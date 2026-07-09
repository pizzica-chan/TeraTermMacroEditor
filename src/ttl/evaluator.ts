import { getSystemVariableType, getSystemVariableMeta, isSystemVariable } from './commands'
import type { IncludeResolver } from './analyzer'
import {
  extractIncludeArgText,
  includeDynamicBindingKey,
  includeLoopIterationBindingKey,
  normalizeIncludePath,
} from './includeRefs'
import { RESERVED, tokenizeLine, stripComments, unquoteString, type Token } from './tokenize'

export type ValueOrigin = 'literal' | 'user-input' | 'dialog-result' | 'match-received' | 'system-default'

export type RuntimeScalar =
  | { kind: 'int'; value: number; origin?: ValueOrigin; hint?: string }
  | { kind: 'str'; value: string; origin?: ValueOrigin; hint?: string }

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
    if (scalar.hint) {
      parts.push(scalar.hint)
      if (isRuntimeOrigin(scalar.origin)) unresolved.flag = true
    } else if (isRuntimeOrigin(scalar.origin)) {
      parts.push(runtimeSegmentLabel(scalar.origin!))
      unresolved.flag = true
    } else {
      parts.push(scalar.value)
    }
    return
  }
  if (scalar.kind === 'int') {
    if (scalar.origin === 'dialog-result') {
      parts.push(runtimeSegmentLabel('dialog-result'))
      unresolved.flag = true
    } else {
      parts.push(String(scalar.value))
    }
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

function initEnv(): Env {
  const env: Env = new Map()
  for (const name of ['timeout', 'mtimeout', 'result', 'paramcnt']) {
    env.set(name, { kind: 'int', value: 0, origin: 'system-default' })
  }
  for (const name of ['inputstr', 'matchstr']) {
    env.set(name, { kind: 'str', value: '', origin: 'system-default' })
  }
  return env
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

function buildStringFromOperands(operands: RuntimeScalar[]): RuntimeScalar & { kind: 'str' } {
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

  return {
    kind: 'str',
    value,
    origin,
    hint: hintParts.length > 0 ? hintParts.join(' + ') : undefined,
  }
}

function prepareAssignedScalar(scalar: RuntimeScalar): RuntimeScalar {
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

  const assignIdx = tokens.findIndex(
    (t, i) => i > offset && t.kind === 'operator' && (t.text === '=' || t.text === ':='),
  )

  if (assignIdx > offset) {
    const arrayName = isArrayAssignTarget(tokens, assignIdx)
    const valueToken = tokens[assignIdx + 1]
    const scalar = evalTokenValue(valueToken, env)

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

  if (cmd === 'int2str' && tokens[offset + 1]?.kind === 'identifier') {
    const v = evalTokenValue(tokens[offset + 2], env)
    if (v?.kind === 'int') setScalar(env, tokens[offset + 1].text, { kind: 'str', value: String(v.value) })
    return
  }

  if (cmd === 'inputbox' || cmd === 'passwordbox') {
    setScalar(env, 'inputstr', { kind: 'str', value: '', origin: 'user-input' })
    setScalar(env, 'result', { kind: 'int', value: 0, origin: 'dialog-result' })
    return
  }

  if (cmd === 'yesnobox' || cmd === 'messagebox' || cmd === 'listbox') {
    setScalar(env, 'result', { kind: 'int', value: 0, origin: 'dialog-result' })
    return
  }

  if (cmd === 'wait' || cmd === 'waitln' || cmd === 'waitregex') {
    const arg = tokens[offset + 1]
    if (arg?.kind === 'string') {
      setScalar(env, 'matchstr', { kind: 'str', value: unquoteString(arg.text), origin: 'literal' })
    } else {
      setScalar(env, 'matchstr', { kind: 'str', value: '', origin: 'match-received' })
    }
    return
  }
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

function collectSendPayload(tokens: Token[], start: number, env: Env): { payload: string; rawArgs: string; unresolved: boolean } {
  const parts: string[] = []
  const raw: string[] = []
  const unresolved = { flag: false }

  let i = start
  while (i < tokens.length) {
    const operand = evalSendOperand(tokens, i, env)
    if (!operand) break
    raw.push(...operand.rawParts)
    appendScalarToPayload(operand.scalar, parts, unresolved, `〈未定義: ${operand.label}〉`)
    i = operand.next
  }

  return { payload: parts.join(''), rawArgs: raw.join(' '), unresolved: unresolved.flag }
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

interface EvalOptions {
  includeResolver?: IncludeResolver
  includeStack: string[]
  includeTabStack: string[]
  inInclude?: boolean
  locationPrefix?: string
  sendEntries?: SendEntry[]
  loopFrame?: { variable: string; value: number; index: number; total: number }
}

interface StmtResult {
  nextIdx: number
  stopAll?: boolean
  stopInclude?: boolean
}

function processIncludedContent(env: Env, content: string, opts: EvalOptions): StmtResult {
  const lines = stripComments(content)
  let i = 0
  while (i < lines.length) {
    const result = processStatement(env, lines, i, null, null, { ...opts, inInclude: true })
    if (result.stopAll) return result
    if (result.stopInclude) break
    i = result.nextIdx + 1
  }
  return { nextIdx: Math.max(0, lines.length - 1) }
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
  let i = startIdx
  while (i <= endIdx) {
    const lineNum = i + 1
    if (beforeLine) beforeLine.set(lineNum, cloneEnv(env))
    const result = processStatement(env, lines, i, beforeLine, afterLine, opts)
    if (afterLine) afterLine.set(lineNum, cloneEnv(env))
    if (result.stopAll) return true
    if (result.stopInclude) return false
    i = result.nextIdx > i ? result.nextIdx + 1 : i + 1
  }
  return false
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

      if (arg.kind === 'string') {
        const path = unquoteString(arg.text)
        bindingKey = normalizeIncludePath(path)
        content = opts.includeResolver.resolve(path)
        locationPrefix = path
      } else {
        includeRawArg = extractIncludeArgText(tokens, offset)
        const loopValue = opts.loopFrame?.value
        if (loopValue !== undefined) {
          bindingKey = includeLoopIterationBindingKey(lineNum, loopValue)
          content = opts.includeResolver.resolveDynamic(includeRawArg, { line: lineNum, loopValue })
          locationPrefix = `${includeRawArg}@${opts.loopFrame!.variable}=${loopValue}`
        } else {
          bindingKey = includeDynamicBindingKey(includeRawArg)
          content = opts.includeResolver.resolveDynamic(includeRawArg)
          locationPrefix = includeRawArg
        }
      }

      if (content && !opts.includeStack.includes(bindingKey)) {
        const linkedTabId = opts.includeResolver.getLinkedTabId(bindingKey, includeRawArg)
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
    if (opts.inInclude) return { nextIdx: lineIdx, stopInclude: true }
    return { nextIdx: lineIdx, stopAll: true }
  }

  if (cmd === 'end') {
    if (opts.inInclude) return { nextIdx: lineIdx, stopInclude: true }
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
}

export interface EvaluationResult {
  /** 各行の実行直前の環境（1-indexed line number） */
  beforeLine: Map<number, Env>
  /** 各行の実行直後の環境 */
  afterLine: Map<number, Env>
  sendEntries: SendEntry[]
  getHoverAt(line: number, column: number): HoverAtResult | null
}

export function evaluateTTL(source: string, options?: EvaluateOptions): EvaluationResult {
  const lines = stripComments(source)
  const beforeLine = new Map<number, Env>()
  const afterLine = new Map<number, Env>()
  const sendEntries: SendEntry[] = []
  const env = initEnv()
  const labels = collectLabelDefinitions(lines)
  const evalOpts: EvalOptions = {
    includeResolver: options?.includeResolver,
    includeStack: [],
    includeTabStack: [],
    sendEntries,
  }

  let lineIdx = 0
  while (lineIdx < lines.length) {
    const lineNum = lineIdx + 1
    beforeLine.set(lineNum, cloneEnv(env))
    const result = processStatement(env, lines, lineIdx, beforeLine, afterLine, evalOpts)
    afterLine.set(lineNum, cloneEnv(env))
    if (result.stopAll) break
    lineIdx = result.nextIdx + 1
  }

  return {
    beforeLine,
    afterLine,
    sendEntries,
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

function collectLabelDefinitions(lines: string[]): Map<string, number> {
  const labels = new Map<string, number>()
  for (let i = 0; i < lines.length; i++) {
    const tokens = tokenizeLine(lines[i]!, i + 1)
    if (tokens[0]?.kind === 'label') {
      labels.set(tokens[0].text.toLowerCase(), i + 1)
    }
  }
  return labels
}

function resolveLabelHover(
  name: string,
  labels: Map<string, number>,
  context: 'definition' | 'goto' | 'call',
  currentLine: number,
): HoverInfo {
  const key = name.toLowerCase()
  const definedAt = labels.get(key)
  const labelName = `:${name}`

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

  // 同一行内でホバー位置より前に完了した代入を反映
  const assignIdx = tokens.findIndex(
    (t, j) => j > 0 && t.kind === 'operator' && (t.text === '=' || t.text === ':='),
  )
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
