import type { IncludeResolver } from './analyzer'
import { findAssignmentIndex } from './argChecker'
import { getCommandOutputEffect } from './commandOutputs'
import {
  extractIncludeArgText,
  includeDynamicBindingKey,
  normalizeIncludePath,
  resolveLoopIncludeBindingKey,
} from './includeRefs'
import {
  tryStaticIntegerCommand,
  tryStaticStringCommand,
  type StaticValueContext,
} from './staticCommandEval'
import { RESERVED, stripComments, tokenizeLine, unquoteString, type Token } from './tokenize'
import {
  buildStringFromOperands,
  collectSendPayload,
  collectWaitPatterns,
  parseWaitPatternAt,
  createMacroEnvironment,
  prepareAssignedScalar,
  type MacroEnvironment,
  type RuntimeScalar,
} from './evaluator'
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
  const text = event.payload
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

export interface DryRunDialogAdapter {
  yesno(message: string, title: string): Promise<boolean | null>
  /** true=OK, false=キャンセル/Escape */
  message(message: string, title: string): Promise<boolean>
  input(message: string, title: string, defaultValue: string, password: boolean): Promise<string | null>
  list(title: string, items: string[]): Promise<number | null>
  filename(title: string, filter: string, defaultPath: string): Promise<{ ok: boolean; path: string } | null>
  dirname(title: string, defaultPath: string): Promise<{ ok: boolean; path: string } | null>
  cancel(): void
}

export interface DryRunOptions {
  source: string
  includeResolver?: IncludeResolver
  macroArgv?: string[]
  dialogAdapter: DryRunDialogAdapter
  onStateChange?: (state: DryRunState) => void
  yieldEveryLine?: () => Promise<void>
}

type Env = MacroEnvironment

const BLOCK_PAIRS: Record<string, string> = {
  if: 'endif',
  while: 'endwhile',
  for: 'next',
  do: 'loop',
  until: 'enduntil',
}

const MAX_LOOP_ITERATIONS = 256
/** Tera Term include ネスト上限（公式） */
const MAX_INCLUDE_DEPTH = 9

function parseLoopWhileCondition(line: string, lineIdx: number, env: Env): boolean | undefined {
  const tokens = tokenizeLine(line, lineIdx + 1)
  let off = tokens[0]?.kind === 'label' ? 1 : 0
  const loopPos = tokens.findIndex(
    (t, i) => i >= off && t.kind === 'identifier' && t.text.toLowerCase() === 'loop',
  )
  if (loopPos < 0) return undefined
  const whilePos = tokens.findIndex(
    (t, i) => i > loopPos && t.kind === 'identifier' && t.text.toLowerCase() === 'while',
  )
  if (whilePos < 0) return undefined
  return evalBoolExpr(tokens.slice(whilePos + 1), env)
}

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
  if (indexToken.kind === 'number') return Number(indexToken.text)
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
  if (token.kind === 'number') return { kind: 'int', value: Number(token.text), origin: 'literal' }
  if (token.kind === 'identifier') {
    const v = env.get(token.text.toLowerCase())
    if (v?.kind === 'int' || v?.kind === 'str') return v
  }
  return undefined
}

function evalIntExpr(tokens: Token[], start: number, env: Env): number | undefined {
  const first = tokens[start]
  if (!first) return undefined
  let value = evalTokenValue(first, env)
  if (value?.kind !== 'int') {
    if (first.kind === 'number') value = { kind: 'int', value: Number(first.text) }
    else return undefined
  }
  let i = start + 1
  while (i < tokens.length) {
    const op = tokens[i]
    const rhs = tokens[i + 1]
    if (op?.kind !== 'operator' || !rhs) break
    const rhsVal = evalTokenValue(rhs, env)
    if (rhsVal?.kind !== 'int') break
    if (op.text === '+') value = { kind: 'int', value: value.value + rhsVal.value }
    else if (op.text === '-') value = { kind: 'int', value: value.value - rhsVal.value }
    else break
    i += 2
  }
  return value?.kind === 'int' ? value.value : undefined
}

function scalarCompare(lhs: RuntimeScalar | undefined, op: string, rhs: RuntimeScalar | undefined): boolean | undefined {
  if (!lhs || !rhs) return undefined
  if (lhs.kind === 'str' && rhs.kind === 'str') {
    if (op === '=') return lhs.value === rhs.value
    if (op === '<>') return lhs.value !== rhs.value
    return undefined
  }
  if (lhs.kind === 'int' && rhs.kind === 'int') {
    switch (op) {
      case '=':
        return lhs.value === rhs.value
      case '<>':
        return lhs.value !== rhs.value
      case '<':
        return lhs.value < rhs.value
      case '>':
        return lhs.value > rhs.value
      case '<=':
        return lhs.value <= rhs.value
      case '>=':
        return lhs.value >= rhs.value
      default:
        return undefined
    }
  }
  return undefined
}

function evalBoolExpr(tokens: Token[], env: Env): boolean | undefined {
  if (tokens.length === 0) return undefined
  if (tokens[0]?.kind === 'identifier' && tokens[0].text.toLowerCase() === 'not') {
    const inner = evalBoolExpr(tokens.slice(1), env)
    return inner === undefined ? undefined : !inner
  }
  for (let j = 1; j < tokens.length; j++) {
    const op = tokens[j]
    if (op?.kind !== 'operator' || !['=', '<>', '<', '>', '<=', '>='].includes(op.text)) continue
    const lhs = evalTokenValue(tokens[j - 1], env)
    const rhs = evalTokenValue(tokens[j + 1], env)
    const cmp = scalarCompare(lhs, op.text, rhs)
    if (cmp === undefined) return undefined
    const andOr = tokens[j + 2]
    if (andOr?.kind === 'identifier') {
      const lo = andOr.text.toLowerCase()
      if (lo === 'and' || lo === 'or') {
        const rest = evalBoolExpr(tokens.slice(j + 3), env)
        if (rest === undefined) return undefined
        return lo === 'and' ? cmp && rest : cmp || rest
      }
    }
    return cmp
  }
  if (tokens.length === 1) {
    const v = evalTokenValue(tokens[0], env)
    if (v?.kind === 'int') return v.value !== 0
    if (v?.kind === 'str') return v.value !== ''
  }
  return undefined
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

function collectStringArgs(tokens: Token[], start: number, env: Env): string[] {
  const args: string[] = []
  for (let i = start; i < tokens.length; i++) {
    args.push(resolveStringToken(tokens[i], env))
  }
  return args
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

function isKnownStringValue(v: RuntimeScalar): v is RuntimeScalar & { kind: 'str' } {
  if (v.kind !== 'str') return false
  if (v.origin === 'user-input' || v.origin === 'match-received' || v.origin === 'dialog-result') return false
  if (v.hasUnresolvedParts) return false
  if (!v.value && v.hint) return false
  return true
}

function resolveKnownString(token: Token | undefined, env: Env): string | undefined {
  if (!token) return undefined
  if (token.kind === 'string') return unquoteString(token.text)
  if (token.kind === 'identifier') {
    const v = env.get(token.text.toLowerCase())
    if (v?.kind === 'str' && isKnownStringValue(v)) return v.value
  }
  return undefined
}

function createStaticCtx(tokens: Token[], offset: number, env: Env): StaticValueContext {
  return {
    tokenAt(rel) {
      return tokens[offset + rel]
    },
    resolveString(rel) {
      return resolveKnownString(tokens[offset + rel], env)
    },
    resolveInt(rel) {
      return evalIntExpr(tokens, offset + rel, env)
    },
    resolveInPlaceVar(rel) {
      const tok = tokens[offset + rel]
      if (tok?.kind !== 'identifier') return undefined
      const v = env.get(tok.text.toLowerCase())
      if (v?.kind === 'str' && isKnownStringValue(v)) return v.value
      return undefined
    },
  }
}

function applyStaticCommandEffects(cmd: string, tokens: Token[], offset: number, env: Env): boolean {
  const staticCtx = createStaticCtx(tokens, offset, env)
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
  const intResult = tryStaticIntegerCommand(cmd, offset, staticCtx)
  if (intResult) {
    const destTok = tokens[intResult.destIndex]
    if (destTok?.kind === 'identifier') {
      setScalar(env, destTok.text, { kind: 'int', value: intResult.value })
      return true
    }
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

function lineKeyword(line: string, lineIdx: number): string {
  const tokens = tokenizeLine(line, lineIdx + 1)
  let off = tokens[0]?.kind === 'label' ? 1 : 0
  return tokens[off]?.kind === 'identifier' ? tokens[off]!.text.toLowerCase() : ''
}

function findBlockEnd(lines: string[], startIdx: number, open: string, close: string): number {
  let depth = 1
  for (let i = startIdx + 1; i < lines.length; i++) {
    const tokens = tokenizeLine(lines[i]!, i + 1)
    let off = tokens[0]?.kind === 'label' ? 1 : 0
    const kw = tokens[off]?.kind === 'identifier' ? tokens[off]!.text.toLowerCase() : ''
    if (kw === open) depth++
    if (kw === close) {
      depth--
      if (depth === 0) return i
    }
  }
  return lines.length - 1
}

function tryEvalCondition(line: string, lineIdx: number, env: Env, cmd: string): boolean | undefined {
  const tokens = tokenizeLine(line, lineIdx + 1)
  let off = tokens[0]?.kind === 'label' ? 1 : 0
  let condEnd = tokens.length
  if (cmd === 'if' || cmd === 'elseif') {
    const thenIdx = tokens.findIndex((t, i) => i > off && t.kind === 'identifier' && t.text.toLowerCase() === 'then')
    condEnd = thenIdx >= 0 ? thenIdx : tokens.length
  } else if (cmd !== 'while' && cmd !== 'until') {
    return undefined
  }
  return evalBoolExpr(tokens.slice(off + 1, condEnd), env)
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
    const cond = evalBoolExpr(tokens.slice(offset + 1, condEnd), env)
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
      env.set(tokens[offset + 1].text.toLowerCase(), { kind: 'array', size, elements: new Map() })
      return
    }
    if (cmd === 'intdim' && tokens[offset + 1]?.kind === 'identifier') {
      const size = evalIntExpr(tokens, offset + 2, env) ?? 0
      env.set(tokens[offset + 1].text.toLowerCase(), { kind: 'array', size, elements: new Map() })
      return
    }

    const assignIdx = findAssignmentIndex(tokens, offset)
    if (assignIdx > offset) {
      const arrayName = isArrayAssignTarget(tokens, assignIdx)
      let scalar: RuntimeScalar | undefined
      const intVal = evalIntExpr(tokens, assignIdx + 1, env)
      if (intVal !== undefined) {
        scalar = { kind: 'int', value: intVal }
      } else {
        scalar = evalTokenValue(tokens[assignIdx + 1], env)
      }
      if (arrayName !== null && scalar) {
        const indexTok = tokens[assignIdx - 2]
        const index =
          indexTok?.kind === 'number'
            ? Number(indexTok.text)
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
      if (applyStaticCommandEffects(cmd, tokens, offset, env)) return
      const dest = tokens[offset + 1].text
      const operands: RuntimeScalar[] = []
      const existing = env.get(dest.toLowerCase())
      if (existing?.kind === 'str') operands.push(existing)
      for (let i = offset + 2; i < tokens.length; i++) {
        const v = evalTokenValue(tokens[i], env)
        if (v?.kind === 'str' || v?.kind === 'int') operands.push(v)
      }
      if (operands.length > 0) setScalar(env, dest, buildStringFromOperands(operands))
      return
    }

    if (applyStaticCommandEffects(cmd, tokens, offset, env)) return

    if (cmd === 'recvln') {
      this.pushEvent(buildWaitReceiveEvent(cmd, [], lineNum, execOpts.locationPrefix))
      setScalar(env, 'result', { kind: 'int', value: 1, origin: 'literal' })
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
      setScalar(env, 'result', { kind: 'int', value: 1, origin: 'literal' })
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

      setScalar(env, 'result', { kind: 'int', value: 1, origin: 'literal' })
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
      return
    }

    if (DIALOG_COMMANDS.has(cmd)) {
      await this.handleDialog(cmd, tokens, offset, lineNum, env, execOpts)
      return
    }

    const effect = getCommandOutputEffect(cmd)
    if (effect) {
      for (const slot of effect.variables ?? []) {
        const tok = tokens[slot.index]
        if (tok?.kind !== 'identifier') continue
        if (slot.type === 'integer') {
          setScalar(env, tok.text, { kind: 'int', value: 0, hint: `（${cmd} の出力 / 実行時）` })
        } else {
          setScalar(env, tok.text, { kind: 'str', value: '', hint: `（${cmd} の出力 / 実行時）` })
        }
      }
      for (const sys of effect.systemVariables ?? []) {
        const origin =
          sys.name === 'inputstr' ? 'user-input' : sys.name.startsWith('groupmatchstr') || sys.name === 'matchstr' ? 'match-received' : 'dialog-result'
        if (sys.type === 'integer') setScalar(env, sys.name, { kind: 'int', value: 0, origin })
        else setScalar(env, sys.name, { kind: 'str', value: '', origin })
      }
      if (effect.setsResult) setScalar(env, 'result', { kind: 'int', value: 0, origin: 'dialog-result' })
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
      setScalar(env, 'result', { kind: 'int', value: yes ? 1 : 0, origin: 'dialog-result' })
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
      setScalar(env, 'result', { kind: 'int', value: ok ? 1 : 0, origin: 'dialog-result' })
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
      const title = args[0] ?? '選択'
      const items = args.slice(1)
      const selected = await this.opts.dialogAdapter.list(title, items)
      if (this.stopped) {
        this.abortRun()
        return
      }
      const resultIndex = selected === null ? -1 : selected
      setScalar(env, 'result', { kind: 'int', value: resultIndex, origin: 'dialog-result' })
      const item = resultIndex >= 0 ? (items[resultIndex] ?? '') : ''
      this.pushEvent({
        kind: 'dialog',
        line: lineNum,
        location: formatLocation(lineNum, execOpts.locationPrefix),
        command: cmd,
        message: resultIndex >= 0 ? `listbox: #${resultIndex} ${item}` : 'listbox: キャンセル',
        detail: title,
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
      setScalar(env, 'result', { kind: 'int', value: filePick.ok ? 1 : 0, origin: 'dialog-result' })
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
      setScalar(env, 'result', { kind: 'int', value: dirPick.ok ? 1 : 0, origin: 'dialog-result' })
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
        const condResult = tryEvalCondition(lines[cursor]!, cursor, env, kw)
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
        let includeRawArg: string | undefined
        let effectiveRaw: string | undefined

        if (arg.kind === 'string') {
          const path = unquoteString(arg.text)
          bindingKey = normalizeIncludePath(path)
          content = execOpts.includeResolver.resolve(path)
          locationPrefix = path
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
            locationPrefix = effectiveRaw
              ? `${effectiveRaw}@${execOpts.loopFrame!.variable}=${loopValue}`
              : `${includeRawArg}@${execOpts.loopFrame!.variable}=${loopValue}`
          } else {
            bindingKey = includeDynamicBindingKey(includeRawArg)
            content = execOpts.includeResolver.resolveDynamic(includeRawArg, {
              rawArg: includeRawArg,
              effectiveRaw,
            })
            locationPrefix = effectiveRaw ?? includeRawArg
          }
        }

        if (content && !execOpts.includeStack.includes(bindingKey)) {
          if (execOpts.includeStack.length >= MAX_INCLUDE_DEPTH) {
            this.pushEvent({
              kind: 'warning',
              line: lineNum,
              location: formatLocation(lineNum, execOpts.locationPrefix),
              command: 'include',
              message: `include ${locationPrefix}: ネスト深度の上限（${MAX_INCLUDE_DEPTH}）に達したためスキップしました`,
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
              message: `include ${locationPrefix}: タブ循環参照のためスキップしました`,
            })
            return { nextIdx: lineIdx }
          }
          this.pushEvent({
            kind: 'flow',
            line: lineNum,
            location: formatLocation(lineNum, execOpts.locationPrefix),
            command: 'include',
            message: `include ${locationPrefix}`,
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
            message: `include ${locationPrefix}: リンク先が未設定です`,
          })
        } else {
          this.pushEvent({
            kind: 'warning',
            line: lineNum,
            location: formatLocation(lineNum, execOpts.locationPrefix),
            command: 'include',
            message: `include ${locationPrefix}: 循環参照のためスキップしました`,
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
      const start = evalIntExpr(tokens, offset + 2, env)
      const end = evalIntExpr(tokens, offset + 3, env)
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
        const cond = tryEvalCondition(lines[lineIdx]!, lineIdx, env, 'while')
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
          const whileCond = parseLoopWhileCondition(loopLine, endIdx, env)
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
        const cond = tryEvalCondition(lines[lineIdx]!, lineIdx, env, 'until')
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
    cancel() {
      cancelled = true
    },
  }
}

export async function runDryRun(options: DryRunOptions): Promise<DryRunState> {
  const session = new DryRunSession(options)
  return session.run()
}
