import type { Token } from './tokenize'
import { tokenizeLine, stripComments, unquoteString } from './tokenize'
import { labelNameFromToken, normalizeLabelName } from './labels'

/** Tera Term の call で渡せるサブルーチン引数の上限 */
export const MAX_SUBROUTINE_PARAMS = 9

export interface CallSiteInfo {
  line: number
  label: string
  /** 静的に解決できた引数文字列（未解決は undefined） */
  staticParams: (string | undefined)[]
}

/** コマンド行の引数トークン列を取得（配列要素は1引数として数える） */
export function collectAtomicArgTokens(tokens: Token[], start = 0): Token[] {
  const args: Token[] = []
  let i = start
  while (i < tokens.length) {
    const tok = tokens[i]!
    if (tok.kind === 'string' || tok.kind === 'number' || tok.kind === 'label') {
      args.push(tok)
      i++
    } else if (tok.kind === 'identifier') {
      if (tokens[i + 1]?.text === '[' && tokens[i + 3]?.text === ']') {
        args.push(tok)
        i += 4
      } else {
        args.push(tok)
        i++
      }
    } else {
      i++
    }
  }
  return args
}

/** call のラベルとサブルーチン引数トークンを分離 */
export function extractCallLabelAndParams(
  tokens: Token[],
  cmdIndex: number,
): { label: Token | undefined; params: Token[] } {
  const atomic = collectAtomicArgTokens(tokens, cmdIndex + 1)
  return {
    label: atomic[0],
    params: atomic.slice(1),
  }
}

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

/** call 行から静的に解決できる引数文字列を取得 */
export function resolveStaticCallParam(
  token: Token | undefined,
  resolveString: (name: string) => string | undefined,
): string | undefined {
  if (!token) return undefined
  if (token.kind === 'string') return unquoteString(token.text)
  if (token.kind === 'number') return token.text
  if (token.kind === 'identifier') return resolveString(token.text.toLowerCase())
  return undefined
}

/** ソース内の call 呼び出しをラベル名ごとに収集 */
export function collectCallSites(
  source: string | string[],
  resolveString: (name: string) => string | undefined = () => undefined,
): Map<string, CallSiteInfo[]> {
  const lines = Array.isArray(source) ? source : stripComments(source)
  const sites = new Map<string, CallSiteInfo[]>()

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const lineNum = lineIdx + 1
    const tokens = tokenizeLine(lines[lineIdx]!, lineNum)
    let offset = 0
    if (tokens[0]?.kind === 'label') offset = 1
    if (offset >= tokens.length) continue
    const cmd = tokens[offset]
    if (cmd?.kind !== 'identifier' || cmd.text.toLowerCase() !== 'call') continue

    const { label, params } = extractCallLabelAndParams(tokens, offset)
    const labelName = labelNameFromToken(label)
    if (!labelName) continue

    const key = normalizeLabelName(labelName)
    const staticParams = params.map((p) => resolveStaticCallParam(p, resolveString))
    const list = sites.get(key) ?? []
    list.push({ line: lineNum, label: labelName, staticParams })
    sites.set(key, list)
  }

  return sites
}

/** 複数 call サイトで共通する静的引数値（不一致なら undefined） */
export function mergeStaticCallParams(sites: CallSiteInfo[], paramIndex: number): string | undefined {
  if (sites.length === 0) return undefined
  let common: string | undefined
  for (const site of sites) {
    const val = site.staticParams[paramIndex]
    if (val === undefined) return undefined
    if (common === undefined) {
      common = val
    } else if (common !== val) {
      return undefined
    }
  }
  return common
}
