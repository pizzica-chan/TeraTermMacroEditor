import { stripComments, tokenizeLine } from './tokenize'
import { lineKeyword } from './controlFlow'
import { evalIfConditionStatic, initMacroEnvironment } from './evaluator'
import type { MacroEnvironment } from './evaluator'
import { findSingleLineIfTailStart } from './subroutine'

export interface IndeterminateIfBranch {
  line: number
  command: 'if' | 'elseif'
  conditionText: string
}

export function extractIfConditionText(line: string, lineIdx: number, cmd: string): string {
  const tokens = tokenizeLine(line, lineIdx + 1)
  let off = tokens[0]?.kind === 'label' ? 1 : 0
  let condEnd = tokens.length
  if (cmd === 'if' || cmd === 'elseif') {
    const thenIdx = tokens.findIndex(
      (t, i) => i > off && t.kind === 'identifier' && t.text.toLowerCase() === 'then',
    )
    if (thenIdx >= 0) {
      condEnd = thenIdx
    } else if (cmd === 'if') {
      const tailStart = findSingleLineIfTailStart(tokens, off)
      if (tailStart !== null) condEnd = tailStart
    }
  }
  return tokens
    .slice(off + 1, condEnd)
    .map((t) => t.text)
    .join(' ')
    .trim()
}

/** 静的に真偽が決まらない if / elseif を列挙する（各行直前の env を使用） */
export function collectIndeterminateIfBranches(
  source: string,
  beforeLine: ReadonlyMap<number, MacroEnvironment>,
): IndeterminateIfBranch[] {
  const lines = stripComments(source)
  const branches: IndeterminateIfBranch[] = []
  const defaultEnv = initMacroEnvironment()

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const kw = lineKeyword(lines[lineIdx]!, lineIdx)
    if (kw !== 'if' && kw !== 'elseif') continue

    const lineNum = lineIdx + 1
    const env = beforeLine.get(lineNum) ?? defaultEnv
    const staticResult = evalIfConditionStatic(lines[lineIdx]!, lineIdx, env, kw)
    if (staticResult !== undefined) continue

    branches.push({
      line: lineNum,
      command: kw,
      conditionText: extractIfConditionText(lines[lineIdx]!, lineIdx, kw) || '（条件）',
    })
  }

  return branches
}

export function branchAssumptionsFromRecord(
  record: Readonly<Record<string, boolean>> | undefined,
): Map<number, boolean> {
  const map = new Map<number, boolean>()
  if (!record) return map
  for (const [key, value] of Object.entries(record)) {
    const line = Number(key)
    if (Number.isFinite(line) && line > 0) map.set(line, value)
  }
  return map
}

export function pruneBranchAssumptions(
  record: Record<string, boolean>,
  validLines: ReadonlySet<number>,
): Record<string, boolean> {
  const next: Record<string, boolean> = {}
  for (const [key, value] of Object.entries(record)) {
    const line = Number(key)
    if (validLines.has(line)) next[key] = value
  }
  return next
}
