import type { IncludeResolver } from './analyzer'
import { findAssignmentIndex } from './argChecker'
import {
  consumeOperand,
  isGroupedStringExprStart,
  resolveStaticControlPart,
  resolveStaticGroupedString,
  resolveStaticLiteralPart,
  tokenGapBefore,
} from './argOperands'
import { commandOutputHint, getCommandOutputEffect } from './commandOutputs'
import {
  extractIncludeArgText,
  includeDynamicBindingKey,
  includeLoopIterationBindingKey,
  normalizeIncludePath,
  resolveLoopIncludeBindingKey,
} from './includeRefs'
import {
  computeStrcompare,
  computeStrlen,
  computeStrscan,
  tryStaticIntegerCommand,
  tryStaticResultCommand,
  tryStaticSprintfCommand,
  tryStaticStr2intCommand,
  tryStaticStringCommand,
  type StaticValueContext,
} from './staticCommandEval'
import { formatSendPayloadForDisplay } from './sendText'
import { collectLabelNames } from './labels'
import { RESERVED, stripComments, tokenizeLine, unquoteString, parseTtlIntegerLiteral, parseTtlCharCodeLiteral, type Token } from './tokenize'
import {
  BLOCK_PAIRS,
  MAX_LOOP_ITERATIONS,
  evalBoolExpr as evalBoolExprShared,
  findBlockEnd,
  lineKeyword,
  type BoolExprScalar,
} from './controlFlow'
import { evalTtlIntExprAt, parseForLoopRangeExprs, type TtlIntExprResolve } from './ttlExpression'
import { formatGetdate, formatGettime } from './ttlDateTime'
import {
  buildStringFromOperands,
  collectSendPayload,
  collectWaitPatterns,
  evalGroupedStringExprAt,
  parseWaitPatternAt,
  createIfdefinedLookup,
  createMacroEnvironment,
  prepareAssignedScalar,
  type MacroEnvironment,
  type RuntimeScalar,
} from './evaluator'
import type { MacroArgvInput } from './commandLineParams'
import { extractIfConditionText } from './branchAssumptions'
import { formatDryRunBranchFlowMessage } from './dryRunBranchCopy'
import {
  findIfThenTailStart,
  findLabelLineIndex,
  findSingleLineIfTailStart,
  MAX_CALL_DEPTH,
  resolveJumpLabelName,
} from './subroutine'

export type DryRunEventKind = 'send' | 'receive-wait' | 'dialog' | 'flow' | 'warning' | 'error'

export interface DryRunEvent {
  id: number
  kind: DryRunEventKind
  line: number
  location: string
  message: string
  command?: string
  payload?: string
  addsNewline?: boolean
  detail?: string
  /** passwordbox 経由の inputstr など、表示・コピー時にマスクする */
  maskPayload?: boolean
}

export type DryRunStatus = 'idle' | 'running' | 'waiting-dialog' | 'stopped' | 'finished' | 'error'

export interface DryRunState {
  status: DryRunStatus
  currentLine: number
  /** formatLocation の結果（例: L3 / sub.ttl:L3） */
  currentLocation?: string
  events: DryRunEvent[]
  truncated?: boolean
  errorMessage?: string
}

const DRY_RUN_STATUS_LABELS: Record<DryRunStatus, string> = {
  idle: '待機',
  running: '実行中',
  'waiting-dialog': '対話待ち',
  stopped: '停止',
  finished: '完了',
  error: 'エラー',
}

/** ドライランイベントの表示用メッセージ（機密マスク適用） */
export function formatDryRunEventMessage(event: DryRunEvent): string {
  if (event.maskPayload && event.command) {
    return `${event.command}: （入力済み）`
  }
  return event.message
}

/** ドライランイベントの表示用ペイロード（機密マスク適用） */
export function formatDryRunEventPayload(event: DryRunEvent): string | undefined {
  if (event.maskPayload) return undefined
  if (event.payload === undefined) return undefined
  const text = formatSendPayloadForDisplay(event.payload)
  return event.addsNewline ? `${text} ↵` : text
}

/** ドライランのログをプレーンテキストに整形（クリップボードコピー用） */
export function buildDryRunPlainTextForCopy(state: DryRunState): string {
  const lines: string[] = []
  const status = DRY_RUN_STATUS_LABELS[state.status] ?? state.status
  const location =
    state.currentLine > 0 ? (state.currentLocation ?? `L${state.currentLine}`) : ''
  lines.push(`# 状態: ${status}${location ? ` / ${location}` : ''}`)
  if (state.errorMessage) lines.push(`# エラー: ${state.errorMessage}`)
  if (state.truncated) lines.push('# ステップ上限で打ち切り')

  if (state.events.length > 0) {
    lines.push('')
    for (const event of state.events) {
      lines.push(`[${event.location}] ${event.kind}: ${formatDryRunEventMessage(event)}`)
      const payload = formatDryRunEventPayload(event)
      if (payload !== undefined) lines.push(payload)
      if (event.detail) lines.push(event.detail)
      lines.push('')
    }
  }

  return lines.join('\n').trimEnd()
}

/** 親マクロ（ドライラン開始タブ）上の行か */
export function isDryRunMainLocation(location: string | undefined): boolean {
  return location !== undefined && /^L\d+$/.test(location)
}

export interface DryRunBranchAssumptionPrompt {
  location: string
  command: string
  conditionText: string
}

/** listbox キーワード引数（公式 Manual 5 / 5.3+） */
export interface ListboxKeywords {
  /** 'dblclick=on' — ダブルクリックで項目確定 */
  dblclick: boolean
  /** 'minmaxbutton=on' — 最小化/最大化ボタン */
  minmaxbutton: boolean
  /** 'minimize=on' — 最小化状態で表示 */
  minimize: boolean
  /** 'maximize=on' — 最大化状態で表示 */
  maximize: boolean
  /** 'listboxsize=WxH' の W（文字数）。省略時 26 */
  listboxWidth: number
  /** 'listboxsize=WxH' の H（文字数＝行数目安）。省略時 6 */
  listboxHeight: number
}

export const DEFAULT_LISTBOX_KEYWORDS: ListboxKeywords = {
  dblclick: false,
  minmaxbutton: false,
  minimize: false,
  maximize: false,
  listboxWidth: 26,
  listboxHeight: 6,
}

export interface DryRunDialogAdapter {
  yesno(message: string, title: string): Promise<boolean | null>
  /** true=OK, false=キャンセル/Escape */
  message(message: string, title: string): Promise<boolean>
  input(message: string, title: string, defaultValue: string, password: boolean): Promise<string | null>
  /**
   * listbox: message / title / 配列項目。
   * selected は 0 オリジンの初期選択（省略時は未選択）。
   * keywords は公式キーワード引数（省略時はデフォルト）。
   */
  list(
    message: string,
    title: string,
    items: string[],
    selected?: number,
    keywords?: ListboxKeywords,
  ): Promise<number | null>
  filename(title: string, filter: string, defaultPath: string): Promise<{ ok: boolean; path: string } | null>
  dirname(title: string, defaultPath: string): Promise<{ ok: boolean; path: string } | null>
  /** 未確定 if/elseif/while/until — TTL yesnobox とは別 UI */
  branchAssumption(options: DryRunBranchAssumptionPrompt): Promise<boolean | null>
  cancel(): void
}

export interface DryRunOptions {
  source: string
  includeResolver?: IncludeResolver
  macroArgv?: MacroArgvInput
  dialogAdapter: DryRunDialogAdapter
  onStateChange?: (state: DryRunState) => void
  yieldEveryLine?: () => Promise<void>
}

type Env = MacroEnvironment

/** Tera Term include ネスト上限（公式） */
const MAX_INCLUDE_DEPTH = 9

function isInfiniteDoLoop(line: string, lineIdx: number): boolean {
  const tokens = tokenizeLine(line, lineIdx + 1)
  let off = tokens[0]?.kind === 'label' ? 1 : 0
  const loopPos = tokens.findIndex(
    (t, i) => i >= off && t.kind === 'identifier' && t.text.toLowerCase() === 'loop',
  )
  if (loopPos < 0) return false
  const whilePos = tokens.findIndex(
    (t, i) => i > loopPos && t.kind === 'identifier' && t.text.toLowerCase() === 'while',
  )
  return whilePos < 0
}

function loopLineHasWhile(line: string, lineIdx: number): boolean {
  return !isInfiniteDoLoop(line, lineIdx) && tokenizeLine(line, lineIdx + 1).some(
    (t) => t.kind === 'identifier' && t.text.toLowerCase() === 'while',
  )
}
const DIALOG_COMMANDS = new Set([
  'yesnobox',
  'messagebox',
  'inputbox',
  'passwordbox',
  'listbox',
  'filenamebox',
  'dirnamebox',
])

const WAIT_COMMANDS = new Set(['wait', 'waitln', 'waitregex', 'wait4all'])
const FLOW_LOG_COMMANDS = new Set(['connect', 'disconnect', 'pause', 'mpause', 'flushrecv', 'sendbreak'])

interface CallFrame {
  returnIdx: number
}

interface ExecOptions {
  includeResolver?: IncludeResolver
  includeStack: string[]
  includeTabStack: string[]
  inInclude?: boolean
  inBlock?: boolean
  locationPrefix?: string
  loopFrame?: { variable: string; value: number; index: number; total: number }
  callStack: CallFrame[]
  loopControl?: { breakRequested: boolean; continueRequested: boolean }
  /** 当該ドライラン実行のみ有効な未確定分岐の True/False */
  dryRunBranchAssumptions?: Map<string, boolean>
}

interface StmtResult {
  nextIdx: number
  jumpTo?: number
  stopAll?: boolean
  stopInclude?: boolean
  stopBlock?: boolean
  truncated?: boolean
}

type BlockRunResult = 'complete' | 'stopAll' | 'stopBlock' | 'stopInclude'

function formatLocation(lineNum: number, prefix?: string): string {
  return prefix ? `${prefix}:L${lineNum}` : `L${lineNum}`
}

function setScalar(env: Env, name: string, value: RuntimeScalar): void {
  env.set(name.toLowerCase(), value)
}

function setResult(
  env: Env,
  setBy: string,
  value: number,
  origin: 'literal' | 'user-input' | 'dialog-result' | 'match-received' | 'system-default',
  extra?: { hint?: string },
): void {
  setScalar(env, 'result', {
    kind: 'int',
    value,
    origin,
    setBy: setBy.toLowerCase(),
    hint: extra?.hint,
  })
}

function setArrayElement(env: Env, name: string, index: number, value: RuntimeScalar): void {
  const key = name.toLowerCase()
  let arr = env.get(key)
  if (!arr || arr.kind !== 'array') {
    arr = { kind: 'array', size: index + 1, elements: new Map() }
    env.set(key, arr)
  }
  arr.elements.set(index, value)
}

function resolveArrayIndex(indexToken: Token, env: Env): number | undefined {
  if (indexToken.kind === 'number') return parseTtlIntegerLiteral(indexToken.text)
  if (indexToken.kind === 'identifier') {
    const v = env.get(indexToken.text.toLowerCase())
    if (v?.kind === 'int') return v.value
  }
  return undefined
}

function evalArrayElement(name: string, indexToken: Token, env: Env): RuntimeScalar | undefined {
  const arr = env.get(name.toLowerCase())
  if (!arr || arr.kind !== 'array') return undefined
  const index = resolveArrayIndex(indexToken, env)
  if (index === undefined) return undefined
  return arr.elements.get(index)
}

function evalTokenValue(token: Token | undefined, env: Env): RuntimeScalar | undefined {
  if (!token) return undefined
  if (token.kind === 'string') return { kind: 'str', value: unquoteString(token.text), origin: 'literal' }
  if (token.kind === 'number') {
    const n = parseTtlIntegerLiteral(token.text)
    return n === undefined ? undefined : { kind: 'int', value: n, origin: 'literal' }
  }
  if (token.kind === 'identifier') {
    const v = env.get(token.text.toLowerCase())
    if (v?.kind === 'int' || v?.kind === 'str') return v
  }
  return undefined
}

/** ドライラン時点で断定できない条件オペランド（未更新のシステム変数・未代入変数） */
function evalResolvableDryRunConditionToken(token: Token | undefined, env: Env): RuntimeScalar | undefined {
  const v = evalTokenValue(token, env)
  if (!v) return undefined
  if (v.kind === 'int' && v.origin === 'system-default') return undefined
  if (v.kind === 'str' && v.origin === 'system-default') return undefined
  return v
}

export function dryRunBranchAssumptionKey(lineNum: number, locationPrefix?: string): string {
  return `${locationPrefix ?? ''}\0${lineNum}`
}

function makeIntExprResolve(env: Env): TtlIntExprResolve {
  return {
    resolveInt(name) {
      const v = env.get(name.toLowerCase())
      return v?.kind === 'int' ? v.value : undefined
    },
    resolveIntArray(name, index) {
      const arr = env.get(name.toLowerCase())
      if (!arr || arr.kind !== 'array') return undefined
      const el = arr.elements.get(index)
      return el?.kind === 'int' ? el.value : undefined
    },
  }
}

function evalIntExprAt(
  tokens: Token[],
  start: number,
  env: Env,
): { value: number; next: number } | undefined {
  const got = evalTtlIntExprAt(tokens, start, makeIntExprResolve(env))
  if (!got || got.error) return undefined
  return { value: got.value, next: got.next }
}

function evalIntExpr(tokens: Token[], start: number, env: Env): number | undefined {
  return evalIntExprAt(tokens, start, env)?.value
}

function evalBoolExpr(
  tokens: Token[],
  env: Env,
  resolveToken: (token: Token | undefined, env: Env) => BoolExprScalar | undefined = evalTokenValue,
): boolean | undefined {
  return evalBoolExprShared(tokens, env, resolveToken, {
    typeMismatchAsFalse: true,
    resolveIntArray(name, index) {
      const arr = env.get(name.toLowerCase())
      if (!arr || arr.kind !== 'array') return undefined
      const el = arr.elements.get(index)
      if (el?.kind !== 'int') return undefined
      // dry-run: 未更新の system-default のみ未確定。dialog-result は直前ダイアログで確定済みなので採用する
      if (el.origin === 'system-default') return undefined
      return el.value
    },
  })
}

/** ドライランでユーザー入力なしに断定できる条件か（シミュレート済みの値は利用可） */
export function tryEvalResolvableDryRunCondition(
  line: string,
  lineIdx: number,
  env: Env,
  cmd: string,
): boolean | undefined {
  const tokens = tokenizeLine(line, lineIdx + 1)
  let off = tokens[0]?.kind === 'label' ? 1 : 0
  let condEnd = tokens.length
  if (cmd === 'if' || cmd === 'elseif') {
    const thenIdx = tokens.findIndex(
      (t, i) => i > off && t.kind === 'identifier' && t.text.toLowerCase() === 'then',
    )
    if (thenIdx >= 0) {
      condEnd = thenIdx
    } else if (cmd === 'if') {
      const tailStart = findSingleLineIfTailStart(tokens, off)
      if (tailStart !== null) condEnd = tailStart
    }
  } else if (cmd !== 'while' && cmd !== 'until') {
    return undefined
  }
  return evalBoolExpr(tokens.slice(off + 1, condEnd), env, evalResolvableDryRunConditionToken)
}

function resolveStringToken(token: Token | undefined, env: Env): string {
  if (!token) return ''
  if (token.kind === 'string') return unquoteString(token.text)
  const v = evalTokenValue(token, env)
  if (v?.kind === 'str') return v.value
  if (v?.kind === 'int') return String(v.value)
  if (token.kind === 'identifier') return token.text
  return token.text
}

function resolveOperandSlice(tokens: Token[], i: number, env: Env): string | undefined {
  const tok = tokens[i]
  if (tok?.text === '#' && tokens[i + 1]?.kind === 'number') {
    const code = parseTtlCharCodeLiteral(tokens[i + 1]!.text)
    // NUL (#0 / #$0) は公式どおり不可。空文字継続せず undefined（send の evalSendOperand と同様）
    if (code === undefined) return undefined
    return String.fromCharCode(code)
  }
  return resolveStringToken(tok, env)
}

function collectStringArgs(tokens: Token[], start: number, env: Env): string[] {
  const args: string[] = []
  let i = start
  while (i < tokens.length) {
    const parts: string[] = []
    let consumed = false
    while (i < tokens.length) {
      if (consumed && tokenGapBefore(tokens, i)) break
      const next = consumeOperand(tokens, i)
      if (next === null) break
      const part = resolveOperandSlice(tokens, i, env)
      if (part === undefined) {
        // #0 等: send と同様に以降のオペランドを取り込まない
        if (consumed) args.push(parts.join(''))
        return args
      }
      parts.push(part)
      consumed = true
      i = next
    }
    if (!consumed) break
    args.push(parts.join(''))
  }
  return args
}

/** 空白区切りの論理引数を 1 個だけ消費（'a'#13 は 1 引数） */
function collectOneStringArg(
  tokens: Token[],
  start: number,
  env: Env,
): { value: string; next: number } | null {
  const parts: string[] = []
  let i = start
  let consumed = false
  while (i < tokens.length) {
    if (consumed && tokenGapBefore(tokens, i)) break
    const next = consumeOperand(tokens, i)
    if (next === null) break
    const part = resolveOperandSlice(tokens, i, env)
    if (part === undefined) {
      // #0 等: ここまでの連結だけ返す（位置は拒否トークン上＝後続を誤読しない）
      if (!consumed) return null
      return { value: parts.join(''), next: i }
    }
    parts.push(part)
    consumed = true
    i = next
  }
  if (!consumed) return null
  return { value: parts.join(''), next: i }
}

/** listbox の <string array>（公式: 全要素を表示。未代入は空文字列） */
function collectStringArrayItems(env: Env, name: string): string[] | undefined {
  const arr = env.get(name.toLowerCase())
  if (!arr || arr.kind !== 'array') return undefined
  const items: string[] = []
  for (let i = 0; i < arr.size; i++) {
    const el = arr.elements.get(i)
    if (el?.kind === 'str') items.push(el.value)
    else if (el?.kind === 'int') items.push(String(el.value))
    else items.push('')
  }
  return items
}

/** 公式キーワード文字列（'dblclick=on' / 'listboxsize=60x20' 等）を反映 */
export function applyListboxKeyword(raw: string, into: ListboxKeywords): void {
  const eq = raw.indexOf('=')
  if (eq <= 0) return
  const key = raw.slice(0, eq).trim().toLowerCase()
  const val = raw.slice(eq + 1).trim()
  const valLower = val.toLowerCase()
  if (key === 'dblclick') {
    into.dblclick = valLower === 'on'
  } else if (key === 'minmaxbutton') {
    into.minmaxbutton = valLower === 'on'
  } else if (key === 'minimize') {
    into.minimize = valLower === 'on'
  } else if (key === 'maximize') {
    into.maximize = valLower === 'on'
  } else if (key === 'listboxsize') {
    const size = /^(\d+)\s*[xX]\s*(\d+)$/.exec(val)
    if (size) {
      into.listboxWidth = Number(size[1])
      into.listboxHeight = Number(size[2])
    }
  }
}

/**
 * listbox <message> <title> <string array> [<selected>] [<keyword>...]
 * @see https://teratermproject.github.io/manual/5/en/macro/command/listbox.html
 *
 * <selected> 省略時: 公式 Parameters は「何も選択されない」、Remarks は「デフォルト 0」と矛盾。
 * 本実装は Parameters に合わせ selected を undefined とする（UI は先頭へフォーカスするが未確定）。
 */
function parseListboxArgs(
  tokens: Token[],
  offset: number,
  env: Env,
): { message: string; title: string; items: string[]; selected?: number; keywords: ListboxKeywords } {
  let i = offset + 1
  const messageArg = collectOneStringArg(tokens, i, env)
  const message = messageArg?.value ?? ''
  if (messageArg) i = messageArg.next

  const titleArg = collectOneStringArg(tokens, i, env)
  const title = titleArg?.value ?? '選択'
  if (titleArg) i = titleArg.next

  let items: string[] = []
  const arrayTok = tokens[i]
  if (arrayTok?.kind === 'identifier') {
    items = collectStringArrayItems(env, arrayTok.text) ?? []
    i += 1
  }

  let selected: number | undefined
  const selectedExpr = evalIntExprAt(tokens, i, env)
  if (selectedExpr) {
    selected = selectedExpr.value
    i = selectedExpr.next
  }

  const keywords: ListboxKeywords = { ...DEFAULT_LISTBOX_KEYWORDS }
  while (i < tokens.length) {
    const kwArg = collectOneStringArg(tokens, i, env)
    if (!kwArg) break
    applyListboxKeyword(kwArg.value, keywords)
    i = kwArg.next
  }

  return { message, title, items, selected, keywords }
}

function formatWaitPatternLabel(pattern: string): string {
  return pattern === '' ? '（空＝任意1文字）' : pattern
}

function buildWaitReceiveEvent(
  cmd: string,
  patterns: string[],
  lineNum: number,
  locationPrefix?: string,
): Omit<DryRunEvent, 'id'> {
  const simulated = patterns[0] ?? ''
  const requireAll = cmd === 'wait4all'
  let message: string
  let detail: string | undefined

  if (patterns.length === 0) {
    message = `${cmd}: 待機パターン「（任意）」`
  } else if (patterns.length === 1) {
    message = `${cmd}: 待機パターン「${formatWaitPatternLabel(patterns[0]!)}」`
  } else {
    const modeLabel = requireAll ? '（すべて）' : '（いずれか）'
    const listed = patterns.map((p, i) => `#${i + 1}「${formatWaitPatternLabel(p)}」`).join(' ')
    message = `${cmd}: 待機パターン${modeLabel} ${listed}`
    detail = requireAll
      ? 'ドライラン: result=1（すべてに一致想定）'
      : `ドライラン: result=1（#1 ${formatWaitPatternLabel(simulated)} に一致想定）`
  }

  return {
    kind: 'receive-wait',
    line: lineNum,
    location: formatLocation(lineNum, locationPrefix),
    command: cmd,
    message,
    payload: patterns.length === 1 ? simulated : undefined,
    detail,
  }
}

/** ドライラン実行時点で利用可能な文字列か（inputbox / wait のシミュレート結果を含む） */
function isDryRunResolvableStringValue(v: RuntimeScalar): v is RuntimeScalar & { kind: 'str' } {
  if (v.kind !== 'str') return false
  if (v.origin === 'dialog-result') return false
  if (v.hasUnresolvedParts) return false
  if (!v.value && v.hint) return false
  return true
}

function resolveDryRunString(token: Token | undefined, env: Env): string | undefined {
  if (!token) return undefined
  if (token.kind === 'string') return unquoteString(token.text)
  if (token.kind === 'identifier') {
    const v = env.get(token.text.toLowerCase())
    if (v?.kind === 'str' && isDryRunResolvableStringValue(v)) return v.value
  }
  return undefined
}

function createStaticCtx(tokens: Token[], offset: number, env: Env): StaticValueContext {
  return {
    tokenAt(rel) {
      return tokens[offset + rel]
    },
    resolveString(rel) {
      return resolveDryRunString(tokens[offset + rel], env)
    },
    resolveInt(rel) {
      return evalIntExpr(tokens, offset + rel, env)
    },
    resolveInPlaceVar(rel) {
      const tok = tokens[offset + rel]
      if (tok?.kind !== 'identifier') return undefined
      const v = env.get(tok.text.toLowerCase())
      if (v?.kind === 'str' && isDryRunResolvableStringValue(v)) return v.value
      return undefined
    },
    resolveGroupedString(rel) {
      return resolveStaticGroupedString(tokens, offset + rel, (tok, i) => {
        const ctrl = resolveStaticControlPart(tokens, i)
        if (ctrl !== undefined) return ctrl
        const lit = resolveStaticLiteralPart(tok)
        if (lit !== undefined) return lit
        if (tok.kind === 'identifier') {
          const v = env.get(tok.text.toLowerCase())
          if (v?.kind === 'str' && isDryRunResolvableStringValue(v)) return v.value
        }
        return undefined
      })
    },
  }
}

function applyStaticCommandEffects(
  cmd: string,
  tokens: Token[],
  offset: number,
  env: Env,
  knownLabels: ReadonlySet<string>,
): boolean {
  const staticCtx = createStaticCtx(tokens, offset, env)
  const sprintfResult = tryStaticSprintfCommand(cmd, offset, staticCtx)
  if (sprintfResult) {
    if (cmd === 'sprintf2' && sprintfResult.result === 0 && sprintfResult.destIndex !== undefined) {
      const destTok = tokens[sprintfResult.destIndex]
      if (destTok?.kind === 'identifier') {
        setScalar(env, destTok.text, {
          kind: 'str',
          value: sprintfResult.value,
          origin: 'literal',
        })
      }
    } else if (cmd === 'sprintf' && sprintfResult.result === 0) {
      setScalar(env, 'inputstr', {
        kind: 'str',
        value: sprintfResult.value,
        origin: 'literal',
      })
    }
    setResult(env, cmd, sprintfResult.result, 'literal')
    return true
  }

  const strResult = tryStaticStringCommand(cmd, offset, staticCtx)
  if (strResult) {
    const destTok = tokens[strResult.destIndex]
    if (destTok?.kind === 'identifier') {
      let sensitive: boolean | undefined
      const srcTok = tokens[offset + 1]
      if (srcTok?.kind === 'identifier') {
        const src = env.get(srcTok.text.toLowerCase())
        if (src?.kind === 'str' && src.sensitive) sensitive = true
      }
      setScalar(env, destTok.text, {
        kind: 'str',
        value: strResult.value,
        origin: 'literal',
        sensitive,
      })
      return true
    }
  }

  const str2intResult = tryStaticStr2intCommand(cmd, offset, staticCtx)
  if (str2intResult) {
    const destTok = tokens[str2intResult.destIndex]
    if (destTok?.kind === 'identifier') {
      setScalar(env, destTok.text, { kind: 'int', value: str2intResult.value, origin: 'literal' })
      setResult(env, cmd, str2intResult.result, 'literal')
      return true
    }
  }

  const intResult = tryStaticIntegerCommand(cmd, offset, staticCtx)
  if (intResult) {
    const destTok = tokens[intResult.destIndex]
    if (destTok?.kind === 'identifier') {
      setScalar(env, destTok.text, { kind: 'int', value: intResult.value })
      return true
    }
  }

  const resultOnlyStringCmds = new Set(['strcompare', 'strlen', 'strlength', 'strscan'])
  if (resultOnlyStringCmds.has(cmd)) {
    const args = collectStringArgs(tokens, offset + 1, env)
    if (cmd === 'strcompare' && args.length >= 2) {
      setResult(env, cmd, computeStrcompare(args[0]!, args[1]!), 'literal')
      return true
    }
    if ((cmd === 'strlen' || cmd === 'strlength') && args.length >= 1) {
      setResult(env, cmd, computeStrlen(args[0]!), 'literal')
      return true
    }
    if (cmd === 'strscan' && args.length >= 2) {
      setResult(env, cmd, computeStrscan(args[0]!, args[1]!), 'literal')
      return true
    }
  }

  if (cmd === 'ifdefined') {
    const nameTok = tokens[offset + 1]
    if (nameTok?.kind === 'identifier' || nameTok?.kind === 'label') {
      const resultVal = tryStaticResultCommand(cmd, staticCtx, {
        ifdefined: createIfdefinedLookup(env, knownLabels),
        ifdefinedName: nameTok.text,
      })
      if (resultVal !== undefined) {
        setResult(env, cmd, resultVal, 'literal')
        return true
      }
    }
  }

  const resultVal = tryStaticResultCommand(cmd, staticCtx)
  if (resultVal !== undefined) {
    setResult(env, cmd, resultVal, 'literal')
    return true
  }

  return false
}

function isArrayAssignTarget(tokens: Token[], eqIdx: number): string | null {
  if (eqIdx < 4) return null
  const close = tokens[eqIdx - 1]
  const index = tokens[eqIdx - 2]
  const open = tokens[eqIdx - 3]
  const name = tokens[eqIdx - 4]
  if (
    close?.text === ']' &&
    open?.text === '[' &&
    name?.kind === 'identifier' &&
    (index?.kind === 'number' || index?.kind === 'identifier')
  ) {
    return name.text
  }
  return null
}

function resolveIncludeEffectiveRaw(tokens: Token[], offset: number, env: Env): string | undefined {
  const argStart = offset + 1
  if (argStart >= tokens.length) return undefined
  const name = tokens[argStart]
  if (name?.kind === 'string') return unquoteString(name.text)
  if (name?.kind !== 'identifier') return undefined
  const open = tokens[argStart + 1]
  const indexTok = tokens[argStart + 2]
  const close = tokens[argStart + 3]
  if (open?.text === '[' && close?.text === ']' && indexTok) {
    const el = evalArrayElement(name.text, indexTok, env)
    if (el?.kind === 'str') return el.value
    return undefined
  }
  const v = env.get(name.text.toLowerCase())
  if (v?.kind === 'str') return v.value
  return undefined
}

function resolveEnvString(env: Env, name: string): string | undefined {
  const v = env.get(name)
  return v?.kind === 'str' && v.value ? v.value : undefined
}

function forLoopIterationCount(start: number, end: number): number {
  return Math.abs(end - start) + 1
}

function canUnrollForLoop(start: number, end: number): boolean {
  return forLoopIterationCount(start, end) <= MAX_LOOP_ITERATIONS
}

export class DryRunSession {
  private readonly lines: string[]
  private readonly env: Env
  private readonly knownLabels: ReadonlySet<string>
  private readonly opts: DryRunOptions
  private stopped = false
  private steps = 0
  private truncatedByStepLimit = false
  private readonly maxSteps: number
  private eventCounter = 0
  private state: DryRunState = { status: 'idle', currentLine: 0, events: [] }

  constructor(options: DryRunOptions) {
    this.opts = options
    this.lines = stripComments(options.source)
    this.env = createMacroEnvironment(options.macroArgv)
    this.knownLabels = collectLabelNames(this.lines)
    this.maxSteps = Math.max(this.lines.length * 8, 128)
  }

  getState(): DryRunState {
    return this.state
  }

  stop(): void {
    this.stopped = true
    this.opts.dialogAdapter.cancel()
    this.patchState({ status: 'stopped' })
  }

  private abortRun(): void {
    this.stop()
  }

  private patchState(patch: Partial<DryRunState>): void {
    this.state = { ...this.state, ...patch }
    this.opts.onStateChange?.(this.state)
  }

  private pushEvent(event: Omit<DryRunEvent, 'id'>): void {
    const full: DryRunEvent = { ...event, id: ++this.eventCounter }
    this.state = { ...this.state, events: [...this.state.events, full] }
    this.opts.onStateChange?.(this.state)
  }

  private pushSendEvent(
    lineNum: number,
    execOpts: { locationPrefix?: string },
    cmd: 'send' | 'sendln',
    tokens: Token[],
    tokenStart: number,
  ): void {
    const { payload, rawArgs, unresolved, sensitive } = collectSendPayload(tokens, tokenStart, this.env)
    const maskPayload = sensitive
    const displayPayload = maskPayload ? '（入力済み）' : payload || '（空）'
    this.pushEvent({
      kind: 'send',
      line: lineNum,
      location: formatLocation(lineNum, execOpts.locationPrefix),
      command: cmd,
      message: `${cmd}: ${displayPayload}`,
      payload,
      addsNewline: cmd === 'sendln',
      detail: rawArgs + (unresolved ? '（未解決を含む）' : ''),
      maskPayload: maskPayload || undefined,
    })
  }

  private finishDialog(): void {
    if (!this.stopped) {
      this.patchState({ status: 'running', currentLine: this.state.currentLine })
    }
  }

  /** 行単位のステップ加算・yield・停止チェック（ネスト実行でも共通） */
  private async advanceStep(lineNum: number, locationPrefix?: string): Promise<'ok' | 'abort'> {
    if (++this.steps > this.maxSteps) {
      this.truncatedByStepLimit = true
      this.pushEvent({
        kind: 'warning',
        line: lineNum,
        location: formatLocation(lineNum, locationPrefix),
        message: 'ステップ上限に達したため実行を打ち切りました',
      })
      return 'abort'
    }
    this.patchState({
      status: 'running',
      currentLine: lineNum,
      currentLocation: formatLocation(lineNum, locationPrefix),
    })
    await this.opts.yieldEveryLine?.()
    if (this.stopped) return 'abort'
    return 'ok'
  }

  private async resolveDryRunBoolExprTokens(
    condTokens: Token[],
    lineNum: number,
    env: Env,
    cmd: string,
    execOpts: ExecOptions,
    conditionText: string,
  ): Promise<boolean | undefined> {
    const resolved = evalBoolExpr(condTokens, env, evalResolvableDryRunConditionToken)
    if (resolved !== undefined) return resolved

    const key = dryRunBranchAssumptionKey(lineNum, execOpts.locationPrefix)
    const cached = execOpts.dryRunBranchAssumptions?.get(key)
    if (cached !== undefined) return cached

    const location = formatLocation(lineNum, execOpts.locationPrefix)

    this.patchState({
      status: 'waiting-dialog',
      currentLine: lineNum,
      currentLocation: location,
    })

    const choice = await this.opts.dialogAdapter.branchAssumption({
      location,
      command: cmd,
      conditionText,
    })

    if (this.stopped) {
      this.abortRun()
      return undefined
    }

    if (choice === null) {
      this.stopped = true
      this.patchState({ status: 'stopped' })
      return undefined
    }

    if (!execOpts.dryRunBranchAssumptions) {
      execOpts.dryRunBranchAssumptions = new Map()
    }
    execOpts.dryRunBranchAssumptions.set(key, choice)

    this.pushEvent({
      kind: 'flow',
      line: lineNum,
      location,
      command: cmd,
      message: formatDryRunBranchFlowMessage(cmd, choice),
      detail: conditionText,
    })
    this.finishDialog()
    return choice
  }

  private async resolveDryRunCondition(
    line: string,
    lineIdx: number,
    lineNum: number,
    env: Env,
    cmd: string,
    execOpts: ExecOptions,
  ): Promise<boolean | undefined> {
    const tokens = tokenizeLine(line, lineIdx + 1)
    let off = tokens[0]?.kind === 'label' ? 1 : 0
    let condEnd = tokens.length
    if (cmd === 'if' || cmd === 'elseif') {
      const thenIdx = tokens.findIndex(
        (t, i) => i > off && t.kind === 'identifier' && t.text.toLowerCase() === 'then',
      )
      if (thenIdx >= 0) {
        condEnd = thenIdx
      } else if (cmd === 'if') {
        const tailStart = findSingleLineIfTailStart(tokens, off)
        if (tailStart !== null) condEnd = tailStart
      }
    } else if (cmd !== 'while' && cmd !== 'until') {
      return undefined
    }
    const conditionText = extractIfConditionText(line, lineIdx, cmd)
    return this.resolveDryRunBoolExprTokens(
      tokens.slice(off + 1, condEnd),
      lineNum,
      env,
      cmd,
      execOpts,
      conditionText || '（条件）',
    )
  }

  private async resolveLoopWhileCondition(
    loopLine: string,
    lineIdx: number,
    env: Env,
    execOpts: ExecOptions,
  ): Promise<boolean | undefined> {
    const lineNum = lineIdx + 1
    const tokens = tokenizeLine(loopLine, lineNum)
    let off = tokens[0]?.kind === 'label' ? 1 : 0
    const whilePos = tokens.findIndex(
      (t, i) => i > off && t.kind === 'identifier' && t.text.toLowerCase() === 'while',
    )
    if (whilePos < 0) return undefined
    const condTokens = tokens.slice(whilePos + 1)
    const conditionText = condTokens.map((t) => t.text).join(' ').trim() || '（条件）'
    return this.resolveDryRunBoolExprTokens(condTokens, lineNum, env, 'while', execOpts, conditionText)
  }

  private async processSingleLineIf(
    env: Env,
    lines: string[],
    lineIdx: number,
    lineNum: number,
    tokens: Token[],
    offset: number,
    condEnd: number,
    tailStart: number,
    execOpts: ExecOptions,
  ): Promise<StmtResult> {
    const condTokens = tokens.slice(offset + 1, condEnd)
    const conditionText = condTokens.map((t) => t.text).join(' ').trim() || '（条件）'
    const cond = await this.resolveDryRunBoolExprTokens(
      condTokens,
      lineNum,
      env,
      'if',
      execOpts,
      conditionText,
    )
    if (cond === undefined && this.stopped) return { nextIdx: lineIdx, stopAll: true }
    if (cond === true) {
      const tailCmd = tokens[tailStart]?.kind === 'identifier' ? tokens[tailStart]!.text.toLowerCase() : ''
      if (tailCmd === 'break') {
        if (execOpts.loopControl) {
          execOpts.loopControl.breakRequested = true
          return { nextIdx: lineIdx, stopBlock: true }
        }
        this.pushEvent({
          kind: 'error',
          line: lineNum,
          location: formatLocation(lineNum, execOpts.locationPrefix),
          command: 'break',
          message: 'break はループ内でのみ使用できます',
        })
        return { nextIdx: lineIdx, stopAll: true }
      }
      if (tailCmd === 'continue') {
        if (execOpts.loopControl) {
          execOpts.loopControl.continueRequested = true
          return { nextIdx: lineIdx, stopBlock: true }
        }
        this.pushEvent({
          kind: 'error',
          line: lineNum,
          location: formatLocation(lineNum, execOpts.locationPrefix),
          command: 'continue',
          message: 'continue はループ内でのみ使用できます',
        })
        return { nextIdx: lineIdx, stopAll: true }
      }
      if (tailCmd === 'goto' || tailCmd === 'call') {
        return this.processGotoCall(env, lines, lineIdx, tokens, tailStart, execOpts)
      }
      if (tailCmd === 'send' || tailCmd === 'sendln') {
        this.pushSendEvent(lineNum, execOpts, tailCmd, tokens, tailStart + 1)
      } else if (
        WAIT_COMMANDS.has(tailCmd) ||
        tailCmd === 'recvln' ||
        tailCmd === 'waitrecv'
      ) {
        await this.processLineEffects(env, lineNum, tokens, tailStart, tailCmd, execOpts)
      }
    }
    return { nextIdx: lineIdx }
  }

  async run(): Promise<DryRunState> {
    this.eventCounter = 0
    this.stopped = false
    this.steps = 0
    this.truncatedByStepLimit = false
    this.state = { status: 'running', currentLine: 0, events: [] }
    this.opts.onStateChange?.(this.state)

    const execOpts: ExecOptions = {
      includeResolver: this.opts.includeResolver,
      includeStack: [],
      includeTabStack: [],
      callStack: [],
    }

    let lineIdx = 0

    try {
      while (lineIdx < this.lines.length && !this.stopped) {
        const step = await this.advanceStep(lineIdx + 1, execOpts.locationPrefix)
        if (step === 'abort') break

        const result = await this.processStatement(this.env, this.lines, lineIdx, execOpts)
        if (result.truncated) this.truncatedByStepLimit = true
        if (result.stopAll) break
        if (this.stopped) break
        if (result.jumpTo !== undefined) {
          lineIdx = result.jumpTo
        } else {
          lineIdx = result.nextIdx + 1
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.pushEvent({
        kind: 'error',
        line: this.state.currentLine,
        location: formatLocation(this.state.currentLine, execOpts.locationPrefix),
        message,
      })
      this.patchState({ status: 'error', errorMessage: message })
      return this.state
    }

    if (this.stopped) return this.state

    this.patchState({
      status: 'finished',
      truncated: this.truncatedByStepLimit || undefined,
    })
    return this.state
  }

  private async processLineEffects(
    env: Env,
    lineNum: number,
    tokens: Token[],
    offset: number,
    cmd: string,
    execOpts: ExecOptions,
  ): Promise<void> {
    if (cmd === 'strdim' && tokens[offset + 1]?.kind === 'identifier') {
      const size = evalIntExpr(tokens, offset + 2, env) ?? 0
      env.set(tokens[offset + 1].text.toLowerCase(), {
        kind: 'array',
        size,
        elements: new Map(),
        elementKind: 'str',
      })
      return
    }
    if (cmd === 'intdim' && tokens[offset + 1]?.kind === 'identifier') {
      const size = evalIntExpr(tokens, offset + 2, env) ?? 0
      env.set(tokens[offset + 1].text.toLowerCase(), {
        kind: 'array',
        size,
        elements: new Map(),
        elementKind: 'int',
      })
      return
    }

    const assignIdx = findAssignmentIndex(tokens, offset)
    if (assignIdx > offset) {
      const arrayName = isArrayAssignTarget(tokens, assignIdx)
      const rhsStart = assignIdx + 1
      let scalar: RuntimeScalar | undefined
      if (isGroupedStringExprStart(tokens, rhsStart)) {
        const grouped = evalGroupedStringExprAt(tokens, rhsStart, env)
        scalar = grouped?.scalar ?? evalTokenValue(tokens[rhsStart], env)
      } else {
        const intVal = evalIntExpr(tokens, rhsStart, env)
        if (intVal !== undefined) {
          scalar = { kind: 'int', value: intVal }
        } else {
          scalar = evalTokenValue(tokens[rhsStart], env)
        }
      }
      if (arrayName !== null && scalar) {
        const indexTok = tokens[assignIdx - 2]
        const index =
          indexTok?.kind === 'number'
            ? parseTtlIntegerLiteral(indexTok.text)
            : indexTok?.kind === 'identifier'
              ? env.get(indexTok.text.toLowerCase())?.kind === 'int'
                ? (env.get(indexTok.text.toLowerCase()) as RuntimeScalar & { kind: 'int' }).value
                : undefined
              : undefined
        if (index !== undefined) setArrayElement(env, arrayName, index, prepareAssignedScalar(scalar))
        return
      }
      const lhs = tokens[assignIdx - 1]
      if (lhs?.kind === 'identifier' && !RESERVED.has(lhs.text.toLowerCase()) && scalar) {
        setScalar(env, lhs.text, prepareAssignedScalar(scalar))
        return
      }
    }

    if (cmd === 'strconcat' && tokens[offset + 1]?.kind === 'identifier') {
      if (applyStaticCommandEffects(cmd, tokens, offset, env, this.knownLabels)) return
      const dest = tokens[offset + 1].text
      const operands: RuntimeScalar[] = []
      const existing = env.get(dest.toLowerCase())
      if (existing?.kind === 'str') operands.push(existing)
      const grouped = evalGroupedStringExprAt(tokens, offset + 2, env)
      if (grouped) operands.push(grouped.scalar)
      if (operands.length > 0) setScalar(env, dest, buildStringFromOperands(operands))
      return
    }

    if (applyStaticCommandEffects(cmd, tokens, offset, env, this.knownLabels)) return

    if (cmd === 'recvln') {
      this.pushEvent(buildWaitReceiveEvent(cmd, [], lineNum, execOpts.locationPrefix))
      setResult(env, cmd, 1, 'literal')
      setScalar(env, 'inputstr', { kind: 'str', value: '〈受信行〉', origin: 'match-received' })
      return
    }

    if (cmd === 'waitrecv') {
      const parsed = parseWaitPatternAt(tokens, offset + 1, env)
      const sub = parsed?.pattern ?? ''
      const len = parsed ? evalIntExpr(tokens, parsed.next, env) : undefined
      const pos = parsed ? evalIntExpr(tokens, parsed.next + 1, env) : undefined
      const lenLabel = len !== undefined ? String(len) : '?'
      const posLabel = pos !== undefined ? String(pos) : '?'
      this.pushEvent({
        kind: 'receive-wait',
        line: lineNum,
        location: formatLocation(lineNum, execOpts.locationPrefix),
        command: cmd,
        message: `waitrecv: 部分一致「${formatWaitPatternLabel(sub)}」 len=${lenLabel} pos=${posLabel}`,
        payload: sub || undefined,
      })
      setResult(env, cmd, 1, 'literal')
      setScalar(env, 'inputstr', {
        kind: 'str',
        value: sub || '〈受信行〉',
        origin: 'match-received',
      })
      return
    }

    if (WAIT_COMMANDS.has(cmd)) {
      const patterns = collectWaitPatterns(tokens, offset + 1, env)
      const simulated = patterns[0] ?? ''
      this.pushEvent(buildWaitReceiveEvent(cmd, patterns, lineNum, execOpts.locationPrefix))

      let matchstrValue: string
      if (patterns.length === 0) {
        matchstrValue = '〈受信データ〉'
      } else if (patterns[0] === '') {
        matchstrValue = ''
      } else {
        matchstrValue = simulated || '〈受信データ〉'
      }
      const matchOrigin =
        patterns.length > 0 &&
        tokens[offset + 1]?.kind === 'string' &&
        patterns[0] === unquoteString(tokens[offset + 1]!.text)
          ? 'literal'
          : 'match-received'
      setScalar(env, 'matchstr', { kind: 'str', value: matchstrValue, origin: matchOrigin })

      setResult(env, cmd, 1, 'literal')
      return
    }

    if (FLOW_LOG_COMMANDS.has(cmd)) {
      const args = collectStringArgs(tokens, offset + 1, env).join(', ')
      this.pushEvent({
        kind: 'flow',
        line: lineNum,
        location: formatLocation(lineNum, execOpts.locationPrefix),
        command: cmd,
        message: `${cmd}${args ? `: ${args}` : ''}（ドライラン: 通信なし）`,
      })
      if (cmd === 'connect') setResult(env, cmd, 0, 'dialog-result')
      return
    }

    if (DIALOG_COMMANDS.has(cmd)) {
      await this.handleDialog(cmd, tokens, offset, lineNum, env, execOpts)
      return
    }

    if (cmd === 'gettime' || cmd === 'getdate') {
      this.handleGetDateTime(cmd, tokens, offset, lineNum, env, execOpts)
      return
    }

    const effect = getCommandOutputEffect(cmd)
    if (effect) {
      for (const slot of effect.variables ?? []) {
        const tok = tokens[slot.index]
        if (tok?.kind !== 'identifier') continue
        if (slot.type === 'integer') {
          setScalar(env, tok.text, { kind: 'int', value: 0, hint: commandOutputHint(cmd) })
        } else {
          setScalar(env, tok.text, { kind: 'str', value: '', hint: commandOutputHint(cmd) })
        }
      }
      for (const sys of effect.systemVariables ?? []) {
        const origin =
          sys.name === 'inputstr' ? 'user-input' : sys.name.startsWith('groupmatchstr') || sys.name === 'matchstr' ? 'match-received' : 'dialog-result'
        if (sys.type === 'integer') setScalar(env, sys.name, { kind: 'int', value: 0, origin })
        else setScalar(env, sys.name, { kind: 'str', value: '', origin })
      }
      if (effect.setsResult) {
        const skipResult =
          cmd === 'getver' &&
          (() => {
            const cmdIdx = tokens.findIndex((t) => t.kind === 'identifier' && t.text.toLowerCase() === 'getver')
            return cmdIdx >= 0 && tokens[cmdIdx + 2] === undefined
          })()
        if (!skipResult) setResult(env, cmd, 0, 'dialog-result')
      }
      if (!DIALOG_COMMANDS.has(cmd)) {
        this.pushEvent({
          kind: 'flow',
          line: lineNum,
          location: formatLocation(lineNum, execOpts.locationPrefix),
          command: cmd,
          message: `${cmd}（ドライラン: 副作用のみ記録）`,
        })
      }
    }
  }

  /**
   * gettime / getdate — ドライラン実行時刻で実値を埋める（静的解析はプレースホルダのまま）。
   * format / timezone が未解決のときは宛先を実行時プレースホルダにし、result は更新しない。
   * 公式どおり result=1/2 のときは宛先へ格納しない（既存値も消す）。
   */
  private handleGetDateTime(
    cmd: 'gettime' | 'getdate',
    tokens: Token[],
    offset: number,
    lineNum: number,
    env: Env,
    execOpts: ExecOptions,
  ): void {
    const dest = tokens[offset + 1]
    if (dest?.kind !== 'identifier') return
    const destKey = dest.text.toLowerCase()

    const formatTok = tokens[offset + 2]
    let format: string | undefined
    if (formatTok) {
      format = resolveDryRunString(formatTok, env)
      if (format === undefined) {
        // 書式自体が未解決 → 成功/失敗も実行時まで不明なので result は触らない
        setScalar(env, dest.text, { kind: 'str', value: '', hint: commandOutputHint(cmd) })
        this.pushEvent({
          kind: 'flow',
          line: lineNum,
          location: formatLocation(lineNum, execOpts.locationPrefix),
          command: cmd,
          message: `${cmd}（ドライラン: 書式が未解決のため実行時扱い）`,
        })
        return
      }
    }

    const tzTok = tokens[offset + 3]
    let timezone: string | undefined
    if (tzTok) {
      timezone = resolveDryRunString(tzTok, env)
      if (timezone === undefined) {
        setScalar(env, dest.text, { kind: 'str', value: '', hint: commandOutputHint(cmd) })
        this.pushEvent({
          kind: 'flow',
          line: lineNum,
          location: formatLocation(lineNum, execOpts.locationPrefix),
          command: cmd,
          message: `${cmd}（ドライラン: タイムゾーンが未解決のため実行時扱い）`,
        })
        return
      }
    }

    const now = new Date()
    const formatted =
      cmd === 'gettime' ? formatGettime(format, now, timezone) : formatGetdate(format, now, timezone)

    if (formatted.ok) {
      setScalar(env, dest.text, { kind: 'str', value: formatted.value, origin: 'literal' })
      setResult(env, cmd, 0, 'literal')
      const note = formatted.timezoneNote ? ` / ${formatted.timezoneNote}` : ''
      this.pushEvent({
        kind: 'flow',
        line: lineNum,
        location: formatLocation(lineNum, execOpts.locationPrefix),
        command: cmd,
        message: `${cmd}: '${formatted.value}'${note}`,
      })
      return
    }

    // result=1: 長すぎて未格納 / result=2: 書式不正で未格納（公式: 宛先は更新しない）
    env.delete(destKey)
    setResult(env, cmd, formatted.result, 'literal')
    this.pushEvent({
      kind: 'warning',
      line: lineNum,
      location: formatLocation(lineNum, execOpts.locationPrefix),
      command: cmd,
      message:
        formatted.result === 1
          ? `${cmd}: 生成文字列が 511 文字を超えたため未格納 (result=1)`
          : `${cmd}: 書式が不正なため未格納 (result=2)`,
    })
  }

  private async handleDialog(
    cmd: string,
    tokens: Token[],
    offset: number,
    lineNum: number,
    env: Env,
    execOpts: ExecOptions,
  ): Promise<void> {
    const args = collectStringArgs(tokens, offset + 1, env)
    this.patchState({
      status: 'waiting-dialog',
      currentLine: lineNum,
      currentLocation: formatLocation(lineNum, execOpts.locationPrefix),
    })

    if (cmd === 'yesnobox') {
      const message = args[0] ?? ''
      const title = args[1] ?? '確認'
      const answer = await this.opts.dialogAdapter.yesno(message, title)
      if (this.stopped) {
        this.abortRun()
        return
      }
      const yes = answer === true
      setResult(env, cmd, yes ? 1 : 0, 'dialog-result')
      this.pushEvent({
        kind: 'dialog',
        line: lineNum,
        location: formatLocation(lineNum, execOpts.locationPrefix),
        command: cmd,
        message: `yesnobox: ${yes ? 'Yes' : 'No'}`,
        detail: message,
      })
      this.finishDialog()
      return
    }

    if (cmd === 'messagebox') {
      const message = args[0] ?? ''
      const title = args[1] ?? 'メッセージ'
      const ok = await this.opts.dialogAdapter.message(message, title)
      if (this.stopped) {
        this.abortRun()
        return
      }
      // 公式 messagebox は result を更新しない。ドライランのみダイアログ応答を result に載せる
      // （静的解析の RESULT_COMMAND_META には含めない）
      setResult(env, cmd, ok ? 1 : 0, 'dialog-result')
      this.pushEvent({
        kind: 'dialog',
        line: lineNum,
        location: formatLocation(lineNum, execOpts.locationPrefix),
        command: cmd,
        message: ok ? 'messagebox: OK' : 'messagebox: キャンセル',
        detail: message,
      })
      this.finishDialog()
      return
    }

    if (cmd === 'inputbox' || cmd === 'passwordbox') {
      const message = args[0] ?? ''
      const title = args[1] ?? '入力'
      const defaultValue = args[2] ?? ''
      const password = cmd === 'passwordbox'
      const value = await this.opts.dialogAdapter.input(message, title, defaultValue, password)
      if (this.stopped) {
        this.abortRun()
        return
      }
      setScalar(env, 'inputstr', {
        kind: 'str',
        value: value ?? '',
        origin: 'user-input',
        sensitive: password || undefined,
      })
      this.pushEvent({
        kind: 'dialog',
        line: lineNum,
        location: formatLocation(lineNum, execOpts.locationPrefix),
        command: cmd,
        message: password ? `${cmd}: （入力済み）` : `${cmd}: ${value ?? ''}`,
        detail: message,
      })
      this.finishDialog()
      return
    }

    if (cmd === 'listbox') {
      // 公式: listbox <message> <title> <string array> [<selected>] [keyword...]
      const {
        message,
        title,
        items,
        selected: initialSelected,
        keywords,
      } = parseListboxArgs(tokens, offset, env)
      const selected = await this.opts.dialogAdapter.list(
        message,
        title,
        items,
        initialSelected,
        keywords,
      )
      if (this.stopped) {
        this.abortRun()
        return
      }
      const resultIndex = selected === null ? -1 : selected
      setResult(env, cmd, resultIndex, 'dialog-result')
      const item = resultIndex >= 0 ? (items[resultIndex] ?? '') : ''
      this.pushEvent({
        kind: 'dialog',
        line: lineNum,
        location: formatLocation(lineNum, execOpts.locationPrefix),
        command: cmd,
        message: resultIndex >= 0 ? `listbox: #${resultIndex} ${item}` : 'listbox: キャンセル',
        detail: message || title,
      })
      this.finishDialog()
      return
    }

    if (cmd === 'filenamebox') {
      const title = args[0] ?? 'ファイル'
      const filter = args[1] ?? ''
      const defaultPath = args[2] ?? ''
      const picked = await this.opts.dialogAdapter.filename(title, filter, defaultPath)
      if (this.stopped) {
        this.abortRun()
        return
      }
      const filePick = picked ?? { ok: false, path: '' }
      setResult(env, cmd, filePick.ok ? 1 : 0, 'dialog-result')
      setScalar(env, 'inputstr', { kind: 'str', value: filePick.path, origin: 'user-input' })
      this.pushEvent({
        kind: 'dialog',
        line: lineNum,
        location: formatLocation(lineNum, execOpts.locationPrefix),
        command: cmd,
        message: filePick.ok ? `filenamebox: ${filePick.path}` : 'filenamebox: キャンセル',
        detail: title,
      })
      this.finishDialog()
      return
    }

    if (cmd === 'dirnamebox') {
      const title = args[0] ?? 'フォルダ'
      const defaultPath = args[1] ?? ''
      const picked = await this.opts.dialogAdapter.dirname(title, defaultPath)
      if (this.stopped) {
        this.abortRun()
        return
      }
      const dirPick = picked ?? { ok: false, path: '' }
      setResult(env, cmd, dirPick.ok ? 1 : 0, 'dialog-result')
      setScalar(env, 'inputstr', { kind: 'str', value: dirPick.path, origin: 'user-input' })
      this.pushEvent({
        kind: 'dialog',
        line: lineNum,
        location: formatLocation(lineNum, execOpts.locationPrefix),
        command: cmd,
        message: dirPick.ok ? `dirnamebox: ${dirPick.path}` : 'dirnamebox: キャンセル',
        detail: title,
      })
      this.finishDialog()
    }
  }

  private processGotoCall(
    env: Env,
    lines: string[],
    lineIdx: number,
    tokens: Token[],
    offset: number,
    execOpts: ExecOptions,
  ): StmtResult {
    const cmd = tokens[offset]?.kind === 'identifier' ? tokens[offset]!.text.toLowerCase() : ''
    const labelName = resolveJumpLabelName(tokens[offset + 1], (n) => resolveEnvString(env, n))
    if (!labelName) {
      this.pushEvent({
        kind: 'error',
        line: lineIdx + 1,
        location: formatLocation(lineIdx + 1, execOpts.locationPrefix),
        message: `${cmd}: ジャンプ先ラベルが指定されていません`,
      })
      return { nextIdx: lineIdx, stopAll: true }
    }
    const targetIdx = findLabelLineIndex(lines, labelName)
    if (targetIdx < 0) {
      this.pushEvent({
        kind: 'error',
        line: lineIdx + 1,
        location: formatLocation(lineIdx + 1, execOpts.locationPrefix),
        message: `未定義ラベル: :${labelName}`,
      })
      return { nextIdx: lineIdx, stopAll: true }
    }
    if (cmd === 'call') {
      if (execOpts.callStack.length >= MAX_CALL_DEPTH) {
        this.pushEvent({
          kind: 'warning',
          line: lineIdx + 1,
          location: formatLocation(lineIdx + 1, execOpts.locationPrefix),
          message: `call のネスト深度が上限 ${MAX_CALL_DEPTH} に達しました`,
        })
        return { nextIdx: lineIdx, stopAll: true, truncated: true }
      }
      execOpts.callStack.push({ returnIdx: lineIdx })
      this.pushEvent({
        kind: 'flow',
        line: lineIdx + 1,
        location: formatLocation(lineIdx + 1, execOpts.locationPrefix),
        command: 'call',
        message: `call :${labelName}`,
      })
    } else {
      this.pushEvent({
        kind: 'flow',
        line: lineIdx + 1,
        location: formatLocation(lineIdx + 1, execOpts.locationPrefix),
        command: 'goto',
        message: `goto :${labelName}`,
      })
    }
    return { nextIdx: lineIdx, jumpTo: targetIdx }
  }

  private async processIncludedContent(env: Env, content: string, execOpts: ExecOptions): Promise<StmtResult> {
    const lines = stripComments(content)
    let i = 0
    while (i < lines.length && !this.stopped) {
      const step = await this.advanceStep(i + 1, execOpts.locationPrefix)
      if (step === 'abort') {
        return { nextIdx: Math.max(0, lines.length - 1), stopAll: true, truncated: this.truncatedByStepLimit }
      }
      const result = await this.processStatement(env, lines, i, {
        ...execOpts,
        inInclude: true,
        inBlock: false,
      })
      if (result.stopAll) return result
      if (result.stopInclude) break
      if (result.jumpTo !== undefined) i = result.jumpTo
      else i = result.nextIdx + 1
    }
    return { nextIdx: Math.max(0, lines.length - 1) }
  }

  private async processBlock(
    env: Env,
    lines: string[],
    startIdx: number,
    endIdx: number,
    execOpts: ExecOptions,
  ): Promise<BlockRunResult> {
    let i = startIdx
    while (i <= endIdx && !this.stopped) {
      const step = await this.advanceStep(i + 1, execOpts.locationPrefix)
      if (step === 'abort') return 'stopAll'
      const result = await this.processStatement(env, lines, i, { ...execOpts, inBlock: true })
      if (result.stopAll) return 'stopAll'
      if (result.stopInclude) return 'stopInclude'
      if (result.stopBlock) return 'stopBlock'
      if (execOpts.loopControl?.breakRequested) return 'stopBlock'
      if (execOpts.loopControl?.continueRequested) return 'stopBlock'
      if (result.jumpTo !== undefined) i = result.jumpTo
      else i = result.nextIdx > i ? result.nextIdx + 1 : i + 1
    }
    return 'complete'
  }

  private blockRunNeedsStopBlock(
    run: BlockRunResult,
    execOpts: ExecOptions,
  ): boolean {
    return (
      run === 'stopBlock' ||
      execOpts.loopControl?.breakRequested === true ||
      execOpts.loopControl?.continueRequested === true
    )
  }

  private async processIfChain(env: Env, lines: string[], lineIdx: number, execOpts: ExecOptions): Promise<StmtResult> {
    const endIdx = findBlockEnd(lines, lineIdx, 'if', 'endif')
    let cursor = lineIdx
    let executed = false

    while (cursor <= endIdx && !this.stopped) {
      const kw = lineKeyword(lines[cursor]!, cursor)
      if (kw === 'endif') break

      if (kw === 'else') {
        if (!executed) {
          const bodyStart = cursor + 1
          const bodyEnd = endIdx - 1
          if (bodyStart <= bodyEnd) {
            const run = await this.processBlock(env, lines, bodyStart, bodyEnd, execOpts)
            if (run === 'stopAll') return { nextIdx: endIdx, stopAll: true }
            if (run === 'stopInclude') return { nextIdx: endIdx, stopInclude: true }
            if (this.blockRunNeedsStopBlock(run, execOpts)) return { nextIdx: endIdx, stopBlock: true }
          }
        }
        break
      }

      if (kw === 'if' || kw === 'elseif') {
        const lineNum = cursor + 1
        const condResult = await this.resolveDryRunCondition(lines[cursor]!, cursor, lineNum, env, kw, execOpts)
        if (condResult === undefined && this.stopped) {
          return { nextIdx: endIdx, stopAll: true }
        }
        let nextSibling = endIdx
        for (let i = cursor + 1; i <= endIdx; i++) {
          const k = lineKeyword(lines[i]!, i)
          if (k === 'elseif' || k === 'else' || k === 'endif') {
            nextSibling = i
            break
          }
          if (k === 'if') i = findBlockEnd(lines, i, 'if', 'endif')
        }
        const bodyStart = cursor + 1
        const bodyEnd = nextSibling - 1
        if (condResult === true && bodyStart <= bodyEnd) {
          const run = await this.processBlock(env, lines, bodyStart, bodyEnd, execOpts)
          if (run === 'stopAll') return { nextIdx: endIdx, stopAll: true }
          if (run === 'stopInclude') return { nextIdx: endIdx, stopInclude: true }
          if (this.blockRunNeedsStopBlock(run, execOpts)) return { nextIdx: endIdx, stopBlock: true }
          executed = true
          break
        }
        cursor = nextSibling
        continue
      }
      cursor++
    }
    return { nextIdx: endIdx }
  }

  private finishLoopBody(
    run: BlockRunResult,
    loopControl: { breakRequested: boolean; continueRequested: boolean },
  ): 'stopAll' | 'stopInclude' | 'break' | 'continue' | 'next' {
    if (run === 'stopAll') return 'stopAll'
    if (run === 'stopInclude') return 'stopInclude'
    if (loopControl.continueRequested) {
      loopControl.continueRequested = false
      return 'continue'
    }
    if (loopControl.breakRequested) return 'break'
    if (run === 'stopBlock') return 'break'
    return 'next'
  }

  private async processStatement(env: Env, lines: string[], lineIdx: number, execOpts: ExecOptions): Promise<StmtResult> {
    const line = lines[lineIdx]!
    const lineNum = lineIdx + 1
    const tokens = tokenizeLine(line, lineNum)
    if (tokens.length === 0) return { nextIdx: lineIdx }

    let offset = 0
    if (tokens[0]?.kind === 'label') offset = 1
    if (offset >= tokens.length) return { nextIdx: lineIdx }

    const first = tokens[offset]!
    if (first.kind !== 'identifier') return { nextIdx: lineIdx }
    const cmd = first.text.toLowerCase()

    if (cmd === 'break') {
      if (execOpts.loopControl) {
        execOpts.loopControl.breakRequested = true
        return { nextIdx: lineIdx, stopBlock: true }
      }
      this.pushEvent({
        kind: 'error',
        line: lineNum,
        location: formatLocation(lineNum, execOpts.locationPrefix),
        command: 'break',
        message: 'break はループ内でのみ使用できます',
      })
      return { nextIdx: lineIdx, stopAll: true }
    }
    if (cmd === 'continue') {
      if (execOpts.loopControl) {
        execOpts.loopControl.continueRequested = true
        return { nextIdx: lineIdx, stopBlock: true }
      }
      this.pushEvent({
        kind: 'error',
        line: lineNum,
        location: formatLocation(lineNum, execOpts.locationPrefix),
        command: 'continue',
        message: 'continue はループ内でのみ使用できます',
      })
      return { nextIdx: lineIdx, stopAll: true }
    }

    if (cmd === 'include') {
      const arg = tokens[offset + 1]
      if (!arg) return { nextIdx: lineIdx }
      if (!execOpts.includeResolver) {
        this.pushEvent({
          kind: 'warning',
          line: lineNum,
          location: formatLocation(lineNum, execOpts.locationPrefix),
          command: 'include',
          message: 'include: リンク先タブが未設定のためスキップしました',
        })
        return { nextIdx: lineIdx }
      }
      {
        let bindingKey: string
        let content: string | null
        let locationPrefix: string
        let includeDisplayPrefix: string
        let includeRawArg: string | undefined
        let effectiveRaw: string | undefined

        if (arg.kind === 'string') {
          const path = unquoteString(arg.text)
          bindingKey = normalizeIncludePath(path)
          content = execOpts.includeResolver.resolve(path)
          locationPrefix = path
          includeDisplayPrefix = path
        } else {
          includeRawArg = extractIncludeArgText(tokens, offset)
          effectiveRaw = resolveIncludeEffectiveRaw(tokens, offset, env)
          const loopValue = execOpts.loopFrame?.value
          if (loopValue !== undefined) {
            bindingKey = resolveLoopIncludeBindingKey(lineNum, loopValue, effectiveRaw)
            content = execOpts.includeResolver.resolveDynamic(includeRawArg, {
              line: lineNum,
              loopValue,
              rawArg: includeRawArg,
              effectiveRaw,
            })
            includeDisplayPrefix = effectiveRaw
              ? `${effectiveRaw}@${execOpts.loopFrame!.variable}=${loopValue}`
              : `${includeRawArg}@${execOpts.loopFrame!.variable}=${loopValue}`
            locationPrefix = includeLoopIterationBindingKey(lineNum, loopValue)
          } else {
            bindingKey = includeDynamicBindingKey(includeRawArg)
            content = execOpts.includeResolver.resolveDynamic(includeRawArg, {
              rawArg: includeRawArg,
              effectiveRaw,
            })
            locationPrefix = effectiveRaw ?? includeRawArg
            includeDisplayPrefix = locationPrefix
          }
        }

        if (content && !execOpts.includeStack.includes(bindingKey)) {
          if (execOpts.includeStack.length >= MAX_INCLUDE_DEPTH) {
            this.pushEvent({
              kind: 'warning',
              line: lineNum,
              location: formatLocation(lineNum, execOpts.locationPrefix),
              command: 'include',
              message: `include ${includeDisplayPrefix}: ネスト深度の上限（${MAX_INCLUDE_DEPTH}）に達したためスキップしました`,
            })
            return { nextIdx: lineIdx }
          }
          const linkedTabId = execOpts.includeResolver.getLinkedTabId(bindingKey, includeRawArg, effectiveRaw)
          if (linkedTabId && execOpts.includeTabStack.includes(linkedTabId)) {
            this.pushEvent({
              kind: 'warning',
              line: lineNum,
              location: formatLocation(lineNum, execOpts.locationPrefix),
              command: 'include',
              message: `include ${includeDisplayPrefix}: タブ循環参照のためスキップしました`,
            })
            return { nextIdx: lineIdx }
          }
          this.pushEvent({
            kind: 'flow',
            line: lineNum,
            location: formatLocation(lineNum, execOpts.locationPrefix),
            command: 'include',
            message: `include ${includeDisplayPrefix}`,
          })
          const childResolver = linkedTabId
            ? execOpts.includeResolver.resolverForLinkedTab(linkedTabId) ?? execOpts.includeResolver
            : execOpts.includeResolver
          const child = await this.processIncludedContent(env, content, {
            ...execOpts,
            includeResolver: childResolver,
            includeStack: [...execOpts.includeStack, bindingKey],
            includeTabStack: linkedTabId ? [...execOpts.includeTabStack, linkedTabId] : execOpts.includeTabStack,
            locationPrefix,
            callStack: [],
          })
          if (child.stopAll) return { nextIdx: lineIdx, stopAll: true }
        } else if (!content) {
          this.pushEvent({
            kind: 'warning',
            line: lineNum,
            location: formatLocation(lineNum, execOpts.locationPrefix),
            command: 'include',
            message: `include ${includeDisplayPrefix}: リンク先が未設定です`,
          })
        } else {
          this.pushEvent({
            kind: 'warning',
            line: lineNum,
            location: formatLocation(lineNum, execOpts.locationPrefix),
            command: 'include',
            message: `include ${includeDisplayPrefix}: 循環参照のためスキップしました`,
          })
        }
      }
      return { nextIdx: lineIdx }
    }

    if (cmd === 'exit') {
      if (execOpts.inInclude && execOpts.inBlock) return { nextIdx: lineIdx, stopBlock: true }
      if (execOpts.inInclude) return { nextIdx: lineIdx, stopInclude: true }
      return { nextIdx: lineIdx, stopAll: true }
    }
    if (cmd === 'end') {
      return { nextIdx: lineIdx, stopAll: true }
    }

    if (cmd === 'goto' || cmd === 'call') {
      return this.processGotoCall(env, lines, lineIdx, tokens, offset, execOpts)
    }

    if (cmd === 'return') {
      const frame = execOpts.callStack.pop()
      if (frame) {
        this.pushEvent({
          kind: 'flow',
          line: lineNum,
          location: formatLocation(lineNum, execOpts.locationPrefix),
          command: 'return',
          message: `return → L${frame.returnIdx + 2}`,
        })
        return { nextIdx: lineIdx, jumpTo: frame.returnIdx + 1 }
      }
      if (execOpts.inInclude && !execOpts.inBlock) {
        return { nextIdx: lineIdx, stopInclude: true }
      }
      if (execOpts.inBlock) return { nextIdx: lineIdx, stopBlock: true }
      this.pushEvent({
        kind: 'error',
        line: lineNum,
        location: formatLocation(lineNum, execOpts.locationPrefix),
        command: 'return',
        message: 'return: 対応する call がありません',
      })
      return { nextIdx: lineIdx, stopAll: true }
    }

    if (cmd === 'send' || cmd === 'sendln') {
      this.pushSendEvent(lineNum, execOpts, cmd, tokens, offset + 1)
      return { nextIdx: lineIdx }
    }

    if (cmd === 'for' && tokens[offset + 1]?.kind === 'identifier') {
      const loopVar = tokens[offset + 1].text
      // 開始・終了は式単位で順に消費（`for i 5 -1` は第2が 5-1 になり第3欠落）
      const range = parseForLoopRangeExprs(tokens, offset + 2, makeIntExprResolve(env))
      const start = range.missingEnd ? undefined : range.start
      const end = range.missingEnd ? undefined : range.end
      const bodyEnd = findBlockEnd(lines, lineIdx, 'for', 'next')
      if (start !== undefined && end !== undefined && canUnrollForLoop(start, end)) {
        const total = forLoopIterationCount(start, end)
        let iteration = 0
        const step = start <= end ? 1 : -1
        for (let v = start; step > 0 ? v <= end : v >= end; v += step) {
          if (this.stopped) break
          iteration++
          setScalar(env, loopVar, { kind: 'int', value: v })
          const loopControl = { breakRequested: false, continueRequested: false }
          const run = await this.processBlock(env, lines, lineIdx + 1, bodyEnd - 1, {
            ...execOpts,
            loopFrame: { variable: loopVar, value: v, index: iteration, total },
            loopControl,
          })
          const action = this.finishLoopBody(run, loopControl)
          if (action === 'stopAll') return { nextIdx: bodyEnd, stopAll: true }
          if (action === 'stopInclude') return { nextIdx: bodyEnd, stopInclude: true }
          if (action === 'break') break
          if (action === 'continue') continue
        }
      } else if (start !== undefined && end !== undefined) {
        setScalar(env, loopVar, { kind: 'int', value: start })
        const loopControl = { breakRequested: false, continueRequested: false }
        const run = await this.processBlock(env, lines, lineIdx + 1, bodyEnd - 1, { ...execOpts, loopControl })
        const action = this.finishLoopBody(run, loopControl)
        if (action === 'stopAll') return { nextIdx: bodyEnd, stopAll: true }
        if (action === 'stopInclude') return { nextIdx: bodyEnd, stopInclude: true }
      } else {
        const loopControl = { breakRequested: false, continueRequested: false }
        const run = await this.processBlock(env, lines, lineIdx + 1, bodyEnd - 1, { ...execOpts, loopControl })
        const action = this.finishLoopBody(run, loopControl)
        if (action === 'stopAll') return { nextIdx: bodyEnd, stopAll: true }
        if (action === 'stopInclude') return { nextIdx: bodyEnd, stopInclude: true }
      }
      return { nextIdx: bodyEnd }
    }

    if (cmd === 'while') {
      const endIdx = findBlockEnd(lines, lineIdx, 'while', 'endwhile')
      const loopControl = { breakRequested: false, continueRequested: false }
      let iterations = 0
      while (!this.stopped) {
        const cond = await this.resolveDryRunCondition(line, lineIdx, lineNum, env, 'while', execOpts)
        if (cond === undefined && this.stopped) return { nextIdx: endIdx, stopAll: true }
        if (cond !== true) break
        if (++iterations > MAX_LOOP_ITERATIONS) {
          this.pushEvent({
            kind: 'warning',
            line: lineNum,
            location: formatLocation(lineNum, execOpts.locationPrefix),
            message: 'while ループの反復上限に達しました（break で脱出してください）',
          })
          break
        }
        const run = await this.processBlock(env, lines, lineIdx + 1, endIdx - 1, { ...execOpts, loopControl })
        const action = this.finishLoopBody(run, loopControl)
        if (action === 'stopAll') return { nextIdx: endIdx, stopAll: true }
        if (action === 'stopInclude') return { nextIdx: endIdx, stopInclude: true }
        if (action === 'break') break
        if (action === 'continue') continue
      }
      return { nextIdx: endIdx }
    }

    if (cmd === 'do') {
      const endIdx = findBlockEnd(lines, lineIdx, 'do', 'loop')
      const loopLine = lines[endIdx]!
      let iterations = 0
      const infinite = isInfiniteDoLoop(loopLine, endIdx)
      const hasWhile = loopLineHasWhile(loopLine, endIdx)
      while (!this.stopped) {
        if (++iterations > MAX_LOOP_ITERATIONS) {
          this.pushEvent({
            kind: 'warning',
            line: lineNum,
            location: formatLocation(lineNum, execOpts.locationPrefix),
            message: infinite
              ? 'do ループの反復上限に達しました（break で脱出してください）'
              : 'do ループの反復上限に達しました',
          })
          break
        }
        const run = await this.processBlock(env, lines, lineIdx + 1, endIdx - 1, { ...execOpts, loopControl: undefined })
        if (run === 'stopAll') return { nextIdx: endIdx, stopAll: true }
        if (run === 'stopInclude') return { nextIdx: endIdx, stopInclude: true }
        if (hasWhile) {
          const whileCond = await this.resolveLoopWhileCondition(loopLine, endIdx, env, execOpts)
          if (whileCond === undefined && this.stopped) return { nextIdx: endIdx, stopAll: true }
          if (whileCond !== true) break
        }
      }
      return { nextIdx: endIdx }
    }

    if (cmd === 'until') {
      const endIdx = findBlockEnd(lines, lineIdx, 'until', 'enduntil')
      const loopControl = { breakRequested: false, continueRequested: false }
      let iterations = 0
      while (!this.stopped) {
        if (++iterations > MAX_LOOP_ITERATIONS) {
          this.pushEvent({
            kind: 'warning',
            line: lineNum,
            location: formatLocation(lineNum, execOpts.locationPrefix),
            message: 'until ループの反復上限に達しました',
          })
          break
        }
        const run = await this.processBlock(env, lines, lineIdx + 1, endIdx - 1, { ...execOpts, loopControl })
        const action = this.finishLoopBody(run, loopControl)
        if (action === 'stopAll') return { nextIdx: endIdx, stopAll: true }
        if (action === 'stopInclude') return { nextIdx: endIdx, stopInclude: true }
        if (action === 'break') break
        if (action === 'continue') continue
        const cond = await this.resolveDryRunCondition(line, lineIdx, lineNum, env, 'until', execOpts)
        if (cond === undefined && this.stopped) return { nextIdx: endIdx, stopAll: true }
        if (cond === true) break
      }
      return { nextIdx: endIdx }
    }

    if (cmd === 'if') {
      const thenForm = findIfThenTailStart(tokens, offset)
      if (thenForm !== null) {
        return this.processSingleLineIf(
          env,
          lines,
          lineIdx,
          lineNum,
          tokens,
          offset,
          thenForm.condEnd,
          thenForm.tailStart,
          execOpts,
        )
      }
      const tailStart = findSingleLineIfTailStart(tokens, offset)
      if (tailStart !== null) {
        return this.processSingleLineIf(env, lines, lineIdx, lineNum, tokens, offset, tailStart, tailStart, execOpts)
      }
      return this.processIfChain(env, lines, lineIdx, execOpts)
    }

    for (const [open, close] of Object.entries(BLOCK_PAIRS)) {
      if (cmd === open && open !== 'for' && open !== 'while' && open !== 'do' && open !== 'until') {
        const endIdx = findBlockEnd(lines, lineIdx, open, close)
        const run = await this.processBlock(env, lines, lineIdx + 1, endIdx - 1, execOpts)
        if (run === 'stopAll') {
          return { nextIdx: endIdx, stopAll: true }
        }
        return { nextIdx: endIdx }
      }
    }

    await this.processLineEffects(env, lineNum, tokens, offset, cmd, execOpts)
    return { nextIdx: lineIdx }
  }
}

/** テスト用: 決定的なダイアログ応答 */
export function createMockDialogAdapter(
  responses: Array<
    | { type: 'yesno'; value: boolean }
    | { type: 'message' }
    | { type: 'input'; value: string }
    | { type: 'list'; index: number }
    | { type: 'filename'; ok: boolean; path: string }
    | { type: 'dirname'; ok: boolean; path: string }
    | { type: 'branch'; value: boolean }
  >,
): DryRunDialogAdapter {
  let i = 0
  let cancelled = false
  const next = () => {
    const r = responses[i++]
    if (!r) throw new Error('mock dialog responses exhausted')
    return r
  }
  return {
    async yesno() {
      if (cancelled) return null
      const r = next()
      if (r.type !== 'yesno') throw new Error(`expected yesno, got ${r.type}`)
      return r.value
    },
    async message() {
      if (cancelled) return false
      const r = next()
      if (r.type !== 'message') throw new Error(`expected message, got ${r.type}`)
      return true
    },
    async input() {
      if (cancelled) return null
      const r = next()
      if (r.type !== 'input') throw new Error(`expected input, got ${r.type}`)
      return r.value
    },
    async list() {
      if (cancelled) return null
      const r = next()
      if (r.type !== 'list') throw new Error(`expected list, got ${r.type}`)
      return r.index
    },
    async filename() {
      if (cancelled) return null
      const r = next()
      if (r.type !== 'filename') throw new Error(`expected filename, got ${r.type}`)
      return { ok: r.ok, path: r.path }
    },
    async dirname() {
      if (cancelled) return null
      const r = next()
      if (r.type !== 'dirname') throw new Error(`expected dirname, got ${r.type}`)
      return { ok: r.ok, path: r.path }
    },
    async branchAssumption() {
      if (cancelled) return null
      const r = next()
      if (r.type !== 'branch') throw new Error(`expected branch, got ${r.type}`)
      return r.value
    },
    cancel() {
      cancelled = true
    },
  }
}

export async function runDryRun(options: DryRunOptions): Promise<DryRunState> {
  const session = new DryRunSession(options)
  return session.run()
}
