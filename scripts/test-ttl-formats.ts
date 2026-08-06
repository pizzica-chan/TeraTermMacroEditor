import {
  parseTtlCharCodeLiteral,
  parseTtlIntegerLiteral,
  tokenizeLine,
} from '../src/ttl/tokenize'
import { evaluateTTL } from '../src/ttl/evaluator'
import { createMockDialogAdapter, runDryRun } from '../src/ttl/dryRun'
import { resolveStaticControlPart, resolveStaticGroupedString, resolveStaticLiteralPart } from '../src/ttl/argOperands'

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

console.log('=== formats.html: tokenize ===')
{
  // https://teratermproject.github.io/manual/5/en/macro/syntax/formats.html
  const hex = tokenizeLine('x = $3a', 1)
  assert(hex.some((t) => t.kind === 'number' && t.text === '$3a'), '$3a is one number token', hex)

  const hex2 = tokenizeLine('x = $10F', 1)
  assert(hex2.some((t) => t.kind === 'number' && t.text === '$10F'), '$10F is one number token', hex2)

  const neg = tokenizeLine('x = -11', 1)
  assert(
    neg.map((t) => `${t.kind}:${t.text}`).join(' ') ===
      'identifier:x operator:= operator:- number:11',
    '-11 is unary minus + number (expressions / GetNumber)',
    neg,
  )

  const floatish = tokenizeLine('x = 1.5', 1)
  assert(
    floatish.map((t) => `${t.kind}:${t.text}`).join(' ') === 'identifier:x operator:= number:1 other:. number:5',
    '1.5 is not a float number token',
    floatish,
  )

  const charHex = tokenizeLine("s = 'a'#$41", 1)
  assert(
    charHex.some((t) => t.kind === 'number' && t.text === '$41'),
    '#$41 has $41 number token',
    charHex,
  )
}

console.log('\n=== formats.html: parse helpers ===')
{
  assert(parseTtlIntegerLiteral('123') === 123, 'decimal')
  assert(parseTtlIntegerLiteral('-11') === -11, 'negative decimal')
  assert(parseTtlIntegerLiteral('$3a') === 0x3a, '$3a')
  assert(parseTtlIntegerLiteral('$10F') === 0x10f, '$10F')
  assert(parseTtlIntegerLiteral('$ffffffff') === -1, '$ffffffff as signed 32-bit')
  assert(parseTtlCharCodeLiteral('65') === 65, '#65 code')
  assert(parseTtlCharCodeLiteral('$41') === 0x41, '#$41 code')
  assert(parseTtlCharCodeLiteral('0') === undefined, 'NUL #0 rejected')
}

console.log('\n=== formats.html: grouped string ===')
{
  const tokens = tokenizeLine("s = 'abc'#$0d#$0a'def'", 1)
  // skip "s =" → start at string 'abc'
  const start = tokens.findIndex((t) => t.kind === 'string')
  const value = resolveStaticGroupedString(tokens, start, (tok, i) => {
    const ctrl = resolveStaticControlPart(tokens, i)
    if (ctrl !== undefined) return ctrl
    return resolveStaticLiteralPart(tok)
  })
  assert(
    value === `abc${String.fromCharCode(0x0d)}${String.fromCharCode(0x0a)}def`,
    "official 'abc'#$0d#$0a'def'",
    value,
  )
}

console.log('\n=== formats.html: evaluator / dry-run ===')
{
  const ev = evaluateTTL(`a = $3a\nb = #$41\nc = 'x'#$0d'y'\nsendln a\nsendln b\nsendln c\nend`)
  const a = ev.afterLine.get(1)?.get('a')
  const b = ev.afterLine.get(2)?.get('b')
  const c = ev.afterLine.get(3)?.get('c')
  assert(a?.kind === 'int' && a.value === 0x3a, 'evaluator $3a', a)
  assert(b?.kind === 'str' && b.value === 'A', 'evaluator #$41 → A', b)
  assert(c?.kind === 'str' && c.value === `x${String.fromCharCode(0x0d)}y`, 'evaluator #$0d join', c)

  const state = await runDryRun({
    source: `a = $10F\nsendln a\nsendln #$41\nend`,
    dialogAdapter: createMockDialogAdapter([]),
  })
  const sends = state.events.filter((e) => e.kind === 'send').map((e) => e.payload)
  assert(sends[0] === String(0x10f), 'dry-run $10F send', sends)
  assert(sends[1] === 'A', 'dry-run #$41 send', sends)
}

console.log('\n=== #0 / #$0 stops like send (no empty-string continue) ===')
{
  const ev = evaluateTTL(`send 'ab'#0'cd'\nend`)
  assert(ev.sendEntries[0]?.payload === 'ab', 'evaluator send stops before #0', ev.sendEntries)

  const state = await runDryRun({
    source: `messagebox 'ab'#0'cd' 't'\nend`,
    dialogAdapter: createMockDialogAdapter([{ type: 'message' }]),
  })
  const dialog = state.events.find((e) => e.kind === 'dialog' && e.command === 'messagebox')
  assert(dialog?.detail === 'ab', 'dry-run messagebox truncates at #0 like send', dialog)

  const stateHex = await runDryRun({
    source: `messagebox 'xy'#$0'z' 't'\nend`,
    dialogAdapter: createMockDialogAdapter([{ type: 'message' }]),
  })
  const dialogHex = stateHex.events.find((e) => e.kind === 'dialog' && e.command === 'messagebox')
  assert(dialogHex?.detail === 'xy', 'dry-run messagebox truncates at #$0 like send', dialogHex)
}

console.log(`\n=== FORMATS RESULT: ${passed} passed, ${failed} failed ===`)
process.exit(failed > 0 ? 1 : 0)
