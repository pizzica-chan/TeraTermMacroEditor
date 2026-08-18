import { stripComments } from './tokenize'
import { collectConsecutiveSendDiagnostics } from './consecutiveSend'

export { CONSECUTIVE_SEND_DIAG_CODE } from './consecutiveSend'

export function consecutiveSendWarningIgnoreKey(line: number): string {
  return String(line)
}

export function consecutiveSendWarningIgnoresFromRecord(
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

export function pruneConsecutiveSendWarningIgnores(
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

export function collectActiveConsecutiveSendWarningLines(source: string): Set<number> {
  const lines = stripComments(source)
  return new Set(collectConsecutiveSendDiagnostics(lines).map((d) => d.line))
}
