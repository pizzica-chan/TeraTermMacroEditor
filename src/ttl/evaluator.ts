import { getSystemVariableType, getSystemVariableMeta, isSystemVariable } from './commands'
import type { IncludeResolver } from './analyzer'
import {
  extractIncludeArgText,
  includeDynamicBindingKey,
  includeLoopIterationBindingKey,
  normalizeIncludePath,
  resolveLoopIncludeBindingKey,
} from './includeRefs'
import { findAssignmentIndex } from './argChecker'
import {
  isGroupedStringExprStart,
  resolveStaticControlPart,
  resolveStaticGroupedString,
  resolveStaticLiteralPart,
  tokenGapBefore,
} from './argOperands'
import {
  commandIntroducesIndependentOutput,
  commandOutputHint,
  getCommandOutputEffect,
  getOutputVariableIndices,
  isCommandOutputHint,
  isInPlaceStringCommand,
  REGEX_MATCH_HINT,
} from './commandOutputs'
import { formatResultSetByNote } from './resultCommandMeta'
import {
  buildCommandLineParamsSnapshot,
  formatParamcntHoverNote,
  formatParamNHoverNote,
  formatParamsArrayHoverNote,
  formatParamsIndexHoverNote,
  type MacroArgvInput,
} from './commandLineParams'
import {
  tryStaticIntegerCommand,
  tryStaticResultCommand,
  tryStaticSprintfCommand,
  tryStaticStr2intCommand,
  tryStaticStrsplitCommand,
  tryStaticStringCommand,
  type IfdefinedLookup,
  type IfdefinedTypeCode,
  type StaticValueContext,
} from './staticCommandEval'
import {
  isSendRecordCommand,
  sendAddsNewline,
  sendDataTokenStart,
  type SendRecordCommand,
} from './sendCommands'
import { RESERVED, tokenizeLine, stripComments, unquoteString, parseTtlIntegerLiteral, parseTtlCharCodeLiteral, type Token } from './tokenize'
import {
  BLOCK_PAIRS,
  MAX_LOOP_ITERATIONS,
  evalBoolExpr as evalBoolExprShared,
  evalGuaranteedLiteralCondition,
  findBlockEnd,
  lineKeyword,
} from './controlFlow'
import { evalTtlIntExprAt, parseForLoopRangeExprs, type TtlIntExprResolve } from './ttlExpression'
import { collectLabelLineMap, collectLabelNames, formatLabelRef, normalizeLabelName } from './labels'
import {
  findLabelLineIndex,
  findIfThenTailStart,
  findSingleLineIfTailStart,
  MAX_CALL_DEPTH,
  resolveJumpLabelName,
} from './subroutine'

export type ValueOrigin = 'literal' | 'user-input' | 'dialog-result' | 'match-received' | 'system-default' | 'assumed'

export type RuntimeScalar =
  | {
      kind: 'int'
      value: number
      origin?: ValueOrigin
      hint?: string
      /** result 等: 値を設定した直前のコマンド名 */
      setBy?: string
      /** 未確定の根源（getdate / inputbox 等）。コピー・連結では継承する */
      unresolvedSourceIds?: readonly number[]
    }
  | {
      kind: 'str'
      value: string
      origin?: ValueOrigin
      hint?: string
      /** 文字列結合に実行時未定のオペランドを含む */
      hasUnresolvedParts?: boolean
      /** passwordbox 等の機密入力を含む */
      sensitive?: boolean
      /** 未確定の根源（getdate / inputbox 等）。コピー・連結では継承する */
      unresolvedSourceIds?: readonly number[]
    }

export type RuntimeValue =
  | RuntimeScalar
  | { kind: 'array'; size: number; elements: Map<number, RuntimeScalar>; elementKind?: 'int' | 'str' }
  | { kind: 'range'; start: number; end: number; label: string }

export interface HoverInfo {
  name: string
  type: string
  display: string
  note?: string
  /** 表示スタイルの区別用 */
  valueKind?: 'known' | 'runtime' | 'system-default' | 'unset' | 'label' | 'assumed'
  isSystem?: boolean
}

export interface HoverAtResult {
  info: HoverInfo
  from: number
  to: number
}

export interface SendEntry {
  line: number
  location: string
  command: SendRecordCommand
  rawArgs: string
  payload: string
  unresolved: boolean
  addsNewline: boolean
  /** for ループ展開時の反復情報 */
  loopInfo?: {
    variable: string
    value: number
    index: number
    total: number
  }
}

type Env = Map<string, RuntimeValue>

function forLoopIterationCount(start: number, end: number): number {
  return Math.abs(end - start) + 1
}

function canUnrollForLoop(start: number, end: number): boolean {
  return forLoopIterationCount(start, end) <= MAX_LOOP_ITERATIONS
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

function isUnresolvedOperand(v: RuntimeScalar): boolean {
  if (v.kind === 'int') return v.origin === 'dialog-result'
  if (v.kind !== 'str') return false
  if (v.hasUnresolvedParts) return true
  if (isRuntimeOrigin(v.origin)) return true
  if (v.hint !== undefined && isCommandOutputHint(v.hint)) return true
  return v.value === '' && v.hint !== undefined
}

function appendScalarToPayload(
  scalar: RuntimeScalar | undefined,
  parts: string[],
  unresolved: { flag: boolean },
  fallbackLabel?: string,
): void {
  if (!scalar) {
    unresolved.flag = true
    parts.push(fallbackLabel ?? '〈未定義〉')
    return
  }
  if (scalar.kind === 'str') {
    if (scalar.hasUnresolvedParts && scalar.hint) {
      parts.push(scalar.hint)
      unresolved.flag = true
      return
    }
    if (scalar.value) {
      parts.push(scalar.value)
      return
    }
    if (isRuntimeOrigin(scalar.origin)) {
      parts.push(scalar.hint ?? runtimeSegmentLabel(scalar.origin!))
      unresolved.flag = true
      return
    }
    if (scalar.hint) {
      parts.push(scalar.hint)
      unresolved.flag = true
      return
    }
    parts.push(scalar.value)
    return
  }
  if (scalar.kind === 'int') {
    if (scalar.hint) {
      parts.push(scalar.hint)
      unresolved.flag = true
      return
    }
    if (scalar.origin === 'dialog-result') {
      parts.push(runtimeSegmentLabel('dialog-result'))
      unresolved.flag = true
      return
    }
    parts.push(String(scalar.value))
  }
}

function evalSendOperand(
  tokens: Token[],
  i: number,
  env: Env,
): { scalar?: RuntimeScalar; next: number; rawParts: string[]; label: string } | null {
  const tok = tokens[i]
  if (!tok) return null

  if (tok.text === '#' && tokens[i + 1]?.kind === 'number') {
    const code = parseTtlCharCodeLiteral(tokens[i + 1]!.text)
    if (code === undefined) return null
    return {
      scalar: { kind: 'str', value: String.fromCharCode(code), origin: 'literal' },
      next: i + 2,
      rawParts: [`#${tokens[i + 1]!.text}`],
      label: `#${tokens[i + 1]!.text}`,
    }
  }

  if (tok.kind === 'string' || tok.kind === 'number') {
    return {
      scalar: evalTokenValue(tok, env),
      next: i + 1,
      rawParts: [tok.text],
      label: tok.text,
    }
  }

  if (tok.kind === 'identifier') {
    if (tokens[i + 1]?.text === '[' && tokens[i + 2] && tokens[i + 3]?.text === ']') {
      const indexTok = tokens[i + 2]!
      const label = `${tok.text}[${indexTok.text}]`
      return {
        scalar: evalArrayElement(tok.text, indexTok, env),
        next: i + 4,
        rawParts: [tok.text, '[', indexTok.text, ']'],
        label,
      }
    }
    return {
      scalar: evalTokenValue(tok, env),
      next: i + 1,
      rawParts: [tok.text],
      label: tok.text,
    }
  }

  return null
}

/** 隣接連結される文字列式（'a'#13'b' 等）を 1 つの文字列として評価 */
export function evalGroupedStringExprAt(
  tokens: Token[],
  start: number,
  env: Env,
): { scalar: RuntimeScalar & { kind: 'str' }; next: number } | null {
  const operands: RuntimeScalar[] = []
  let i = start
  let consumed = false

  while (i < tokens.length) {
    if (consumed && tokenGapBefore(tokens, i)) break
    const operand = evalSendOperand(tokens, i, env)
    if (!operand?.scalar) break
    if (operand.scalar.kind !== 'str' && operand.scalar.kind !== 'int') break
    operands.push(operand.scalar)
    consumed = true
    i = operand.next
  }

  if (!consumed) return null
  return { scalar: buildStringFromOperands(operands), next: i }
}

/** 1 つの wait 引数パターンを読み取り、消費した次トークン位置を返す */
export function parseWaitPatternAt(
  tokens: Token[],
  start: number,
  env: Env,
): { pattern: string; next: number } | null {
  if (start >= tokens.length) return null
  const parts: string[] = []
  let i = start
  while (i < tokens.length) {
    if (parts.length > 0 && tokenGapBefore(tokens, i)) break
    const operand = evalSendOperand(tokens, i, env)
    if (!operand) break
    if (operand.scalar?.kind === 'str') parts.push(operand.scalar.value)
    else if (operand.scalar?.kind === 'int') parts.push(String(operand.scalar.value))
    else break
    i = operand.next
  }
  if (parts.length === 0) return null
  return { pattern: parts.join(''), next: i }
}

/** wait 系コマンドの引数パターンを収集（1パターンは #NN 連結・隣接リテラル結合に対応） */
export function collectWaitPatterns(tokens: Token[], start: number, env: Env): string[] {
  const patterns: string[] = []
  let i = start
  while (i < tokens.length) {
    const parsed = parseWaitPatternAt(tokens, i, env)
    if (!parsed) break
    patterns.push(parsed.pattern)
    i = parsed.next
  }
  return patterns
}

function cloneEnv(env: ReadonlyMap<string, RuntimeValue>): Env {
  const next = new Map<string, RuntimeValue>()
  for (const [k, v] of env) {
    if (v.kind === 'array') {
      next.set(k, {
        kind: 'array',
        size: v.size,
        elements: new Map(v.elements),
        elementKind: v.elementKind,
      })
    } else {
      next.set(k, v)
    }
  }
  return next
}

function initEnv(macroArgv?: MacroArgvInput): Env {
  const env: Env = new Map()
  for (const name of ['timeout', 'mtimeout', 'result']) {
    env.set(name, { kind: 'int', value: 0, origin: 'system-default' })
  }
  for (const name of ['inputstr', 'matchstr']) {
    env.set(name, { kind: 'str', value: '', origin: 'system-default' })
  }
  applyMacroArgv(env, macroArgv)
  return env
}

/**
 * Tera Term: paramcnt / params[] / param1〜9 はマクロ起動時のコマンドライン引数。
 * 仕様の正は commandLineParams.ts（Manual 5 commandline.html）。
 */
function applyMacroArgv(env: Env, input?: MacroArgvInput): void {
  const snap = buildCommandLineParamsSnapshot(input)
  // 明示 argv は静的に既知（literal）。未指定（方針 A）は system-default のまま if で未確定。
  const origin = snap.specified ? 'literal' : 'system-default'

  env.set('paramcnt', { kind: 'int', value: snap.paramcnt, origin })

  const elements = new Map<number, RuntimeScalar>()
  for (const [index, value] of snap.params) {
    elements.set(index, { kind: 'str', value, origin })
  }
  const maxIndex = elements.size > 0 ? Math.max(...elements.keys()) : -1
  env.set('params', {
    kind: 'array',
    size: Math.max(maxIndex + 1, snap.paramcnt, 0),
    elements,
    elementKind: 'str',
  })

  for (let i = 1; i <= 9; i++) {
    env.set(`param${i}`, {
      kind: 'str',
      value: snap.param1to9[i - 1] ?? '',
      origin,
    })
  }
}

function isRuntimeOrigin(origin?: ValueOrigin): boolean {
  return origin === 'user-input' || origin === 'match-received' || origin === 'dialog-result'
}

function combineOrigins(a?: ValueOrigin, b?: ValueOrigin): ValueOrigin | undefined {
  if (a === 'user-input' || b === 'user-input') return 'user-input'
  if (a === 'match-received' || b === 'match-received') return 'match-received'
  if (a === 'dialog-result' || b === 'dialog-result') return 'dialog-result'
  if (a === 'assumed' || b === 'assumed') return 'assumed'
  if (a === 'literal' || b === 'literal') return 'literal'
  return a ?? b
}

function isIndeterminateScalar(v: RuntimeScalar): boolean {
  if (v.origin === 'assumed') return false
  if (v.kind === 'int') {
    return v.origin === 'dialog-result' || v.hint !== undefined
  }
  if (v.hasUnresolvedParts) return true
  if (isRuntimeOrigin(v.origin)) return true
  if (v.hint !== undefined && isCommandOutputHint(v.hint)) return true
  return v.value === '' && v.hint !== undefined
}

/** 静的に値が確定しないスカラーか（変数仮定の収集・上書き判定用） */
export function isIndeterminateRuntimeScalar(v: RuntimeValue): boolean {
  if (v.kind !== 'int' && v.kind !== 'str') return false
  return isIndeterminateScalar(v)
}

function stripAssumedStringQuotes(text: string): string {
  if (text.length >= 2) {
    const q = text[0]
    if ((q === "'" || q === '"') && text[text.length - 1] === q) {
      return text.slice(1, -1)
    }
  }
  return text
}

function applyVariableAssumptionsForLine(env: Env, lineNum: number, opts: EvalOptions): void {
  const names = opts.variableAssumptions?.get(lineNum)
  if (!names || names.size === 0) return
  for (const [name, text] of names) {
    const key = name.toLowerCase()
    const current = env.get(key)
    if (current?.kind !== 'int' && current?.kind !== 'str') continue
    if (!isIndeterminateScalar(current) && current.origin !== 'assumed') continue
    if (current.kind === 'int') {
      const n = parseTtlIntegerLiteral(text.trim())
      if (n === undefined) continue
      setScalar(env, key, {
        kind: 'int',
        value: n,
        origin: 'assumed',
        setBy: current.setBy,
      })
    } else {
      setScalar(env, key, {
        kind: 'str',
        value: stripAssumedStringQuotes(text),
        origin: 'assumed',
        sensitive: current.sensitive,
      })
    }
  }
}

function runtimeSegmentLabel(origin: ValueOrigin): string {
  switch (origin) {
    case 'user-input':
      return '（ユーザー入力）'
    case 'match-received':
      return '（受信マッチ）'
    case 'dialog-result':
      // origin 名は歴史的。ダイアログ以外の実行時依存 result にも使う
      return '（実行時）'
    case 'assumed':
      return '（仮定）'
    default:
      return '（実行時）'
  }
}

function runtimeStrNote(origin: ValueOrigin | undefined, isSystem: boolean, meta?: { setBy: string }): string | undefined {
  if (origin === 'user-input') {
    return isSystem
      ? `${meta?.setBy ?? 'inputbox 等'} の実行後に、実際の入力値が代入されます`
      : 'inputstr 等のユーザー入力が代入または結合されています（実行時に値が決まります）'
  }
  if (origin === 'match-received') {
    return isSystem
      ? 'wait 系コマンドで、受信データと一致した文字列が代入されます'
      : 'matchstr 等の受信データが代入または結合されています（実行時に値が決まります）'
  }
  return undefined
}

function operandDisplayPart(v: RuntimeScalar): string | undefined {
  if (v.hint) return v.hint
  if (v.kind === 'str') {
    if (v.origin === 'user-input' || v.origin === 'match-received') return runtimeSegmentLabel(v.origin)
    if (v.value) return `'${v.value}'`
    return undefined
  }
  if (v.kind === 'int') {
    if (v.origin === 'dialog-result') return runtimeSegmentLabel('dialog-result')
    return String(v.value)
  }
  return undefined
}

function mintUnresolvedSourceId(seq: { next: number }): number {
  return seq.next++
}

function mergeUnresolvedSourceIds(scalars: readonly RuntimeScalar[]): number[] | undefined {
  const ids: number[] = []
  const seen = new Set<number>()
  for (const scalar of scalars) {
    for (const id of scalar.unresolvedSourceIds ?? []) {
      if (seen.has(id)) continue
      seen.add(id)
      ids.push(id)
    }
  }
  return ids.length > 0 ? ids : undefined
}

function withUnresolvedSourceIds<T extends RuntimeScalar>(
  scalar: T,
  seq: { next: number },
  ids?: readonly number[],
): T {
  const unresolvedSourceIds = ids && ids.length > 0 ? [...ids] : [mintUnresolvedSourceId(seq)]
  return { ...scalar, unresolvedSourceIds }
}

/**
 * コマンド引数の識別子が持つ未確定根源 ID。
 * strreplace 等のインプレース dest は含める。sprintf2 等の出力専用 dest は含めない。
 */
function collectInputUnresolvedIds(tokens: Token[], env: Env, cmd: string): number[] {
  const ids: number[] = []
  const seen = new Set<number>()
  const outputIndices = getOutputVariableIndices(cmd)
  const inPlace = isInPlaceStringCommand(cmd)
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]
    if (tok?.kind !== 'identifier') continue
    if (tok.text.toLowerCase() === cmd) continue
    if (outputIndices.has(i) && !inPlace) continue
    const value = env.get(tok.text.toLowerCase())
    if (!value) continue
    const scalars: RuntimeScalar[] =
      value.kind === 'array'
        ? [...value.elements.values()]
        : value.kind === 'int' || value.kind === 'str'
          ? [value]
          : []
    for (const id of mergeUnresolvedSourceIds(scalars) ?? []) {
      if (seen.has(id)) continue
      seen.add(id)
      ids.push(id)
    }
  }
  return ids
}

function commandOutputSourceIds(
  cmd: string,
  tokens: Token[],
  env: Env,
  seq: { next: number },
): number[] {
  if (!commandIntroducesIndependentOutput(cmd)) {
    const inherited = collectInputUnresolvedIds(tokens, env, cmd)
    if (inherited.length > 0) return inherited
  }
  return [mintUnresolvedSourceId(seq)]
}

/** 変数・配列要素が持つ未確定根源 ID */
export function unresolvedSourceIdsOf(value: RuntimeValue): readonly number[] {
  if (value.kind === 'int' || value.kind === 'str') return value.unresolvedSourceIds ?? []
  if (value.kind === 'array') {
    return mergeUnresolvedSourceIds([...value.elements.values()]) ?? []
  }
  return []
}

function maxUnresolvedSourceId(env: ReadonlyMap<string, RuntimeValue>): number {
  let max = 0
  for (const value of env.values()) {
    for (const id of unresolvedSourceIdsOf(value)) {
      if (id > max) max = id
    }
  }
  return max
}

export function buildStringFromOperands(operands: RuntimeScalar[]): RuntimeScalar & { kind: 'str' } {
  const value = operands
    .map((v) => (v.kind === 'str' ? v.value : v.kind === 'int' ? String(v.value) : ''))
    .join('')

  let origin: ValueOrigin | undefined
  const hintParts: string[] = []
  for (const v of operands) {
    if (v.kind !== 'str' && v.kind !== 'int') continue
    origin = combineOrigins(origin, v.origin)
    const part = operandDisplayPart(v)
    if (part) hintParts.push(part)
  }

  const hasUnresolvedParts = operands.some(isUnresolvedOperand)
  const sensitive = operands.some((v) => v.kind === 'str' && v.sensitive)
  const unresolvedSourceIds = mergeUnresolvedSourceIds(operands)

  return {
    kind: 'str',
    value,
    origin,
    hint: hintParts.length > 0 ? hintParts.join(' + ') : undefined,
    hasUnresolvedParts: hasUnresolvedParts ? true : undefined,
    sensitive: sensitive || undefined,
    unresolvedSourceIds,
  }
}

export function prepareAssignedScalar(scalar: RuntimeScalar): RuntimeScalar {
  if (scalar.kind === 'str' && scalar.origin && !scalar.hint && isRuntimeOrigin(scalar.origin)) {
    return { ...scalar, hint: runtimeSegmentLabel(scalar.origin) }
  }
  return scalar
}

function evalTokenValue(token: Token | undefined, env: Env): RuntimeScalar | undefined {
  if (!token) return undefined
  if (token.kind === 'number') {
    const n = parseTtlIntegerLiteral(token.text)
    return n === undefined ? undefined : { kind: 'int', value: n }
  }
  if (token.kind === 'string') return { kind: 'str', value: unquoteString(token.text), origin: 'literal' }
  if (token.kind === 'identifier') {
    const v = env.get(token.text.toLowerCase())
    if (v?.kind === 'int' || v?.kind === 'str') return v
  }
  return undefined
}

/** if 条件で未確定とみなす値（既定値・実行時依存の result 等は静的に真偽を断定しない） */
function evalConditionTokenValue(token: Token | undefined, env: Env): RuntimeScalar | undefined {
  const v = evalTokenValue(token, env)
  if (v?.kind === 'int' && (v.origin === 'system-default' || v.origin === 'dialog-result')) {
    return undefined
  }
  return v
}

/**
 * 到達不能判定と同様、リテラルだけで真と断定できる if 条件か。
 * 変数比較は未確定とする（controlFlow.evalGuaranteedLiteralCondition）。
 */
function evalGuaranteedIfCondition(
  line: string,
  lineIdx: number,
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
  }
  return evalGuaranteedLiteralCondition(tokens.slice(off + 1, condEnd))
}

function isConditionalIfEndContext(opts: EvalOptions): boolean {
  // 未確定 if 内 end は分岐終了のみ（scripts/test-conditional-end-static.ts）
  return (opts.blockTerminatorStack ?? []).some((entry) => entry.kind === 'if' && !entry.guaranteed)
}

function hasAppliedBranchAssumption(
  opts: EvalOptions,
  line: string,
  lineIdx: number,
  env: Env,
  cmd: string,
): boolean {
  return tryEvalCondition(line, lineIdx, env, cmd) === undefined
    && opts.branchAssumptions?.has(lineIdx + 1) === true
}

function withIfBodyOpts(opts: EvalOptions, guaranteed: boolean): EvalOptions {
  return {
    ...opts,
    blockTerminatorStack: [
      ...(opts.blockTerminatorStack ?? []),
      { kind: 'if', guaranteed },
    ],
  }
}

function withElseBodyOpts(opts: EvalOptions, guaranteed = false): EvalOptions {
  return {
    ...opts,
    blockTerminatorStack: [
      ...(opts.blockTerminatorStack ?? []),
      { kind: 'if', guaranteed },
    ],
  }
}

/** 未確定 if then をホバー用にだけ走らせるときの完全隔離 opts */
function withSpeculativeHoverOpts(opts: EvalOptions): EvalOptions {
  return {
    ...withIfBodyOpts(opts, false),
    speculativeHover: true,
    sendEntries: undefined,
    callStack: [],
    loopControl: { breakRequested: false, continueRequested: false },
    // for 展開中でも各行の beforeLine を残せるよう loopFrame は外す
    loopFrame: undefined,
    includeStack: [...opts.includeStack],
    includeTabStack: [...opts.includeTabStack],
  }
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

/** 公式優先順位の整数式（expressions.html） */
function evalIntExpr(tokens: Token[], start: number, env: Env): number | undefined {
  const got = evalTtlIntExprAt(tokens, start, makeIntExprResolve(env))
  if (!got || got.error) return undefined
  return got.value
}

/** include 引数の実行時実効値（hoge や host[i] を env から解決） */
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

function isKnownStringValue(v: RuntimeScalar): v is RuntimeScalar & { kind: 'str' } {
  if (v.kind !== 'str') return false
  if (isRuntimeOrigin(v.origin)) return false
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

function resolveKnownSystemString(name: string, env: Env): string | undefined {
  const v = env.get(name.toLowerCase())
  if (!v) return ''
  if (v.kind !== 'str') return undefined
  if (v.hasUnresolvedParts) return undefined
  if (isRuntimeOrigin(v.origin)) return undefined
  return v.value
}

function createEvaluatorStaticCtx(tokens: Token[], offset: number, env: Env): StaticValueContext {
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
    resolveGroupedString(rel) {
      return resolveStaticGroupedString(tokens, offset + rel, (tok, i) => {
        const ctrl = resolveStaticControlPart(tokens, i)
        if (ctrl !== undefined) return ctrl
        const lit = resolveStaticLiteralPart(tok)
        if (lit !== undefined) return lit
        if (tok.kind === 'identifier') {
          const v = env.get(tok.text.toLowerCase())
          if (v?.kind === 'str' && isKnownStringValue(v)) return v.value
        }
        return undefined
      })
    },
    resolveSystemString(name) {
      return resolveKnownSystemString(name, env)
    },
  }
}

function resolveIfdefinedVarType(name: string, env: Env): IfdefinedTypeCode {
  const key = name.toLowerCase()
  if (key === 'paramcnt' || key === 'timeout' || key === 'mtimeout' || key === 'result') return 1
  if (key === 'params') return 6
  if (/^param\d+$/.test(key)) return 3
  if (key === 'inputstr' || key === 'matchstr' || /^groupmatchstr\d+$/.test(key)) return 3
  const v = env.get(key)
  if (!v) return 0
  if (v.kind === 'int') return 1
  if (v.kind === 'str') return 3
  if (v.kind === 'array') {
    if (v.elementKind === 'int') return 5
    if (v.elementKind === 'str') return 6
    for (const el of v.elements.values()) {
      if (el.kind === 'int') return 5
      if (el.kind === 'str') return 6
    }
    return 6
  }
  return 0
}

export function createIfdefinedLookup(env: Env, knownLabels: ReadonlySet<string>): IfdefinedLookup {
  return {
    isLabel(name) {
      return knownLabels.has(name.replace(/^:/, '').toLowerCase())
    },
    varType(name) {
      return resolveIfdefinedVarType(name, env)
    },
  }
}

function applyStaticCommandEffects(
  cmd: string,
  tokens: Token[],
  offset: number,
  env: Env,
  knownLabels?: ReadonlySet<string>,
): boolean {
  const staticCtx = createEvaluatorStaticCtx(tokens, offset, env)
  const sprintfResult = tryStaticSprintfCommand(cmd, offset, staticCtx)
  if (sprintfResult) {
    if (cmd === 'sprintf2' && sprintfResult.result === 0 && sprintfResult.destIndex !== undefined) {
      const destTok = tokens[sprintfResult.destIndex]
      if (destTok?.kind === 'identifier') {
        setScalar(env, destTok.text, { kind: 'str', value: sprintfResult.value, origin: 'literal' })
      }
    } else if (cmd === 'sprintf' && sprintfResult.result === 0) {
      setScalar(env, 'inputstr', { kind: 'str', value: sprintfResult.value, origin: 'literal' })
    }
    setResult(env, cmd, sprintfResult.result, 'literal')
    return true
  }

  const strResult = tryStaticStringCommand(cmd, offset, staticCtx)
  if (strResult) {
    const destTok = tokens[strResult.destIndex]
    if (destTok?.kind === 'identifier') {
      setScalar(env, destTok.text, { kind: 'str', value: strResult.value, origin: 'literal' })
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
      setScalar(env, destTok.text, { kind: 'int', value: intResult.value, origin: 'literal' })
      return true
    }
  }

  const splitResult = tryStaticStrsplitCommand(cmd, staticCtx)
  if (splitResult) {
    for (let i = 0; i < 9; i++) {
      setScalar(env, `groupmatchstr${i + 1}`, {
        kind: 'str',
        value: splitResult.groups[i]!,
        origin: 'literal',
      })
    }
    setResult(env, cmd, splitResult.result, 'literal')
    return true
  }

  const ifdefinedLookup = knownLabels ? createIfdefinedLookup(env, knownLabels) : undefined
  const ifdefinedName =
    cmd === 'ifdefined' && (tokens[offset + 1]?.kind === 'identifier' || tokens[offset + 1]?.kind === 'label')
      ? tokens[offset + 1]!.text
      : undefined
  const resultVal = tryStaticResultCommand(cmd, staticCtx, {
    ifdefined: ifdefinedLookup,
    ifdefinedName,
  })
  if (resultVal !== undefined) {
    setResult(env, cmd, resultVal, 'literal')
    return true
  }

  return false
}

function setScalar(env: Env, name: string, value: RuntimeScalar) {
  env.set(name.toLowerCase(), value)
}

/** システム変数 result を設定し、設定元コマンドを記録する */
function setResult(
  env: Env,
  setBy: string,
  value: number,
  origin: ValueOrigin,
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

function setArrayElement(env: Env, name: string, index: number, value: RuntimeScalar) {
  const key = name.toLowerCase()
  let arr = env.get(key)
  if (!arr || arr.kind !== 'array') {
    arr = { kind: 'array', size: index + 1, elements: new Map() }
    env.set(key, arr)
  }
  arr.elements.set(index, value)
}

function applyCommandOutputEffects(
  cmd: string,
  tokens: Token[],
  env: Env,
  seq: { next: number },
): boolean {
  const effect = getCommandOutputEffect(cmd)
  if (!effect) return false

  let applied = false
  const inheritedSourceIds = commandIntroducesIndependentOutput(cmd)
    ? undefined
    : commandOutputSourceIds(cmd, tokens, env, seq)

  for (const slot of effect.variables ?? []) {
    const tok = tokens[slot.index]
    if (tok?.kind !== 'identifier') continue
    applied = true
    const sourceIds = inheritedSourceIds ?? [mintUnresolvedSourceId(seq)]
    if (slot.type === 'integer') {
      setScalar(
        env,
        tok.text,
        withUnresolvedSourceIds(
          {
            kind: 'int',
            value: 0,
            hint: commandOutputHint(cmd),
          },
          seq,
          sourceIds,
        ),
      )
    } else {
      setScalar(
        env,
        tok.text,
        withUnresolvedSourceIds(
          {
            kind: 'str',
            value: '',
            hint: commandOutputHint(cmd),
          },
          seq,
          sourceIds,
        ),
      )
    }
  }

  for (const sys of effect.systemVariables ?? []) {
    applied = true
    const origin =
      sys.name === 'inputstr'
        ? 'user-input'
        : sys.name === 'matchstr' || sys.name.startsWith('groupmatchstr')
          ? 'match-received'
          : 'dialog-result'
    const sourceIds = inheritedSourceIds ?? [mintUnresolvedSourceId(seq)]
    if (sys.type === 'integer') {
      setScalar(env, sys.name, withUnresolvedSourceIds({ kind: 'int', value: 0, origin }, seq, sourceIds))
    } else {
      setScalar(
        env,
        sys.name,
        withUnresolvedSourceIds(
          {
            kind: 'str',
            value: '',
            origin,
            hint:
              sys.name === 'matchstr' || sys.name.startsWith('groupmatchstr')
                ? REGEX_MATCH_HINT
                : undefined,
          },
          seq,
          sourceIds,
        ),
      )
    }
  }

  if (effect.setsResult) {
    // 公式: getver は <version> 省略時 result を変更しない
    if (cmd === 'getver') {
      const cmdIdx = tokens.findIndex((t) => t.kind === 'identifier' && t.text.toLowerCase() === 'getver')
      if (cmdIdx >= 0 && tokens[cmdIdx + 2] === undefined) {
        return applied
      }
    }
    applied = true
    setResult(env, cmd, 0, 'dialog-result')
  }

  return applied
}

function processLine(
  env: Env,
  line: string,
  lineNum: number,
  knownLabels: ReadonlySet<string> | undefined,
  seq: { next: number },
): void {
  const tokens = tokenizeLine(line, lineNum)
  if (tokens.length === 0) return

  let offset = 0
  if (tokens[0]?.kind === 'label') offset = 1
  if (offset >= tokens.length) return

  const first = tokens[offset]!
  if (first.kind !== 'identifier') return

  const cmd = first.text.toLowerCase()

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
    if (applyStaticCommandEffects(cmd, tokens, offset, env, knownLabels)) return
    const dest = tokens[offset + 1].text
    const operands: RuntimeScalar[] = []
    const existing = env.get(dest.toLowerCase())
    if (existing?.kind === 'str') operands.push(existing)
    const grouped = evalGroupedStringExprAt(tokens, offset + 2, env)
    if (grouped) operands.push(grouped.scalar)
    if (operands.length > 0) setScalar(env, dest, buildStringFromOperands(operands))
    return
  }

  if (applyStaticCommandEffects(cmd, tokens, offset, env, knownLabels)) return

  if (applyWaitReceiveEffects(env, tokens, offset, cmd, seq)) return

  if (applyCommandOutputEffects(cmd, tokens, env, seq)) return
}

const WAIT_RECEIVE_COMMANDS = new Set(['wait', 'waitln', 'waitregex', 'wait4all'])

function applyWaitReceiveEffects(
  env: Env,
  tokens: Token[],
  offset: number,
  cmd: string,
  seq: { next: number },
): boolean {
  if (cmd === 'recvln') {
    setResult(env, cmd, 1, 'literal')
    setScalar(
      env,
      'inputstr',
      withUnresolvedSourceIds({ kind: 'str', value: '〈受信行〉', origin: 'match-received' }, seq),
    )
    return true
  }
  if (cmd === 'waitrecv') {
    const parsed = parseWaitPatternAt(tokens, offset + 1, env)
    const sub = parsed?.pattern ?? ''
    setResult(env, cmd, 1, 'literal')
    setScalar(
      env,
      'inputstr',
      withUnresolvedSourceIds(
        {
          kind: 'str',
          value: sub || '〈受信行〉',
          origin: 'match-received',
        },
        seq,
      ),
    )
    return true
  }
  if (!WAIT_RECEIVE_COMMANDS.has(cmd)) return false

  const patterns = collectWaitPatterns(tokens, offset + 1, env)
  let matchstrValue: string
  if (patterns.length === 0) {
    matchstrValue = '〈受信データ〉'
  } else if (patterns[0] === '') {
    matchstrValue = ''
  } else {
    matchstrValue = patterns[0]!
  }
  const origin: ValueOrigin =
    patterns.length > 0 &&
    tokens[offset + 1]?.kind === 'string' &&
    patterns[0] === unquoteString(tokens[offset + 1]!.text)
      ? 'literal'
      : 'match-received'
  const matchstr =
    origin === 'match-received'
      ? withUnresolvedSourceIds({ kind: 'str', value: matchstrValue, origin }, seq)
      : { kind: 'str' as const, value: matchstrValue, origin }
  setScalar(env, 'matchstr', matchstr)
  setResult(env, cmd, 1, 'literal')
  return true
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

function formatSendLocation(lineNum: number, prefix?: string): string {
  return prefix ? `${prefix}:L${lineNum}` : `L${lineNum}`
}

export function collectSendPayload(
  tokens: Token[],
  start: number,
  env: Env,
): { payload: string; rawArgs: string; unresolved: boolean; sensitive: boolean } {
  const parts: string[] = []
  const raw: string[] = []
  const unresolved = { flag: false }
  let sensitive = false

  let i = start
  while (i < tokens.length) {
    const tok = tokens[i]
    if (tok?.kind === 'operator' && tok.text === '+') {
      raw.push(tok.text)
      i++
      continue
    }

    const operand = evalSendOperand(tokens, i, env)
    if (!operand) break
    raw.push(...operand.rawParts)
    if (operand.scalar?.kind === 'str' && operand.scalar.sensitive) sensitive = true
    appendScalarToPayload(operand.scalar, parts, unresolved, `〈未定義: ${operand.label}〉`)
    i = operand.next
  }

  return { payload: parts.join(''), rawArgs: raw.join(' '), unresolved: unresolved.flag, sensitive }
}

function recordSend(
  opts: EvalOptions,
  lineNum: number,
  command: SendRecordCommand,
  tokens: Token[],
  commandTokenOffset: number,
  env: Env,
): void {
  if (!opts.sendEntries) return
  const argStart = sendDataTokenStart(command, commandTokenOffset)
  const { payload, rawArgs, unresolved } = collectSendPayload(tokens, argStart, env)
  const lf = opts.loopFrame
  opts.sendEntries.push({
    line: lineNum,
    location: formatSendLocation(lineNum, opts.locationPrefix),
    command,
    rawArgs,
    payload,
    unresolved,
    addsNewline: sendAddsNewline(command),
    loopInfo: lf
      ? { variable: lf.variable, value: lf.value, index: lf.index, total: lf.total }
      : undefined,
  })
}

function findNextIfSiblingLine(lines: string[], fromLineIdx: number, endIdx: number): number {
  for (let i = fromLineIdx + 1; i <= endIdx; i++) {
    const kw = lineKeyword(lines[i]!, i)
    if (kw === 'elseif' || kw === 'else' || kw === 'endif') return i
    if (kw === 'if') i = findBlockEnd(lines, i, 'if', 'endif')
  }
  return endIdx
}

/**
 * 同一 if 鎖の後続 if/elseif が仮定・リテラルで True になり、選択経路になるか。
 * その場合、先行の未確定分岐は実行されないためホバー投機も行わない。
 */
function laterIfSiblingWillExecute(
  env: Env,
  lines: string[],
  fromSiblingIdx: number,
  endIdx: number,
  opts: EvalOptions,
): boolean {
  let cursor = fromSiblingIdx
  while (cursor <= endIdx) {
    const kw = lineKeyword(lines[cursor]!, cursor)
    if (kw === 'endif' || kw === 'else') break
    if (kw === 'if' || kw === 'elseif') {
      if (resolveIfCondition(lines[cursor]!, cursor, env, kw, opts) === true) return true
      cursor = findNextIfSiblingLine(lines, cursor, endIdx)
      continue
    }
    cursor++
  }
  return false
}

function evalBoolExpr(tokens: Token[], env: Env): boolean | undefined {
  return evalBoolExprShared(tokens, env, evalConditionTokenValue, {
    resolveIntArray(name, index) {
      const arr = env.get(name.toLowerCase())
      if (!arr || arr.kind !== 'array') return undefined
      const el = arr.elements.get(index)
      if (el?.kind !== 'int') return undefined
      // 静的評価: 既定値・ダイアログ由来は真偽を断定しない（スカラー条件と同方針）
      if (el.origin === 'system-default' || el.origin === 'dialog-result') return undefined
      return el.value
    },
  })
}

function tryEvalCondition(line: string, lineIdx: number, env: Env, cmd: string): boolean | undefined {
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

  return evalBoolExpr(tokens.slice(off + 1, condEnd), env)
}

/** 分岐仮定を適用しない静的な if 条件評価（未確定分岐の列挙用） */
export function evalIfConditionStatic(
  line: string,
  lineIdx: number,
  env: MacroEnvironment,
  cmd: string,
): boolean | undefined {
  return tryEvalCondition(line, lineIdx, env as Env, cmd)
}

function resolveIfCondition(
  line: string,
  lineIdx: number,
  env: Env,
  cmd: string,
  opts: EvalOptions,
): boolean | undefined {
  const staticResult = tryEvalCondition(line, lineIdx, env, cmd)
  if (staticResult !== undefined) return staticResult
  const assumed = opts.branchAssumptions?.get(lineIdx + 1)
  if (assumed !== undefined) return assumed
  return undefined
}

function processIfChain(
  env: Env,
  lines: string[],
  lineIdx: number,
  beforeLine: Map<number, Env> | null,
  afterLine: Map<number, Env> | null,
  opts: EvalOptions,
): StmtResult {
  const endIdx = findBlockEnd(lines, lineIdx, 'if', 'endif')
  let cursor = lineIdx
  let executed = false
  let pathGuaranteed = true

  while (cursor <= endIdx) {
    const kw = lineKeyword(lines[cursor]!, cursor)
    if (kw === 'endif') break

    if (kw === 'else') {
      if (!executed) {
        const bodyStart = cursor + 1
        const bodyEnd = endIdx - 1
        if (bodyStart <= bodyEnd) {
          const run = processBlock(
            env,
            lines,
            bodyStart,
            bodyEnd,
            beforeLine,
            afterLine,
            withElseBodyOpts(opts, pathGuaranteed),
          )
          if (run !== 'complete') return blockRunToStmtResult(run, endIdx)
        }
      }
      break
    }

    if (kw === 'if' || kw === 'elseif') {
      const assumptionApplied = hasAppliedBranchAssumption(
        opts,
        lines[cursor]!,
        cursor,
        env,
        kw,
      )
      const condResult = resolveIfCondition(lines[cursor]!, cursor, env, kw, opts)
      const literalResult = evalGuaranteedIfCondition(lines[cursor]!, cursor, kw)
      const conditionGuaranteed = assumptionApplied || literalResult !== undefined
      const nextSibling = findNextIfSiblingLine(lines, cursor, endIdx)
      const bodyStart = cursor + 1
      const bodyEnd = nextSibling - 1

      if (condResult === true) {
        // elseif の明示的な True 仮定は、その分岐を選ぶ指定でもあるため、
        // 先行 if/elseif の未仮定条件にかかわらず選択経路を確定扱いにする。
        // 本体が空でもこの分岐は確定選択されるため、以降の else を実行させない
        // （executed を立てずに break を抜けると else が誤って走ってしまう）。
        if (bodyStart <= bodyEnd) {
          const selectedBranchGuaranteed =
            conditionGuaranteed && (assumptionApplied || pathGuaranteed)
          const run = processBlock(
            env,
            lines,
            bodyStart,
            bodyEnd,
            beforeLine,
            afterLine,
            withIfBodyOpts(opts, selectedBranchGuaranteed),
          )
          if (run !== 'complete') return blockRunToStmtResult(run, endIdx)
        }
        executed = true
        break
      }

      // 条件未確定: 本体は親 env に影響させないが、ホバー用にクローン上で投機実行して
      // then / elseif 本体の result 設定元（yesnobox 等）を beforeLine に残す。
      // afterLine も投機側で埋まる。本評価で未訪問の行へホバーしたとき
      // getEnvForLine が投機 afterLine にフォールバックするのは意図的（分岐内の
      // result 由来表示を可能にする）。親 env・sendEntries には反映しない。
      // 後続が仮定/リテラル True で選ばれるときは非選択経路なので投機しない
      // （送信・ホバーを同じ経路に揃える）。else 本体は従来どおり !executed のとき
      // 本評価で実行される（投機対象外）。
      if (
        condResult === undefined
        && bodyStart <= bodyEnd
        && beforeLine
        && !laterIfSiblingWillExecute(env, lines, nextSibling, endIdx, opts)
      ) {
        processBlock(
          cloneEnv(env),
          lines,
          bodyStart,
          bodyEnd,
          beforeLine,
          afterLine,
          withSpeculativeHoverOpts(opts),
        )
      }

      pathGuaranteed &&= conditionGuaranteed && condResult === false
      cursor = nextSibling
      continue
    }

    cursor++
  }

  return { nextIdx: endIdx }
}

interface CallFrame {
  returnIdx: number
}

interface EvalOptions {
  includeResolver?: IncludeResolver
  includeStack: string[]
  includeTabStack: string[]
  inInclude?: boolean
  /** if/while/for 等のブロック内 */
  inBlock?: boolean
  /** if 分岐内の end がマクロ全体を止めるか（未確定 if では分岐のみ終了） */
  blockTerminatorStack?: { kind: 'if'; guaranteed: boolean }[]
  locationPrefix?: string
  sendEntries?: SendEntry[]
  loopFrame?: { variable: string; value: number; index: number; total: number }
  loopControl?: { breakRequested: boolean; continueRequested: boolean }
  callStack: CallFrame[]
  /** 未確定 if/elseif 行番号（1-based）→ ユーザーが選んだ真偽 */
  branchAssumptions?: Map<number, boolean>
  /** 未確定変数のユーザー仮定（行番号 1-based → 変数名 → 入力テキスト） */
  variableAssumptions?: Map<number, Map<string, string>>
  knownLabels?: ReadonlySet<string>
  /** この評価内で未確定根源 ID を一意にする */
  unresolvedIdSeq: { next: number }
  /** ループ内 include の反復ごとの直前 env（キーは `@loop:L行:値`） */
  beforeIncludeByLoopKey?: Map<string, Env>
  /**
   * ホバー用の投機実行。親の送信・ループ制御・ジャンプと隔離する。
   * then/elseif 本体の jumpTo は追わない。未訪問行の afterLine フォールバックは意図的。
   */
  speculativeHover?: boolean
}

interface StmtResult {
  nextIdx: number
  /** 指定時は nextIdx+1 ではなくこの行へジャンプ（0-based） */
  jumpTo?: number
  stopAll?: boolean
  stopInclude?: boolean
  /** 現在のブロックだけを終了 */
  stopBlock?: boolean
  /** ステップ上限・call 深度上限などで打ち切り */
  truncated?: boolean
}

type BlockRunResult = 'complete' | 'stopAll' | 'stopInclude' | 'stopBlock'

function blockRunToStmtResult(run: BlockRunResult, nextIdx: number): StmtResult {
  if (run === 'stopAll') return { nextIdx, stopAll: true }
  if (run === 'stopInclude') return { nextIdx, stopInclude: true }
  if (run === 'stopBlock') return { nextIdx, stopBlock: true }
  return { nextIdx }
}

function resolveEnvString(env: Env, name: string): string | undefined {
  const v = env.get(name)
  return v?.kind === 'str' && v.value ? v.value : undefined
}

function processGotoCall(
  env: Env,
  lines: string[],
  lineIdx: number,
  tokens: Token[],
  offset: number,
  opts: EvalOptions,
): StmtResult {
  const cmd = tokens[offset]?.kind === 'identifier' ? tokens[offset]!.text.toLowerCase() : ''
  const labelName = resolveJumpLabelName(tokens[offset + 1], (n) => resolveEnvString(env, n))
  if (!labelName) return { nextIdx: lineIdx }
  const targetIdx = findLabelLineIndex(lines, labelName)
  if (targetIdx < 0) return { nextIdx: lineIdx, stopAll: true }

  if (cmd === 'call') {
    if (opts.callStack.length >= MAX_CALL_DEPTH) {
      return { nextIdx: lineIdx, stopAll: true, truncated: true }
    }
    opts.callStack.push({ returnIdx: lineIdx })
  }
  return { nextIdx: lineIdx, jumpTo: targetIdx }
}

function processIncludedContent(env: Env, content: string, opts: EvalOptions): StmtResult {
  const lines = stripComments(content)
  const includeOpts: EvalOptions = {
    ...opts,
    inInclude: true,
    inBlock: false,
    callStack: [],
    knownLabels: collectLabelNames(lines),
  }
  let i = 0
  while (i < lines.length) {
    const result = processStatement(env, lines, i, null, null, includeOpts)
    if (result.stopAll) return result
    if (result.stopInclude) break
    if (result.jumpTo !== undefined) {
      i = result.jumpTo
    } else {
      i = result.nextIdx + 1
    }
    continue
  }
  return { nextIdx: Math.max(0, lines.length - 1) }
}

function shouldCaptureLineEnv(opts: EvalOptions, beforeLine: Map<number, Env> | null): boolean {
  if (!beforeLine) return false
  if (!opts.loopFrame) return true
  return opts.loopFrame.index === opts.loopFrame.total
}

function processBlock(
  env: Env,
  lines: string[],
  startIdx: number,
  endIdx: number,
  beforeLine: Map<number, Env> | null,
  afterLine: Map<number, Env> | null,
  opts: EvalOptions,
): BlockRunResult {
  const captureLineEnv = shouldCaptureLineEnv(opts, beforeLine)
  let i = startIdx
  while (i <= endIdx) {
    const lineNum = i + 1
    // 各反復で上書きし、最終反復（または途中の stopAll）の直前 env を残す
    if (beforeLine) beforeLine.set(lineNum, cloneEnv(env))
    const result = processStatement(env, lines, i, beforeLine, afterLine, { ...opts, inBlock: true })
    if (captureLineEnv && afterLine) afterLine.set(lineNum, cloneEnv(env))
    if (result.stopAll) return 'stopAll'
    if (result.stopInclude) return 'stopInclude'
    if (result.stopBlock) return 'stopBlock'
    if (result.jumpTo !== undefined) {
      // ホバー投機: ジャンプは追わない（範囲外追従・後方 goto の無限ループを防ぐ）。
      // then 内の前方 goto で飛ばされる result 更新も反映しない（レアケース）。
      if (opts.speculativeHover) {
        i = i + 1
        continue
      }
      i = result.jumpTo
    } else {
      i = result.nextIdx > i ? result.nextIdx + 1 : i + 1
    }
  }
  return 'complete'
}

function processSingleLineIfTail(
  env: Env,
  lines: string[],
  lineIdx: number,
  tokens: Token[],
  tailStart: number,
  lineNum: number,
  opts: EvalOptions,
): StmtResult {
  const tailCmd = tokens[tailStart]?.kind === 'identifier' ? tokens[tailStart]!.text.toLowerCase() : ''
  if (tailCmd === 'goto' || tailCmd === 'call') {
    return processGotoCall(env, lines, lineIdx, tokens, tailStart, opts)
  }
  if (tailCmd === 'break' || tailCmd === 'continue') {
    if (!opts.loopControl) return { nextIdx: lineIdx, stopAll: true }
    if (tailCmd === 'break') opts.loopControl.breakRequested = true
    else opts.loopControl.continueRequested = true
    return { nextIdx: lineIdx, stopBlock: true }
  }
  if (applyWaitReceiveEffects(env, tokens, tailStart, tailCmd, opts.unresolvedIdSeq)) {
    return { nextIdx: lineIdx }
  }
  if (isSendRecordCommand(tailCmd)) {
    recordSend(opts, lineNum, tailCmd, tokens, tailStart, env)
    return { nextIdx: lineIdx }
  }
  if (tailCmd === 'end') {
    if (isConditionalIfEndContext(opts)) return { nextIdx: lineIdx, stopBlock: true }
    return { nextIdx: lineIdx, stopAll: true }
  }
  if (tailCmd === 'exit') {
    if (opts.inInclude) return { nextIdx: lineIdx, stopInclude: true }
    return { nextIdx: lineIdx, stopAll: true }
  }
  return { nextIdx: lineIdx }
}

function processStatement(
  env: Env,
  lines: string[],
  lineIdx: number,
  beforeLine: Map<number, Env> | null,
  afterLine: Map<number, Env> | null,
  opts: EvalOptions,
): StmtResult {
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

  if (cmd === 'break' || cmd === 'continue') {
    if (!opts.loopControl) return { nextIdx: lineIdx, stopAll: true }
    if (cmd === 'break') opts.loopControl.breakRequested = true
    else opts.loopControl.continueRequested = true
    return { nextIdx: lineIdx, stopBlock: true }
  }

  if (cmd === 'include') {
    if (opts.loopFrame && opts.beforeIncludeByLoopKey && !opts.inInclude) {
      opts.beforeIncludeByLoopKey.set(
        includeLoopIterationBindingKey(lineNum, opts.loopFrame.value),
        cloneEnv(env),
      )
    }
    const arg = tokens[offset + 1]
    if (arg && opts.includeResolver) {
      let bindingKey: string
      let content: string | null
      let locationPrefix: string
      let includeRawArg: string | undefined
      let effectiveRaw: string | undefined

      if (arg.kind === 'string') {
        const path = unquoteString(arg.text)
        bindingKey = normalizeIncludePath(path)
        content = opts.includeResolver.resolve(path)
        locationPrefix = path
      } else {
        includeRawArg = extractIncludeArgText(tokens, offset)
        effectiveRaw = resolveIncludeEffectiveRaw(tokens, offset, env)
        const loopValue = opts.loopFrame?.value
        if (loopValue !== undefined) {
          bindingKey = resolveLoopIncludeBindingKey(lineNum, loopValue, effectiveRaw)
          content = opts.includeResolver.resolveDynamic(includeRawArg, {
            line: lineNum,
            loopValue,
            rawArg: includeRawArg,
            effectiveRaw,
          })
          locationPrefix = includeLoopIterationBindingKey(lineNum, loopValue)
        } else {
          bindingKey = includeDynamicBindingKey(includeRawArg)
          content = opts.includeResolver.resolveDynamic(includeRawArg, {
            rawArg: includeRawArg,
            effectiveRaw,
          })
          locationPrefix = effectiveRaw ?? includeRawArg
        }
      }

      if (content && !opts.includeStack.includes(bindingKey)) {
        const linkedTabId = opts.includeResolver.getLinkedTabId(bindingKey, includeRawArg, effectiveRaw)
        if (linkedTabId && opts.includeTabStack.includes(linkedTabId)) {
          return { nextIdx: lineIdx }
        }
        const childResolver = linkedTabId
          ? opts.includeResolver.resolverForLinkedTab(linkedTabId) ?? opts.includeResolver
          : opts.includeResolver
        const childBranchAssumptions = linkedTabId
          ? opts.includeResolver.getBranchAssumptions?.(linkedTabId)
          : undefined
        const child = processIncludedContent(env, content, {
          ...opts,
          includeResolver: childResolver,
          includeStack: [...opts.includeStack, bindingKey],
          includeTabStack: linkedTabId ? [...opts.includeTabStack, linkedTabId] : opts.includeTabStack,
          locationPrefix,
          // 行番号キーはソース内だけで有効。親の Lx ではなくリンク先自身の仮定を使う。
          branchAssumptions: childBranchAssumptions
            ? new Map(childBranchAssumptions)
            : undefined,
          variableAssumptions: linkedTabId
            ? opts.includeResolver.getVariableAssumptions?.(linkedTabId)
            : undefined,
        })
        if (child.stopAll) return { nextIdx: lineIdx, stopAll: true }
      }
    }
    return { nextIdx: lineIdx }
  }

  if (cmd === 'exit') {
    if (opts.inInclude) return { nextIdx: lineIdx, stopInclude: true }
    return { nextIdx: lineIdx, stopAll: true }
  }

  if (cmd === 'end') {
    if (isConditionalIfEndContext(opts)) return { nextIdx: lineIdx, stopBlock: true }
    return { nextIdx: lineIdx, stopAll: true }
  }

  if (cmd === 'goto' || cmd === 'call') {
    return processGotoCall(env, lines, lineIdx, tokens, offset, opts)
  }

  if (cmd === 'return') {
    const frame = opts.callStack.pop()
    if (frame) {
      return { nextIdx: lineIdx, jumpTo: frame.returnIdx + 1 }
    }
    if (opts.inInclude && !opts.inBlock) {
      return { nextIdx: lineIdx, stopInclude: true }
    }
    if (opts.inBlock) return { nextIdx: lineIdx, stopBlock: true }
    return { nextIdx: lineIdx, stopAll: true }
  }

  if (isSendRecordCommand(cmd)) {
    recordSend(opts, lineNum, cmd, tokens, offset, env)
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
        iteration++
        setScalar(env, loopVar, { kind: 'int', value: v })
        const loopFrame = { variable: loopVar, value: v, index: iteration, total }
        const loopControl = { breakRequested: false, continueRequested: false }
        const run = processBlock(env, lines, lineIdx + 1, bodyEnd - 1, beforeLine, afterLine, {
          ...opts,
          loopFrame,
          loopControl,
        })
        if (run === 'stopAll' || run === 'stopInclude') return blockRunToStmtResult(run, bodyEnd)
        if (run === 'stopBlock' || loopControl.breakRequested) break
        if (loopControl.continueRequested) continue
      }
    } else if (start !== undefined && end !== undefined) {
      setScalar(env, loopVar, { kind: 'int', value: start })
      env.set(loopVar.toLowerCase(), { kind: 'range', start, end, label: loopVar })
      const run = processBlock(env, lines, lineIdx + 1, bodyEnd - 1, beforeLine, afterLine, opts)
      if (run !== 'complete') return blockRunToStmtResult(run, bodyEnd)
    } else {
      const run = processBlock(env, lines, lineIdx + 1, bodyEnd - 1, beforeLine, afterLine, opts)
      if (run !== 'complete') return blockRunToStmtResult(run, bodyEnd)
    }
    return { nextIdx: bodyEnd }
  }

  if (cmd === 'while') {
    const endIdx = findBlockEnd(lines, lineIdx, 'while', 'endwhile')
    let iterations = 0
    while (iterations++ < MAX_LOOP_ITERATIONS) {
      if (tryEvalCondition(line, lineIdx, env, 'while') !== true) break
      const loopControl = { breakRequested: false, continueRequested: false }
      const run = processBlock(env, lines, lineIdx + 1, endIdx - 1, beforeLine, afterLine, {
        ...opts,
        loopControl,
      })
      if (run === 'stopAll' || run === 'stopInclude') return blockRunToStmtResult(run, endIdx)
      if (run === 'stopBlock' || loopControl.breakRequested) break
    }
    return { nextIdx: endIdx }
  }

  if (cmd === 'until') {
    const endIdx = findBlockEnd(lines, lineIdx, 'until', 'enduntil')
    let iterations = 0
    while (iterations++ < MAX_LOOP_ITERATIONS) {
      const loopControl = { breakRequested: false, continueRequested: false }
      const run = processBlock(env, lines, lineIdx + 1, endIdx - 1, beforeLine, afterLine, {
        ...opts,
        loopControl,
      })
      if (run === 'stopAll' || run === 'stopInclude') return blockRunToStmtResult(run, endIdx)
      if (run === 'stopBlock' || loopControl.breakRequested) break
      if (tryEvalCondition(line, lineIdx, env, 'until') === true) break
    }
    return { nextIdx: endIdx }
  }

  if (cmd === 'do') {
    const endIdx = findBlockEnd(lines, lineIdx, 'do', 'loop')
    const loopTokens = tokenizeLine(lines[endIdx]!, endIdx + 1)
    const loopOffset = loopTokens[0]?.kind === 'label' ? 1 : 0
    const whileIndex = loopTokens.findIndex(
      (token, index) =>
        index > loopOffset && token.kind === 'identifier' && token.text.toLowerCase() === 'while',
    )
    let iterations = 0
    while (iterations++ < MAX_LOOP_ITERATIONS) {
      const run = processBlock(env, lines, lineIdx + 1, endIdx - 1, beforeLine, afterLine, {
        ...opts,
        loopControl: undefined,
      })
      if (run === 'stopAll' || run === 'stopInclude') return blockRunToStmtResult(run, endIdx)
      if (run === 'stopBlock') break
      if (whileIndex < 0) continue
      if (evalBoolExpr(loopTokens.slice(whileIndex + 1), env) !== true) break
    }
    return { nextIdx: endIdx }
  }

  for (const [open, close] of Object.entries(BLOCK_PAIRS)) {
    if (cmd === 'if') {
      const thenForm = findIfThenTailStart(tokens, offset)
      if (thenForm !== null) {
        const cond = resolveIfCondition(line, lineIdx, env, 'if', opts)
        if (cond === true) {
          const guaranteed =
            hasAppliedBranchAssumption(opts, line, lineIdx, env, 'if')
            || evalGuaranteedIfCondition(line, lineIdx, 'if') === true
          return processSingleLineIfTail(
            env,
            lines,
            lineIdx,
            tokens,
            thenForm.tailStart,
            lineNum,
            withIfBodyOpts(opts, guaranteed),
          )
        }
        return { nextIdx: lineIdx }
      }
      const tailStart = findSingleLineIfTailStart(tokens, offset)
      if (tailStart !== null) {
        const cond = resolveIfCondition(line, lineIdx, env, 'if', opts)
        if (cond === true) {
          const guaranteed =
            hasAppliedBranchAssumption(opts, line, lineIdx, env, 'if')
            || evalGuaranteedIfCondition(line, lineIdx, 'if') === true
          return processSingleLineIfTail(
            env,
            lines,
            lineIdx,
            tokens,
            tailStart,
            lineNum,
            withIfBodyOpts(opts, guaranteed),
          )
        }
        return { nextIdx: lineIdx }
      }
      return processIfChain(env, lines, lineIdx, beforeLine, afterLine, opts)
    }
    if (cmd === open && !['for', 'while', 'until', 'do'].includes(open)) {
      const endIdx = findBlockEnd(lines, lineIdx, open, close)
      const run = processBlock(env, lines, lineIdx + 1, endIdx - 1, beforeLine, afterLine, opts)
      if (run !== 'complete') return blockRunToStmtResult(run, endIdx)
      return { nextIdx: endIdx }
    }
  }

  processLine(env, line, lineNum, opts.knownLabels, opts.unresolvedIdSeq)
  applyVariableAssumptionsForLine(env, lineNum, opts)
  return { nextIdx: lineIdx }
}

export interface EvaluateOptions {
  includeResolver?: IncludeResolver
  /**
   * マクロ起動時のコマンドライン引数。
   * - string[]: [ファイル名, 引数1, ...]（後方互換。params[1..] に対応）
   * - MacroLaunchArgv: params[0]/[1]/[2..] を明示
   * 未指定（方針 A）: paramcnt=0・param* 空・params[0] 未設定
   */
  macroArgv?: MacroArgvInput
  /** 未確定 if/elseif のユーザー仮定（行番号 1-based → 真偽） */
  branchAssumptions?: Map<number, boolean>
  /** 未確定変数のユーザー仮定（行番号 1-based → 変数名 → 入力テキスト） */
  variableAssumptions?: Map<number, Map<string, string>>
  /**
   * include 先タブを単独評価するとき、親の include 直前 env を初期値にする。
   * 親で代入した値が include 先の送信・ホバー・未確定表示に載る。
   * 未確定根源 ID は env 内の最大値の次から振り、親の ID と衝突させない。
   */
  importedEnv?: ReadonlyMap<string, RuntimeValue>
}

export interface EvaluationResult {
  /** 各行の実行直前の環境（1-indexed line number） */
  beforeLine: Map<number, Env>
  /** 各行の実行直後の環境 */
  afterLine: Map<number, Env>
  sendEntries: SendEntry[]
  /** ループ内 include の反復ごとの直前 env（キーは `@loop:L行:値`） */
  beforeIncludeByLoopKey: Map<string, Env>
  /** ステップ上限等で評価が打ち切られた */
  truncated?: boolean
  getHoverAt(line: number, column: number): HoverAtResult | null
}

export function initMacroEnvironment(macroArgv?: MacroArgvInput): Map<string, RuntimeValue> {
  return initEnv(macroArgv)
}

/** @deprecated initMacroEnvironment を使用 */
export function createMacroEnvironment(macroArgv?: MacroArgvInput): Map<string, RuntimeValue> {
  return initMacroEnvironment(macroArgv)
}

/** 実行環境の浅いコピー */
export function cloneMacroEnvironment(env: Map<string, RuntimeValue>): Map<string, RuntimeValue> {
  return cloneEnv(env)
}

export type MacroEnvironment = Map<string, RuntimeValue>

export function evaluateTTL(source: string, options?: EvaluateOptions): EvaluationResult {
  const lines = stripComments(source)
  const beforeLine = new Map<number, Env>()
  const afterLine = new Map<number, Env>()
  const beforeIncludeByLoopKey = new Map<string, Env>()
  const sendEntries: SendEntry[] = []
  const env = options?.importedEnv ? cloneEnv(options.importedEnv) : initEnv(options?.macroArgv)
  const unresolvedIdSeq = { next: maxUnresolvedSourceId(env) + 1 }
  const labels = collectLabelLineMap(lines)
  const knownLabels = new Set(labels.keys())
  const evalOpts: EvalOptions = {
    includeResolver: options?.includeResolver,
    includeStack: [],
    includeTabStack: [],
    sendEntries,
    callStack: [],
    branchAssumptions: options?.branchAssumptions,
    variableAssumptions: options?.variableAssumptions,
    knownLabels,
    unresolvedIdSeq,
    beforeIncludeByLoopKey,
  }

  let lineIdx = 0
  const maxSteps = Math.max(lines.length * 8, 128)
  let steps = 0
  let truncated = false
  while (lineIdx < lines.length) {
    if (++steps > maxSteps) {
      truncated = true
      break
    }
    const lineNum = lineIdx + 1
    beforeLine.set(lineNum, cloneEnv(env))
    const result = processStatement(env, lines, lineIdx, beforeLine, afterLine, evalOpts)
    afterLine.set(lineNum, cloneEnv(env))
    if (result.truncated) truncated = true
    if (result.stopAll) break
    if (result.jumpTo !== undefined) {
      lineIdx = result.jumpTo
    } else {
      lineIdx = result.nextIdx + 1
    }
  }

  return {
    beforeLine,
    afterLine,
    beforeIncludeByLoopKey,
    sendEntries,
    truncated: truncated || undefined,
    getHoverAt(line: number, column: number): HoverAtResult | null {
      const rawLine = lines[line - 1]
      if (!rawLine) return null

      const target = findHoverTarget(rawLine, line, column)
      if (!target) return null

      if (target.kind === 'label') {
        return {
          from: target.from,
          to: target.to,
          info: resolveLabelHover(target.name, labels, target.context ?? 'definition', line),
        }
      }

      const envAtPoint = computeEnvAtColumn(beforeLine, afterLine, rawLine, line, target.from)

      const info = target.arrayName
        ? resolveArrayHover(target.arrayName, target.arrayIndex, envAtPoint)
        : resolveVarHover(target.name, envAtPoint)

      if (!info) return null
      return { from: target.from, to: target.to, info }
    },
  }
}

function resolveLabelHover(
  name: string,
  labels: Map<string, number>,
  context: 'definition' | 'goto' | 'call',
  currentLine: number,
): HoverInfo {
  const key = normalizeLabelName(name)
  const definedAt = labels.get(key)
  const labelName = formatLabelRef(name)

  if (context === 'definition') {
    return {
      name: labelName,
      type: 'label',
      display: '（ラベル定義）',
      note: `行 ${currentLine} で定義`,
      valueKind: 'label',
    }
  }

  const cmdLabel = context === 'goto' ? 'goto' : 'call'
  return {
    name: labelName,
    type: 'label',
    display: definedAt ? `→ L${definedAt}` : '（未定義ラベル）',
    note: definedAt
      ? `${cmdLabel} のジャンプ先（L${definedAt} で定義）`
      : `${cmdLabel} のジャンプ先ですが、定義が見つかりません`,
    valueKind: 'label',
  }
}

function getEnvForLine(lineNum: number, beforeLine: Map<number, Env>, afterLine: Map<number, Env>): Env {
  if (beforeLine.has(lineNum)) return cloneEnv(beforeLine.get(lineNum)!)

  for (let l = lineNum - 1; l >= 1; l--) {
    if (afterLine.has(l)) return cloneEnv(afterLine.get(l)!)
  }
  return initEnv()
}

function computeEnvAtColumn(
  beforeLine: Map<number, Env>,
  afterLine: Map<number, Env>,
  line: string,
  lineNum: number,
  tokenFrom: number,
): Env {
  const base = getEnvForLine(lineNum, beforeLine, afterLine)
  const tokens = tokenizeLine(line, lineNum)
  let stmtOffset = 0
  if (tokens[0]?.kind === 'label') stmtOffset = 1

  const assignIdx = findAssignmentIndex(tokens, stmtOffset)
  if (assignIdx < 0) return base

  // 演算子（=, := 等）の終端を境界にする。RHS 側（自己参照を含む）は常に
  // 代入前の env を見る必要があるため、最初の RHS トークン終端を境界にしてはいけない
  // （`cnt = cnt + 1` の RHS `cnt` にホバーしたとき代入後の値を返してしまう）。
  const assignEnd = tokens[assignIdx].column + tokens[assignIdx].text.length

  if (assignEnd > tokenFrom) {
    const tempEnv = cloneEnv(base)
    processLine(tempEnv, line, lineNum, undefined, { next: 1 })
    return tempEnv
  }

  return base
}

interface HoverTarget {
  kind: 'variable' | 'label'
  name: string
  from: number
  to: number
  arrayName?: string
  arrayIndex?: number | 'var'
  context?: 'definition' | 'goto' | 'call'
}

function findHoverTarget(line: string, lineNum: number, column: number): HoverTarget | null {
  const tokens = tokenizeLine(line, lineNum)
  const stmtOffset = tokens[0]?.kind === 'label' ? 1 : 0
  const cmd =
    tokens[stmtOffset]?.kind === 'identifier' ? tokens[stmtOffset].text.toLowerCase() : ''

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]!
    const start = tok.column
    const end = tok.column + tok.text.length

    if (tok.kind === 'label') {
      if (column >= start && column < end) {
        const context: 'definition' | 'goto' | 'call' =
          i === 0 ? 'definition' : cmd === 'goto' || cmd === 'call' ? cmd : 'definition'
        return { kind: 'label', name: tok.text, from: start, to: end, context }
      }
      continue
    }

    if (tok.kind !== 'identifier' || column < start || column >= end) continue

    const lower = tok.text.toLowerCase()
    if (RESERVED.has(lower)) return null

    if ((cmd === 'goto' || cmd === 'call') && i === stmtOffset + 1) {
      return { kind: 'label', name: tok.text, from: start, to: end, context: cmd }
    }

    if (tokens[i + 1]?.text === '[' && tokens[i + 3]?.text === ']') {
      const idxTok = tokens[i + 2]
      const idxEnd = tokens[i + 3]!.column + 1
      if (column < idxEnd) {
        const arrayIndex =
          idxTok?.kind === 'number'
            ? parseTtlIntegerLiteral(idxTok.text)
            : idxTok?.kind === 'identifier'
              ? 'var'
              : undefined
        return {
          kind: 'variable',
          name: tok.text,
          from: start,
          to: idxEnd,
          arrayName: tok.text,
          arrayIndex,
        }
      }
    }

    if (i > 0 && tokens[i - 1]?.text === '[' && tokens[i + 1]?.text === ']') {
      return { kind: 'variable', name: tok.text, from: start, to: end }
    }

    return { kind: 'variable', name: tok.text, from: start, to: end }
  }

  return null
}

function resolveVarHover(name: string, env: Env): HoverInfo {
  const key = name.toLowerCase()
  const v = env.get(key)
  const sysType = getSystemVariableType(name)
  const meta = getSystemVariableMeta(name)
  const isSystem = isSystemVariable(name)

  if (!v) {
    return {
      name,
      type: sysType ?? 'unknown',
      display: isSystem ? '（システム変数・初期状態）' : '（未代入）',
      note: isSystem && meta
        ? `${meta.description}。${meta.setBy} の実行後に更新されます。`
        : isSystem
          ? 'システム変数'
          : undefined,
      valueKind: isSystem ? 'system-default' : 'unset',
      isSystem,
    }
  }

  if ((v.kind === 'int' || v.kind === 'str') && v.origin === 'assumed') {
    const typeLabel = v.kind === 'int' ? 'integer' : 'string'
    const display = v.kind === 'int' ? String(v.value) : `'${v.value}'`
    return {
      name,
      type: typeLabel,
      display: `仮定: ${display}`,
      note: '静的解析用のユーザー仮定です（実行時の値ではありません）',
      valueKind: 'assumed',
      isSystem,
    }
  }

  if (v.kind === 'str' && (v.hint || v.origin === 'user-input' || v.origin === 'match-received')) {
    const display =
      v.hint ??
      (v.origin === 'user-input' ? '（ユーザー入力）' : v.origin === 'match-received' ? '（受信マッチ）' : `'${v.value}'`)
    return {
      name,
      type: 'string',
      display,
      note: runtimeStrNote(v.origin, isSystem, meta),
      valueKind: isRuntimeOrigin(v.origin) ? 'runtime' : 'known',
      isSystem,
    }
  }

  if (v.kind === 'int' && v.hint) {
    return {
      name,
      type: 'integer',
      display: v.hint,
      note: v.setBy
        ? formatResultSetByNote(v.setBy)
        : '実行時に決定されます',
      valueKind: 'runtime',
      isSystem,
    }
  }

  if (v.kind === 'int' && v.origin === 'dialog-result') {
    return {
      name,
      type: 'integer',
      display: v.hint ?? '（実行時）',
      note: v.setBy
        ? `${formatResultSetByNote(v.setBy)}（静的には断定できません）`
        : '実行時に決定されます（静的には断定できません）',
      valueKind: 'runtime',
      isSystem,
    }
  }

  if (isSystem && (v.kind === 'int' || v.kind === 'str') && v.origin === 'system-default') {
    const typeLabel = sysType ?? (v.kind === 'int' ? 'integer' : 'string')
    let note = meta ? `${meta.description}。${meta.setBy} で更新されます。` : 'システム変数（初期状態）'
    if (key === 'paramcnt') note = formatParamcntHoverNote(false)
    else {
      const pm = /^param(\d+)$/.exec(key)
      if (pm) note = `${formatParamNHoverNote(Number(pm[1]))}（エディタでは起動引数未指定）`
    }
    return {
      name,
      type: typeLabel,
      display: meta?.defaultHint ?? (v.kind === 'int' ? '0（初期値）' : "''（初期値）"),
      note,
      valueKind: 'system-default',
      isSystem: true,
    }
  }

  if (v.kind === 'int') {
    const note =
      key === 'result' && v.setBy
        ? formatResultSetByNote(v.setBy)
        : key === 'paramcnt'
          ? formatParamcntHoverNote(v.origin === 'literal')
          : isSystem && meta
            ? `システム変数 — ${meta.description}`
            : undefined
    return {
      name,
      type: 'integer',
      display: String(v.value),
      note,
      valueKind: 'known',
      isSystem,
    }
  }
  if (v.kind === 'str') {
    const paramMatch = /^param(\d+)$/.exec(key)
    const matchNote =
      isSystem && name.toLowerCase() === 'matchstr' && v.origin === 'literal'
        ? '待機文字列との一致を想定（静的推定）'
        : paramMatch
          ? formatParamNHoverNote(Number(paramMatch[1]))
          : isSystem && meta
            ? `システム変数 — ${meta.description}`
            : undefined
    return {
      name,
      type: 'string',
      display: v.value === '' && !isSystem ? "''" : `'${v.value}'`,
      note: matchNote,
      valueKind: 'known',
      isSystem,
    }
  }
  if (v.kind === 'range') {
    return {
      name,
      type: 'integer',
      display: `${v.start} ～ ${v.end}`,
      note: 'for ループ変数（反復範囲）',
      valueKind: 'known',
    }
  }
  if (v.kind === 'array') {
    return resolveArrayHover(name, undefined, env)!
  }

  return { name, type: 'unknown', display: '（不明）', valueKind: 'unset' }
}

function resolveArrayHover(
  name: string,
  index: number | 'var' | undefined,
  env: Env,
): HoverInfo | null {
  const key = name.toLowerCase()
  const arr = env.get(key)
  if (!arr || arr.kind !== 'array') {
    return { name, type: 'array', display: '（未宣言または未代入）' }
  }

  const isParams = key === 'params'
  const paramsSpecified = isParams && [...arr.elements.values()].some((el) => el.origin === 'literal')

  if (index !== undefined && index !== 'var') {
    const el = arr.elements.get(index)
    if (el?.kind === 'str' || el?.kind === 'int') {
      if (el.origin === 'assumed') {
        const display = el.kind === 'int' ? String(el.value) : `'${el.value}'`
        return {
          name: `${name}[${index}]`,
          type: el.kind === 'int' ? 'integer' : 'string',
          display: `仮定: ${display}`,
          note: '静的解析用のユーザー仮定です（実行時の値ではありません）',
          valueKind: 'assumed',
        }
      }
    }
    if (el?.kind === 'str') {
      if (el.hint || isRuntimeOrigin(el.origin)) {
        return {
          name: `${name}[${index}]`,
          type: 'string',
          display: el.hint ?? (el.origin ? runtimeSegmentLabel(el.origin) : `'${el.value}'`),
          note: isParams ? formatParamsIndexHoverNote(index) : runtimeStrNote(el.origin, false),
          valueKind: isRuntimeOrigin(el.origin) ? 'runtime' : 'known',
        }
      }
      return {
        name: `${name}[${index}]`,
        type: 'string',
        display: `'${el.value}'`,
        note: isParams ? formatParamsIndexHoverNote(index) : undefined,
        valueKind: 'known',
        isSystem: isParams,
      }
    }
    if (el?.kind === 'int') {
      return { name: `${name}[${index}]`, type: 'integer', display: String(el.value) }
    }
    return {
      name: `${name}[${index}]`,
      type: 'string',
      display: '（未代入）',
      note: isParams ? formatParamsIndexHoverNote(index) : undefined,
      isSystem: isParams,
    }
  }

  const entries = [...arr.elements.entries()].sort((a, b) => a[0] - b[0])
  if (entries.length === 0) {
    return {
      name,
      type: 'array',
      display: `（サイズ ${arr.size}、要素未代入）`,
      note: isParams ? formatParamsArrayHoverNote(false) : undefined,
      isSystem: isParams,
      valueKind: isParams ? 'system-default' : undefined,
    }
  }

  const lines = entries.map(([i, v]) => {
    const val =
      v.kind === 'str'
        ? v.hint ??
          (v.origin && isRuntimeOrigin(v.origin) ? runtimeSegmentLabel(v.origin) : `'${v.value}'`)
        : v.kind === 'int'
          ? String(v.value)
          : '?'
    return `[${i}] = ${val}`
  })

  if (index === 'var') {
    return {
      name: `${name}[i]`,
      type: 'array',
      display: lines.join('\n'),
      note: isParams ? formatParamsArrayHoverNote(paramsSpecified) : 'インデックスは変数（反復中）',
      isSystem: isParams,
    }
  }

  const preview = lines.slice(0, 8).join(', ')
  const more = lines.length > 8 ? ` …他${lines.length - 8}件` : ''
  return {
    name,
    type: 'array',
    display: preview + more,
    note: isParams ? formatParamsArrayHoverNote(paramsSpecified) : undefined,
    valueKind: 'known',
    isSystem: isParams,
  }
}
