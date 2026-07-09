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
