import {
  CONTROL_KEYWORDS,
  TTL_COMMANDS,
  LOGICAL_OPERATORS,
} from './commands'

export interface Token {
  text: string
  line: number
  column: number
  kind: 'identifier' | 'string' | 'number' | 'operator' | 'comment' | 'label' | 'other'
}

export const RESERVED = new Set([
  ...CONTROL_KEYWORDS,
  ...TTL_COMMANDS,
  ...LOGICAL_OPERATORS,
  'then',
])

export function tokenizeLine(line: string, lineNum: number): Token[] {
  const tokens: Token[] = []
  let i = 0

  while (i < line.length) {
    const col = i

    if (/\s/.test(line[i]!)) {
      i++
      continue
    }

    if (line[i] === ';') break

    if (line.slice(i, i + 2) === '/*') {
      const end = line.indexOf('*/', i + 2)
      i = end === -1 ? line.length : end + 2
      continue
    }

    if (line[i] === ':' && (i === 0 || /\s/.test(line[i - 1]!))) {
      const m = line.slice(i + 1).match(/^[\w]+/)
      if (m) {
        tokens.push({ text: m[0], line: lineNum, column: col, kind: 'label' })
        i += 1 + m[0].length
        continue
      }
    }

    if (line[i] === "'" || line[i] === '"') {
      const quote = line[i]!
      let j = i + 1
      while (j < line.length && line[j] !== quote) j++
      const text = line.slice(i, j < line.length ? j + 1 : line.length)
      tokens.push({ text, line: lineNum, column: col, kind: 'string' })
      i = j < line.length ? j + 1 : line.length
      continue
    }

    const numMatch = line.slice(i).match(/^-?\d+(\.\d+)?/)
    if (numMatch) {
      tokens.push({ text: numMatch[0], line: lineNum, column: col, kind: 'number' })
      i += numMatch[0].length
      continue
    }

    const idMatch = line.slice(i).match(/^[a-zA-Z_][\w]*/)
    if (idMatch) {
      tokens.push({ text: idMatch[0], line: lineNum, column: col, kind: 'identifier' })
      i += idMatch[0].length
      continue
    }

    const opMatch = line.slice(i).match(/^(<>|>=|<=|:=|[=<>+\-*/%#])/)
    if (opMatch) {
      tokens.push({ text: opMatch[0], line: lineNum, column: col, kind: 'operator' })
      i += opMatch[0].length
      continue
    }

    tokens.push({ text: line[i]!, line: lineNum, column: col, kind: 'other' })
    i++
  }

  return tokens
}

export function stripComments(source: string): string[] {
  const lines: string[] = []
  let inBlock = false

  for (const rawLine of source.split('\n')) {
    let line = ''
    let i = 0

    while (i < rawLine.length) {
      if (inBlock) {
        const end = rawLine.indexOf('*/', i)
        if (end === -1) break
        inBlock = false
        i = end + 2
        continue
      }

      if (rawLine.slice(i, i + 2) === '/*') {
        inBlock = true
        i += 2
        continue
      }

      if (rawLine[i] === ';') break

      line += rawLine[i]
      i++
    }

    lines.push(line)
  }

  return lines
}

export function unquoteString(text: string): string {
  if ((text.startsWith("'") && text.endsWith("'")) || (text.startsWith('"') && text.endsWith('"'))) {
    return text.slice(1, -1)
  }
  return text
}

/** 文字列リテラルの構文エラーを返す（正常なら null） */
export function getStringLiteralError(text: string): string | null {
  if (!text.startsWith("'") && !text.startsWith('"')) return null
  const open = text[0]!
  if (text.length < 2) return '文字列リテラルが閉じられていません'

  const close = text[text.length - 1]!
  if (close === open) return null

  if (close === "'" || close === '"') {
    return `文字列リテラルのクォートが一致しません（${open} で始まっていますが ${close} で終わっています）`
  }
  return '文字列リテラルが閉じられていません'
}
