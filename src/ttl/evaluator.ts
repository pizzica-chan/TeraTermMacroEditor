import { getSystemVariableType, getSystemVariableMeta, isSystemVariable } from './commands'
import type { IncludeResolver } from './analyzer'
import {
  extractIncludeArgText,
  includeDynamicBindingKey,
  normalizeIncludePath,
  resolveLoopIncludeBindingKey,
} from './includeRefs'
import { findAssignmentIndex } from './argChecker'
import { getCommandOutputEffect } from './commandOutputs'
import {
  tryStaticIntegerCommand,
  tryStaticStringCommand,
  type StaticValueContext,
} from './staticCommandEval'
import { RESERVED, tokenizeLine, stripComments, unquoteString, type Token } from './tokenize'
import { collectLabelLineMap, formatLabelRef, normalizeLabelName } from './labels'
import {
  findLabelLineIndex,
  findIfThenTailStart,
  findSingleLineIfTailStart,
  MAX_CALL_DEPTH,
  resolveJumpLabelName,
} from './subroutine'

export type ValueOrigin = 'literal' | 'user-input' | 'dialog-result' | 'match-received' | 'system-default'

export type RuntimeScalar =
  | { kind: 'int'; value: number; origin?: ValueOrigin; hint?: string }
  | {
      kind: 'str'
      value: string
      origin?: ValueOrigin
      hint?: string
      /** 文字列結合に実行時未定のオペランドを含む */
      hasUnresolvedParts?: boolean
      /** passwordbox 等の機密入力を含む */
      sensitive?: boolean
    }

export type RuntimeValue =
  | RuntimeScalar
  | { kind: 'array'; size: number; elements: Map<number, RuntimeScalar> }
  | { kind: 'range'; start: number; end: number; label: string }

export interface HoverInfo {
  name: string
  type: string
  display: string
  note?: string
  /** 表示スタイルの区別用 */
  valueKind?: 'known' | 'runtime' | 'system-default' | 'unset' | 'label'
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
  command: 'send' | 'sendln'
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

const BLOCK_PAIRS: Record<string, string> = {
  if: 'endif',
  while: 'endwhile',
  for: 'next',
  do: 'loop',
  until: 'enduntil',
}

const MAX_LOOP_ITERATIONS = 256

function forLoopIterationCount(start: number, end: number): number {
  return Math.abs(end - start) + 1
}

function canUnrollForLoop(start: number, end: number): boolean {
  return forLoopIterationCount(start, end) <= MAX_LOOP_ITERATIONS
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

function isUnresolvedOperand(v: RuntimeScalar): boolean {
  if (v.kind === 'int') return v.origin === 'dialog-result'
  if (v.kind !== 'str') return false
  if (v.hasUnresolvedParts) return true
  if (isRuntimeOrigin(v.origin)) return true
  if (v.hint !== undefined && v.hint.includes('実行時')) return true
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
    const code = Number(tokens[i + 1]!.text)
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

function tokenGapBefore(tokens: Token[], i: number): boolean {
  const prev = tokens[i - 1]
  const cur = tokens[i]
  if (!prev || !cur) return false
  return cur.column > prev.column + prev.text.length
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

function cloneEnv(env: Env): Env {
  const next = new Map<string, RuntimeValue>()
  for (const [k, v] of env) {
    if (v.kind === 'array') {
      next.set(k, { kind: 'array', size: v.size, elements: new Map(v.elements) })
    } else {
      next.set(k, v)
    }
  }
  return next
}

function initEnv(macroArgv?: string[]): Env {
  const env: Env = new Map()
  for (const name of ['timeout', 'mtimeout', 'result']) {
    env.set(name, { kind: 'int', value: 0, origin: 'system-default' })
  }
  for (const name of ['inputstr', 'matchstr']) {
    env.set(name, { kind: 'str', value: '', origin: 'system-default' })
  }
  applyMacroArgv(env, macroArgv ?? [])
  return env
}

/** Tera Term: paramcnt / params[] / param1〜9 はマクロ起動時のコマンドライン引数 */
function applyMacroArgv(env: Env, argv: string[]): void {
  env.set('paramcnt', { kind: 'int', value: argv.length, origin: 'system-default' })
  const elements = new Map<number, RuntimeScalar>()
  for (let i = 0; i < argv.length; i++) {
    elements.set(i + 1, { kind: 'str', value: argv[i]!, origin: 'system-default' })
  }
  env.set('params', { kind: 'array', size: Math.max(argv.length, 1), elements })
  for (let i = 1; i <= 9; i++) {
    env.set(`param${i}`, { kind: 'str', value: argv[i - 1] ?? '', origin: 'system-default' })
  }
}

function isRuntimeOrigin(origin?: ValueOrigin): boolean {
  return origin === 'user-input' || origin === 'match-received' || origin === 'dialog-result'
}

function combineOrigins(a?: ValueOrigin, b?: ValueOrigin): ValueOrigin | undefined {
  if (a === 'user-input' || b === 'user-input') return 'user-input'
  if (a === 'match-received' || b === 'match-received') return 'match-received'
  if (a === 'dialog-result' || b === 'dialog-result') return 'dialog-result'
  if (a === 'literal' || b === 'literal') return 'literal'
  return a ?? b
}

function runtimeSegmentLabel(origin: ValueOrigin): string {
  switch (origin) {
    case 'user-input':
      return '（ユーザー入力）'
    case 'match-received':
      return '（受信マッチ）'
    case 'dialog-result':
      return '（ダイアログの戻り値）'
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

  return {
    kind: 'str',
    value,
    origin,
    hint: hintParts.length > 0 ? hintParts.join(' + ') : undefined,
    hasUnresolvedParts: hasUnresolvedParts ? true : undefined,
    sensitive: sensitive || undefined,
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
  if (token.kind === 'number') return { kind: 'int', value: Number(token.text) }
  if (token.kind === 'string') return { kind: 'str', value: unquoteString(token.text), origin: 'literal' }
  if (token.kind === 'identifier') {
    const v = env.get(token.text.toLowerCase())
    if (v?.kind === 'int' || v?.kind === 'str') return v
  }
  return undefined
}

/** 単純な整数式: a, a - b, a + b */
function evalIntExpr(tokens: Token[], start: number, env: Env): number | undefined {
  const first = evalTokenValue(tokens[start], env)
  if (!first || first.kind !== 'int') {
    if (tokens[start]?.kind === 'number') return Number(tokens[start]!.text)
    return undefined
  }
  let value = first.value
  let i = start + 1
  while (i + 1 < tokens.length) {
    const op = tokens[i]
    const rhs = evalTokenValue(tokens[i + 1], env)
    if (op?.kind !== 'operator' || !rhs || rhs.kind !== 'int') break
    if (op.text === '-') value -= rhs.value
    else if (op.text === '+') value += rhs.value
    else break
    i += 2
  }
  return value
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
  }
}

function applyStaticCommandEffects(
  cmd: string,
  tokens: Token[],
  offset: number,
  env: Env,
): boolean {
  const staticCtx = createEvaluatorStaticCtx(tokens, offset, env)
  const strResult = tryStaticStringCommand(cmd, offset, staticCtx)
  if (strResult) {
    const destTok = tokens[strResult.destIndex]
    if (destTok?.kind === 'identifier') {
      setScalar(env, destTok.text, { kind: 'str', value: strResult.value, origin: 'literal' })
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

function setScalar(env: Env, name: string, value: RuntimeScalar) {
  env.set(name.toLowerCase(), value)
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

function applyCommandOutputEffects(cmd: string, tokens: Token[], env: Env): boolean {
  const effect = getCommandOutputEffect(cmd)
  if (!effect) return false

  let applied = false

  for (const slot of effect.variables ?? []) {
    const tok = tokens[slot.index]
    if (tok?.kind !== 'identifier') continue
    applied = true
    if (slot.type === 'integer') {
      setScalar(env, tok.text, {
        kind: 'int',
        value: 0,
        hint: `（${cmd} の出力 / 実行時）`,
      })
    } else {
      setScalar(env, tok.text, {
        kind: 'str',
        value: '',
        hint: `（${cmd} の出力 / 実行時）`,
      })
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
    if (sys.type === 'integer') {
      setScalar(env, sys.name, { kind: 'int', value: 0, origin })
    } else {
      setScalar(env, sys.name, {
        kind: 'str',
        value: '',
        origin,
        hint:
          sys.name === 'matchstr' || sys.name.startsWith('groupmatchstr')
            ? '（正規表現マッチ / 実行時）'
            : undefined,
      })
    }
  }

  if (effect.setsResult) {
    applied = true
    setScalar(env, 'result', { kind: 'int', value: 0, origin: 'dialog-result' })
  }

  return applied
}

function processLine(env: Env, line: string, lineNum: number): void {
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

  if (applyWaitReceiveEffects(env, tokens, offset, cmd)) return

  if (applyCommandOutputEffects(cmd, tokens, env)) return
}

const WAIT_RECEIVE_COMMANDS = new Set(['wait', 'waitln', 'waitregex', 'wait4all'])

function applyWaitReceiveEffects(env: Env, tokens: Token[], offset: number, cmd: string): boolean {
  if (cmd === 'recvln') {
    setScalar(env, 'result', { kind: 'int', value: 1, origin: 'literal' })
    setScalar(env, 'inputstr', { kind: 'str', value: '〈受信行〉', origin: 'match-received' })
    return true
  }
  if (cmd === 'waitrecv') {
    const parsed = parseWaitPatternAt(tokens, offset + 1, env)
    const sub = parsed?.pattern ?? ''
    setScalar(env, 'result', { kind: 'int', value: 1, origin: 'literal' })
    setScalar(env, 'inputstr', {
      kind: 'str',
      value: sub || '〈受信行〉',
      origin: 'match-received',
    })
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
  const origin =
    patterns.length > 0 &&
    tokens[offset + 1]?.kind === 'string' &&
    patterns[0] === unquoteString(tokens[offset + 1]!.text)
      ? 'literal'
      : 'match-received'
  setScalar(env, 'matchstr', { kind: 'str', value: matchstrValue, origin })
  setScalar(env, 'result', { kind: 'int', value: 1, origin: 'literal' })
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
  command: 'send' | 'sendln',
  tokens: Token[],
  argStart: number,
  env: Env,
): void {
  if (!opts.sendEntries) return
  const { payload, rawArgs, unresolved } = collectSendPayload(tokens, argStart, env)
  const lf = opts.loopFrame
  opts.sendEntries.push({
    line: lineNum,
    location: formatSendLocation(lineNum, opts.locationPrefix),
    command,
    rawArgs,
    payload,
    unresolved,
    addsNewline: command === 'sendln',
    loopInfo: lf
      ? { variable: lf.variable, value: lf.value, index: lf.index, total: lf.total }
      : undefined,
  })
}

function lineKeyword(line: string, lineIdx: number): string {
  const tokens = tokenizeLine(line, lineIdx + 1)
  let off = tokens[0]?.kind === 'label' ? 1 : 0
  return tokens[off]?.kind === 'identifier' ? tokens[off]!.text.toLowerCase() : ''
}

function findNextIfSiblingLine(lines: string[], fromLineIdx: number, endIdx: number): number {
  for (let i = fromLineIdx + 1; i <= endIdx; i++) {
    const kw = lineKeyword(lines[i]!, i)
    if (kw === 'elseif' || kw === 'else' || kw === 'endif') return i
    if (kw === 'if') i = findBlockEnd(lines, i, 'if', 'endif')
  }
  return endIdx
}

function scalarCompare(
  lhs: RuntimeScalar | undefined,
  op: string,
  rhs: RuntimeScalar | undefined,
): boolean | undefined {
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

function tryEvalCondition(line: string, lineIdx: number, env: Env, cmd: string): boolean | undefined {
  const tokens = tokenizeLine(line, lineIdx + 1)
  let off = tokens[0]?.kind === 'label' ? 1 : 0
  let condEnd = tokens.length

  if (cmd === 'if' || cmd === 'elseif') {
    const thenIdx = tokens.findIndex(
      (t, i) => i > off && t.kind === 'identifier' && t.text.toLowerCase() === 'then',
    )
    if (thenIdx < 0) return undefined
    condEnd = thenIdx
  } else if (cmd !== 'while' && cmd !== 'until') {
    return undefined
  }

  return evalBoolExpr(tokens.slice(off + 1, condEnd), env)
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

  while (cursor <= endIdx) {
    const kw = lineKeyword(lines[cursor]!, cursor)
    if (kw === 'endif') break

    if (kw === 'else') {
      if (!executed) {
        const bodyStart = cursor + 1
        const bodyEnd = endIdx - 1
        if (
          bodyStart <= bodyEnd &&
          processBlock(env, lines, bodyStart, bodyEnd, beforeLine, afterLine, opts)
        ) {
          return { nextIdx: endIdx, stopAll: true }
        }
      }
      break
    }

    if (kw === 'if' || kw === 'elseif') {
      const condResult = tryEvalCondition(lines[cursor]!, cursor, env, kw)
      const nextSibling = findNextIfSiblingLine(lines, cursor, endIdx)
      const bodyStart = cursor + 1
      const bodyEnd = nextSibling - 1

      if (condResult !== false && bodyStart <= bodyEnd) {
        if (
          processBlock(env, lines, bodyStart, bodyEnd, beforeLine, afterLine, opts)
        ) {
          return { nextIdx: endIdx, stopAll: true }
        }
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

interface CallFrame {
  returnIdx: number
}

interface EvalOptions {
  includeResolver?: IncludeResolver
  includeStack: string[]
  includeTabStack: string[]
  inInclude?: boolean
  /** if/while/for 等のブロック内（end/exit はブロック脱出のみ） */
  inBlock?: boolean
  locationPrefix?: string
  sendEntries?: SendEntry[]
  loopFrame?: { variable: string; value: number; index: number; total: number }
  callStack: CallFrame[]
}

interface StmtResult {
  nextIdx: number
  /** 指定時は nextIdx+1 ではなくこの行へジャンプ（0-based） */
  jumpTo?: number
  stopAll?: boolean
  stopInclude?: boolean
  /** ブロック内の end/exit（マクロ全体は継続） */
  stopBlock?: boolean
  /** ステップ上限・call 深度上限などで打ち切り */
  truncated?: boolean
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
  let i = 0
  while (i < lines.length) {
    const result = processStatement(env, lines, i, null, null, {
      ...opts,
      inInclude: true,
      inBlock: false,
      callStack: [],
    })
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
): boolean {
  const captureLineEnv = shouldCaptureLineEnv(opts, beforeLine)
  let i = startIdx
  while (i <= endIdx) {
    const lineNum = i + 1
    if (captureLineEnv && beforeLine) beforeLine.set(lineNum, cloneEnv(env))
    const result = processStatement(env, lines, i, beforeLine, afterLine, { ...opts, inBlock: true })
    if (captureLineEnv && afterLine) afterLine.set(lineNum, cloneEnv(env))
    if (result.stopAll) return true
    if (result.stopBlock || result.stopInclude) return false
    if (result.jumpTo !== undefined) {
      i = result.jumpTo
    } else {
      i = result.nextIdx > i ? result.nextIdx + 1 : i + 1
    }
  }
  return false
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
  if (applyWaitReceiveEffects(env, tokens, tailStart, tailCmd)) {
    return { nextIdx: lineIdx }
  }
  if (tailCmd === 'send' || tailCmd === 'sendln') {
    recordSend(opts, lineNum, tailCmd, tokens, tailStart + 1, env)
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

  if (cmd === 'include') {
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
          locationPrefix = effectiveRaw
            ? `${effectiveRaw}@${opts.loopFrame!.variable}=${loopValue}`
            : `${includeRawArg}@${opts.loopFrame!.variable}=${loopValue}`
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
        const child = processIncludedContent(env, content, {
          ...opts,
          includeResolver: childResolver,
          includeStack: [...opts.includeStack, bindingKey],
          includeTabStack: linkedTabId ? [...opts.includeTabStack, linkedTabId] : opts.includeTabStack,
          locationPrefix,
        })
        if (child.stopAll) return { nextIdx: lineIdx, stopAll: true }
      }
    }
    return { nextIdx: lineIdx }
  }

  if (cmd === 'exit') {
    if (opts.inInclude && !opts.inBlock) return { nextIdx: lineIdx, stopInclude: true }
    if (opts.inBlock) return { nextIdx: lineIdx, stopBlock: true }
    return { nextIdx: lineIdx, stopAll: true }
  }

  if (cmd === 'end') {
    if (opts.inInclude && !opts.inBlock) return { nextIdx: lineIdx, stopInclude: true }
    if (opts.inBlock) return { nextIdx: lineIdx, stopBlock: true }
    return { nextIdx: lineIdx, stopAll: true }
  }

  if (cmd === 'goto' || cmd === 'call') {
    return processGotoCall(env, lines, lineIdx, tokens, offset, opts)
  }

  if (cmd === 'return') {
    if (opts.inInclude && !opts.inBlock) {
      return { nextIdx: lineIdx, stopInclude: true }
    }
    const frame = opts.callStack.pop()
    if (frame) {
      return { nextIdx: lineIdx, jumpTo: frame.returnIdx + 1 }
    }
    if (opts.inBlock) return { nextIdx: lineIdx, stopBlock: true }
    return { nextIdx: lineIdx, stopAll: true }
  }

  if (cmd === 'send' || cmd === 'sendln') {
    recordSend(opts, lineNum, cmd, tokens, offset + 1, env)
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
        iteration++
        setScalar(env, loopVar, { kind: 'int', value: v })
        const loopFrame = { variable: loopVar, value: v, index: iteration, total }
        if (
          processBlock(env, lines, lineIdx + 1, bodyEnd - 1, beforeLine, afterLine, {
            ...opts,
            loopFrame,
          })
        ) {
          return { nextIdx: bodyEnd, stopAll: true }
        }
      }
    } else if (start !== undefined && end !== undefined) {
      setScalar(env, loopVar, { kind: 'int', value: start })
      env.set(loopVar.toLowerCase(), { kind: 'range', start, end, label: loopVar })
      if (processBlock(env, lines, lineIdx + 1, bodyEnd - 1, beforeLine, afterLine, opts)) {
        return { nextIdx: bodyEnd, stopAll: true }
      }
    } else if (processBlock(env, lines, lineIdx + 1, bodyEnd - 1, beforeLine, afterLine, opts)) {
      return { nextIdx: bodyEnd, stopAll: true }
    }
    return { nextIdx: bodyEnd }
  }

  for (const [open, close] of Object.entries(BLOCK_PAIRS)) {
    if (cmd === 'if') {
      const thenForm = findIfThenTailStart(tokens, offset)
      if (thenForm !== null) {
        const cond = evalBoolExpr(tokens.slice(offset + 1, thenForm.condEnd), env)
        if (cond === true) {
          return processSingleLineIfTail(env, lines, lineIdx, tokens, thenForm.tailStart, lineNum, opts)
        }
        return { nextIdx: lineIdx }
      }
      const tailStart = findSingleLineIfTailStart(tokens, offset)
      if (tailStart !== null) {
        const cond = evalBoolExpr(tokens.slice(offset + 1, tailStart), env)
        if (cond === true) {
          return processSingleLineIfTail(env, lines, lineIdx, tokens, tailStart, lineNum, opts)
        }
        return { nextIdx: lineIdx }
      }
      return processIfChain(env, lines, lineIdx, beforeLine, afterLine, opts)
    }
    if (cmd === open && open !== 'for') {
      const endIdx = findBlockEnd(lines, lineIdx, open, close)
      if (processBlock(env, lines, lineIdx + 1, endIdx - 1, beforeLine, afterLine, opts)) {
        return { nextIdx: endIdx, stopAll: true }
      }
      return { nextIdx: endIdx }
    }
  }

  processLine(env, line, lineNum)
  return { nextIdx: lineIdx }
}

export interface EvaluateOptions {
  includeResolver?: IncludeResolver
  /** マクロ起動時のコマンドライン引数（先頭要素はマクロファイルパス。paramcnt に含む） */
  macroArgv?: string[]
}

export interface EvaluationResult {
  /** 各行の実行直前の環境（1-indexed line number） */
  beforeLine: Map<number, Env>
  /** 各行の実行直後の環境 */
  afterLine: Map<number, Env>
  sendEntries: SendEntry[]
  /** ステップ上限等で評価が打ち切られた */
  truncated?: boolean
  getHoverAt(line: number, column: number): HoverAtResult | null
}

/** ドライラン等でマクロ実行環境を初期化する */
export function createMacroEnvironment(macroArgv?: string[]): Map<string, RuntimeValue> {
  return initEnv(macroArgv)
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
  const sendEntries: SendEntry[] = []
  const env = initEnv(options?.macroArgv)
  const labels = collectLabelLineMap(lines)
  const evalOpts: EvalOptions = {
    includeResolver: options?.includeResolver,
    includeStack: [],
    includeTabStack: [],
    sendEntries,
    callStack: [],
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

  const assignEnd = tokens[assignIdx + 1]
    ? tokens[assignIdx + 1].column + tokens[assignIdx + 1].text.length
    : tokens[assignIdx].column + 1

  if (assignEnd > tokenFrom) {
    const tempEnv = cloneEnv(base)
    processLine(tempEnv, line, lineNum)
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
            ? Number(idxTok.text)
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
      note: '実行時に決定されます',
      valueKind: 'runtime',
      isSystem,
    }
  }

  if (v.kind === 'int' && v.origin === 'dialog-result') {
    return {
      name,
      type: 'integer',
      display: v.hint ?? '（ダイアログの戻り値）',
      note: '実行時に決定されます（例: 1=OK / Yes、0=Cancel / No）',
      valueKind: 'runtime',
      isSystem,
    }
  }

  if (isSystem && (v.kind === 'int' || v.kind === 'str') && v.origin === 'system-default') {
    const typeLabel = sysType ?? (v.kind === 'int' ? 'integer' : 'string')
    return {
      name,
      type: typeLabel,
      display: meta?.defaultHint ?? (v.kind === 'int' ? '0（初期値）' : "''（初期値）"),
      note: meta ? `${meta.description}。${meta.setBy} で更新されます。` : 'システム変数（初期状態）',
      valueKind: 'system-default',
      isSystem: true,
    }
  }

  if (v.kind === 'int') {
    return {
      name,
      type: 'integer',
      display: String(v.value),
      note: isSystem && meta ? `システム変数 — ${meta.description}` : undefined,
      valueKind: 'known',
      isSystem,
    }
  }
  if (v.kind === 'str') {
    const matchNote =
      isSystem && name.toLowerCase() === 'matchstr' && v.origin === 'literal'
        ? '待機文字列との一致を想定（静的推定）'
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
  const arr = env.get(name.toLowerCase())
  if (!arr || arr.kind !== 'array') {
    return { name, type: 'array', display: '（未宣言または未代入）' }
  }

  if (index !== undefined && index !== 'var') {
    const el = arr.elements.get(index)
    if (el?.kind === 'str') {
      if (el.hint || isRuntimeOrigin(el.origin)) {
        return {
          name: `${name}[${index}]`,
          type: 'string',
          display: el.hint ?? (el.origin ? runtimeSegmentLabel(el.origin) : `'${el.value}'`),
          note: runtimeStrNote(el.origin, false),
          valueKind: isRuntimeOrigin(el.origin) ? 'runtime' : 'known',
        }
      }
      return { name: `${name}[${index}]`, type: 'string', display: `'${el.value}'` }
    }
    if (el?.kind === 'int') {
      return { name: `${name}[${index}]`, type: 'integer', display: String(el.value) }
    }
    return { name: `${name}[${index}]`, type: 'string', display: '（未代入）' }
  }

  const entries = [...arr.elements.entries()].sort((a, b) => a[0] - b[0])
  if (entries.length === 0) {
    return { name, type: 'array', display: `（サイズ ${arr.size}、要素未代入）` }
  }

  const lines = entries.map(([i, v]) => {
    const val = v.kind === 'str' ? `'${v.value}'` : String(v.value)
    return `[${i}] = ${val}`
  })

  if (index === 'var') {
    return {
      name: `${name}[i]`,
      type: 'array',
      display: lines.join('\n'),
      note: 'インデックスは変数（反復中）',
    }
  }

  return { name, type: 'array', display: lines.join('\n') }
}
