import type { SendEntry } from './evaluator'

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
