import { analyzeTTL } from '../src/ttl/analyzer'
import { findAssignmentIndex, isAssignmentLine, checkCommandArgs } from '../src/ttl/argChecker'
import { tokenizeLine } from '../src/ttl/tokenize'

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

console.log('=== findAssignmentIndex / isAssignmentLine: do/loop conditions ===')
{
  const loopWhile = tokenizeLine('loop while loopflg=1', 1)
  assert(findAssignmentIndex(loopWhile) === -1, 'loop while loopflg=1 is not assignment')
  assert(isAssignmentLine(loopWhile) === false, 'isAssignmentLine(loop while loopflg=1) === false')

  const doWhile = tokenizeLine('do while x=1', 1)
  assert(findAssignmentIndex(doWhile) === -1, 'do while x=1 is not assignment')
  assert(isAssignmentLine(doWhile) === false, 'isAssignmentLine(do while x=1) === false')

  const doUntil = tokenizeLine('do until done=1', 1)
  assert(findAssignmentIndex(doUntil) === -1, 'do until done=1 is not assignment')

  const loopUntil = tokenizeLine('loop until x=1', 1)
  assert(findAssignmentIndex(loopUntil) === -1, 'loop until x=1 is not assignment')
  assert(isAssignmentLine(loopUntil) === false, 'isAssignmentLine(loop until x=1) === false')

  const whileLine = tokenizeLine('while x=1', 1)
  assert(findAssignmentIndex(whileLine) === -1, 'while x=1 is not assignment')

  const assign = tokenizeLine('loopflg=1', 1)
  assert(findAssignmentIndex(assign) === 1, 'loopflg=1 is assignment', findAssignmentIndex(assign))
  assert(isAssignmentLine(assign) === true, 'isAssignmentLine(loopflg=1) === true')

  const spaced = tokenizeLine('loop while x = 1', 1)
  assert(findAssignmentIndex(spaced) === -1, 'loop while x = 1 (spaces) is not assignment')
  assert(isAssignmentLine(spaced) === false, 'isAssignmentLine(loop while x = 1) === false')

  const bareDo = tokenizeLine('do', 1)
  assert(findAssignmentIndex(bareDo) === -1, 'bare do is not assignment')
  assert(isAssignmentLine(bareDo) === false, 'isAssignmentLine(do) === false')

  const bareLoop = tokenizeLine('loop', 1)
  assert(findAssignmentIndex(bareLoop) === -1, 'bare loop is not assignment')
  assert(isAssignmentLine(bareLoop) === false, 'isAssignmentLine(loop) === false')

  const labeled = tokenizeLine(':retry loop while x=1', 1)
  // tokenizeLine: label 'retry' then identifiers...
  assert(labeled[0]?.kind === 'label', 'labeled line starts with label', labeled[0])
  assert(findAssignmentIndex(labeled, 1) === -1, 'labeled loop while x=1 is not assignment')
  assert(isAssignmentLine(labeled) === false, 'isAssignmentLine(:retry loop while x=1) === false')
}

console.log('\n=== checkCommandArgs: loop while loopflg=1 ===')
{
  const tokens = tokenizeLine('loop while loopflg=1', 1)
  const diags = checkCommandArgs('loop', tokens, 1, 0)
  assert(diags.length === 0, 'loop while loopflg=1 has no arg diagnostics', diags)
}

console.log('\n=== unused var: loop while uses loopflg ===')
{
  const src = `offset = 0
loopflg=1
do
    clipb2var buff offset
    if buff > 0 send buff
    offset = offset + 1
loop while loopflg=1
`
  const r = analyzeTTL(src)
  const unused = r.diagnostics.filter((d) => d.message.includes('使用されていません'))
  assert(
    !unused.some((d) => d.message.includes('loopflg')),
    'loopflg in loop while is used',
    unused,
  )
  const loopflg = r.variables.find((v) => v.name.toLowerCase() === 'loopflg')
  assert(loopflg?.isUsed === true, 'loopflg.isUsed', loopflg)
}

console.log('\n=== unused var: do while x=1 ===')
{
  const src = `x = 1
do while x=1
  x = 0
loop
`
  const r = analyzeTTL(src)
  const unused = r.diagnostics.filter((d) => d.message.includes('使用されていません'))
  assert(!unused.some((d) => d.message.includes("'x'")), 'x in do while is used', unused)
  const x = r.variables.find((v) => v.name.toLowerCase() === 'x')
  assert(x?.isUsed === true, 'x.isUsed after do while', x)
}

console.log('\n=== unused var: loop until done=1 ===')
{
  const src = `done = 0
do
  done = 1
loop until done=1
`
  const r = analyzeTTL(src)
  const unused = r.diagnostics.filter((d) => d.message.includes('使用されていません'))
  assert(!unused.some((d) => d.message.includes('done')), 'done in loop until is used', unused)
  const done = r.variables.find((v) => v.name.toLowerCase() === 'done')
  assert(done?.isUsed === true, 'done.isUsed after loop until', done)
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
