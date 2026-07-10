import type { Token } from './tokenize'
import { getCommandArgSpec } from './commandArgs'

export interface ArgDiagnostic {
  line: number
  column: number
  message: string
  severity: 'error' | 'warning' | 'info'
}

const CONDITIONAL_CMDS = new Set(['if', 'elseif', 'while', 'until'])

/**
 * 代入演算子の位置を返す。if/elseif/while/until の条件内の = は除外する。
 */
export function findAssignmentIndex(tokens: Token[], stmtOffset = 0): number {
  const cmd =
    tokens[stmtOffset]?.kind === 'identifier' ? tokens[stmtOffset].text.toLowerCase() : ''

  if (CONDITIONAL_CMDS.has(cmd)) {
    if (cmd === 'if' || cmd === 'elseif') {
      const thenIdx = tokens.findIndex(
        (t, i) => i > stmtOffset && t.kind === 'identifier' && t.text.toLowerCase() === 'then',
      )
      if (thenIdx < 0) return -1
      return tokens.findIndex(
        (t, i) => i > thenIdx && t.kind === 'operator' && (t.text === '=' || t.text === ':='),
      )
    }
    return -1
  }

  return tokens.findIndex(
    (t, i) => i > stmtOffset && t.kind === 'operator' && (t.text === '=' || t.text === ':='),
  )
}

/** 代入行かどうか */
export function isAssignmentLine(tokens: Token[]): boolean {
  let offset = 0
  if (tokens[0]?.kind === 'label') offset = 1
  const assignIdx = findAssignmentIndex(tokens, offset)
  if (assignIdx <= offset) return false
  if (tokens[assignIdx - 1]?.kind === 'identifier') return true
  return (
    assignIdx >= offset + 4 &&
    tokens[assignIdx - 1]?.text === ']' &&
    tokens[assignIdx - 4]?.kind === 'identifier'
  )
}

function countAtomicArgs(tokens: Token[]): number {
  let count = 0
  let i = 0
  while (i < tokens.length) {
    const tok = tokens[i]!
    if (tok.kind === 'string' || tok.kind === 'number' || tok.kind === 'label') {
      count++
      i++
    } else if (tok.kind === 'identifier') {
      if (tokens[i + 1]?.text === '[' && tokens[i + 3]?.text === ']') {
        count++
        i += 4
      } else {
        count++
        i++
      }
    } else {
      i++
    }
  }
  return count
}

/** コマンドの引数個数を数える */
export function countCommandArgs(cmd: string, tokens: Token[]): number {
  const rest = tokens.slice(1)
  if (rest.length === 0) return 0

  const lower = cmd.toLowerCase()

  if (lower === 'if') {
    const thenIdx = rest.findIndex((t) => t.kind === 'identifier' && t.text.toLowerCase() === 'then')
    const cond = thenIdx >= 0 ? rest.slice(0, thenIdx) : rest
    return cond.length > 0 ? 1 : 0
  }

  if (lower === 'while' || lower === 'until' || lower === 'elseif') {
    return rest.length > 0 ? 1 : 0
  }

  if (lower === 'for') {
    if (rest.length < 3) return rest.length
    return 3
  }

  return countAtomicArgs(rest)
}

function formatArgRange(spec: { min: number; max: number | null }): string {
  if (spec.max === null) {
    return spec.min === 0 ? '0個以上' : `${spec.min}個以上`
  }
  if (spec.min === spec.max) return `${spec.min}個`
  return `${spec.min}〜${spec.max}個`
}

export function checkCommandArgs(cmd: string, tokens: Token[], lineNum: number, column: number): ArgDiagnostic[] {
  const spec = getCommandArgSpec(cmd)
  if (!spec) return []

  const count = countCommandArgs(cmd, tokens)
  const diagnostics: ArgDiagnostic[] = []
  const range = formatArgRange(spec)

  if (count < spec.min) {
    diagnostics.push({
      line: lineNum,
      column,
      message: `'${cmd}' の引数が不足しています（${count}個 / 必要: ${range}）`,
      severity: 'error',
    })
  } else if (spec.max !== null && count > spec.max) {
    diagnostics.push({
      line: lineNum,
      column,
      message: `'${cmd}' の引数が多すぎます（${count}個 / 必要: ${range}）`,
      severity: 'error',
    })
  }

  return diagnostics
}
