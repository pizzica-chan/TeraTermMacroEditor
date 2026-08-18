/** 静的解析で未確定値をどう見せるか（内部の hint 文字列は連結式のまま） */
export type UnresolvedValueDisplay = 'expression' | 'embedded'

const PLUS = ' + '

const UNRESOLVED_LABELS = new Set([
  'ユーザー入力',
  '受信マッチ',
  '実行時',
  '未確定',
  '仮定',
  '正規表現マッチ',
])

let currentDisplay: UnresolvedValueDisplay = 'expression'

export function isUnresolvedValueDisplay(value: unknown): value is UnresolvedValueDisplay {
  return value === 'expression' || value === 'embedded'
}

export function getUnresolvedValueDisplay(): UnresolvedValueDisplay {
  return currentDisplay
}

export function setUnresolvedValueDisplay(mode: UnresolvedValueDisplay): void {
  currentDisplay = mode
}

function isUnresolvedInner(inner: string): boolean {
  if (UNRESOLVED_LABELS.has(inner)) return true
  if (inner.endsWith('の出力')) return true
  if (inner.startsWith('未定義')) return true
  return false
}

function compactUnresolvedLabel(inner: string): string {
  return inner.replace(/\s*の\s*/g, 'の').trim()
}

type HintPart =
  | { kind: 'literal'; text: string }
  | { kind: 'unresolved'; text: string }

function parseQuoted(hint: string, start: number): { text: string; next: number } | undefined {
  if (hint[start] !== "'") return undefined
  const end = hint.indexOf("'", start + 1)
  if (end < 0) return undefined
  return { text: hint.slice(start + 1, end), next: end + 1 }
}

function parseWrapped(
  hint: string,
  start: number,
  open: string,
  close: string,
): { inner: string; next: number } | undefined {
  if (!hint.startsWith(open, start)) return undefined
  const end = hint.indexOf(close, start + open.length)
  if (end < 0) return undefined
  return { inner: hint.slice(start + open.length, end), next: end + close.length }
}

function parseInteger(hint: string, start: number): { text: string; next: number } | undefined {
  const rest = hint.slice(start)
  const m = /^-?\d+/.exec(rest)
  if (!m) return undefined
  const nextPlus = hint.indexOf(PLUS, start)
  const next = start + m[0].length
  if (nextPlus >= 0 && next > nextPlus) return undefined
  if (next < hint.length && hint.slice(next, next + PLUS.length) !== PLUS && next !== hint.length) {
    return undefined
  }
  return { text: m[0], next }
}

function parseExpressionHint(hint: string): HintPart[] | undefined {
  const parts: HintPart[] = []
  let i = 0
  let expectPlus = false

  while (i < hint.length) {
    if (expectPlus) {
      if (!hint.startsWith(PLUS, i)) return undefined
      i += PLUS.length
      expectPlus = false
      continue
    }

    const quoted = parseQuoted(hint, i)
    if (quoted) {
      parts.push({ kind: 'literal', text: quoted.text })
      i = quoted.next
      expectPlus = true
      continue
    }

    const paren = parseWrapped(hint, i, '（', '）')
    if (paren) {
      if (!isUnresolvedInner(paren.inner)) return undefined
      parts.push({ kind: 'unresolved', text: paren.inner })
      i = paren.next
      expectPlus = true
      continue
    }

    const angle = parseWrapped(hint, i, '〈', '〉')
    if (angle) {
      if (!isUnresolvedInner(angle.inner)) return undefined
      parts.push({ kind: 'unresolved', text: angle.inner })
      i = angle.next
      expectPlus = true
      continue
    }

    const integer = parseInteger(hint, i)
    if (integer) {
      parts.push({ kind: 'literal', text: integer.text })
      i = integer.next
      expectPlus = true
      continue
    }

    return undefined
  }

  if (parts.length === 0) return undefined
  return parts
}

function toEmbedded(parts: HintPart[]): string {
  return parts
    .map((part) =>
      part.kind === 'literal' ? part.text : `{${compactUnresolvedLabel(part.text)}}`,
    )
    .join('')
}

/** 連結式の hint / 送信ペイロードを、選択中の表示形式へ変換する */
export function formatUnresolvedDisplay(
  text: string,
  mode: UnresolvedValueDisplay = getUnresolvedValueDisplay(),
): string {
  if (mode === 'expression' || text === '') return text
  const parts = parseExpressionHint(text)
  if (!parts) return text
  if (parts.length === 1 && parts[0]!.kind === 'literal') return text
  return toEmbedded(parts)
}
