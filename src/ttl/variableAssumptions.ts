import { stripComments, parseTtlIntegerLiteral } from './tokenize'
import { lineKeyword } from './controlFlow'
import { isSystemVariable } from './commands'
import {
  isIndeterminateRuntimeScalar,
  unresolvedSourceIdsOf,
  type MacroEnvironment,
  type RuntimeValue,
} from './evaluator'

export type AssumedValueType = 'integer' | 'string'

export interface IndeterminateVariable {
  line: number
  name: string
  valueType: AssumedValueType
  reason: string
}

/** 制御構造・include 行は afterLine がブロック全体の env になるため収集しない */
const SKIP_COLLECT_KEYWORDS = new Set([
  'if',
  'elseif',
  'else',
  'endif',
  'for',
  'next',
  'while',
  'endwhile',
  'do',
  'loop',
  'until',
  'enduntil',
  'include',
  'goto',
  'call',
  'return',
  'break',
  'continue',
  'end',
  'exit',
])

export function variableAssumptionKey(line: number, name: string): string {
  return `${line}:${name.toLowerCase()}`
}

export function parseVariableAssumptionKey(
  key: string,
): { line: number; name: string } | undefined {
  const m = /^(\d+):([A-Za-z_][A-Za-z0-9_]*)$/.exec(key)
  if (!m) return undefined
  const line = Number(m[1])
  if (!Number.isFinite(line) || line <= 0) return undefined
  return { line, name: m[2]!.toLowerCase() }
}

/** result / timeout / param 等は分岐仮定・起動引数で扱う */
/** サイドパネル入力が保存可能か（整数は TTL 整数として解釈できること） */
export function isValidVariableAssumptionInput(
  valueType: AssumedValueType,
  text: string,
): boolean {
  if (valueType === 'integer') {
    return parseTtlIntegerLiteral(text.trim()) !== undefined
  }
  return true
}

export function isAssumableVariableName(name: string): boolean {
  const key = name.toLowerCase()
  if (key === 'inputstr' || key === 'matchstr') return true
  if (/^groupmatchstr\d+$/.test(key)) return true
  if (isSystemVariable(key)) return false
  return true
}

export function describeIndeterminateReason(value: RuntimeValue): string {
  if (value.kind !== 'int' && value.kind !== 'str') return '（未確定）'
  if (value.hint) return value.hint
  if (value.origin === 'user-input') return '（ユーザー入力）'
  if (value.origin === 'match-received') return '（受信マッチ）'
  if (value.origin === 'dialog-result') return '（実行時）'
  return '（未確定）'
}

function scalarType(value: RuntimeValue): AssumedValueType | undefined {
  if (value.kind === 'int') return 'integer'
  if (value.kind === 'str') return 'string'
  return undefined
}

function envUnresolvedSourceIds(env: MacroEnvironment | undefined): Set<number> {
  const ids = new Set<number>()
  if (!env) return ids
  for (const value of env.values()) {
    for (const id of unresolvedSourceIdsOf(value)) ids.add(id)
  }
  return ids
}

function introducesNewUnresolvedSource(
  before: MacroEnvironment | undefined,
  value: RuntimeValue,
): boolean {
  const afterIds = unresolvedSourceIdsOf(value)
  if (afterIds.length === 0) return true
  const beforeIds = envUnresolvedSourceIds(before)
  return afterIds.some((id) => !beforeIds.has(id))
}

/** 静的に値が決まらない代入先のうち、原因となる変数だけを列挙する */
export function collectIndeterminateVariables(
  source: string,
  beforeLine: ReadonlyMap<number, MacroEnvironment>,
  afterLine: ReadonlyMap<number, MacroEnvironment>,
): IndeterminateVariable[] {
  const lines = stripComments(source)
  const items: IndeterminateVariable[] = []
  const seen = new Set<string>()

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const kw = lineKeyword(lines[lineIdx]!, lineIdx)
    if (kw && SKIP_COLLECT_KEYWORDS.has(kw)) continue

    const lineNum = lineIdx + 1
    const before = beforeLine.get(lineNum)
    const after = afterLine.get(lineNum)
    if (!after) continue

    for (const [name, value] of after) {
      if (!isAssumableVariableName(name)) continue
      if (!isIndeterminateRuntimeScalar(value)) continue
      const valueType = scalarType(value)
      if (!valueType) continue
      const prev = before?.get(name)
      if (prev === value) continue
      if (!introducesNewUnresolvedSource(before, value)) continue

      const key = variableAssumptionKey(lineNum, name)
      if (seen.has(key)) continue
      seen.add(key)
      items.push({
        line: lineNum,
        name,
        valueType,
        reason: describeIndeterminateReason(value),
      })
    }
  }

  return items
}

export function variableAssumptionsFromRecord(
  record: Readonly<Record<string, string>> | undefined,
): Map<number, Map<string, string>> {
  const byLine = new Map<number, Map<string, string>>()
  if (!record) return byLine
  for (const [key, text] of Object.entries(record)) {
    if (typeof text !== 'string') continue
    const parsed = parseVariableAssumptionKey(key)
    if (!parsed) continue
    let names = byLine.get(parsed.line)
    if (!names) {
      names = new Map()
      byLine.set(parsed.line, names)
    }
    names.set(parsed.name, text)
  }
  return byLine
}

export function hasVariableAssumptions(
  map: ReadonlyMap<number, ReadonlyMap<string, string>>,
): boolean {
  for (const names of map.values()) {
    if (names.size > 0) return true
  }
  return false
}

export function pruneVariableAssumptions(
  record: Record<string, string>,
  validKeys: ReadonlySet<string>,
  valueTypes?: ReadonlyMap<string, AssumedValueType>,
): Record<string, string> {
  const next: Record<string, string> = {}
  for (const [key, value] of Object.entries(record)) {
    if (!validKeys.has(key) || typeof value !== 'string') continue
    const valueType = valueTypes?.get(key)
    if (valueType !== undefined && !isValidVariableAssumptionInput(valueType, value)) continue
    next[key] = value
  }
  return next
}
