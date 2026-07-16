import { unquoteString, type Token } from './tokenize'

/** 隣接トークン間に空白などの区切りがあるか */
export function tokenGapBefore(tokens: Token[], i: number): boolean {
  const prev = tokens[i - 1]
  const cur = tokens[i]
  if (!prev || !cur) return false
  return cur.column > prev.column + prev.text.length
}

/** 1 引数分に連結されるオペランド（文字列・#NN・識別子等）を 1 つ消費 */
export function consumeOperand(tokens: Token[], i: number): number | null {
  const tok = tokens[i]
  if (!tok) return null

  if (tok.text === '#' && tokens[i + 1]?.kind === 'number') {
    return i + 2
  }

  if (tok.kind === 'string' || tok.kind === 'number') {
    return i + 1
  }

  if (tok.kind === 'identifier') {
    if (tokens[i + 1]?.text === '[' && tokens[i + 2] && tokens[i + 3]?.text === ']') {
      return i + 4
    }
    return i + 1
  }

  return null
}

/** start 以降に隣接連結オペランドが続くか（'a'#13 など） */
export function hasAdjacentOperandsAfter(tokens: Token[], start: number): boolean {
  const next = consumeOperand(tokens, start)
  if (next === null || next >= tokens.length) return false
  return !tokenGapBefore(tokens, next)
}

/**
 * 代入右辺などを連結文字列式として解釈すべきか。
 * 整数式（B+1 等）と区別するため、先頭または直後が文字列 / #NN のときだけ true。
 */
export function isGroupedStringExprStart(tokens: Token[], start: number): boolean {
  const tok = tokens[start]
  if (!tok) return false
  if (tok.kind === 'string') return true
  if (tok.text === '#' && tokens[start + 1]?.kind === 'number') return true

  const next = consumeOperand(tokens, start)
  if (next === null || next >= tokens.length || tokenGapBefore(tokens, next)) {
    return false
  }

  const nextTok = tokens[next]
  if (nextTok?.kind === 'string') return true
  if (nextTok?.text === '#' && tokens[next + 1]?.kind === 'number') return true
  return false
}

/** 空白区切りの論理引数個数（'a'#13'b' は 1 個） */
export function countGroupedArgs(tokens: Token[], start = 0): number {
  let count = 0
  let i = start

  while (i < tokens.length) {
    let consumed = false
    while (i < tokens.length) {
      if (consumed && tokenGapBefore(tokens, i)) break
      const next = consumeOperand(tokens, i)
      if (next === null) break
      consumed = true
      i = next
    }
    if (!consumed) break
    count++
  }

  return count
}

/** 静的に解決できる連結文字列式（代入右辺・strconcat 等） */
export function resolveStaticGroupedString(
  tokens: Token[],
  start: number,
  resolvePart: (token: Token, index: number) => string | undefined,
): string | undefined {
  const parts: string[] = []
  let i = start
  let consumed = false

  while (i < tokens.length) {
    if (consumed && tokenGapBefore(tokens, i)) break
    const next = consumeOperand(tokens, i)
    if (next === null) break
    const part = resolvePart(tokens[i]!, i)
    if (part === undefined) return undefined
    parts.push(part)
    consumed = true
    i = next
  }

  if (!consumed) return undefined
  return parts.join('')
}

export function resolveStaticControlPart(tokens: Token[], index: number): string | undefined {
  const tok = tokens[index]
  if (tok?.text === '#' && tokens[index + 1]?.kind === 'number') {
    return String.fromCharCode(Number(tokens[index + 1]!.text))
  }
  return undefined
}

export function resolveStaticLiteralPart(token: Token | undefined): string | undefined {
  if (!token) return undefined
  if (token.kind === 'string') return unquoteString(token.text)
  if (token.kind === 'number') return token.text
  return undefined
}
