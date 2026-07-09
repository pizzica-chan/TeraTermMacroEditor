import type { NewlineType } from './types'

export function detectNewline(text: string): NewlineType {
  let crlf = 0
  let lf = 0
  let cr = 0

  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\r') {
      if (text[i + 1] === '\n') {
        crlf++
        i++
      } else {
        cr++
      }
    } else if (text[i] === '\n') {
      lf++
    }
  }

  if (crlf >= lf && crlf >= cr && crlf > 0) return 'CRLF'
  if (cr > lf && cr > 0) return 'CR'
  return 'LF'
}

/** エディタ内部表現（LF）に正規化 */
export function normalizeNewlines(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

/** 指定改行コードに変換 */
export function applyNewline(text: string, newline: NewlineType): string {
  const normalized = normalizeNewlines(text)
  if (newline === 'CRLF') return normalized.replace(/\n/g, '\r\n')
  if (newline === 'CR') return normalized.replace(/\n/g, '\r')
  return normalized
}

export function convertNewlineInEditor(text: string, _from: NewlineType, to: NewlineType): string {
  return normalizeNewlines(applyNewline(normalizeNewlines(text), to))
}
