import { tokenizeLine, unquoteString, type Token } from './tokenize'
import { evalTtlIntExprAt, evalTtlLiteralIntCondition, type TtlIntExprResolve } from './ttlExpression'

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
 * 変数を含む式は未確定とする。
 * @see https://teratermproject.github.io/manual/5/en/macro/syntax/expressions.html
 */
export function evalGuaranteedLiteralCondition(tokens: Token[]): boolean | undefined {
  if (tokens.length === 0) return undefined
  // 文字列リテラル単独（公式の整数条件ではないが、従来の静的判定を維持）
  if (tokens.length === 1 && tokens[0]?.kind === 'string') {
    return unquoteString(tokens[0].text) !== ''
  }
  return evalTtlLiteralIntCondition(tokens)
}

export function scalarCompare(
  lhs: BoolExprScalar | undefined,
  op: string,
  rhs: BoolExprScalar | undefined,
): boolean | undefined {
  if (!lhs || !rhs) return undefined
  if (lhs.kind === 'str' && rhs.kind === 'str') {
    if (op === '=' || op === '==') return lhs.value === rhs.value
    if (op === '<>' || op === '!=') return lhs.value !== rhs.value
    return undefined
  }
  if (lhs.kind === 'int' && rhs.kind === 'int') {
    switch (op) {
      case '=':
      case '==':
        return lhs.value === rhs.value
      case '<>':
      case '!=':
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
  /** 整数配列要素の解決（`if arr[0]=1` 用） */
  resolveIntArray?: (name: string, index: number) => number | undefined
}

function resolveFromTokenFn<TEnv>(
  resolveToken: (token: Token | undefined, env: TEnv) => BoolExprScalar | undefined,
  env: TEnv,
  options?: EvalBoolExprOptions,
): TtlIntExprResolve {
  return {
    resolveInt(name: string) {
      const v = resolveToken({ text: name, line: 0, column: 0, kind: 'identifier' }, env)
      return v?.kind === 'int' ? v.value : undefined
    },
    resolveIntArray: options?.resolveIntArray,
  }
}

/**
 * 単純な文字列比較 `lhs =/==/<> /!= rhs`（公式整数式の外側の互換）。
 */
function evalSimpleStringCompare<TEnv>(
  tokens: Token[],
  env: TEnv,
  resolveToken: (token: Token | undefined, env: TEnv) => BoolExprScalar | undefined,
  options?: EvalBoolExprOptions,
): boolean | undefined {
  if (tokens.length !== 3) return undefined
  const op = tokens[1]
  if (op?.kind !== 'operator' || !['=', '==', '<>', '!='].includes(op.text)) return undefined
  const lhs = resolveToken(tokens[0], env)
  const rhs = resolveToken(tokens[2], env)
  if (!lhs || !rhs) return undefined
  if (lhs.kind !== 'str' || rhs.kind !== 'str') {
    if (options?.typeMismatchAsFalse && lhs.kind !== rhs.kind) return false
    return undefined
  }
  return scalarCompare(lhs, op.text, rhs)
}

/**
 * 条件式の評価。
 * 本線は公式どおり整数式（非ゼロが真）。
 * 互換: 単独の文字列真偽、単純な文字列比較。
 * @see https://teratermproject.github.io/manual/5/en/macro/syntax/expressions.html
 */
export function evalBoolExpr<TEnv>(
  tokens: Token[],
  env: TEnv,
  resolveToken: (token: Token | undefined, env: TEnv) => BoolExprScalar | undefined,
  options?: EvalBoolExprOptions,
): boolean | undefined {
  if (tokens.length === 0) return undefined

  const intGot = evalTtlIntExprAt(tokens, 0, resolveFromTokenFn(resolveToken, env, options))
  if (intGot && !intGot.error && intGot.next === tokens.length) {
    return intGot.value !== 0
  }

  // 単独トークンの真偽（整数は上で処理済み。文字列は非空が真）
  if (tokens.length === 1) {
    const v = resolveToken(tokens[0], env)
    if (v?.kind === 'int') return v.value !== 0
    if (v?.kind === 'str') return v.value !== ''
    return undefined
  }

  // 型不一致の単純比較（dryRun: msg = 1 → false）
  if (tokens.length === 3 && options?.typeMismatchAsFalse) {
    const op = tokens[1]
    if (op?.kind === 'operator' && ['=', '==', '<>', '!=', '<', '>', '<=', '>='].includes(op.text)) {
      const lhs = resolveToken(tokens[0], env)
      const rhs = resolveToken(tokens[2], env)
      if (lhs && rhs && lhs.kind !== rhs.kind) return false
    }
  }

  const strCmp = evalSimpleStringCompare(tokens, env, resolveToken, options)
  if (strCmp !== undefined) return strCmp

  // 整数式が途中までしか解けない／未解決変数 → 未確定
  if (intGot?.error === 'unresolved') return undefined
  return undefined
}
