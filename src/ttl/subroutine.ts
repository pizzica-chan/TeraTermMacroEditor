import type { Token } from './tokenize'
import { tokenizeLine, stripComments } from './tokenize'
import { labelNameFromToken, normalizeLabelName } from './labels'
import { TTL_COMMANDS } from './commands'

/** Tera Term Appendix A: Too many labels */
export const MAX_LABEL_COUNT = 256

/** ネスト call の安全上限 */
export const MAX_CALL_DEPTH = 64

export function findLabelLineIndex(lines: string[], labelName: string): number {
  const key = normalizeLabelName(labelName)
  for (let i = 0; i < lines.length; i++) {
    const tokens = tokenizeLine(lines[i]!, i + 1)
    if (tokens[0]?.kind === 'label' && tokens[0].text.toLowerCase() === key) {
      return i
    }
  }
  return -1
}

export function hasThenKeyword(tokens: Token[], offset: number): boolean {
  return tokens.some(
    (t, i) => i > offset && t.kind === 'identifier' && t.text.toLowerCase() === 'then',
  )
}

/** 1行形式 if（then なしで直後にコマンド）のコマンド開始位置 */
export function findSingleLineIfTailStart(tokens: Token[], offset: number): number | null {
  if (hasThenKeyword(tokens, offset)) return null
  for (let i = offset + 1; i < tokens.length; i++) {
    const tok = tokens[i]
    if (tok?.kind === 'identifier' && TTL_COMMANDS.has(tok.text.toLowerCase())) {
      return i
    }
  }
  return null
}

/** 1行形式 if cond then cmd の条件終端とコマンド開始位置 */
export function findIfThenTailStart(
  tokens: Token[],
  offset: number,
): { condEnd: number; tailStart: number } | null {
  const thenIdx = tokens.findIndex(
    (t, i) => i > offset && t.kind === 'identifier' && t.text.toLowerCase() === 'then',
  )
  if (thenIdx < 0) return null
  for (let i = thenIdx + 1; i < tokens.length; i++) {
    const tok = tokens[i]
    if (tok?.kind === 'identifier' && TTL_COMMANDS.has(tok.text.toLowerCase())) {
      return { condEnd: thenIdx, tailStart: i }
    }
  }
  return null
}

/** goto/call のジャンプ先ラベル名を解決（定数文字列変数のみ動的対応） */
export function resolveJumpLabelName(
  token: Token | undefined,
  resolveString?: (name: string) => string | undefined,
): string | null {
  const direct = labelNameFromToken(token)
  if (!direct || !token) return direct
  if (token.kind === 'identifier' && !token.text.startsWith(':') && resolveString) {
    const fromVar = resolveString(token.text.toLowerCase())
    if (fromVar) return fromVar
  }
  return direct
}

export function sourceContainsCall(source: string | string[]): boolean {
  const lines = Array.isArray(source) ? source : stripComments(source)
  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const tokens = tokenizeLine(lines[lineIdx]!, lineIdx + 1)
    let offset = 0
    if (tokens[0]?.kind === 'label') offset = 1
    const cmd = tokens[offset]
    if (cmd?.kind === 'identifier' && cmd.text.toLowerCase() === 'call') return true
  }
  return false
}
