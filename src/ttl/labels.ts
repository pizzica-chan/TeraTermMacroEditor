import { stripComments, tokenizeLine, type Token } from './tokenize'

/** ラベル名を正規化（先頭の ':' を除去し小文字化） */
export function normalizeLabelName(name: string): string {
  return name.replace(/^:/, '').toLowerCase()
}

/** 診断メッセージ用にラベル表示名を整形 */
export function formatLabelRef(name: string): string {
  const bare = name.replace(/^:/, '')
  return `:${bare}`
}

/** ソース内のラベル定義名を収集（行頭の :label のみ） */
export function collectLabelNames(source: string | string[]): Set<string> {
  const lines = Array.isArray(source) ? source : stripComments(source)
  const labels = new Set<string>()
  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const tokens = tokenizeLine(lines[lineIdx]!, lineIdx + 1)
    if (tokens[0]?.kind === 'label') {
      labels.add(tokens[0].text.toLowerCase())
    }
  }
  return labels
}

/** ソース内のラベル定義と行番号 */
export function collectLabelLineMap(source: string | string[]): Map<string, number> {
  const lines = Array.isArray(source) ? source : stripComments(source)
  const labels = new Map<string, number>()
  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const tokens = tokenizeLine(lines[lineIdx]!, lineIdx + 1)
    if (tokens[0]?.kind === 'label') {
      labels.set(tokens[0].text.toLowerCase(), lineIdx + 1)
    }
  }
  return labels
}

/** goto / call のジャンプ先トークンを返す（1-based トークン配列の cmd 直後） */
export function getGotoCallTargetToken(tokens: Token[], cmdIndex: number): Token | undefined {
  return tokens[cmdIndex + 1]
}

/** トークンからラベル参照名を抽出。ラベルでなければ null */
export function labelNameFromToken(tok: Token | undefined): string | null {
  if (!tok) return null
  if (tok.kind === 'label') return tok.text
  if (tok.kind === 'identifier' && tok.text.startsWith(':')) {
    return tok.text.slice(1)
  }
  if (tok.kind === 'identifier' && !tok.text.includes('[')) {
    return tok.text
  }
  return null
}

export function isGotoCallLabelRef(tokens: Token[], index: number): boolean {
  if (index <= 0) return false
  const prev = tokens[index - 1]
  return (
    prev?.kind === 'identifier' &&
    (prev.text.toLowerCase() === 'goto' || prev.text.toLowerCase() === 'call')
  )
}
