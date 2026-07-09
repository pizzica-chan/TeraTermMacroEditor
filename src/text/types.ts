export type TextEncoding = 'UTF-8' | 'SJIS'
export type NewlineType = 'LF' | 'CRLF' | 'CR'

export const ENCODING_LABELS: Record<TextEncoding, string> = {
  'UTF-8': 'UTF-8',
  SJIS: 'Shift_JIS',
}

export const NEWLINE_LABELS: Record<NewlineType, string> = {
  LF: 'LF (Unix)',
  CRLF: 'CRLF (Windows)',
  CR: 'CR (Mac)',
}
