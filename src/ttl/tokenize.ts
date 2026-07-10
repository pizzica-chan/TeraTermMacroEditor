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

    if (line.slice(i, i + 2) === '/*') {
      const end = line.indexOf('*/', i + 2)
      i = end === -1 ? line.length : end + 2
      continue
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

    if (line[i] === ';') break

    if (line[i] === ':' && (i === 0 || /\s/.test(line[i - 1]!))) {
      const m = line.slice(i + 1).match(/^[\w]+/)
      if (m) {
        tokens.push({ text: m[0], line: lineNum, column: col, kind: 'label' })
        i += 1 + m[0].length
        continue
      }
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
    let inString: "'" | '"' | null = null

    while (i < rawLine.length) {
      if (inBlock) {
        const end = rawLine.indexOf('*/', i)
        if (end === -1) break
        inBlock = false
        i = end + 2
        continue
      }

      const ch = rawLine[i]!

      if (inString) {
        line += ch
        if (ch === inString) inString = null
        i++
        continue
      }

      if (rawLine.slice(i, i + 2) === '/*') {
        inBlock = true
        i += 2
        continue
      }

      if (ch === "'" || ch === '"') {
        inString = ch
        line += ch
        i++
        continue
      }

      if (ch === ';') break

      line += ch
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

export interface NonAsciiOutsideLiteralSpan {
  line: number
  column: number
  length: number
}

/** マクロ構文部（コメント・文字列リテラル外）で許可されるコードポイント */
export function isAllowedCodePointInMacroSyntax(code: number): boolean {
  return code === 0x09 || (code >= 0x20 && code <= 0x7e)
}

function isInvalidInMacroSyntaxChar(ch: string): boolean {
  const code = ch.codePointAt(0)
  return code !== undefined && !isAllowedCodePointInMacroSyntax(code)
}

function advanceChar(rawLine: string, i: number): number {
  const cp = rawLine[i]!.codePointAt(0)!
  return i + (cp > 0xffff ? 2 : 1)
}

/** コメントおよび文字列リテラル以外に現れる非 ASCII 文字の位置を返す */
export function findNonAsciiOutsideLiterals(source: string): NonAsciiOutsideLiteralSpan[] {
  const spans: NonAsciiOutsideLiteralSpan[] = []
  const lines = source.split('\n')
  let inBlockComment = false
  let inString: "'" | '"' | null = null

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const rawLine = lines[lineIdx]!
    const lineNum = lineIdx + 1
    let i = 0

    while (i < rawLine.length) {
      if (inBlockComment) {
        const end = rawLine.indexOf('*/', i)
        if (end === -1) break
        inBlockComment = false
        i = end + 2
        continue
      }

      const ch = rawLine[i]!

      if (inString) {
        if (ch === inString) inString = null
        i = advanceChar(rawLine, i)
        continue
      }

      if (rawLine.slice(i, i + 2) === '/*') {
        inBlockComment = true
        i += 2
        continue
      }

      if (ch === "'" || ch === '"') {
        inString = ch
        i++
        continue
      }

      if (ch === ';') break

      if (isInvalidInMacroSyntaxChar(ch)) {
        const start = i
        i = advanceChar(rawLine, i)
        while (i < rawLine.length && isInvalidInMacroSyntaxChar(rawLine[i]!)) {
          i = advanceChar(rawLine, i)
        }
        spans.push({ line: lineNum, column: start, length: i - start })
        continue
      }

      i = advanceChar(rawLine, i)
    }
  }

  return spans
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
