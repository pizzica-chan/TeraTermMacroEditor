import type { SendEntry } from './evaluator'

const CONTROL_CHAR_NAMES: Readonly<Record<number, string>> = {
  0: 'NUL',
  7: 'BEL',
  8: 'BS',
  9: 'TAB',
  10: 'LF',
  11: 'VT',
  12: 'FF',
  13: 'CR',
  27: 'ESC',
  127: 'DEL',
}

/** ASCII 制御文字（Tera Term の #NN 相当）か */
export function isAsciiControlCharCode(code: number): boolean {
  return (code >= 0 && code <= 31) || code === 127
}

/** 送信ペイロード内の制御文字を Tera Term 風 #NN 表記へ */
export function formatSendPayloadForDisplay(text: string): string {
  let out = ''
  for (const ch of text) {
    const code = ch.charCodeAt(0)
    if (isAsciiControlCharCode(code)) {
      out += `#${code}`
    } else {
      out += ch
    }
  }
  return out
}

function escapeHtmlChar(ch: string): string {
  switch (ch) {
    case '&':
      return '&amp;'
    case '<':
      return '&lt;'
    case '>':
      return '&gt;'
    case '"':
      return '&quot;'
    default:
      return ch
  }
}

/** 送信ペイロードの HTML 表示（制御文字は #NN バッジ） */
export function renderSendPayloadHtml(payload: string): string {
  let out = ''
  for (const ch of payload) {
    const code = ch.charCodeAt(0)
    if (isAsciiControlCharCode(code)) {
      const name = CONTROL_CHAR_NAMES[code]
      const title = name ? `制御文字 #${code} (${name})` : `制御文字 #${code}`
      out += `<span class="send-ctrl" title="${escapeHtmlChar(title)}">#${code}</span>`
    } else {
      out += escapeHtmlChar(ch)
    }
  }
  return out
}

/** send / sendln を送信ストリームとして連結（未解決部分はプレースホルダー付き） */
export function buildSendPlainTextForCopy(entries: SendEntry[]): string {
  let out = ''
  for (const entry of entries) {
    out += entry.payload
    if (entry.addsNewline) out += '\n'
  }
  return out
}

export function countResolvedSendEntries(entries: SendEntry[]): number {
  return entries.filter((e) => !e.unresolved).length
}

export function countUnresolvedSendEntries(entries: SendEntry[]): number {
  return entries.filter((e) => e.unresolved).length
}
