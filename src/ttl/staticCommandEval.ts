import type { Token } from './tokenize'

export interface StaticValueContext {
  tokenAt(rel: number): Token | undefined
  resolveString(rel: number): string | undefined
  resolveInt(rel: number): number | undefined
  /** 第 rel 引数の変数に格納済みの文字列（in-place 系コマンド用） */
  resolveInPlaceVar(rel: number): string | undefined
  /** 第 rel 引数から始まる隣接連結文字列（'a'#13 等） */
  resolveGroupedString(rel: number): string | undefined
}

export interface StaticStringResult {
  destIndex: number
  value: string
}

export interface StaticIntResult {
  destIndex: number
  value: number
}

export interface StaticStr2intResult {
  destIndex: number
  value: number
  result: 0 | 1
}

function utf8Bytes(s: string): Uint8Array {
  return new TextEncoder().encode(s)
}

function fromUtf8Bytes(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes)
}

/** strcopy / strremove 等: UTF-8 バイト位置（1 始まり）で部分文字列を切り出す */
export function computeStrcopySubstring(
  source: string,
  position1Based: number,
  length: number,
): string {
  if (length <= 0 || position1Based < 1) return ''
  const bytes = utf8Bytes(source)
  const start = position1Based - 1
  if (start >= bytes.length) return ''
  return fromUtf8Bytes(bytes.slice(start, start + length))
}

export function computeStrinsert(
  base: string,
  position1Based: number,
  insert: string,
): string | undefined {
  const bytes = utf8Bytes(base)
  const insertBytes = utf8Bytes(insert)
  if (position1Based < 1 || position1Based > bytes.length + 1) return undefined
  const idx = position1Based - 1
  const out = new Uint8Array(bytes.length + insertBytes.length)
  out.set(bytes.subarray(0, idx), 0)
  out.set(insertBytes, idx)
  out.set(bytes.subarray(idx), idx + insertBytes.length)
  return fromUtf8Bytes(out)
}

export function computeStrremove(
  base: string,
  position1Based: number,
  length: number,
): string | undefined {
  if (length <= 0 || position1Based < 1) return undefined
  const bytes = utf8Bytes(base)
  const start = position1Based - 1
  if (start + length > bytes.length) return undefined
  const out = new Uint8Array(bytes.length - length)
  out.set(bytes.subarray(0, start), 0)
  out.set(bytes.subarray(start + length), start)
  return fromUtf8Bytes(out)
}

export function computeStrtrim(base: string, trimChars: string): string {
  const trimSet = new Set(trimChars)
  let start = 0
  let end = base.length
  while (start < end && trimSet.has(base[start]!)) start++
  while (end > start && trimSet.has(base[end - 1]!)) end--
  return base.slice(start, end)
}

export function computeMakepath(dir: string, name: string): string {
  if (dir.length === 0) return name
  const last = dir[dir.length - 1]
  if (last === '\\' || last === '/') return dir + name
  return `${dir}\\${name}`
}

export function computeBasename(path: string): string {
  const i = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'))
  return i === -1 ? path : path.slice(i + 1)
}

export function computeDirname(path: string): string {
  const i = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'))
  return i === -1 ? '' : path.slice(0, i)
}

export function computeCode2str(code: number): string {
  if (code === 0) return ''
  const bytes: number[] = []
  let n = code >>> 0
  while (n > 0) {
    bytes.unshift(n & 0xff)
    n >>>= 8
  }
  return fromUtf8Bytes(new Uint8Array(bytes))
}

export function computeStr2code(source: string): number {
  const bytes = utf8Bytes(source)
  const take = bytes.slice(Math.max(0, bytes.length - 4))
  let val = 0
  for (const b of take) {
    val = val * 256 + b
  }
  return val
}

/** strcompare: UTF-8 バイト列の辞書順比較（Tera Term の result: -1 / 0 / 1） */
export function computeStrcompare(a: string, b: string): number {
  const ab = utf8Bytes(a)
  const bb = utf8Bytes(b)
  const len = Math.min(ab.length, bb.length)
  for (let i = 0; i < len; i++) {
    if (ab[i]! < bb[i]!) return -1
    if (ab[i]! > bb[i]!) return 1
  }
  if (ab.length < bb.length) return -1
  if (ab.length > bb.length) return 1
  return 0
}

/** strlen / strlength: UTF-8 バイト長 */
export function computeStrlen(text: string): number {
  return utf8Bytes(text).length
}

/** strscan: 部分文字列の 1-origin バイト位置（見つからなければ 0） */
export function computeStrscan(haystack: string, needle: string): number {
  if (needle.length === 0) return 0
  const h = utf8Bytes(haystack)
  const n = utf8Bytes(needle)
  if (n.length === 0 || h.length < n.length) return 0
  outer: for (let i = 0; i <= h.length - n.length; i++) {
    for (let j = 0; j < n.length; j++) {
      if (h[i + j] !== n[j]) continue outer
    }
    return i + 1
  }
  return 0
}

export type IfdefinedTypeCode = 0 | 1 | 3 | 4 | 5 | 6

export interface IfdefinedLookup {
  isLabel(name: string): boolean
  /** 未定義は 0 */
  varType(name: string): IfdefinedTypeCode
}

function normalizeIfdefinedName(name: string): string {
  return name.replace(/^:/, '').toLowerCase()
}

/** ifdefined: 変数・ラベルの型コード（Tera Term v5） */
export function computeIfdefined(varName: string, lookup: IfdefinedLookup): IfdefinedTypeCode {
  const key = normalizeIfdefinedName(varName)
  if (lookup.isLabel(key)) return 4
  return lookup.varType(key)
}

export function parseStr2int(source: string): number | undefined {
  const t = source.trim()
  if (t.length === 0) return undefined
  if (/^0x[0-9a-f]+$/i.test(t)) return parseInt(t.slice(2), 16)
  if (/^\$[0-9a-f]+$/i.test(t)) return parseInt(t.slice(1), 16)
  const m = t.match(/^-?\d+/)
  if (!m) return undefined
  return Number(m[0])
}

export function computeChecksum8(source: string): number {
  const bytes = utf8Bytes(source)
  let sum = 0
  for (const b of bytes) sum = (sum + b) & 0xff
  return sum
}

function simpleRegexToLiteral(pattern: string): string | null {
  let result = ''
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]!
    if (ch === '\\') {
      if (i + 1 >= pattern.length) return null
      result += pattern[++i]
      continue
    }
    if ('.*+?[](){}|^$'.includes(ch)) return null
    result += ch
  }
  return result
}

export function computeStrreplaceLiteral(
  base: string,
  position1Based: number,
  pattern: string,
  replacement: string,
): string | undefined {
  const literal = simpleRegexToLiteral(pattern)
  if (literal === null) return undefined
  if (position1Based < 1) return undefined
  const bytes = utf8Bytes(base)
  const start = position1Based - 1
  if (start > bytes.length) return undefined
  const tail = fromUtf8Bytes(bytes.slice(start))
  const idx = tail.indexOf(literal)
  if (idx < 0) return undefined
  const abs = start + utf8Bytes(tail.slice(0, idx)).length
  const before = fromUtf8Bytes(bytes.slice(0, abs))
  const afterStart = abs + utf8Bytes(literal).length
  const after = fromUtf8Bytes(bytes.slice(afterStart))
  return before + replacement + after
}

function destIdentifier(ctx: StaticValueContext, offset: number, rel: number): number | undefined {
  const tok = ctx.tokenAt(rel)
  if (tok?.kind !== 'identifier') return undefined
  return offset + rel
}

export function tryStaticStringCommand(
  cmd: string,
  offset: number,
  ctx: StaticValueContext,
): StaticStringResult | undefined {
  const lower = cmd.toLowerCase()

  switch (lower) {
    case 'int2str': {
      const n = ctx.resolveInt(2)
      const dest = destIdentifier(ctx, offset, 1)
      if (n === undefined || dest === undefined) return undefined
      return { destIndex: dest, value: String(n) }
    }
    case 'code2str': {
      const code = ctx.resolveInt(2)
      const dest = destIdentifier(ctx, offset, 1)
      if (code === undefined || dest === undefined) return undefined
      return { destIndex: dest, value: computeCode2str(code) }
    }
    case 'tolower': {
      const src = ctx.resolveString(2)
      const dest = destIdentifier(ctx, offset, 1)
      if (src === undefined || dest === undefined) return undefined
      return { destIndex: dest, value: src.toLowerCase() }
    }
    case 'toupper': {
      const src = ctx.resolveString(2)
      const dest = destIdentifier(ctx, offset, 1)
      if (src === undefined || dest === undefined) return undefined
      return { destIndex: dest, value: src.toUpperCase() }
    }
    case 'strconcat': {
      const base = ctx.resolveInPlaceVar(1)
      const append = ctx.resolveGroupedString(2) ?? ctx.resolveString(2)
      const dest = destIdentifier(ctx, offset, 1)
      if (base === undefined || append === undefined || dest === undefined) return undefined
      return { destIndex: dest, value: base + append }
    }
    case 'makepath': {
      const dir = ctx.resolveString(2)
      const name = ctx.resolveString(3)
      const dest = destIdentifier(ctx, offset, 1)
      if (dir === undefined || name === undefined || dest === undefined) return undefined
      return { destIndex: dest, value: computeMakepath(dir, name) }
    }
    case 'basename': {
      const path = ctx.resolveString(2)
      const dest = destIdentifier(ctx, offset, 1)
      if (path === undefined || dest === undefined) return undefined
      return { destIndex: dest, value: computeBasename(path) }
    }
    case 'dirname': {
      const path = ctx.resolveString(2)
      const dest = destIdentifier(ctx, offset, 1)
      if (path === undefined || dest === undefined) return undefined
      return { destIndex: dest, value: computeDirname(path) }
    }
    case 'strcopy': {
      const source = ctx.resolveString(1)
      const position = ctx.resolveInt(2)
      const length = ctx.resolveInt(3)
      const dest = destIdentifier(ctx, offset, 4)
      if (source === undefined || position === undefined || length === undefined || dest === undefined) {
        return undefined
      }
      return { destIndex: dest, value: computeStrcopySubstring(source, position, length) }
    }
    case 'strinsert': {
      const base = ctx.resolveInPlaceVar(1)
      const index = ctx.resolveInt(2)
      const insert = ctx.resolveString(3)
      const dest = destIdentifier(ctx, offset, 1)
      if (base === undefined || index === undefined || insert === undefined || dest === undefined) {
        return undefined
      }
      const value = computeStrinsert(base, index, insert)
      if (value === undefined) return undefined
      return { destIndex: dest, value }
    }
    case 'strremove': {
      const base = ctx.resolveInPlaceVar(1)
      const index = ctx.resolveInt(2)
      const length = ctx.resolveInt(3)
      const dest = destIdentifier(ctx, offset, 1)
      if (base === undefined || index === undefined || length === undefined || dest === undefined) {
        return undefined
      }
      const value = computeStrremove(base, index, length)
      if (value === undefined) return undefined
      return { destIndex: dest, value }
    }
    case 'strtrim': {
      const base = ctx.resolveInPlaceVar(1)
      const trimChars = ctx.resolveString(2)
      const dest = destIdentifier(ctx, offset, 1)
      if (base === undefined || trimChars === undefined || dest === undefined) return undefined
      return { destIndex: dest, value: computeStrtrim(base, trimChars) }
    }
    case 'strreplace': {
      const base = ctx.resolveInPlaceVar(1)
      const index = ctx.resolveInt(2)
      const pattern = ctx.resolveString(3)
      const replacement = ctx.resolveString(4)
      const dest = destIdentifier(ctx, offset, 1)
      if (
        base === undefined ||
        index === undefined ||
        pattern === undefined ||
        replacement === undefined ||
        dest === undefined
      ) {
        return undefined
      }
      const value = computeStrreplaceLiteral(base, index, pattern, replacement)
      if (value === undefined) return undefined
      return { destIndex: dest, value }
    }
    default:
      return undefined
  }
}

export function tryStaticIntegerCommand(
  cmd: string,
  offset: number,
  ctx: StaticValueContext,
): StaticIntResult | undefined {
  const lower = cmd.toLowerCase()

  switch (lower) {
    case 'str2int':
      return undefined
    case 'str2code': {
      const src = ctx.resolveString(2)
      const dest = destIdentifier(ctx, offset, 1)
      if (src === undefined || dest === undefined) return undefined
      return { destIndex: dest, value: computeStr2code(src) }
    }
    case 'checksum8': {
      const src = ctx.resolveString(2)
      const dest = destIdentifier(ctx, offset, 1)
      if (src === undefined || dest === undefined) return undefined
      return { destIndex: dest, value: computeChecksum8(src) }
    }
    default:
      return undefined
  }
}

export function tryStaticStr2intCommand(
  cmd: string,
  offset: number,
  ctx: StaticValueContext,
): StaticStr2intResult | undefined {
  if (cmd.toLowerCase() !== 'str2int') return undefined
  const src = ctx.resolveString(2)
  const dest = destIdentifier(ctx, offset, 1)
  if (src === undefined || dest === undefined) return undefined
  const value = parseStr2int(src)
  if (value !== undefined) return { destIndex: dest, value, result: 1 }
  return { destIndex: dest, value: 0, result: 0 }
}

/** result のみを更新するコマンド（strcompare / strlen 等） */
export function tryStaticResultCommand(
  cmd: string,
  ctx: StaticValueContext,
  options?: { ifdefined?: IfdefinedLookup; ifdefinedName?: string },
): number | undefined {
  const lower = cmd.toLowerCase()
  switch (lower) {
    case 'strcompare': {
      const a = ctx.resolveString(1)
      const b = ctx.resolveString(2)
      if (a === undefined || b === undefined) return undefined
      return computeStrcompare(a, b)
    }
    case 'strlen':
    case 'strlength': {
      const text = ctx.resolveString(1)
      if (text === undefined) return undefined
      return computeStrlen(text)
    }
    case 'strscan': {
      const haystack = ctx.resolveString(1)
      const needle = ctx.resolveString(2)
      if (haystack === undefined || needle === undefined) return undefined
      return computeStrscan(haystack, needle)
    }
    case 'ifdefined': {
      const lookup = options?.ifdefined
      const name = options?.ifdefinedName ?? ctx.tokenAt(1)?.text
      if (!lookup || !name) return undefined
      return computeIfdefined(name, lookup)
    }
    default:
      return undefined
  }
}
