import { stripComments, tokenizeLine, unquoteString, type Token } from './tokenize'

export const MAX_INCLUDE_LOOP_ITERATIONS = 256

export interface IncludeLoopContext {
  variable: string
  start: number
  end: number
  values: number[]
}

export interface IncludeRef {
  line: number
  column: number
  /** 文字列リテラルから得たパス（動的 include は null） */
  path: string | null
  raw: string
  isDynamic: boolean
  /** 静的に展開可能な for ループ内にある場合 */
  loopContext?: IncludeLoopContext
}

export interface IncludeResolveContext {
  line: number
  loopValue?: number
}

interface ForLoopBlock {
  variable: string
  start: number
  end: number
  bodyStartLine: number
  bodyEndLine: number
}

export type { ForLoopBlock }

export function normalizeIncludePath(path: string): string {
  return path.replace(/\\/g, '/').toLowerCase()
}

const INCLUDE_LINE_BINDING_PREFIX = '@line:'
const INCLUDE_DYNAMIC_BINDING_PREFIX = '@dynamic:'
const INCLUDE_LOOP_BINDING_PREFIX = '@loop:'

/** 変数指定 include のタブ紐づけキー（引数テキストベース） */
export function includeDynamicBindingKey(rawArg: string): string {
  return `${INCLUDE_DYNAMIC_BINDING_PREFIX}${rawArg.trim().toLowerCase()}`
}

/** for ループ展開時の include タブ紐づけキー（行番号 + ループ変数の値） */
export function includeLoopIterationBindingKey(line: number, loopValue: number): string {
  return `${INCLUDE_LOOP_BINDING_PREFIX}L${line}:${loopValue}`
}

/** for ループ内 include の全反復共通タブ紐づけキー */
export function includeLoopLineBindingKey(line: number): string {
  return `${INCLUDE_LOOP_BINDING_PREFIX}L${line}:*`
}

export function isIncludeLoopLineBindingKey(key: string): boolean {
  return key.endsWith(':*') && key.startsWith(INCLUDE_LOOP_BINDING_PREFIX)
}

export function isIncludeLineBindingKey(key: string): boolean {
  return key.startsWith(INCLUDE_LINE_BINDING_PREFIX)
}

export function isIncludeLoopBindingKey(key: string): boolean {
  return key.startsWith(INCLUDE_LOOP_BINDING_PREFIX)
}

function parseIncludeLineBindingKey(key: string): number | null {
  if (!isIncludeLineBindingKey(key)) return null
  const n = Number(key.slice(INCLUDE_LINE_BINDING_PREFIX.length))
  return Number.isFinite(n) && n > 0 ? n : null
}

/** include 文に対応するタブ紐づけキー（ループ外の単一紐づけ） */
export function getIncludeBindingKey(ref: IncludeRef): string | null {
  if (ref.path) return normalizeIncludePath(ref.path)
  if (ref.loopContext) return null
  if (ref.isDynamic && ref.raw) return includeDynamicBindingKey(ref.raw)
  return null
}

export function getIncludeLoopBindingKeys(ref: IncludeRef): string[] {
  if (!ref.loopContext) return []
  return ref.loopContext.values.map((v) => includeLoopIterationBindingKey(ref.line, v))
}

export function resolveIncludeBindingTabId(
  bindings: Record<string, string>,
  bindingKey: string,
  rawArg?: string,
): string | null {
  const direct = bindings[bindingKey]
  if (direct) return direct

  const loopIterMatch = bindingKey.match(/^@loop:L(\d+):(-?\d+)$/)
  if (loopIterMatch) {
    const line = Number(loopIterMatch[1])
    const lineKey = includeLoopLineBindingKey(line)
    if (bindings[lineKey]) return bindings[lineKey]
  }

  if (rawArg) {
    const dynamicKey = includeDynamicBindingKey(rawArg)
    if (bindings[dynamicKey]) return bindings[dynamicKey]
  }

  return null
}

export function isIncludeRefLinked(ref: IncludeRef, bindings: Record<string, string>): boolean {
  if (ref.loopContext) {
    if (bindings[includeLoopLineBindingKey(ref.line)]) return true
    if (bindings[includeDynamicBindingKey(ref.raw)]) return true
    return ref.loopContext.values.every(
      (v) => !!bindings[includeLoopIterationBindingKey(ref.line, v)],
    )
  }
  const key = getIncludeBindingKey(ref)
  return key ? !!bindings[key] : false
}

export function getLoopIncludeCommonTabId(ref: IncludeRef, bindings: Record<string, string>): string {
  if (!ref.loopContext) return ''
  return (
    bindings[includeLoopLineBindingKey(ref.line)] ??
    bindings[includeDynamicBindingKey(ref.raw)] ??
    ''
  )
}

export function computeLoopValues(start: number, end: number): number[] {
  const values: number[] = []
  const step = start <= end ? 1 : -1
  for (let v = start; step > 0 ? v <= end : v >= end; v += step) {
    values.push(v)
    if (values.length > MAX_INCLUDE_LOOP_ITERATIONS) return []
  }
  return values
}

function collectStaticIntConstants(lines: string[]): Map<string, number> {
  const constants = new Map<string, number>()
  for (let i = 0; i < lines.length; i++) {
    const tokens = tokenizeLine(lines[i]!, i + 1)
    let offset = 0
    if (tokens[0]?.kind === 'label') offset = 1
    const assignIdx = tokens.findIndex(
      (t, j) => j > offset && t.kind === 'operator' && (t.text === '=' || t.text === ':='),
    )
    if (assignIdx <= offset) continue
    const lhs = tokens[assignIdx - 1]
    const rhs = tokens[assignIdx + 1]
    if (lhs?.kind !== 'identifier' || rhs?.kind !== 'number') continue
    constants.set(lhs.text.toLowerCase(), Number(rhs.text))
  }
  return constants
}

function resolveStaticIntToken(token: Token | undefined, constants: Map<string, number>): number | undefined {
  if (!token) return undefined
  if (token.kind === 'number') return Number(token.text)
  if (token.kind === 'identifier') return constants.get(token.text.toLowerCase())
  return undefined
}

function findBlockEndIndex(lines: string[], startIdx: number, open: string, close: string): number {
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

function findForLoopBlocks(lines: string[]): ForLoopBlock[] {
  const constants = collectStaticIntConstants(lines)
  const blocks: ForLoopBlock[] = []

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const tokens = tokenizeLine(lines[lineIdx]!, lineIdx + 1)
    let start = 0
    if (tokens[0]?.kind === 'label') start = 1
    if (tokens[start]?.kind !== 'identifier' || tokens[start]!.text.toLowerCase() !== 'for') continue
    if (tokens[start + 1]?.kind !== 'identifier') continue

    const variable = tokens[start + 1]!.text
    const loopStart = resolveStaticIntToken(tokens[start + 2], constants)
    const loopEnd = resolveStaticIntToken(tokens[start + 3], constants)
    if (loopStart === undefined || loopEnd === undefined) continue

    const values = computeLoopValues(loopStart, loopEnd)
    if (values.length === 0) continue

    const nextIdx = findBlockEndIndex(lines, lineIdx, 'for', 'next')
    blocks.push({
      variable,
      start: loopStart,
      end: loopEnd,
      bodyStartLine: lineIdx + 2,
      bodyEndLine: nextIdx,
    })
  }

  return blocks
}

function getInnermostForLoopForLine(blocks: ForLoopBlock[], line: number): ForLoopBlock | null {
  let best: ForLoopBlock | null = null
  let bestSpan = Infinity
  for (const block of blocks) {
    if (line < block.bodyStartLine || line > block.bodyEndLine) continue
    const span = block.bodyEndLine - block.bodyStartLine
    if (span < bestSpan) {
      best = block
      bestSpan = span
    }
  }
  return best
}

/** include コマンドの引数テキストを取得（host[i] など） */
export function extractIncludeArgText(tokens: Token[], cmdIndex: number): string {
  const parts: string[] = []
  for (let i = cmdIndex + 1; i < tokens.length; i++) {
    parts.push(tokens[i]!.text)
  }
  return parts.join('')
}

export function migrateIncludeBindings(
  source: string,
  bindings: Record<string, string>,
): Record<string, string> {
  const refs = findIncludeRefs(source)

  let changed = false
  const next = { ...bindings }

  for (const [key, tabId] of Object.entries(bindings)) {
    if (!isIncludeLineBindingKey(key)) continue
    const oldLine = parseIncludeLineBindingKey(key)
    if (!oldLine) continue

    const refAtLine = refs.find((r) => r.line === oldLine && r.isDynamic && r.raw)
    const newKey = refAtLine ? includeDynamicBindingKey(refAtLine.raw) : null

    if (newKey && !next[newKey]) {
      next[newKey] = tabId
    }
    delete next[key]
    changed = true
  }

  return changed ? next : bindings
}

/** ソース中の include 文を列挙する */
export function findIncludeRefs(source: string): IncludeRef[] {
  const lines = stripComments(source)
  const loopBlocks = findForLoopBlocks(lines)
  const refs: IncludeRef[] = []

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1
    const tokens = tokenizeLine(lines[i]!, lineNum)
    if (tokens.length === 0) continue

    let start = 0
    if (tokens[0]?.kind === 'label') start = 1
    if (tokens[start]?.kind !== 'identifier') continue
    if (tokens[start]!.text.toLowerCase() !== 'include') continue

    const arg = tokens[start + 1]
    if (!arg) {
      refs.push({ line: lineNum, column: tokens[start]!.column, path: null, raw: '', isDynamic: false })
      continue
    }

    if (arg.kind === 'string') {
      refs.push({
        line: lineNum,
        column: arg.column,
        path: unquoteString(arg.text),
        raw: arg.text,
        isDynamic: false,
      })
    } else {
      const raw = extractIncludeArgText(tokens, start)
      const ref: IncludeRef = {
        line: lineNum,
        column: arg.column,
        path: null,
        raw,
        isDynamic: true,
      }
      const loopBlock = getInnermostForLoopForLine(loopBlocks, lineNum)
      if (loopBlock) {
        const values = computeLoopValues(loopBlock.start, loopBlock.end)
        if (values.length > 0) {
          ref.loopContext = {
            variable: loopBlock.variable,
            start: loopBlock.start,
            end: loopBlock.end,
            values,
          }
        }
      }
      refs.push(ref)
    }
  }

  return refs
}

/** for ループブロック一覧（解析用） */
export function createForLoopBlockList(source: string): ForLoopBlock[] {
  return findForLoopBlocks(stripComments(source))
}

/** 指定行が静的 for ループ内なら反復コンテキストを返す */
export function getLoopContextForLine(blocks: ForLoopBlock[], line: number): IncludeLoopContext | undefined {
  const block = getInnermostForLoopForLine(blocks, line)
  if (!block) return undefined
  const values = computeLoopValues(block.start, block.end)
  if (values.length === 0) return undefined
  return { variable: block.variable, start: block.start, end: block.end, values }
}
