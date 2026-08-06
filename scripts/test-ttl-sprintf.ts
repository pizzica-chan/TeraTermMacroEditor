import { formatTtlSprintf } from '../src/ttl/ttlSprintf'
import { tryStaticSprintfCommand, type StaticValueContext } from '../src/ttl/staticCommandEval'
import { resolveStaticControlPart, resolveStaticGroupedString, resolveStaticLiteralPart } from '../src/ttl/argOperands'
import { tokenizeLine, unquoteString, type Token } from '../src/ttl/tokenize'
import { createMockDialogAdapter, runDryRun } from '../src/ttl/dryRun'
import { evaluateTTL } from '../src/ttl/evaluator'

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

function ctxFromLine(line: string, ints: Record<string, number> = {}, strs: Record<string, string> = {}): {
  tokens: Token[]
  ctx: StaticValueContext
} {
  const tokens = tokenizeLine(line, 1)
  const ctx: StaticValueContext = {
    tokenAt(rel) {
      return tokens[rel]
    },
    resolveString(rel) {
      const tok = tokens[rel]
      if (!tok) return undefined
      if (tok.kind === 'string') return unquoteString(tok.text)
      if (tok.kind === 'identifier') return strs[tok.text.toLowerCase()]
      return undefined
    },
    resolveInt(rel) {
      const tok = tokens[rel]
      if (!tok) return undefined
      if (tok.kind === 'number') return Number(tok.text)
      if (tok.kind === 'identifier') return ints[tok.text.toLowerCase()]
      return undefined
    },
    resolveInPlaceVar() {
      return undefined
    },
    resolveGroupedString(rel) {
      return resolveStaticGroupedString(tokens, rel, (tok, i) => {
        const ctrl = resolveStaticControlPart(tokens, i)
        if (ctrl !== undefined) return ctrl
        const lit = resolveStaticLiteralPart(tok)
        if (lit !== undefined) return lit
        if (tok.kind === 'identifier') return strs[tok.text.toLowerCase()]
        return undefined
      })
    },
  }
  return { tokens, ctx }
}

console.log('=== formatTtlSprintf (公式例) ===')
{
  const a = formatTtlSprintf('Tera Term 4.%d', [{ kind: 'int', value: 51 }])
  assert(a.result === 0 && a.value === 'Tera Term 4.51', 'Tera Term 4.%d', a)

  const b = formatTtlSprintf('Windows %d (+%s)', [
    { kind: 'int', value: 2000 },
    { kind: 'str', value: 'SP4' },
  ])
  assert(b.result === 0 && b.value === 'Windows 2000 (+SP4)', 'Windows %d (+%s)', b)

  const c = formatTtlSprintf('%s=%d %s=0x%x', [
    { kind: 'str', value: 'dec' },
    { kind: 'int', value: 10 },
    { kind: 'str', value: 'hex' },
    { kind: 'int', value: 33 },
  ])
  assert(c.result === 0 && c.value === 'dec=10 hex=0x21', '%s=%d %s=0x%x', c)

  const d = formatTtlSprintf('pi=%f', [{ kind: 'str', value: '3.14159' }])
  assert(d.result === 0 && d.value.startsWith('pi=3.14159'), 'pi=%f', d)

  assert(formatTtlSprintf('', []).result === 1, 'empty format → result 1')
  assert(formatTtlSprintf('%z', [{ kind: 'int', value: 1 }]).result === 2, 'invalid type → result 2')
  assert(formatTtlSprintf('%d', []).result === 3, 'missing arg → result 3')
  assert(formatTtlSprintf('100%%', []).result === 0 && formatTtlSprintf('100%%', []).value === '100%', '%%')
}

console.log('\n=== tryStaticSprintfCommand ===')
{
  const { ctx } = ctxFromLine(`sprintf2 ver 'Tera Term 4.%d' 51`)
  const r = tryStaticSprintfCommand('sprintf2', 0, ctx)
  assert(r?.result === 0 && r.value === 'Tera Term 4.51', 'static sprintf2', r)

  const { ctx: ctx2 } = ctxFromLine(`sprintf 'hi %s' 'there'`)
  const r2 = tryStaticSprintfCommand('sprintf', 0, ctx2)
  assert(r2?.result === 0 && r2.value === 'hi there' && r2.destIndex === undefined, 'static sprintf→inputstr', r2)

  const { ctx: ctx3 } = ctxFromLine(`sprintf2 out '%d' n`, { n: 7 })
  const r3 = tryStaticSprintfCommand('sprintf2', 0, ctx3)
  assert(r3?.result === 0 && r3.value === '7', 'static sprintf2 int var', r3)

  const { ctx: ctx4 } = ctxFromLine(`sprintf2 out '%d' unknown`)
  const r4 = tryStaticSprintfCommand('sprintf2', 0, ctx4)
  assert(r4 === undefined, 'unresolved arg stays undefined', r4)

  // FORMAT が隣接連結: #13 越しの '%d' を引数と誤認しない
  const { ctx: ctx5 } = ctxFromLine(`sprintf2 out 'n='#13'%d' 7`)
  const r5 = tryStaticSprintfCommand('sprintf2', 0, ctx5)
  assert(
    r5?.result === 0 && r5.value === `n=${String.fromCharCode(13)}7`,
    'grouped FORMAT with #13 and %d',
    r5,
  )

  // 空白区切りなら FORMAT は先頭リテラルのみ（TTL の引数区切りどおり）
  const { ctx: ctx6 } = ctxFromLine(`sprintf2 out 'n=' '%d' 7`)
  const r6 = tryStaticSprintfCommand('sprintf2', 0, ctx6)
  assert(r6?.result === 0 && r6.value === 'n=', 'space-separated FORMAT is first string only', r6)

  // 不正な宛先は引数未解決でも result=4
  const { ctx: ctx7 } = ctxFromLine(`sprintf2 123 '%d' unknown`)
  const r7 = tryStaticSprintfCommand('sprintf2', 0, ctx7)
  assert(r7?.result === 4 && r7.destIndex === undefined, 'invalid dest → result 4 even if args unresolved', r7)

  const stateGrouped = await runDryRun({
    source: `sprintf2 out 'n='#13'%d' 7\nsendln out\nend`,
    dialogAdapter: createMockDialogAdapter([]),
  })
  assert(
    stateGrouped.events.filter((e) => e.kind === 'send')[0]?.payload === `n=${String.fromCharCode(13)}7`,
    'dry-run grouped FORMAT',
    stateGrouped.events,
  )
}

console.log('\n=== dry-run sprintf2 ===')
{
  const state = await runDryRun({
    source: `sprintf2 ver 'Tera Term 4.%d' 51
sprintf2 win 'Windows %d (+%s)' 2000 'SP4'
sprintf2 test '%s=%d %s=0x%x' 'dec' 10 'hex' 33
sendln ver
sendln win
sendln test
if result=0
sendln 'ok'
endif
end`,
    dialogAdapter: createMockDialogAdapter([]),
  })
  const sends = state.events.filter((e) => e.kind === 'send').map((e) => e.payload)
  assert(sends[0] === 'Tera Term 4.51', 'dry-run ver', sends)
  assert(sends[1] === 'Windows 2000 (+SP4)', 'dry-run win', sends)
  assert(sends[2] === 'dec=10 hex=0x21', 'dry-run test', sends)
  assert(sends[3] === 'ok', 'dry-run result=0', sends)
}

console.log('\n=== evaluator sprintf2 ===')
{
  const ev = evaluateTTL(`sprintf2 ver 'Tera Term 4.%d' 51\nend`)
  const ver = ev.afterLine.get(1)?.get('ver')
  assert(ver?.kind === 'str' && ver.value === 'Tera Term 4.51', 'evaluator sprintf2 value', ver)
  const result = ev.afterLine.get(1)?.get('result')
  assert(result?.kind === 'int' && result.value === 0, 'evaluator sprintf2 result', result)
}

console.log('\n=== failure does not update dest ===')
{
  const ev = evaluateTTL(`sprintf2 out 'keep'\nsprintf2 out '%z' 1\nend`)
  const out = ev.afterLine.get(2)?.get('out')
  const result = ev.afterLine.get(2)?.get('result')
  assert(out?.kind === 'str' && out.value === 'keep', 'evaluator keeps dest on invalid format', out)
  assert(result?.kind === 'int' && result.value === 2, 'evaluator sets result=2 on invalid format', result)

  const state = await runDryRun({
    source: `sprintf2 out 'keep'\nsprintf2 out '%z' 1\nsendln out\nend`,
    dialogAdapter: createMockDialogAdapter([]),
  })
  const send = state.events.filter((e) => e.kind === 'send')[0]
  assert(send?.payload === 'keep', 'dry-run keeps dest on invalid format', send)
  const evResult = evaluateTTL(`sprintf2 out '%d'\nend`).afterLine.get(1)?.get('result')
  assert(evResult?.kind === 'int' && evResult.value === 3, 'evaluator result=3 on missing arg', evResult)
}

console.log(`\n=== SPRINTF RESULT: ${passed} passed, ${failed} failed ===`)
process.exit(failed > 0 ? 1 : 0)
