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

/**
 * TTL 整数定数（10進 / `$` 始まり16進）を数値化する。
 * @see https://teratermproject.github.io/manual/5/en/macro/syntax/formats.html
 */
export function parseTtlIntegerLiteral(text: string): number | undefined {
  if (/^-?\d+$/.test(text)) {
    const n = Number(text)
    return Number.isFinite(n) ? n | 0 : undefined
  }
  if (/^\$[0-9a-fA-F]+$/.test(text)) {
    // 符号付き32bit（公式 Integer）
    return (parseInt(text.slice(1), 16) | 0)
  }
  return undefined
}

/**
 * `#` / `#$` に続く文字コード。NUL(0) は公式どおり文字列に含められないため undefined。
 */
export function parseTtlCharCodeLiteral(text: string): number | undefined {
  const n = parseTtlIntegerLiteral(text)
  if (n === undefined || n === 0) return undefined
  return n
}

/**
 * tokens[start] から符号付き整数リテラルを読む（`-`/`+` + 非負 number、または number）。
 * トークン化が単項 `-` と数値を分離したあとの静的解析用。
 */
export function parseTtlSignedIntAt(
  tokens: ReadonlyArray<Token>,
  start: number,
): { value: number; next: number } | undefined {
  const tok = tokens[start]
  if (!tok) return undefined
  if (tok.kind === 'number') {
    const n = parseTtlIntegerLiteral(tok.text)
    return n === undefined ? undefined : { value: n, next: start + 1 }
  }
  if (tok.kind === 'operator' && (tok.text === '-' || tok.text === '+')) {
    const num = tokens[start + 1]
    if (num?.kind !== 'number') return undefined
    const n = parseTtlIntegerLiteral(num.text)
    if (n === undefined) return undefined
    return { value: tok.text === '-' ? (-n | 0) : (n | 0), next: start + 2 }
  }
  return undefined
}

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

    // `$3a` / `$10F` — 公式16進整数（10進より先に判定）
    const hexMatch = line.slice(i).match(/^\$[0-9a-fA-F]+/)
    if (hexMatch) {
      tokens.push({ text: hexMatch[0], line: lineNum, column: col, kind: 'number' })
      i += hexMatch[0].length
      continue
    }

    // 10進は非負のみ（負数は単項 `-` + 数値。公式 expressions / ttpmacro GetNumber に合わせる）
    const numMatch = line.slice(i).match(/^\d+/)
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

    // 長い演算子を先に（expressions.html / ttpmacro GetOperator）
    const opMatch = line
      .slice(i)
      .match(/^(>>>|>>|<<|&&|\|\||<>|>=|<=|==|!=|:=|[=<>+\-*/%#&|^~!()[\]])/)
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

interface BlockCommentLineState {
  /** この行を最後まで処理した後もブロックコメントが閉じていないか */
  endsInBlockComment: boolean
  /** 0-based 列 col が `/* ... *\/` の範囲内か（文字列リテラル内の `/*` は対象外、stripComments と同じ規則） */
  isColumnInBlockComment(col: number): boolean
}

function scanBlockCommentState(rawLine: string, startInBlockComment: boolean): BlockCommentLineState {
  const ranges: Array<{ start: number; end: number }> = []
  let inBlock = startInBlockComment
  let inString: "'" | '"' | null = null
  let i = 0

  if (inBlock) ranges.push({ start: 0, end: Infinity })

  while (i < rawLine.length) {
    if (inBlock) {
      const end = rawLine.indexOf('*/', i)
      if (end === -1) break
      inBlock = false
      ranges[ranges.length - 1]!.end = end + 2
      i = end + 2
      continue
    }

    const ch = rawLine[i]!

    if (inString) {
      if (ch === inString) inString = null
      i++
      continue
    }

    if (rawLine.slice(i, i + 2) === '/*') {
      inBlock = true
      ranges.push({ start: i, end: Infinity })
      i += 2
      continue
    }

    if (ch === "'" || ch === '"') {
      inString = ch
      i++
      continue
    }

    if (ch === ';') break

    i++
  }

  return {
    endsInBlockComment: inBlock,
    isColumnInBlockComment: (col) => ranges.some((r) => col >= r.start && col < r.end),
  }
}

let blockCommentCache: { source: string; lines: string[]; startsInBlock: boolean[] } | null = null

function getBlockCommentCache(source: string): { lines: string[]; startsInBlock: boolean[] } {
  if (blockCommentCache && blockCommentCache.source === source) return blockCommentCache
  const lines = source.split('\n')
  const startsInBlock: boolean[] = []
  let inBlock = false
  for (const raw of lines) {
    startsInBlock.push(inBlock)
    inBlock = scanBlockCommentState(raw, inBlock).endsInBlockComment
  }
  blockCommentCache = { source, lines, startsInBlock }
  return blockCommentCache
}

/**
 * 複数行 `/* *\/` コメートをまたぐ状態を考慮し、`source` 内の (lineNum, col) が
 * ブロックコメント内かを判定する。ホバー・補完は行単位の `tokenizeLine` を使うため、
 * これらの呼び出し元で明示的にチェックする必要がある（stripComments を経由する
 * 静的解析本体は複数行状態を追跡済み）。
 */
export function isPositionInBlockComment(source: string, lineNum: number, col: number): boolean {
  const { lines, startsInBlock } = getBlockCommentCache(source)
  const idx = lineNum - 1
  const line = lines[idx]
  if (line === undefined) return false
  return scanBlockCommentState(line, startsInBlock[idx] ?? false).isColumnInBlockComment(col)
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
