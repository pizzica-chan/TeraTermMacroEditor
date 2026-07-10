import { stripComments, tokenizeLine, unquoteString, type Token } from './tokenize'

export const MAX_INCLUDE_LOOP_ITERATIONS = 256

export interface IncludeLoopContext {
  variable: string
  start: number
  end: number
  values: number[]
  /** 反復ごとの実効 include 引数（hoge=koge[i] などから静的に解決） */
  effectiveRawsByValue?: Record<number, string>
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
  line?: number
  loopValue?: number
  /** include 文の元引数テキスト（hoge など） */
  rawArg?: string
  /** 実行時/静的解析で解決した実効引数（ファイル名など） */
  effectiveRaw?: string
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
  effectiveRaw?: string,
): string | null {
  const direct = bindings[bindingKey]
  if (direct) return direct

  const loopIterMatch = bindingKey.match(/^@loop:L(\d+):(-?\d+)$/)
  if (loopIterMatch) {
    const line = Number(loopIterMatch[1])
    const lineKey = includeLoopLineBindingKey(line)
    if (bindings[lineKey]) return bindings[lineKey]
  }

  if (effectiveRaw) {
    const pathKey = resolveIncludePathBindingKey(effectiveRaw)
    if (pathKey && bindings[pathKey]) return bindings[pathKey]
    const effDynamic = includeDynamicBindingKey(effectiveRaw)
    if (bindings[effDynamic]) return bindings[effDynamic]
  }

  if (rawArg) {
    const dynamicKey = includeDynamicBindingKey(rawArg)
    if (bindings[dynamicKey]) return bindings[dynamicKey]
  }

  return null
}

/** 実効 include 引数からタブ紐づけキーを得る（文字列リテラル・ファイル名） */
export function resolveIncludePathBindingKey(effectiveRaw: string): string | null {
  const trimmed = effectiveRaw.trim()
  if (!trimmed) return null
  if (
    (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    return normalizeIncludePath(unquoteString(trimmed))
  }
  if (/^[\w./\\-]+$/i.test(trimmed)) {
    return normalizeIncludePath(trimmed)
  }
  return null
}

export function getLoopIncludeIterationBindingKey(
  ref: IncludeRef,
  loopValue: number,
): string {
  const effectiveRaw = ref.loopContext?.effectiveRawsByValue?.[loopValue]
  const pathKey = effectiveRaw ? resolveIncludePathBindingKey(effectiveRaw) : null
  return pathKey ?? includeLoopIterationBindingKey(ref.line, loopValue)
}

export function resolveLoopIncludeBindingKey(
  line: number,
  loopValue: number,
  effectiveRaw?: string,
): string {
  const pathKey = effectiveRaw ? resolveIncludePathBindingKey(effectiveRaw) : null
  return pathKey ?? includeLoopIterationBindingKey(line, loopValue)
}

export function isIncludeRefLinked(ref: IncludeRef, bindings: Record<string, string>): boolean {
  if (ref.loopContext) {
    if (bindings[includeLoopLineBindingKey(ref.line)]) return true
    if (bindings[includeDynamicBindingKey(ref.raw)]) return true
    return ref.loopContext.values.every((v) => {
      const iterKey = getLoopIncludeIterationBindingKey(ref, v)
      const effectiveRaw = ref.loopContext!.effectiveRawsByValue?.[v]
      return !!resolveIncludeBindingTabId(bindings, iterKey, ref.raw, effectiveRaw)
    })
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
  if (!Number.isFinite(start) || !Number.isFinite(end)) return []
  const estimated = Math.abs(end - start) + 1
  if (estimated > MAX_INCLUDE_LOOP_ITERATIONS) return []

  const values: number[] = []
  const step = start <= end ? 1 : -1
  for (let v = start; step > 0 ? v <= end : v >= end; v += step) {
    values.push(v)
  }
  return values
}

/** for 行より前に確定している整数定数のみ収集（後方参照は使わない） */
function collectStaticIntConstants(lines: string[], beforeLineIdx?: number): Map<string, number> {
  const endLine = beforeLineIdx ?? lines.length
  const constants = new Map<string, number>()
  let changed = true

  while (changed) {
    changed = false
    for (let i = 0; i < endLine; i++) {
      const tokens = tokenizeLine(lines[i]!, i + 1)
      let offset = 0
      if (tokens[0]?.kind === 'label') offset = 1
      const assignIdx = tokens.findIndex(
        (t, j) => j > offset && t.kind === 'operator' && (t.text === '=' || t.text === ':='),
      )
      if (assignIdx <= offset) continue
      const lhs = tokens[assignIdx - 1]
      const rhs = tokens[assignIdx + 1]
      if (lhs?.kind !== 'identifier') continue

      let value: number | undefined
      if (rhs?.kind === 'number') {
        value = Number(rhs.text)
      } else if (rhs?.kind === 'identifier') {
        value = constants.get(rhs.text.toLowerCase())
      }
      if (value === undefined || !Number.isFinite(value)) continue

      const key = lhs.text.toLowerCase()
      if (constants.get(key) !== value) {
        constants.set(key, value)
        changed = true
      }
    }
  }

  return constants
}

function collectStaticStringArrayValues(lines: string[], beforeLineIdx?: number): Map<string, Map<number, string>> {
  const endLine = beforeLineIdx ?? lines.length
  const arrays = new Map<string, Map<number, string>>()

  for (let i = 0; i < endLine; i++) {
    const tokens = tokenizeLine(lines[i]!, i + 1)
    const assignIdx = tokens.findIndex(
      (t, j) => j > 0 && t.kind === 'operator' && (t.text === '=' || t.text === ':='),
    )
    if (assignIdx < 4) continue

    const close = tokens[assignIdx - 1]
    const indexTok = tokens[assignIdx - 2]
    const open = tokens[assignIdx - 3]
    const name = tokens[assignIdx - 4]
    const valueTok = tokens[assignIdx + 1]
    if (
      name?.kind !== 'identifier' ||
      open?.text !== '[' ||
      close?.text !== ']' ||
      indexTok?.kind !== 'number' ||
      valueTok?.kind !== 'string'
    ) {
      continue
    }

    const arrayKey = name.text.toLowerCase()
    const index = Number(indexTok.text)
    if (!Number.isFinite(index)) continue

    let bucket = arrays.get(arrayKey)
    if (!bucket) {
      bucket = new Map()
      arrays.set(arrayKey, bucket)
    }
    bucket.set(index, unquoteString(valueTok.text))
  }

  return arrays
}

function parseLoopArrayAliasAssign(
  tokens: Token[],
  assignIdx: number,
  includeArgLower: string,
  loopVarLower: string,
): string | null {
  const lhs = tokens[assignIdx - 1]
  if (lhs?.kind !== 'identifier' || lhs.text.toLowerCase() !== includeArgLower) return null

  const rhsStart = assignIdx + 1
  const arrayName = tokens[rhsStart]
  const open = tokens[rhsStart + 1]
  const indexTok = tokens[rhsStart + 2]
  const close = tokens[rhsStart + 3]
  if (
    arrayName?.kind !== 'identifier' ||
    open?.text !== '[' ||
    indexTok?.kind !== 'identifier' ||
    close?.text !== ']'
  ) {
    return null
  }
  if (indexTok.text.toLowerCase() !== loopVarLower) return null
  return arrayName.text.toLowerCase()
}

function findLoopIncludeAliasArray(
  lines: string[],
  includeLine: number,
  loopBlock: ForLoopBlock,
  includeArg: string,
): string | null {
  const includeArgLower = includeArg.toLowerCase()
  const loopVarLower = loopBlock.variable.toLowerCase()

  for (let lineNum = loopBlock.bodyStartLine; lineNum < includeLine; lineNum++) {
    const tokens = tokenizeLine(lines[lineNum - 1]!, lineNum)
    let offset = 0
    if (tokens[0]?.kind === 'label') offset = 1
    const assignIdx = tokens.findIndex(
      (t, j) => j > offset && t.kind === 'operator' && (t.text === '=' || t.text === ':='),
    )
    if (assignIdx <= offset) continue

    const arrayName = parseLoopArrayAliasAssign(tokens, assignIdx, includeArgLower, loopVarLower)
    if (arrayName) return arrayName
  }

  return null
}

/** ループ内 include の反復ごと実効引数（hoge=koge[i] から koge[v] を解決） */
export function computeLoopIncludeEffectiveRaw(
  lines: string[],
  includeLine: number,
  loopBlock: ForLoopBlock,
  includeArg: string,
  loopValue: number,
  arrayConstants?: Map<string, Map<number, string>>,
): string | undefined {
  const arrayName = findLoopIncludeAliasArray(lines, includeLine, loopBlock, includeArg)
  if (!arrayName) return undefined
  const constants = arrayConstants ?? collectStaticStringArrayValues(lines, includeLine - 1)
  return constants.get(arrayName)?.get(loopValue)
}

function buildLoopEffectiveRaws(
  lines: string[],
  includeLine: number,
  loopBlock: ForLoopBlock,
  includeArg: string,
  values: number[],
): Record<number, string> | undefined {
  const arrayConstants = collectStaticStringArrayValues(lines, includeLine - 1)
  const effectiveRawsByValue: Record<number, string> = {}
  for (const v of values) {
    const effectiveRaw = computeLoopIncludeEffectiveRaw(
      lines,
      includeLine,
      loopBlock,
      includeArg,
      v,
      arrayConstants,
    )
    if (effectiveRaw !== undefined) effectiveRawsByValue[v] = effectiveRaw
  }
  return Object.keys(effectiveRawsByValue).length > 0 ? effectiveRawsByValue : undefined
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
  const blocks: ForLoopBlock[] = []

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const tokens = tokenizeLine(lines[lineIdx]!, lineIdx + 1)
    let start = 0
    if (tokens[0]?.kind === 'label') start = 1
    if (tokens[start]?.kind !== 'identifier' || tokens[start]!.text.toLowerCase() !== 'for') continue
    if (tokens[start + 1]?.kind !== 'identifier') continue

    const variable = tokens[start + 1]!.text
    const constants = collectStaticIntConstants(lines, lineIdx)
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
      /** 1-indexed: ループ本体の最終行（next の直前行） */
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
            effectiveRawsByValue: buildLoopEffectiveRaws(lines, lineNum, loopBlock, raw, values),
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

/** 指定行が属する最も内側の for ループブロック */
export function getForLoopBlockForLine(blocks: ForLoopBlock[], line: number): ForLoopBlock | undefined {
  return getInnermostForLoopForLine(blocks, line) ?? undefined
}

/** 指定行が静的 for ループ内なら反復コンテキストを返す */
export function getLoopContextForLine(blocks: ForLoopBlock[], line: number): IncludeLoopContext | undefined {
  const block = getInnermostForLoopForLine(blocks, line)
  if (!block) return undefined
  const values = computeLoopValues(block.start, block.end)
  if (values.length === 0) return undefined
  return { variable: block.variable, start: block.start, end: block.end, values }
}
