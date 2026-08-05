import { findIncludeRefs } from '../src/ttl/includeRefs'

let passed = 0
let failed = 0

function check(name: string, cond: boolean, detail?: string): void {
  if (cond) {
    passed++
    console.log(`  OK  ${name}`)
  } else {
    failed++
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

const src = `bbb = ''
include bbb

kaisuu = 10
for i 0 kaisuu
  include host[i]
  sendln host[i]
next`

const refs = findIncludeRefs(src)

check('include refs count', refs.length === 2, `got ${refs.length}`)

const staticRef = refs.find((r) => r.raw === 'bbb')
check('static include raw is bbb', staticRef !== undefined)
check('static include has no loopContext', staticRef?.loopContext === undefined)
check('static include line is 2', staticRef?.line === 2)

const loopRef = refs.find((r) => r.raw === 'host[i]')
check('loop include raw is host[i]', loopRef !== undefined)
check('loop include has loopContext', loopRef?.loopContext !== undefined)
check(
  'loop include values 0-10 (11 vals)',
  loopRef?.loopContext?.values.length === 11 &&
    loopRef.loopContext.start === 0 &&
    loopRef.loopContext.end === 10,
  loopRef?.loopContext
    ? `${loopRef.loopContext.values.length} vals ${loopRef.loopContext.start}-${loopRef.loopContext.end}`
    : 'missing',
)
check('loop include line is 6', loopRef?.line === 6)

console.log(`\n=== INCLUDE REFS: ${passed} passed, ${failed} failed ===`)
if (failed > 0) process.exit(1)
