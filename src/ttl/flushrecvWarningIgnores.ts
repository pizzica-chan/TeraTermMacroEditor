import { stripComments } from './tokenize'
import { collectFlushrecvBeforeSendDiagnostics } from './flushrecvBeforeSend'

export { FLUSHRECV_BEFORE_SEND_DIAG_CODE } from './flushrecvBeforeSend'

/** 行番号（1-based）を無視リストのキーにする */
export function flushrecvWarningIgnoreKey(line: number): string {
  return String(line)
}

export function flushrecvWarningIgnoresFromRecord(
  record: Readonly<Record<string, boolean>> | undefined,
): Set<number> {
  const set = new Set<number>()
  if (!record) return set
  for (const [key, value] of Object.entries(record)) {
    if (!value) continue
    const line = Number(key)
    if (Number.isFinite(line) && line > 0) set.add(line)
  }
  return set
}

/** まだ警告対象の行だけ無視設定を残す */
export function pruneFlushrecvWarningIgnores(
  record: Record<string, boolean>,
  activeWarningLines: ReadonlySet<number>,
): Record<string, boolean> {
  const next: Record<string, boolean> = {}
  for (const [key, value] of Object.entries(record)) {
    if (!value) continue
    const line = Number(key)
    if (Number.isFinite(line) && line > 0 && activeWarningLines.has(line)) {
      next[key] = true
    }
  }
  return next
}

export function collectActiveFlushrecvWarningLines(source: string): Set<number> {
  const lines = stripComments(source)
  return new Set(collectFlushrecvBeforeSendDiagnostics(lines).map((d) => d.line))
}
