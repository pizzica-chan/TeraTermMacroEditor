import { stripComments, tokenizeLine, unquoteString } from './tokenize'

export interface IncludeRef {
  line: number
  column: number
  /** 文字列リテラルから得たパス（動的 include は null） */
  path: string | null
  raw: string
  isDynamic: boolean
}

export function normalizeIncludePath(path: string): string {
  return path.replace(/\\/g, '/').toLowerCase()
}

const INCLUDE_LINE_BINDING_PREFIX = '@line:'
const INCLUDE_DYNAMIC_BINDING_PREFIX = '@dynamic:'

/** 変数指定 include のタブ紐づけキー（引数テキストベース・行の増減に追従） */
export function includeDynamicBindingKey(rawArg: string): string {
  return `${INCLUDE_DYNAMIC_BINDING_PREFIX}${rawArg.trim().toLowerCase()}`
}

/** @deprecated 旧形式（行番号キー）。migrateIncludeBindings で移行する */
export function isIncludeLineBindingKey(key: string): boolean {
  return key.startsWith(INCLUDE_LINE_BINDING_PREFIX)
}

function parseIncludeLineBindingKey(key: string): number | null {
  if (!isIncludeLineBindingKey(key)) return null
  const n = Number(key.slice(INCLUDE_LINE_BINDING_PREFIX.length))
  return Number.isFinite(n) && n > 0 ? n : null
}

/** include 文に対応するタブ紐づけキー */
export function getIncludeBindingKey(ref: IncludeRef): string | null {
  if (ref.path) return normalizeIncludePath(ref.path)
  if (ref.isDynamic && ref.raw) return includeDynamicBindingKey(ref.raw)
  return null
}

/**
 * 旧 @line:N 形式の紐づけを @dynamic:arg に移行する。
 * 行がずれても同じ引数の include にリンクが維持される。
 */
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
      refs.push({
        line: lineNum,
        column: arg.column,
        path: null,
        raw: arg.text,
        isDynamic: true,
      })
    }
  }

  return refs
}
