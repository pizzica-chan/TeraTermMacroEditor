/**
 * TTL 整数式の評価（優先順位・演算子は公式 Manual 5 / ttpmacro 実装に準拠）。
 * @see https://teratermproject.github.io/manual/5/en/macro/syntax/expressions.html
 * @see teraterm/ttpmacro/ttmparse.cpp GetExpression
 */
import { parseTtlIntegerLiteral, type Token } from './tokenize'

const INT_BIT = 32

/** 単語演算子（ビット演算。論理演算ではない） */
const WORD_BITWISE = new Set(['and', 'or', 'xor', 'not'])

export interface TtlIntExprResolve {
  /** 整数スカラー変数 */
  resolveInt(name: string): number | undefined
  /** 整数配列要素（未対応なら省略可） */
  resolveIntArray?(name: string, index: number): number | undefined
}

export type TtlIntExprError = 'div0' | 'syntax' | 'type' | 'unresolved'

export interface TtlIntExprResult {
  value: number
  next: number
  error?: TtlIntExprError
}

function toInt32(n: number): number {
  return n | 0
}

function isRParen(tok: Token | undefined): boolean {
  return tok?.text === ')' && (tok.kind === 'operator' || tok.kind === 'other')
}

function isLParen(tok: Token | undefined): boolean {
  return tok?.text === '(' && (tok.kind === 'operator' || tok.kind === 'other')
}

function isLBracket(tok: Token | undefined): boolean {
  return tok?.text === '[' && (tok.kind === 'operator' || tok.kind === 'other')
}

function isRBracket(tok: Token | undefined): boolean {
  return tok?.text === ']' && (tok.kind === 'operator' || tok.kind === 'other')
}

function wordOp(tok: Token | undefined): string | undefined {
  if (tok?.kind !== 'identifier') return undefined
  const lower = tok.text.toLowerCase()
  return WORD_BITWISE.has(lower) ? lower : undefined
}

function binOp(tok: Token | undefined): string | undefined {
  if (!tok) return undefined
  const w = wordOp(tok)
  if (w === 'and' || w === 'or' || w === 'xor') return w
  if (tok.kind !== 'operator' && tok.kind !== 'other') return undefined
  const t = tok.text
  switch (t) {
    case '*':
    case '/':
    case '%':
    case '+':
    case '-':
    case '>>':
    case '<<':
    case '>>>':
    case '&':
    case '|':
    case '^':
    case '<':
    case '>':
    case '<=':
    case '>=':
    case '=':
    case '==':
    case '<>':
    case '!=':
    case '&&':
    case '||':
      return t
    default:
      return undefined
  }
}

function unaryOp(tok: Token | undefined): string | undefined {
  if (!tok) return undefined
  const w = wordOp(tok)
  if (w === 'not') return 'not'
  if (tok.kind !== 'operator' && tok.kind !== 'other') return undefined
  switch (tok.text) {
    case '~':
    case '!':
    case '+':
    case '-':
      return tok.text
    default:
      return undefined
  }
}

function applyShift(val1: number, val2: number, kind: '>>' | '<<' | '>>>'): number {
  let shift = val2
  if (kind === '<<') shift = -shift

  if (shift <= -INT_BIT) return 0
  if (shift < 0) return toInt32(val1 << -shift)
  if (shift === 0) return toInt32(val1)
  if (shift < INT_BIT) {
    if (kind === '>>>') return toInt32(val1 >>> shift)
    return toInt32(val1 >> shift)
  }
  // shift >= 32
  if (val1 > 0 || kind === '>>>') return 0
  return toInt32(~0)
}

type Partial = { value: number; next: number; error?: TtlIntExprError } | undefined

/**
 * tokens[start..] から整数式を1つ評価する。成功時 next は未消費位置。
 * 失敗時（未解決変数・構文）は undefined。ゼロ除算は error: 'div0' 付きで返す場合あり。
 */
export function evalTtlIntExprAt(
  tokens: Token[],
  start: number,
  resolve: TtlIntExprResolve,
): TtlIntExprResult | undefined {
  const got = getExpression(tokens, start, resolve)
  if (!got || got.error) return got
  return { value: toInt32(got.value), next: got.next }
}

/** 式全体を評価（残りトークンがあっても値は返す。呼び出し側で next を確認） */
export function evalTtlIntExpr(
  tokens: Token[],
  start: number,
  resolve: TtlIntExprResolve,
): number | undefined {
  const got = evalTtlIntExprAt(tokens, start, resolve)
  if (!got || got.error) return undefined
  return got.value
}

/** リテラルと演算子だけで真偽が断定できるか（到達不能解析用） */
export function evalTtlLiteralIntCondition(tokens: Token[]): boolean | undefined {
  if (tokens.length === 0) return undefined
  for (const tok of tokens) {
    if (tok.kind === 'number') continue
    if (tok.kind === 'operator' || tok.kind === 'other') continue
    if (tok.kind === 'identifier' && WORD_BITWISE.has(tok.text.toLowerCase())) continue
    return undefined
  }
  const got = evalTtlIntExprAt(tokens, 0, {
    resolveInt() {
      return undefined
    },
  })
  if (!got || got.error || got.next !== tokens.length) return undefined
  return got.value !== 0
}

// --- precedence layers (ttmparse.cpp) ---

function getFactor(tokens: Token[], i: number, resolve: TtlIntExprResolve): Partial {
  const tok = tokens[i]
  if (!tok) return undefined

  // not / unary word
  const u = unaryOp(tok)
  if (u === 'not' || u === '~' || u === '!' || u === '+' || u === '-') {
    const inner = getFactor(tokens, i + 1, resolve)
    if (!inner || inner.error) return inner ?? { value: 0, next: i, error: 'syntax' }
    let v = inner.value
    if (u === 'not' || u === '~') v = ~v
    else if (u === '!') v = v ? 0 : 1
    else if (u === '-') v = -v
    return { value: toInt32(v), next: inner.next }
  }

  if (tok.kind === 'number') {
    const n = parseTtlIntegerLiteral(tok.text)
    if (n === undefined) return undefined
    return { value: toInt32(n), next: i + 1 }
  }

  if (tok.kind === 'identifier' && !WORD_BITWISE.has(tok.text.toLowerCase())) {
    const name = tok.text
    // arr[index]
    if (isLBracket(tokens[i + 1])) {
      const idxExpr = getExpression(tokens, i + 2, resolve)
      if (!idxExpr || idxExpr.error) return idxExpr ?? { value: 0, next: i, error: 'syntax' }
      if (!isRBracket(tokens[idxExpr.next])) return { value: 0, next: i, error: 'syntax' }
      const el = resolve.resolveIntArray?.(name, idxExpr.value)
      if (el === undefined) return { value: 0, next: i, error: 'unresolved' }
      return { value: toInt32(el), next: idxExpr.next + 1 }
    }
    const v = resolve.resolveInt(name)
    if (v === undefined) return { value: 0, next: i, error: 'unresolved' }
    return { value: toInt32(v), next: i + 1 }
  }

  if (isLParen(tok)) {
    const inner = getExpression(tokens, i + 1, resolve)
    if (!inner || inner.error) return inner ?? { value: 0, next: i, error: 'syntax' }
    if (!isRParen(tokens[inner.next])) return { value: 0, next: i, error: 'syntax' }
    return { value: inner.value, next: inner.next + 1 }
  }

  return undefined
}

function evalMul(tokens: Token[], i: number, resolve: TtlIntExprResolve): Partial {
  let left = getFactor(tokens, i, resolve)
  if (!left) return undefined
  if (left.error) return left
  while (true) {
    const op = binOp(tokens[left.next])
    if (op !== '*' && op !== '/' && op !== '%') return left
    const right = getFactor(tokens, left.next + 1, resolve)
    if (!right || right.error) return right ?? { value: 0, next: left.next, error: 'syntax' }
    if ((op === '/' || op === '%') && right.value === 0) {
      return { value: 0, next: right.next, error: 'div0' }
    }
    let v: number = left.value
    if (op === '*') v = left.value * right.value
    else if (op === '/') v = (left.value / right.value) | 0
    else v = left.value % right.value
    left = { value: toInt32(v), next: right.next }
  }
}

function evalAdd(tokens: Token[], i: number, resolve: TtlIntExprResolve): Partial {
  let left = evalMul(tokens, i, resolve)
  if (!left) return undefined
  if (left.error) return left
  while (true) {
    const op = binOp(tokens[left.next])
    if (op !== '+' && op !== '-') return left
    const right = evalMul(tokens, left.next + 1, resolve)
    if (!right || right.error) return right ?? { value: 0, next: left.next, error: 'syntax' }
    const v: number = op === '+' ? left.value + right.value : left.value - right.value
    left = { value: toInt32(v), next: right.next }
  }
}

function evalShift(tokens: Token[], i: number, resolve: TtlIntExprResolve): Partial {
  let left = evalAdd(tokens, i, resolve)
  if (!left) return undefined
  if (left.error) return left
  while (true) {
    const op = binOp(tokens[left.next])
    if (op !== '>>' && op !== '<<' && op !== '>>>') return left
    const right = evalAdd(tokens, left.next + 1, resolve)
    if (!right || right.error) return right ?? { value: 0, next: left.next, error: 'syntax' }
    left = { value: applyShift(left.value, right.value, op), next: right.next }
  }
}

function evalBitAnd(tokens: Token[], i: number, resolve: TtlIntExprResolve): Partial {
  let left = evalShift(tokens, i, resolve)
  if (!left) return undefined
  if (left.error) return left
  while (true) {
    const op = binOp(tokens[left.next])
    if (op !== 'and' && op !== '&') return left
    const right = evalShift(tokens, left.next + 1, resolve)
    if (!right || right.error) return right ?? { value: 0, next: left.next, error: 'syntax' }
    left = { value: toInt32(left.value & right.value), next: right.next }
  }
}

function evalBitXor(tokens: Token[], i: number, resolve: TtlIntExprResolve): Partial {
  let left = evalBitAnd(tokens, i, resolve)
  if (!left) return undefined
  if (left.error) return left
  while (true) {
    const op = binOp(tokens[left.next])
    if (op !== 'xor' && op !== '^') return left
    const right = evalBitAnd(tokens, left.next + 1, resolve)
    if (!right || right.error) return right ?? { value: 0, next: left.next, error: 'syntax' }
    left = { value: toInt32(left.value ^ right.value), next: right.next }
  }
}

function evalBitOr(tokens: Token[], i: number, resolve: TtlIntExprResolve): Partial {
  let left = evalBitXor(tokens, i, resolve)
  if (!left) return undefined
  if (left.error) return left
  while (true) {
    const op = binOp(tokens[left.next])
    if (op !== 'or' && op !== '|') return left
    const right = evalBitXor(tokens, left.next + 1, resolve)
    if (!right || right.error) return right ?? { value: 0, next: left.next, error: 'syntax' }
    left = { value: toInt32(left.value | right.value), next: right.next }
  }
}

function evalRel(tokens: Token[], i: number, resolve: TtlIntExprResolve): Partial {
  let left = evalBitOr(tokens, i, resolve)
  if (!left) return undefined
  if (left.error) return left
  while (true) {
    const op = binOp(tokens[left.next])
    if (op !== '<' && op !== '>' && op !== '<=' && op !== '>=') return left
    const right = evalBitOr(tokens, left.next + 1, resolve)
    if (!right || right.error) return right ?? { value: 0, next: left.next, error: 'syntax' }
    let v = 0
    if (op === '<') v = left.value < right.value ? 1 : 0
    else if (op === '>') v = left.value > right.value ? 1 : 0
    else if (op === '<=') v = left.value <= right.value ? 1 : 0
    else v = left.value >= right.value ? 1 : 0
    left = { value: v, next: right.next }
  }
}

function evalEq(tokens: Token[], i: number, resolve: TtlIntExprResolve): Partial {
  let left = evalRel(tokens, i, resolve)
  if (!left) return undefined
  if (left.error) return left
  while (true) {
    const op = binOp(tokens[left.next])
    if (op !== '=' && op !== '==' && op !== '<>' && op !== '!=') return left
    const right = evalRel(tokens, left.next + 1, resolve)
    if (!right || right.error) return right ?? { value: 0, next: left.next, error: 'syntax' }
    const eq: boolean = left.value === right.value
    left = { value: op === '=' || op === '==' ? (eq ? 1 : 0) : eq ? 0 : 1, next: right.next }
  }
}

function evalLand(tokens: Token[], i: number, resolve: TtlIntExprResolve): Partial {
  let left = evalEq(tokens, i, resolve)
  if (!left) return undefined
  if (left.error) return left
  while (true) {
    const op = binOp(tokens[left.next])
    if (op !== '&&') return left
    // ttpmacro EvalLogicalAnd と同様、右辺は常に評価（短絡なし）
    const right = evalEq(tokens, left.next + 1, resolve)
    if (!right || right.error) return right ?? { value: 0, next: left.next, error: 'syntax' }
    left = { value: left.value && right.value ? 1 : 0, next: right.next }
  }
}

function getExpression(tokens: Token[], i: number, resolve: TtlIntExprResolve): Partial {
  let left = evalLand(tokens, i, resolve)
  if (!left) return undefined
  if (left.error) return left
  while (true) {
    const op = binOp(tokens[left.next])
    if (op !== '||') return left
    // ttpmacro GetExpression と同様、右辺は常に評価（短絡なし）
    const right = evalLand(tokens, left.next + 1, resolve)
    if (!right || right.error) return right ?? { value: 0, next: left.next, error: 'syntax' }
    left = { value: left.value || right.value ? 1 : 0, next: right.next }
  }
}
