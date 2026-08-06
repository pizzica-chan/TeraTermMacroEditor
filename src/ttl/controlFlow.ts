import { tokenizeLine, unquoteString, parseTtlIntegerLiteral, type Token } from './tokenize'

/** if/while/for/do/until の開閉ペア（配列形・analyzer 向け） */
export const BLOCK_PAIR_LIST: ReadonlyArray<readonly [string, string]> = [
  ['if', 'endif'],
  ['while', 'endwhile'],
  ['for', 'next'],
  ['do', 'loop'],
  ['until', 'enduntil'],
]

/** 開キーワード → 閉じキーワード */
export const BLOCK_PAIRS: Readonly<Record<string, string>> = Object.fromEntries(BLOCK_PAIR_LIST)

/** エディタ保護用のループ展開上限（公式の無限ループとは異なる） */
export const MAX_LOOP_ITERATIONS = 256

/** 比較演算で扱うスカラー（origin 等は無視） */
export type BoolExprScalar =
  | { kind: 'int'; value: number }
  | { kind: 'str'; value: string }

/**
 * 行先頭のコマンド／制御キーワード（ラベル行ならラベルの次）。
 * @param lineIdx 0-based 行インデックス
 */
export function lineKeyword(line: string, lineIdx: number): string {
  const tokens = tokenizeLine(line, lineIdx + 1)
  let off = tokens[0]?.kind === 'label' ? 1 : 0
  return tokens[off]?.kind === 'identifier' ? tokens[off]!.text.toLowerCase() : ''
}

/**
 * ネストを考慮してブロック終端行を探す。閉じが見つからなければ最終行。
 * @param startIdx 開きキーワードがある行（0-based）
 */
export function findBlockEnd(lines: string[], startIdx: number, open: string, close: string): number {
  let depth = 1
  for (let i = startIdx + 1; i < lines.length; i++) {
    const tokens = tokenizeLine(lines[i]!, i + 1)
    let off = tokens[0]?.kind === 'label' ? 1 : 0
    const kw = tokens[off]?.kind === 'identifier' ? tokens[off]!.text.toLowerCase() : ''
    if (kw === open) depth++
    if (kw === close) {
      depth--
      if (depth === 0) return i
    }
  }
  return lines.length - 1
}

/**
 * 到達不能判定と同様、リテラルだけで真と断定できる if 条件か。
 * 変数比較は未確定とする。
 */
export function evalGuaranteedLiteralCondition(tokens: Token[]): boolean | undefined {
  if (tokens.length === 1) {
    const token = tokens[0]
    if (token?.kind === 'number') {
      const value = parseTtlIntegerLiteral(token.text)
      return value !== undefined ? value !== 0 : undefined
    }
    if (token?.kind === 'string') return unquoteString(token.text) !== ''
    return undefined
  }
  if (
    tokens.length === 2 &&
    tokens[0]?.kind === 'identifier' &&
    tokens[0].text.toLowerCase() === 'not'
  ) {
    const inner = evalGuaranteedLiteralCondition(tokens.slice(1))
    return inner === undefined ? undefined : !inner
  }
  return undefined
}

export function scalarCompare(
  lhs: BoolExprScalar | undefined,
  op: string,
  rhs: BoolExprScalar | undefined,
): boolean | undefined {
  if (!lhs || !rhs) return undefined
  if (lhs.kind === 'str' && rhs.kind === 'str') {
    if (op === '=') return lhs.value === rhs.value
    if (op === '<>') return lhs.value !== rhs.value
    return undefined
  }
  if (lhs.kind === 'int' && rhs.kind === 'int') {
    switch (op) {
      case '=':
        return lhs.value === rhs.value
      case '<>':
        return lhs.value !== rhs.value
      case '<':
        return lhs.value < rhs.value
      case '>':
        return lhs.value > rhs.value
      case '<=':
        return lhs.value <= rhs.value
      case '>=':
        return lhs.value >= rhs.value
      default:
        return undefined
    }
  }
  return undefined
}

export interface EvalBoolExprOptions {
  /**
   * 左右のスカラー種別が食い違うとき false とみなす（dryRun の従来挙動）。
   * evaluator では undefined のまま（未確定）にする。
   */
  typeMismatchAsFalse?: boolean
}

/**
 * ブール式の静的／実行時評価。トークン解決は呼び出し側に委譲する。
 * - evaluator: resolveToken = evalConditionTokenValue（system-default 等は未確定）
 * - dryRun: resolveToken = evalTokenValue 等 + typeMismatchAsFalse
 */
export function evalBoolExpr<TEnv>(
  tokens: Token[],
  env: TEnv,
  resolveToken: (token: Token | undefined, env: TEnv) => BoolExprScalar | undefined,
  options?: EvalBoolExprOptions,
): boolean | undefined {
  if (tokens.length === 0) return undefined

  if (tokens[0]?.kind === 'identifier' && tokens[0].text.toLowerCase() === 'not') {
    const inner = evalBoolExpr(tokens.slice(1), env, resolveToken, options)
    return inner === undefined ? undefined : !inner
  }

  for (let j = 1; j < tokens.length; j++) {
    const op = tokens[j]
    if (op?.kind !== 'operator' || !['=', '<>', '<', '>', '<=', '>='].includes(op.text)) continue

    const lhs = resolveToken(tokens[j - 1], env)
    const rhs = resolveToken(tokens[j + 1], env)
    const cmp = scalarCompare(lhs, op.text, rhs)
    if (cmp === undefined) {
      if (options?.typeMismatchAsFalse && lhs && rhs && lhs.kind !== rhs.kind) return false
      return undefined
    }

    const andOr = tokens[j + 2]
    if (andOr?.kind === 'identifier') {
      const lo = andOr.text.toLowerCase()
      if (lo === 'and' || lo === 'or') {
        const rest = evalBoolExpr(tokens.slice(j + 3), env, resolveToken, options)
        if (rest === undefined) return undefined
        return lo === 'and' ? cmp && rest : cmp || rest
      }
    }
    return cmp
  }

  if (tokens.length === 1) {
    const v = resolveToken(tokens[0], env)
    if (v?.kind === 'int') return v.value !== 0
    if (v?.kind === 'str') return v.value !== ''
  }

  return undefined
}
