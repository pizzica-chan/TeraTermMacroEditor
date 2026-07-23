import { buildDryRunPlainTextForCopy, createMockDialogAdapter, DryRunSession, isDryRunMainLocation, runDryRun, type DryRunDialogAdapter, type DryRunEvent, type DryRunEventKind } from '../src/ttl/dryRun'
import { SAMPLE_MACRO } from '../src/editor/createEditor'
import type { IncludeResolver } from '../src/ttl/analyzer'
import { includeLoopIterationBindingKey } from '../src/ttl/includeRefs'

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

function eventsOfKind(events: DryRunEvent[], kind: DryRunEventKind) {
  return events.filter((e) => e.kind === kind)
}

console.log('=== 1. send / sendln ===')
{
  const state = await runDryRun({
    source: `send 'hello'\nsendln 'world'\nend`,
    dialogAdapter: createMockDialogAdapter([]),
  })
  const sends = eventsOfKind(state.events, 'send')
  assert(sends.length === 2, 'two send events', sends)
  assert(sends[0]?.payload === 'hello', 'send payload', sends[0])
  assert(sends[1]?.payload === 'world' && sends[1]?.addsNewline === true, 'sendln newline', sends[1])
}

console.log('\n=== 2. wait / waitln log ===')
{
  const state = await runDryRun({
    source: `wait 'login:'\nwaitln '$'\nend`,
    dialogAdapter: createMockDialogAdapter([]),
  })
  const waits = eventsOfKind(state.events, 'receive-wait')
  assert(waits.length === 2, 'two wait events', waits)
  assert(waits[0]?.payload === 'login:', 'wait pattern', waits[0])
}

console.log('\n=== 3. yesnobox branch ===')
{
  const yesMacro = `yesnobox 'continue?' 'test'\nif result=1\nsend 'yes'\nelse\nsend 'no'\nendif\nend`
  const yesState = await runDryRun({
    source: yesMacro,
    dialogAdapter: createMockDialogAdapter([{ type: 'yesno', value: true }]),
  })
  const yesSends = eventsOfKind(yesState.events, 'send')
  assert(yesSends[0]?.payload === 'yes', 'yes branch', yesSends)

  const noState = await runDryRun({
    source: yesMacro,
    dialogAdapter: createMockDialogAdapter([{ type: 'yesno', value: false }]),
  })
  const noSends = eventsOfKind(noState.events, 'send')
  assert(noSends[0]?.payload === 'no', 'no branch', noSends)
}

console.log('\n=== 4. inputbox / passwordbox ===')
{
  const state = await runDryRun({
    source: `inputbox 'name?' 'input' 'guest'\nsend inputstr\nend`,
    dialogAdapter: createMockDialogAdapter([{ type: 'input', value: 'alice' }]),
  })
  const sends = eventsOfKind(state.events, 'send')
  assert(sends[0]?.payload === 'alice', 'inputstr used in send', sends)

  const pwState = await runDryRun({
    source: `passwordbox 'pw?' 'pw'\nend`,
    dialogAdapter: createMockDialogAdapter([{ type: 'input', value: 'secret' }]),
  })
  const dialog = eventsOfKind(pwState.events, 'dialog')[0]
  assert(dialog?.message.includes('入力済み'), 'password not logged in plain text', dialog)
  assert(!dialog?.message.includes('secret'), 'password hidden', dialog)

  const ctrlState = await runDryRun({
    source: `inputbox 'aaaaa'#13#10'bbbbb' ''\nend`,
    dialogAdapter: createMockDialogAdapter([{ type: 'input', value: 'x' }]),
  })
  const ctrlDialog = eventsOfKind(ctrlState.events, 'dialog')[0]
  const expectedMsg = 'aaaaa' + String.fromCharCode(13, 10) + 'bbbbb'
  assert(ctrlDialog?.detail === expectedMsg, 'inputbox message joins #13#10 literals', ctrlDialog?.detail)
}

console.log('\n=== 5. call / return / goto ===')
{
  const state = await runDryRun({
    source: `call sub\ngoto fin\n:sub\nsend 'sub'\nreturn\n:fin\nsend 'main'\nend`,
    dialogAdapter: createMockDialogAdapter([]),
  })
  const sends = eventsOfKind(state.events, 'send').map((e) => e.payload)
  assert(sends.join(',') === 'sub,main', 'call/return order', sends)
}

console.log('\n=== 6. stop ===')
{
  let steps = 0
  const session = new DryRunSession({
    source: `send 'a'\nsend 'b'\nsend 'c'\nend`,
    dialogAdapter: createMockDialogAdapter([]),
    async yieldEveryLine() {
      steps++
      if (steps >= 2) session.stop()
    },
  })
  const state = await session.run()
  assert(state.status === 'stopped', 'stopped status', state.status)
  assert(eventsOfKind(state.events, 'send').length < 3, 'stopped before all sends', state.events)
}

console.log('\n=== 7. connect flow log ===')
{
  const state = await runDryRun({
    source: `connect '192.168.0.1'\nend`,
    dialogAdapter: createMockDialogAdapter([]),
  })
  const flow = eventsOfKind(state.events, 'flow')
  assert(flow.some((e) => e.command === 'connect'), 'connect logged', flow)
}

console.log('\n=== 8. wait/connect with variables ===')
{
  const state = await runDryRun({
    source: `host = '10.0.0.1'\nprompt = 'login:'\nconnect host\nwait prompt\nend`,
    dialogAdapter: createMockDialogAdapter([]),
  })
  const flow = eventsOfKind(state.events, 'flow')[0]
  const wait = eventsOfKind(state.events, 'receive-wait')[0]
  assert(flow?.message.includes('10.0.0.1'), 'connect resolves variable host', flow)
  assert(wait?.payload === 'login:', 'wait resolves variable prompt', wait)
}

console.log('\n=== 9. while/break ===')
{
  const state = await runDryRun({
    source: `i = 0\nwhile 1\ni = i + 1\nif i=2\nbreak\nendif\nendwhile\nsend 'done'\nend`,
    dialogAdapter: createMockDialogAdapter([]),
  })
  const sends = eventsOfKind(state.events, 'send')
  assert(sends.length === 1 && sends[0]?.payload === 'done', 'while break exits loop', sends)
}

console.log('\n=== 10. until loop ===')
{
  const state = await runDryRun({
    source: `i = 0\nuntil i=2\ni = i + 1\nenduntil\nsend 'ok'\nend`,
    dialogAdapter: createMockDialogAdapter([]),
  })
  const sends = eventsOfKind(state.events, 'send')
  assert(sends[0]?.payload === 'ok', 'until loop completes', sends)
}

console.log('\n=== 11. same-line label command ===')
{
  const state = await runDryRun({
    source: `goto :sub\n:sub send 'hit'\nend`,
    dialogAdapter: createMockDialogAdapter([]),
  })
  const sends = eventsOfKind(state.events, 'send')
  assert(sends[0]?.payload === 'hit', 'same-line label send runs', sends)
}

console.log('\n=== 12. while 1 (constant true) ===')
{
  const state = await runDryRun({
    source: `while 1\nsend 'loop'\nbreak\nendwhile\nsend 'after'\nend`,
    dialogAdapter: createMockDialogAdapter([]),
  })
  const sends = eventsOfKind(state.events, 'send').map((e) => e.payload)
  assert(sends.join(',') === 'loop,after', 'while 1 runs body until break', sends)
}

console.log('\n=== 13. SAMPLE_MACRO login flow ===')
{
  const state = await runDryRun({
    source: SAMPLE_MACRO,
    dialogAdapter: createMockDialogAdapter([{ type: 'message' }]),
  })
  const sends = eventsOfKind(state.events, 'send')
  const waits = eventsOfKind(state.events, 'receive-wait')
  assert(state.status === 'finished', 'sample macro finishes', state.status)
  assert(sends.length === 2, 'sample sends username and password', sends.length)
  assert(sends[0]?.payload === 'admin' && sends[0]?.addsNewline === true, 'sendln username', sends[0])
  assert(sends[1]?.payload === 'secret' && sends[1]?.addsNewline === true, 'sendln password', sends[1])
  assert(waits.length === 3, 'sample has 3 wait commands', waits.length)
  assert(eventsOfKind(state.events, 'dialog').length === 1, 'sample shows messagebox', state.events)
}

console.log('\n=== 14. messagebox continues macro ===')
{
  const dismissAdapter: DryRunDialogAdapter = {
    ...createMockDialogAdapter([{ type: 'message' }]),
    async message() {
      return false
    },
    cancel() {},
  }
  const state = await runDryRun({
    source: `send 'before'\nmessagebox 'ok' 'title'\nsend 'after'\nend`,
    dialogAdapter: dismissAdapter,
  })
  const sends = eventsOfKind(state.events, 'send').map((e) => e.payload)
  assert(state.status === 'finished', 'messagebox dismiss finishes macro', state.status)
  assert(sends.join(',') === 'before,after', 'macro continues after messagebox', sends)
}

console.log('\n=== 15. for/continue ===')
{
  const state = await runDryRun({
    source: `for i 1 3\nif i=2\ncontinue\nendif\nsend 'x'\nnext\nend`,
    dialogAdapter: createMockDialogAdapter([]),
  })
  const sends = eventsOfKind(state.events, 'send').map((e) => e.payload)
  assert(sends.join(',') === 'x,x', 'for continue skips iteration 2', sends)
}

console.log('\n=== 16. while/continue in if ===')
{
  const state = await runDryRun({
    source: `i = 0\nwhile i < 3\ni = i + 1\nif i=2\ncontinue\nendif\nsend 'x'\nendwhile\nend`,
    dialogAdapter: createMockDialogAdapter([]),
  })
  const sends = eventsOfKind(state.events, 'send').map((e) => e.payload)
  assert(sends.join(',') === 'x,x', 'while continue in if skips iteration 2', sends)
}

console.log('\n=== 17. exit inside while stops macro ===')
{
  const state = await runDryRun({
    source: `while 1\nsend 'in'\nexit\nsend 'never'\nendwhile\nsend 'after'\nend`,
    dialogAdapter: createMockDialogAdapter([]),
  })
  const sends = eventsOfKind(state.events, 'send').map((e) => e.payload)
  assert(sends.join(',') === 'in', 'exit inside while stops entire macro', sends)
  assert(state.status === 'finished', 'macro finished after exit', state.status)
}

console.log('\n=== 18. i = i + 1 assignment ===')
{
  const state = await runDryRun({
    source: `i = 0\ni = i + 1\nsend 'v'\nend`,
    dialogAdapter: createMockDialogAdapter([]),
  })
  const sends = eventsOfKind(state.events, 'send')
  assert(sends.length === 1, 'assignment expression runs', sends)
  // i=2 check via until
  const state2 = await runDryRun({
    source: `i = 0\nuntil i=2\ni = i + 1\nenduntil\nend`,
    dialogAdapter: createMockDialogAdapter([]),
  })
  assert(state2.status === 'finished', 'increment until condition', state2.status)
}

console.log('\n=== 19. if then goto (single line) ===')
{
  const state = await runDryRun({
    source: `if 1 then goto fin\nsend 'skip'\nend\n:fin\nsend 'ok'\nend`,
    dialogAdapter: createMockDialogAdapter([]),
  })
  const sends = eventsOfKind(state.events, 'send').map((e) => e.payload)
  assert(sends.join(',') === 'ok', 'if then goto skips fallthrough', sends)
}

console.log('\n=== 20. continue in do loop errors ===')
{
  const state = await runDryRun({
    source: `do\ncontinue\nloop\nend`,
    dialogAdapter: createMockDialogAdapter([]),
  })
  const errors = eventsOfKind(state.events, 'error')
  assert(errors.length === 1, 'continue in do loop is invalid', errors)
}

console.log('\n=== 21. break outside loop ===')
{
  const state = await runDryRun({
    source: `break\nsend 'x'\nend`,
    dialogAdapter: createMockDialogAdapter([]),
  })
  const sends = eventsOfKind(state.events, 'send')
  const errors = eventsOfKind(state.events, 'error')
  assert(errors.length === 1, 'break outside loop errors', errors)
  assert(sends.length === 0, 'no send after invalid break', sends)
}

console.log('\n=== 22. stop before line executes ===')
{
  let yields = 0
  const session = new DryRunSession({
    source: `send 'a'\nsend 'b'\nend`,
    dialogAdapter: createMockDialogAdapter([]),
    async yieldEveryLine() {
      yields++
      if (yields >= 2) session.stop()
    },
  })
  const state = await session.run()
  const sends = eventsOfKind(state.events, 'send')
  assert(state.status === 'stopped', 'stopped on yield', state.status)
  assert(sends.length === 1 && sends[0]?.payload === 'a', 'stop before second line runs', sends)
}

console.log('\n=== 23. end inside while stops macro ===')
{
  const state = await runDryRun({
    source: `while 1\nsend 'once'\nend\nsend 'never'\nendwhile\nend`,
    dialogAdapter: createMockDialogAdapter([]),
  })
  const sends = eventsOfKind(state.events, 'send').map((e) => e.payload)
  assert(sends.join(',') === 'once', 'end inside while stops macro', sends)
}

console.log('\n=== 24. listbox 0-based index and cancel ===')
{
  const adapter = createMockDialogAdapter([{ type: 'list', index: 1 }])
  const picked = await runDryRun({
    source: `listbox 'title' 'a' 'b' 'c'\nif result=1\nsend 'banana'\nendif\nend`,
    dialogAdapter: adapter,
  })
  const sends = eventsOfKind(picked.events, 'send')
  assert(sends[0]?.payload === 'banana', 'listbox result 1 selects second item (0-based)', sends)

  const cancelAdapter: DryRunDialogAdapter = {
    ...createMockDialogAdapter([]),
    async list() {
      return null
    },
    cancel() {},
  }
  const cancelled = await runDryRun({
    source: `listbox 'title' 'a'\nif result=-1\nsend 'cancelled'\nendif\nend`,
    dialogAdapter: cancelAdapter,
  })
  const cancelSends = eventsOfKind(cancelled.events, 'send')
  assert(cancelSends[0]?.payload === 'cancelled', 'listbox cancel sets result=-1', cancelSends)
}

console.log('\n=== 25. break in do loop errors ===')
{
  const state = await runDryRun({
    source: `while 1\ndo\nbreak\nloop\nsend 'escaped'\nendwhile\nend`,
    dialogAdapter: createMockDialogAdapter([]),
  })
  const errors = eventsOfKind(state.events, 'error')
  const sends = eventsOfKind(state.events, 'send')
  assert(errors.length === 1, 'break in do loop is invalid', errors)
  assert(sends.length === 0, 'no send after break in do', sends)
}

console.log('\n=== 26. filenamebox cancel continues ===')
{
  const adapter: DryRunDialogAdapter = {
    ...createMockDialogAdapter([]),
    async filename() {
      return { ok: false, path: '' }
    },
    cancel() {},
  }
  const state = await runDryRun({
    source: `filenamebox 'pick' '' ''\nif result=0\nsend 'cancelled'\nendif\nend`,
    dialogAdapter: adapter,
  })
  const sends = eventsOfKind(state.events, 'send')
  assert(state.status === 'finished', 'filenamebox cancel finishes macro', state.status)
  assert(sends[0]?.payload === 'cancelled', 'filenamebox cancel sets result=0', sends)
}

console.log('\n=== 27. stop then restart dry run ===')
{
  let runs = 0
  const session1 = new DryRunSession({
    source: `send 'first'\nend`,
    dialogAdapter: createMockDialogAdapter([]),
    async yieldEveryLine() {
      runs++
      if (runs === 1) session1.stop()
    },
  })
  await session1.run()
  const session2 = new DryRunSession({
    source: `send 'second'\nend`,
    dialogAdapter: createMockDialogAdapter([]),
  })
  const state2 = await session2.run()
  const sends = eventsOfKind(state2.events, 'send')
  assert(sends[0]?.payload === 'second', 'new session runs after prior stop', sends)
}

console.log('\n=== 28. if then break (single line) ===')
{
  const state = await runDryRun({
    source: `i = 0\nwhile 1\ni = i + 1\nif i=2 then break\nendwhile\nsend 'done'\nend`,
    dialogAdapter: createMockDialogAdapter([]),
  })
  const sends = eventsOfKind(state.events, 'send')
  assert(sends.length === 1 && sends[0]?.payload === 'done', 'if then break exits while', sends)
}

console.log('\n=== 29. return inside include resumes main ===')
{
  const subMacro = `send 'inc'\nreturn\nsend 'never'`
  const resolver: IncludeResolver = {
    resolve(path) {
      return path === 'sub.ttl' ? subMacro : null
    },
    resolveDynamic() {
      return null
    },
    getLinkedTabId() {
      return null
    },
    resolverForLinkedTab() {
      return null
    },
  }
  const state = await runDryRun({
    source: `include 'sub.ttl'\nsend 'main'\nend`,
    includeResolver: resolver,
    dialogAdapter: createMockDialogAdapter([]),
  })
  const sends = eventsOfKind(state.events, 'send').map((e) => e.payload)
  assert(sends.join(',') === 'inc,main', 'return in include resumes main', sends)
  assert(!sends.includes('never'), 'code after return in include not run', sends)
}

console.log('\n=== 30. return without call outside include errors ===')
{
  const state = await runDryRun({
    source: `return\nsend 'never'\nend`,
    dialogAdapter: createMockDialogAdapter([]),
  })
  const errors = eventsOfKind(state.events, 'error')
  const sends = eventsOfKind(state.events, 'send')
  assert(errors.some((e) => e.command === 'return'), 'return without call is error', errors)
  assert(sends.length === 0, 'macro stops after invalid return', sends)
}

console.log('\n=== 31. exit inside include resumes main ===')
{
  const subMacro = `send 'inc'\nexit\nsend 'never'`
  const resolver: IncludeResolver = {
    resolve(path) {
      return path === 'sub.ttl' ? subMacro : null
    },
    resolveDynamic() {
      return null
    },
    getLinkedTabId() {
      return null
    },
    resolverForLinkedTab() {
      return null
    },
  }
  const state = await runDryRun({
    source: `include 'sub.ttl'\nsend 'main'\nend`,
    includeResolver: resolver,
    dialogAdapter: createMockDialogAdapter([]),
  })
  const sends = eventsOfKind(state.events, 'send').map((e) => e.payload)
  assert(sends.join(',') === 'inc,main', 'exit in include resumes main', sends)
}

console.log('\n=== 32. end inside include stops entire macro ===')
{
  const subMacro = `send 'inc'\nend\nsend 'never'`
  const resolver: IncludeResolver = {
    resolve(path) {
      return path === 'sub.ttl' ? subMacro : null
    },
    resolveDynamic() {
      return null
    },
    getLinkedTabId() {
      return null
    },
    resolverForLinkedTab() {
      return null
    },
  }
  const state = await runDryRun({
    source: `include 'sub.ttl'\nsend 'after'\nend`,
    includeResolver: resolver,
    dialogAdapter: createMockDialogAdapter([]),
  })
  const sends = eventsOfKind(state.events, 'send').map((e) => e.payload)
  assert(sends.join(',') === 'inc', 'end in include stops macro before parent continues', sends)
}

console.log('\n=== 33. include natural end resumes main ===')
{
  const subMacro = `send 'inc'`
  const resolver: IncludeResolver = {
    resolve(path) {
      return path === 'sub.ttl' ? subMacro : null
    },
    resolveDynamic() {
      return null
    },
    getLinkedTabId() {
      return null
    },
    resolverForLinkedTab() {
      return null
    },
  }
  const state = await runDryRun({
    source: `include 'sub.ttl'\nsend 'main'\nend`,
    includeResolver: resolver,
    dialogAdapter: createMockDialogAdapter([]),
  })
  const sends = eventsOfKind(state.events, 'send').map((e) => e.payload)
  assert(sends.join(',') === 'inc,main', 'include file end returns to main', sends)
}

console.log('\n=== 34. variable sharing across include ===')
{
  const subMacro = `send msg`
  const resolver: IncludeResolver = {
    resolve(path) {
      return path === 'sub.ttl' ? subMacro : null
    },
    resolveDynamic() {
      return null
    },
    getLinkedTabId() {
      return null
    },
    resolverForLinkedTab() {
      return null
    },
  }
  const state = await runDryRun({
    source: `msg = 'shared'\ninclude 'sub.ttl'\nsend msg\nend`,
    includeResolver: resolver,
    dialogAdapter: createMockDialogAdapter([]),
  })
  const sends = eventsOfKind(state.events, 'send').map((e) => e.payload)
  assert(sends.join(',') === 'shared,shared', 'variables shared parent to include and back', sends)
}

console.log('\n=== 35. isDryRunMainLocation ===')
{
  assert(isDryRunMainLocation('L12'), 'main location L12')
  assert(!isDryRunMainLocation('sub.ttl:L3'), 'include location not main')
  assert(!isDryRunMainLocation(undefined), 'undefined not main')
}

console.log('\n=== 36. return inside if in include does not exit include ===')
{
  const subMacro = `if 1\nreturn\nendif\nsend 'in_after'`
  const resolver: IncludeResolver = {
    resolve(path) {
      return path === 'sub.ttl' ? subMacro : null
    },
    resolveDynamic() {
      return null
    },
    getLinkedTabId() {
      return null
    },
    resolverForLinkedTab() {
      return null
    },
  }
  const state = await runDryRun({
    source: `include 'sub.ttl'\nsend 'main'\nend`,
    includeResolver: resolver,
    dialogAdapter: createMockDialogAdapter([]),
  })
  const sends = eventsOfKind(state.events, 'send').map((e) => e.payload)
  assert(sends.join(',') === 'in_after,main', 'return in if block only exits if, not include', sends)
}

console.log('\n=== 37. nested include exit returns to intermediate parent ===')
{
  const inner = `send 'inner'\nexit`
  const middle = `include 'inner.ttl'\nsend 'middle'`
  const resolver: IncludeResolver = {
    resolve(path) {
      if (path === 'inner.ttl') return inner
      if (path === 'mid.ttl') return middle
      return null
    },
    resolveDynamic() {
      return null
    },
    getLinkedTabId() {
      return null
    },
    resolverForLinkedTab() {
      return null
    },
  }
  const state = await runDryRun({
    source: `include 'mid.ttl'\nsend 'main'\nend`,
    includeResolver: resolver,
    dialogAdapter: createMockDialogAdapter([]),
  })
  const sends = eventsOfKind(state.events, 'send').map((e) => e.payload)
  assert(sends.join(',') === 'inner,middle,main', 'exit in nested include resumes intermediate parent', sends)
}

console.log('\n=== 38. until runs body before condition ===')
{
  const state = await runDryRun({
    source: `until 1\nsend 'once'\nenduntil\nsend 'after'\nend`,
    dialogAdapter: createMockDialogAdapter([]),
  })
  const sends = eventsOfKind(state.events, 'send').map((e) => e.payload)
  assert(sends.join(',') === 'once,after', 'until executes body once before true condition', sends)
}

console.log('\n=== 39. until break exits loop ===')
{
  const state = await runDryRun({
    source: `i = 0\nuntil i=3\ni = i + 1\nif i=2 then break\nenduntil\nsend 'done'\nend`,
    dialogAdapter: createMockDialogAdapter([]),
  })
  const sends = eventsOfKind(state.events, 'send').map((e) => e.payload)
  assert(sends.join(',') === 'done', 'until break exits loop', sends)
}

console.log('\n=== 40. call/return inside include ===')
{
  const subMacro = `call step2\ngoto done\n:step2\nsend 'two'\nreturn\n:done\nsend 'done'`
  const resolver: IncludeResolver = {
    resolve(path) {
      return path === 'sub.ttl' ? subMacro : null
    },
    resolveDynamic() {
      return null
    },
    getLinkedTabId() {
      return null
    },
    resolverForLinkedTab() {
      return null
    },
  }
  const state = await runDryRun({
    source: `include 'sub.ttl'\nsend 'main'\nend`,
    includeResolver: resolver,
    dialogAdapter: createMockDialogAdapter([]),
  })
  const sends = eventsOfKind(state.events, 'send').map((e) => e.payload)
  assert(sends.join(',') === 'two,done,main', 'call/return in include completes before returning to main', sends)
}

console.log('\n=== 41. if type mismatch is false ===')
{
  const state = await runDryRun({
    source: `msg = 'hello'\nif msg = 1\nsend 'wrong'\nendif\nsend 'after'\nend`,
    dialogAdapter: createMockDialogAdapter([]),
  })
  const sends = eventsOfKind(state.events, 'send').map((e) => e.payload)
  assert(sends.join(',') === 'after', 'if with type mismatch does not run then branch', sends)
}

console.log('\n=== 42. messagebox cancel sets result=0 ===')
{
  const adapter: DryRunDialogAdapter = {
    ...createMockDialogAdapter([]),
    async message() {
      return false
    },
    cancel() {},
  }
  const state = await runDryRun({
    source: `messagebox 'test' 'title'\nif result=0\nsend 'cancelled'\nelse\nsend 'ok'\nendif\nend`,
    dialogAdapter: adapter,
  })
  const sends = eventsOfKind(state.events, 'send').map((e) => e.payload)
  assert(sends[0] === 'cancelled', 'messagebox cancel sets result=0', sends)
}

console.log('\n=== 43. exit inside while in include stays in include ===')
{
  const subMacro = `while 1\nsend 'loop'\nexit\nendwhile\nsend 'after_exit'`
  const resolver: IncludeResolver = {
    resolve(path) {
      return path === 'sub.ttl' ? subMacro : null
    },
    resolveDynamic() {
      return null
    },
    getLinkedTabId() {
      return null
    },
    resolverForLinkedTab() {
      return null
    },
  }
  const state = await runDryRun({
    source: `include 'sub.ttl'\nsend 'main'\nend`,
    includeResolver: resolver,
    dialogAdapter: createMockDialogAdapter([]),
  })
  const sends = eventsOfKind(state.events, 'send').map((e) => e.payload)
  assert(sends.join(',') === 'loop,after_exit,main', 'exit in while only exits loop inside include', sends)
}

console.log('\n=== 44. yesnobox cancel sets result=0 ===')
{
  const adapter: DryRunDialogAdapter = {
    ...createMockDialogAdapter([]),
    async yesno() {
      return null
    },
    cancel() {},
  }
  const state = await runDryRun({
    source: `yesnobox 'test' 'title'\nif result=0\nsend 'no'\nelse\nsend 'yes'\nendif\nend`,
    dialogAdapter: adapter,
  })
  const sends = eventsOfKind(state.events, 'send').map((e) => e.payload)
  assert(sends[0] === 'no', 'yesnobox cancel sets result=0', sends)
}

console.log('\n=== 45. gettime strconcat send shows runtime hint ===')
{
  const state = await runDryRun({
    source: `gettime t "%Y"\nstrconcat t 'x'\nsendln t\nend`,
    dialogAdapter: createMockDialogAdapter([]),
  })
  const sends = eventsOfKind(state.events, 'send')
  assert(sends[0]?.payload?.includes('実行時') === true, 'gettime hint in dry run send payload', sends[0]?.payload)
  assert(sends[0]?.detail?.includes('未解決') === true, 'gettime send marked unresolved', sends[0]?.detail)
}

console.log('\n=== 46. buildDryRunPlainTextForCopy ===')
{
  const state = await runDryRun({
    source: `send 'hello'\nsendln 'world'\nend`,
    dialogAdapter: createMockDialogAdapter([]),
  })
  const text = buildDryRunPlainTextForCopy(state)
  assert(text.includes('# 状態: 完了'), 'copy text has status header', text.split('\n')[0])
  assert(text.includes('[L1] send:'), 'copy text has send event', text)
  assert(text.includes('hello'), 'copy text has payload', text)
  assert(text.includes('world ↵'), 'copy text marks sendln newline', text)
}

console.log('\n=== 47. passwordbox send masked in copy ===')
{
  const state = await runDryRun({
    source: `passwordbox 'pw?' 'pw'\nsend inputstr\nend`,
    dialogAdapter: createMockDialogAdapter([{ type: 'input', value: 'secret' }]),
  })
  const sends = eventsOfKind(state.events, 'send')
  assert(sends[0]?.maskPayload === true, 'password send event masked', sends[0])
  const text = buildDryRunPlainTextForCopy(state)
  assert(!text.includes('secret'), 'copy text hides password payload', text)
  assert(text.includes('send: （入力済み）'), 'copy text shows masked send message', text)
}

console.log('\n=== 48. copy text available with empty events ===')
{
  const state = await runDryRun({
    source: `end`,
    dialogAdapter: createMockDialogAdapter([]),
  })
  const text = buildDryRunPlainTextForCopy(state)
  assert(text.includes('# 状態: 完了'), 'finished macro without events still has copy header', text)
}

console.log('\n=== 49. password via strconcat masked ===')
{
  const state = await runDryRun({
    source: `passwordbox 'pw?' 'pw'\nstrconcat buf inputstr\nsendln buf\nend`,
    dialogAdapter: createMockDialogAdapter([{ type: 'input', value: 'secret' }]),
  })
  const sends = eventsOfKind(state.events, 'send')
  assert(sends[0]?.maskPayload === true, 'strconcat send masked', sends[0])
  const text = buildDryRunPlainTextForCopy(state)
  assert(!text.includes('secret'), 'copy hides strconcat password', text)
}

console.log('\n=== 50. password send via InputStr identifier ===')
{
  const state = await runDryRun({
    source: `passwordbox 'pw?' 'pw'\nsend InputStr\nend`,
    dialogAdapter: createMockDialogAdapter([{ type: 'input', value: 'secret' }]),
  })
  const sends = eventsOfKind(state.events, 'send')
  assert(sends[0]?.maskPayload === true, 'mixed-case inputstr send masked', sends[0])
}

console.log('\n=== 51. wait multiple patterns ===')
{
  const state = await runDryRun({
    source: `prompt = 'login:'\nwait 'OK' 'ERROR'\nwait prompt 'done'\nend`,
    dialogAdapter: createMockDialogAdapter([]),
  })
  const waits = eventsOfKind(state.events, 'receive-wait')
  assert(waits[0]?.payload === undefined, 'multi pattern wait has no payload line', waits[0])
  assert(waits[0]?.message.includes('OK') && waits[0]?.message.includes('ERROR'), 'multi wait message lists patterns', waits[0]?.message)
  assert(waits[0]?.detail?.includes('result=1'), 'multi wait detail notes simulated result', waits[0]?.detail)
  assert(waits[1]?.message.includes('login:') && waits[1]?.message.includes('done'), 'mixed variable and literal patterns', waits[1]?.message)
  assert(waits[1]?.payload === undefined, 'second multi wait also omits payload', waits[1]?.payload)
}

console.log('\n=== 52. recvln without args keeps result=1 ===')
{
  const state = await runDryRun({
    source: `recvln\nif result=1\nsend 'matched'\nelse\nsend 'no'\nendif\nend`,
    dialogAdapter: createMockDialogAdapter([]),
  })
  const sends = eventsOfKind(state.events, 'send').map((e) => e.payload)
  assert(sends[0] === 'matched', 'recvln without args simulates success', sends)
}

console.log('\n=== 53. wait hex pattern is single argument ===')
{
  const state = await runDryRun({
    source: `wait #10'>'\nend`,
    dialogAdapter: createMockDialogAdapter([]),
  })
  const wait = eventsOfKind(state.events, 'receive-wait')[0]
  const expected = String.fromCharCode(10) + '>'
  assert(wait?.payload === expected, 'hex wait joins into one pattern', wait?.payload)
  assert(wait?.message.includes('待機パターン「'), 'hex wait is single-pattern message', wait?.message)
}

console.log('\n=== 54. wait4all logs all patterns ===')
{
  const state = await runDryRun({
    source: `wait4all 'A' 'B'\nend`,
    dialogAdapter: createMockDialogAdapter([]),
  })
  const wait = eventsOfKind(state.events, 'receive-wait')[0]
  assert(wait?.message.includes('すべて'), 'wait4all uses all-patterns label', wait?.message)
  assert(wait?.message.includes('A') && wait?.message.includes('B'), 'wait4all lists patterns', wait?.message)
}

console.log('\n=== 55. multi wait copy text omits payload line ===')
{
  const { buildDryRunPlainTextForCopy } = await import('../src/ttl/dryRun')
  const state = await runDryRun({
    source: `wait 'OK' 'ERROR'\nend`,
    dialogAdapter: createMockDialogAdapter([]),
  })
  const text = buildDryRunPlainTextForCopy(state)
  const lines = text.split('\n')
  const eventIdx = lines.findIndex((l) => l.includes('[L1] receive-wait'))
  assert(eventIdx >= 0, 'copy has wait event line', eventIdx)
  assert(lines[eventIdx + 1]?.startsWith('ドライラン:'), 'copy skips duplicate payload after multi wait', lines[eventIdx + 1])
}

console.log('\n=== 56. recvln does not overwrite matchstr ===')
{
  const state = await runDryRun({
    source: `wait 'keep'\nrecvln\nsend matchstr\nend`,
    dialogAdapter: createMockDialogAdapter([]),
  })
  const sends = eventsOfKind(state.events, 'send')
  assert(sends[0]?.payload === 'keep', 'recvln leaves prior matchstr intact', sends[0]?.payload)
}

console.log('\n=== 57. waitrecv parses substring len pos ===')
{
  const state = await runDryRun({
    source: `waitrecv 'C'#13 2 1\nend`,
    dialogAdapter: createMockDialogAdapter([]),
  })
  const wait = eventsOfKind(state.events, 'receive-wait')[0]
  const expected = 'C' + String.fromCharCode(13)
  assert(wait?.payload === expected, 'waitrecv substring includes trailing #13', wait?.payload)
  assert(wait?.message.includes('len=2') && wait?.message.includes('pos=1'), 'waitrecv logs len and pos', wait?.message)
  assert(!wait?.message.includes('いずれか'), 'waitrecv is not multi-pattern wait', wait?.message)
}

console.log('\n=== 58. wait complete.#13 suffix pattern ===')
{
  const state = await runDryRun({
    source: `wait 'complete.'#13\nend`,
    dialogAdapter: createMockDialogAdapter([]),
  })
  const wait = eventsOfKind(state.events, 'receive-wait')[0]
  assert(wait?.payload === 'complete.' + String.fromCharCode(13), 'literal with trailing CR suffix', wait?.payload)
}

console.log('\n=== 59. single-line if wait ===')
{
  const state = await runDryRun({
    source: `if 1 then wait 'login:'\nif 1 wait 'done'\nend`,
    dialogAdapter: createMockDialogAdapter([]),
  })
  const waits = eventsOfKind(state.events, 'receive-wait')
  assert(waits.length === 2, 'single-line if emits wait events', waits.length)
  assert(waits[0]?.payload === 'login:', 'if then wait pattern', waits[0]?.payload)
  assert(waits[1]?.payload === 'done', 'if cond wait pattern', waits[1]?.payload)
}

console.log('\n=== 60. wait undefined variable pattern ===')
{
  const state = await runDryRun({
    source: `wait missing\nend`,
    dialogAdapter: createMockDialogAdapter([]),
  })
  const wait = eventsOfKind(state.events, 'receive-wait')[0]
  assert(wait?.payload === undefined, 'undefined wait variable has no pattern payload', wait?.payload)
  assert(wait?.message.includes('（任意）'), 'undefined wait variable has no resolved pattern', wait?.message)
}

console.log('\n=== 61. loop include location uses binding key ===')
{
  const loopBindingKey = includeLoopIterationBindingKey(4, 0)
  const loopIncludeResolver: IncludeResolver = {
    resolve: () => null,
    resolveDynamic: (_rawArg, context) =>
      context?.loopValue === 0 ? `send 'from-loop'\nend` : null,
    getLinkedTabId: (bindingKey) =>
      bindingKey === 'sub.ttl' || bindingKey === loopBindingKey ? 'sub-tab' : null,
    resolverForLinkedTab: () => null,
  }
  const state = await runDryRun({
    source: `strdim files 1\nfiles[0] = 'sub.ttl'\nfor i 0 0\n  include files[i]\nnext\nend`,
    includeResolver: loopIncludeResolver,
    dialogAdapter: createMockDialogAdapter([]),
  })
  const includeEvent = state.events.find((event) => event.command === 'include')
  const childSend = eventsOfKind(state.events, 'send')[0]
  assert(includeEvent?.message === 'include sub.ttl@i=0', 'loop include message stays human readable', includeEvent?.message)
  assert(childSend?.location === `${loopBindingKey}:L1`, 'loop include child location uses loop binding key', childSend?.location)
}

console.log('\n=== 62. strcompare sets result for branching ===')
{
  const state = await runDryRun({
    source: `command = 'next'\nstrcompare command 'next'\nif result = 0 then\nsend 'match'\nelse\nsend 'nomatch'\nendif\nstrcompare 'abc' 'def'\nif result = -1 then\nsend 'less'\nendif\nend`,
    dialogAdapter: createMockDialogAdapter([]),
  })
  const sends = eventsOfKind(state.events, 'send')
  assert(sends[0]?.payload === 'match', 'strcompare variable match sets result=0', sends[0]?.payload)
    assert(sends[1]?.payload === 'less', 'strcompare literal less sets result=-1', sends[1]?.payload)
}

console.log('\n=== 63. strlen/strscan/str2int/ifdefined result ===')
{
  const state = await runDryRun({
    source: `strscan 'tera term' 'term'\nif result = 6 then\nsend 'scan'\nendif\nstrlen 'abc'\nif result = 3 then\nsend 'len'\nendif\nstr2int n '9'\nif result = 1 then\nsend 'n9'\nendif\nx = 1\nifdefined x\nif result = 1 then\nsend 'int'\nendif\nendif\nstrdim arr 2\nifdefined arr\nif result = 6 then\nsend 'arr'\nendif\nendif\nend`,
    dialogAdapter: createMockDialogAdapter([]),
  })
  const sends = eventsOfKind(state.events, 'send')
  assert(sends[0]?.payload === 'scan', 'dry run strscan result', sends[0]?.payload)
  assert(sends[1]?.payload === 'len', 'dry run strlen/strlength result', sends[1]?.payload)
  assert(sends[2]?.payload === 'n9', 'dry run str2int result', sends[2]?.payload)
  assert(sends[3]?.payload === 'int', 'dry run ifdefined int', sends[3]?.payload)
  assert(sends[4]?.payload === 'arr', 'dry run ifdefined str array', sends[4]?.payload)
}

console.log('\n=== 64. indeterminate if branch assumption (True) ===')
{
  const state = await runDryRun({
    source: `if result <> 0\nsend 'picked'\nendif\nend`,
    dialogAdapter: createMockDialogAdapter([{ type: 'branch', value: true }]),
  })
  const sends = eventsOfKind(state.events, 'send')
  const flow = state.events.find((e) => e.message.includes('分岐を仮定'))
  assert(sends[0]?.payload === 'picked', 'branch true runs then', sends[0])
  assert(flow?.message.includes('真（then に進む）'), 'logs branch true assumption', flow?.message)
}

console.log('\n=== 65. indeterminate if branch assumption (False → else) ===')
{
  const state = await runDryRun({
    source: `if result <> 0\nsend 'yes'\nelse\nsend 'no'\nendif\nend`,
    dialogAdapter: createMockDialogAdapter([{ type: 'branch', value: false }]),
  })
  const sends = eventsOfKind(state.events, 'send')
  assert(sends[0]?.payload === 'no', 'branch false runs else', sends[0])
}

console.log('\n=== 66. yesnobox result does not prompt branch assumption ===')
{
  const state = await runDryRun({
    source: `yesnobox 'ok?' 't'\nif result = 1\nsend 'ok'\nendif\nend`,
    dialogAdapter: createMockDialogAdapter([{ type: 'yesno', value: true }]),
  })
  const sends = eventsOfKind(state.events, 'send')
  const branchFlow = state.events.some((e) => e.message.includes('分岐を仮定'))
  assert(sends[0]?.payload === 'ok', 'yesnobox result resolves if without branch dialog', sends[0])
  assert(!branchFlow, 'no branch assumption after yesnobox', branchFlow)
}

console.log('\n=== 67. branch assumption is per dry-run session only ===')
{
  let branchCalls = 0
  const adapter: DryRunDialogAdapter = {
    ...createMockDialogAdapter([{ type: 'branch', value: true }, { type: 'branch', value: false }]),
    async branchAssumption() {
      branchCalls++
      return branchCalls === 1
    },
  }
  const macro = `if result <> 0\nsend 'hit'\nendif\nend`
  const first = await runDryRun({ source: macro, dialogAdapter: adapter })
  const second = await runDryRun({ source: macro, dialogAdapter: adapter })
  assert(branchCalls === 2, 'branch dialog on each new dry run', branchCalls)
  assert(eventsOfKind(first.events, 'send')[0]?.payload === 'hit', 'first run true sends', first.events)
  assert(eventsOfKind(second.events, 'send').length === 0, 'second run false skips send', second.events)
}

console.log('\n=== 68. elseif prompts branch per indeterminate arm ===')
{
  const branchLines: string[] = []
  const adapter: DryRunDialogAdapter = {
    ...createMockDialogAdapter([{ type: 'branch', value: false }, { type: 'branch', value: true }]),
    async branchAssumption(opts) {
      branchLines.push(opts.conditionText)
      return branchLines.length === 1 ? false : true
    },
    cancel() {},
  }
  const state = await runDryRun({
    source: `if result = 1 then
sendln 'd1'
elseif result = 2 then
sendln 'd2'
else
sendln 'd-other'
endif
end`,
    dialogAdapter: adapter,
  })
  const sends = eventsOfKind(state.events, 'send').map((e) => e.payload)
  assert(branchLines.length === 2, 'if and elseif each prompt', branchLines)
  assert(sends[0] === 'd2', 'elseif true arm runs', sends)
}

console.log('\n=== 69. sample verify macro flow (A/C/D/E + yesnobox B) ===')
{
  const macro = `if result <> 0 then
sendln 'case-a-then'
else
sendln 'case-a-else'
endif
if result <> 0 then sendln 'case-c-single-line'
if result = 1 then
sendln 'case-d-eq1'
elseif result = 2 then
sendln 'case-d-eq2'
else
sendln 'case-d-other'
endif
if 1 then
sendln 'case-e-always'
endif
yesnobox 'continue?' 'confirm'
if result = 1 then
sendln 'case-b-yes'
else
sendln 'case-b-no'
endif
end`
  const state = await runDryRun({
    source: macro,
    dialogAdapter: createMockDialogAdapter([
      { type: 'branch', value: true },
      { type: 'branch', value: true },
      { type: 'branch', value: false },
      { type: 'branch', value: true },
      { type: 'yesno', value: true },
    ]),
  })
  const sends = eventsOfKind(state.events, 'send').map((e) => e.payload)
  const branchCount = state.events.filter((e) => e.message.includes('分岐を仮定')).length
  assert(branchCount === 4, 'four branch dialogs before yesnobox', branchCount)
  assert(sends.join(',') === 'case-a-then,case-c-single-line,case-d-eq2,case-e-always,case-b-yes', 'sample path sends', sends)
}

console.log('\n=== 70. inputbox + str2int result ===')
{
  const okState = await runDryRun({
    source: `inputbox 'num' 'title' ''\nstr2int val inputstr\nif result = 1 then\nsendln val\nendif\nend`,
    dialogAdapter: createMockDialogAdapter([{ type: 'input', value: '42' }]),
  })
  const okSends = eventsOfKind(okState.events, 'send')
  assert(okSends[0]?.payload === '42', 'inputbox str2int success sets result=1', okSends[0]?.payload)

  const ngState = await runDryRun({
    source: `inputbox 'num' 'title' ''\nstr2int val inputstr\nif result = 0 then\nsendln 'bad'\nendif\nend`,
    dialogAdapter: createMockDialogAdapter([{ type: 'input', value: 'abc' }]),
  })
  const ngSends = eventsOfKind(ngState.events, 'send')
  assert(ngSends[0]?.payload === 'bad', 'inputbox str2int failure sets result=0', ngSends[0]?.payload)

  const hexState = await runDryRun({
    source: `inputbox '' ''\nstr2int val inputstr\nif result = 1 then\nsendln val\nendif\nend`,
    dialogAdapter: createMockDialogAdapter([{ type: 'input', value: '0x7b' }]),
  })
  assert(eventsOfKind(hexState.events, 'send')[0]?.payload === '123', 'inputbox hex str2int', eventsOfKind(hexState.events, 'send')[0]?.payload)

  const prefixState = await runDryRun({
    source: `inputbox '' ''\nstr2int val inputstr\nif result = 1 then\nsendln val\nendif\nend`,
    dialogAdapter: createMockDialogAdapter([{ type: 'input', value: '123abc' }]),
  })
  assert(eventsOfKind(prefixState.events, 'send')[0]?.payload === '123', 'inputbox partial numeric prefix', eventsOfKind(prefixState.events, 'send')[0]?.payload)

  const copyState = await runDryRun({
    source: `inputbox '' ''\ns = inputstr\nstr2int val s\nif result = 1 then\nsendln val\nendif\nend`,
    dialogAdapter: createMockDialogAdapter([{ type: 'input', value: '17' }]),
  })
  assert(eventsOfKind(copyState.events, 'send')[0]?.payload === '17', 'copied user-input str2int', eventsOfKind(copyState.events, 'send')[0]?.payload)

  const earlyState = await runDryRun({
    source: `str2int val inputstr\nif result = 1 then\nsendln val\nendif\ninputbox '' ''\nend`,
    dialogAdapter: createMockDialogAdapter([{ type: 'input', value: '9' }]),
  })
  assert(eventsOfKind(earlyState.events, 'send').length === 0, 'str2int before inputbox does not send', eventsOfKind(earlyState.events, 'send'))

  const waitState = await runDryRun({
    source: `prompt = '42'\nwait prompt\nstr2int val matchstr\nif result = 1 then\nsendln val\nendif\nend`,
    dialogAdapter: createMockDialogAdapter([]),
  })
  assert(eventsOfKind(waitState.events, 'send')[0]?.payload === '42', 'match-received matchstr str2int', eventsOfKind(waitState.events, 'send')[0]?.payload)
}

console.log(`\n=== DRY-RUN RESULT: ${passed} passed, ${failed} failed ===`)
if (failed > 0) process.exit(1)
