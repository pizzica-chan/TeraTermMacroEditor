import type { SendEntry } from './evaluator'

/** 静的に解決できた send / sendln のみを、実際の送信ストリームとして連結する */
export function buildResolvedSendPlainText(entries: SendEntry[]): string {
  let out = ''
  for (const entry of entries) {
    if (entry.unresolved) continue
    out += entry.payload
    if (entry.addsNewline) out += '\n'
  }
  return out
}

export function countResolvedSendEntries(entries: SendEntry[]): number {
  return entries.filter((e) => !e.unresolved).length
}
