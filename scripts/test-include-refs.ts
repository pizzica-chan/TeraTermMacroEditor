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

const negForSrc = `for i -1 1
  include host[i]
next`
const negRefs = findIncludeRefs(negForSrc)
const negLoop = negRefs.find((r) => r.raw === 'host[i]')
check(
  'for i -1 1 expands values',
  negLoop?.loopContext?.values.join(',') === '-1,0,1',
  `got ${negLoop?.loopContext?.values.join(',')}`,
)

const negConstSrc = `n = -2
for i n 0
  include host[i]
next`
const negConstRefs = findIncludeRefs(negConstSrc)
const negConstLoop = negConstRefs.find((r) => r.raw === 'host[i]')
check(
  'n=-2 feeds for start',
  negConstLoop?.loopContext?.start === -2 &&
    negConstLoop.loopContext.values.join(',') === '-2,-1,0',
  `got start=${negConstLoop?.loopContext?.start} vals=${negConstLoop?.loopContext?.values.join(',')}`,
)

console.log(`\n=== INCLUDE REFS: ${passed} passed, ${failed} failed ===`)
if (failed > 0) process.exit(1)
