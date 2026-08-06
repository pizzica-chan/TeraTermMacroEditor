/**
 * 公式 expressions.html / ttpmacro GetExpression 相当の回帰テスト。
 * @see https://teratermproject.github.io/manual/5/en/macro/syntax/expressions.html
 */
import { tokenizeLine } from '../src/ttl/tokenize'
import { evalTtlIntExpr, evalTtlIntExprAt, evalTtlLiteralIntCondition } from '../src/ttl/ttlExpression'
import { evaluateTTL } from '../src/ttl/evaluator'
import { createMockDialogAdapter, runDryRun } from '../src/ttl/dryRun'
import { evalGuaranteedLiteralCondition } from '../src/ttl/controlFlow'

let passed = 0
let failed = 0

function assert(cond: boolean, label: string, detail?: unknown): void {
  if (cond) {
    console.log(`  OK  ${label}`)
    passed++
  } else {
    console.log(`  NG  ${label}`, detail ?? '')
    failed++
  }
}

function evalLine(src: string, vars: Record<string, number> = {}): number | undefined {
  const tokens = tokenizeLine(src, 1)
  return evalTtlIntExpr(tokens, 0, {
    resolveInt(name) {
      const v = vars[name.toLowerCase()]
      return v
    },
  })
}

console.log('=== expressions.html: official examples ===')
{
  assert(evalLine('1 + 1') === 2, '1 + 1')
  assert(evalLine('4 - 2 * 3') === -2, '4 - 2 * 3 => -2')
  assert(evalLine('15 % 10') === 5, '15 % 10 => 5')
  assert(evalLine('3 * (A + 2)', { a: 5 }) === 21, '3 * (A + 2)')
  assert(evalLine('A and not B', { a: 0xff, b: 0x0f }) === 0xf0, 'A and not B (bitwise)')
  assert(evalLine('A <= B', { a: 1, b: 2 }) === 1, 'A <= B true => 1')
  assert(evalLine('A <= B', { a: 3, b: 2 }) === 0, 'A <= B false => 0')
}

console.log('\n=== operators & precedence ===')
{
  assert(evalLine('2 * 3 + 4') === 10, '2 * 3 + 4')
  assert(evalLine('(1 + 2) * 3') === 9, '(1 + 2) * 3')
  assert(evalLine('8 / 3') === 2, 'integer division')
  assert(evalLine('1 = 1') === 1, 'relational =')
  assert(evalLine('1 == 1') === 1, 'relational ==')
  assert(evalLine('1 <> 2') === 1, 'relational <>')
  assert(evalLine('1 != 2') === 1, 'relational !=')
  assert(evalLine('1 && 0') === 0, 'logical &&')
  assert(evalLine('0 || 2') === 1, 'logical ||')
  assert(evalLine('5 & 3') === 1, 'bitwise &')
  assert(evalLine('5 | 2') === 7, 'bitwise |')
  assert(evalLine('5 xor 1') === 4, 'bitwise xor word')
  assert(evalLine('5 ^ 1') === 4, 'bitwise ^')
  assert(evalLine('~0') === -1, 'bitwise ~')
  assert(evalLine('!0') === 1, 'logical !')
  assert(evalLine('!3') === 0, 'logical ! nonzero')
  assert(evalLine('not 0') === -1, 'not is bitwise (~0)')
  assert(evalLine('1 << 3') === 8, '<<')
  assert(evalLine('16 >> 2') === 4, '>>')
  assert(evalLine('-1 >>> 1') === 0x7fffffff, '>>> logical shift')
  assert(evalLine('1 = 1 && 0 = 0') === 1, '1=1 && 0=0 (&& lower than =)')
  // and は = より高優先: A = 1 and B → A = (1 and B)
  assert(evalLine('A = 1 and B', { a: 1, b: 1 }) === 1, 'A = 1 and B => A = (1 and B)')
  assert(evalLine('A = 1 and B', { a: 0, b: 1 }) === 0, 'A = 1 and B when A=0')
}

console.log('\n=== tokenize new operators ===')
{
  const t = tokenizeLine('x = a && b || c >> 1', 1)
  const ops = t.filter((x) => x.kind === 'operator').map((x) => x.text)
  assert(ops.includes('&&') && ops.includes('||') && ops.includes('>>'), '&& || >> tokens', ops)
}

console.log('\n=== literal condition / analyzer ===')
{
  assert(evalTtlLiteralIntCondition(tokenizeLine('1 + 0 = 0', 1)) === false, '1+0=0 is false')
  assert(evalTtlLiteralIntCondition(tokenizeLine('1 + 0 = 1', 1)) === true, '1+0=1 is true')
  assert(evalGuaranteedLiteralCondition(tokenizeLine('1 + 0 = 0', 1)) === false, 'guaranteed false')
  assert(evalGuaranteedLiteralCondition(tokenizeLine('x = 1', 1)) === undefined, 'var condition unknown')
}

console.log('\n=== evaluator / dry-run ===')
{
  const ev = evaluateTTL(`x = 4 - 2 * 3\ny = 15 % 10\nz = 3 * (x + 2)\nsendln x\nsendln y\nsendln z\nend`)
  assert(ev.afterLine.get(1)?.get('x')?.kind === 'int' && (ev.afterLine.get(1)?.get('x') as { value: number }).value === -2, 'eval 4-2*3')
  assert(ev.afterLine.get(2)?.get('y')?.kind === 'int' && (ev.afterLine.get(2)?.get('y') as { value: number }).value === 5, 'eval 15%10')
  const z = ev.afterLine.get(3)?.get('z')
  assert(z?.kind === 'int' && z.value === 0, 'eval 3*(x+2) with x=-2', z)

  const neg = evaluateTTL(`n = -11\nsendln n\nend`)
  assert(neg.afterLine.get(1)?.get('n')?.kind === 'int' && (neg.afterLine.get(1)?.get('n') as { value: number }).value === -11, 'n = -11')

  const ifAnd = evaluateTTL(`a = 1\nb = 2\nif a = 1 && b = 2 then\nsend 'ok'\nendif\nend`)
  assert(ifAnd.sendEntries[0]?.payload === 'ok', 'if a=1 && b=2')

  const ifBit = evaluateTTL(`if 3 and 2 then\nsend 'bit'\nendif\nend`)
  assert(ifBit.sendEntries[0]?.payload === 'bit', 'if 3 and 2 (bitwise 2 → true)')

  const ifBitZero = evaluateTTL(`if 1 and 2 then\nsend 'no'\nendif\nsend 'after'\nend`)
  assert(
    ifBitZero.sendEntries.length === 1 && ifBitZero.sendEntries[0]?.payload === 'after',
    'if 1 and 2 is false (bitwise 0)',
  )
}

{
  const state = await runDryRun({
    source: `x = 4 - 2 * 3\nif x = -2 then\nsend 'yes'\nendif\nend`,
    dialogAdapter: createMockDialogAdapter([]),
  })
  const sends = state.events.filter((e) => e.kind === 'send').map((e) => e.payload)
  assert(sends[0] === 'yes', 'dry-run precedence in if', sends)
}

{
  const partial = evalTtlIntExprAt(tokenizeLine('1+2 then', 1), 0, { resolveInt: () => undefined })
  assert(partial?.value === 3 && partial.next === 3, 'stops before non-expr token', partial)
}

console.log('\n=== Bugbot fixes: signed int / array cond / string truthiness ===')
{
  const neg = evaluateTTL(`n = -11\nif n = -11 then\nsend 'neg'\nendif\nend`)
  assert(neg.sendEntries[0]?.payload === 'neg', 'n=-11 assignment and compare')

  const arr = evaluateTTL(
    `intdim a 1\na[0] = 5\nif a[0] = 5 then\nsend 'arr'\nendif\nend`,
  )
  assert(arr.sendEntries[0]?.payload === 'arr', 'if arr[0]=5')

  const strTrue = evaluateTTL(`s = 'hi'\nif s then\nsend 'str'\nendif\nend`)
  assert(strTrue.sendEntries[0]?.payload === 'str', 'non-empty string is true')

  const strFalse = evaluateTTL(`s = ''\nif s then\nsend 'no'\nendif\nsend 'ok'\nend`)
  assert(
    strFalse.sendEntries.length === 1 && strFalse.sendEntries[0]?.payload === 'ok',
    'empty string is false',
  )

  const litStr = evaluateTTL(`if 'x' then\nsend 'lit'\nendif\nend`)
  assert(litStr.sendEntries[0]?.payload === 'lit', 'non-empty string literal is true')
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
