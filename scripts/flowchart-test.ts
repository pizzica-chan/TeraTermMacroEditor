import type { IncludeResolver } from '../src/ttl/analyzer'
import { buildFlowchart, type FlowchartModel } from '../src/ttl/flowchart'

let passed = 0
let failed = 0

function assert(condition: boolean, label: string, detail?: unknown): void {
  if (condition) {
    passed++
    console.log(`  OK  ${label}`)
  } else {
    failed++
    console.error(`  NG  ${label}`, detail ?? '')
  }
}

function edgeKinds(model: FlowchartModel): string[] {
  return model.edges.map((edge) => edge.kind)
}

console.log('=== 1. sequential processing and IO ===')
{
  const model = buildFlowchart(`a = 1\nb = 2\ninputbox 'name' 'title'\nsendln 'ok'\nend`, {
    sourceId: 'main',
    sourceName: 'main.ttl',
  })
  assert(!model.nodes.some((node) => node.kind === 'assignment'), 'assignments are hidden by default')
  assert(!model.nodes.some((node) => node.kind === 'process'), 'ordinary processing is hidden')
  assert(!model.nodes.some((node) => node.kind === 'dialog'), 'dialog commands are hidden')
  assert(model.nodes.some((node) => node.kind === 'io'), 'sendln is an IO node')
  const entry = model.nodes.find((node) => node.kind === 'entry')
  const send = model.nodes.find((node) => node.kind === 'io')
  assert(
    model.edges.some((edge) => edge.source === entry?.id && edge.target === send?.id),
    'hidden nodes keep the execution path connected',
    model.edges,
  )
}

console.log('\n=== 2. if / elseif / else ===')
{
  const model = buildFlowchart(
    `if result=1\nsend 'yes'\nelseif result=2\nsend 'maybe'\nelse\nsend 'no'\nendif\nend`,
    { sourceId: 'main', sourceName: 'main.ttl' },
  )
  assert(edgeKinds(model).includes('true'), 'if has true edge', model.edges)
  assert(edgeKinds(model).includes('false'), 'if has false edge', model.edges)
  assert(model.nodes.filter((node) => node.kind === 'decision').length >= 3, 'branch headers are decision nodes')
}

console.log('\n=== 3. loop / break / continue ===')
{
  const model = buildFlowchart(
    `while 1\nif result=1 then break\ncontinue\nendwhile\nsend 'done'\nend`,
    { sourceId: 'main', sourceName: 'main.ttl' },
  )
  assert(edgeKinds(model).includes('loop'), 'loop back edge exists', model.edges)
  assert(model.edges.some((edge) => edge.label === 'break'), 'break exits loop', model.edges)
  assert(model.edges.some((edge) => edge.label === 'continue'), 'continue returns to loop', model.edges)
}

console.log('\n=== 4. goto / call / return ===')
{
  const model = buildFlowchart(
    `call sub\ngoto done\n:sub\nsend 'sub'\nreturn\n:done\nend`,
    { sourceId: 'main', sourceName: 'main.ttl' },
  )
  assert(edgeKinds(model).includes('call'), 'call edge exists', model.edges)
  assert(edgeKinds(model).includes('jump'), 'goto edge exists', model.edges)
  assert(edgeKinds(model).includes('return'), 'return edge exists', model.edges)
}

console.log('\n=== 5. single-line if ===')
{
  const model = buildFlowchart(`if result=1 then goto ok\nsend 'ng'\n:ok\nend`, {
    sourceId: 'main',
    sourceName: 'main.ttl',
  })
  const ifNode = model.nodes.find((node) => node.line === 1 && node.kind === 'decision')
  const outgoing = model.edges.filter((edge) => edge.source === ifNode?.id)
  assert(outgoing.some((edge) => edge.kind === 'jump'), 'single-line if true jump')
  assert(outgoing.some((edge) => edge.kind === 'false'), 'single-line if false fallthrough')
}

console.log('\n=== 6. linked include expansion ===')
{
  const childSource = `send 'child'\nend`
  let childResolver: IncludeResolver
  const rootResolver: IncludeResolver = {
    resolve(path) {
      return path === 'child.ttl' ? childSource : null
    },
    resolveDynamic() {
      return null
    },
    getLinkedTabId(bindingKey) {
      return bindingKey === 'child.ttl' ? 'child-tab' : undefined
    },
    resolverForLinkedTab(tabId) {
      return tabId === 'child-tab' ? childResolver : null
    },
  }
  childResolver = {
    resolve() {
      return null
    },
    resolveDynamic() {
      return null
    },
    getLinkedTabId() {
      return undefined
    },
    resolverForLinkedTab() {
      return null
    },
  }
  const model = buildFlowchart(`include 'child.ttl'\nsend 'main'\nend`, {
    sourceId: 'main-tab',
    sourceName: 'main.ttl',
    includeResolver: rootResolver,
    getSourceName: (id) => (id === 'child-tab' ? 'child.ttl' : undefined),
  })
  assert(model.nodes.some((node) => node.sourceId === 'child-tab' && node.kind === 'io'), 'include child nodes expanded')
  assert(model.edges.some((edge) => edge.kind === 'include'), 'include edge exists')
  assert(model.edges.some((edge) => edge.kind === 'return'), 'include return edge exists')
}

console.log('\n=== 7. include cycle guard ===')
{
  const resolver: IncludeResolver = {
    resolve() {
      return `include 'self.ttl'`
    },
    resolveDynamic() {
      return null
    },
    getLinkedTabId() {
      return 'main-tab'
    },
    resolverForLinkedTab() {
      return resolver
    },
  }
  const model = buildFlowchart(`include 'self.ttl'`, {
    sourceId: 'main-tab',
    sourceName: 'main.ttl',
    includeResolver: resolver,
  })
  assert(model.nodes.some((node) => node.kind === 'warning'), 'cycle becomes warning node', model.nodes)
  assert(model.warnings.length > 0, 'cycle warning is reported', model.warnings)
}

console.log('\n=== 8. nested if skips outer else ===')
{
  const model = buildFlowchart(
    `if outer\nif inner\nsend 'inner'\nendif\nelse\nsend 'outer-else'\nendif\nend`,
    { sourceId: 'main', sourceName: 'main.ttl' },
  )
  const innerSend = model.nodes.find((node) => node.line === 3)
  const outerElse = model.nodes.find((node) => node.line === 5)
  assert(
    !model.edges.some((edge) => edge.source === innerSend?.id && edge.target === outerElse?.id),
    'inner true branch does not enter outer else',
    model.edges,
  )
}

console.log('\n=== 9. call returns to matching caller only ===')
{
  const model = buildFlowchart(
    `call a\nsend 'after-a'\ncall b\nsend 'after-b'\nend\n:a\nreturn\n:b\nreturn`,
    { sourceId: 'main', sourceName: 'main.ttl' },
  )
  const returnA = model.nodes.find((node) => node.line === 7)
  const returnB = model.nodes.find((node) => node.line === 9)
  const afterA = model.nodes.find((node) => node.line === 2)
  const afterB = model.nodes.find((node) => node.line === 4)
  assert(
    model.edges.some((edge) => edge.source === returnA?.id && edge.target === afterA?.id) &&
      !model.edges.some((edge) => edge.source === returnA?.id && edge.target === afterB?.id),
    'subroutine a returns only after call a',
    model.edges,
  )
  assert(
    model.edges.some((edge) => edge.source === returnB?.id && edge.target === afterB?.id) &&
      !model.edges.some((edge) => edge.source === returnB?.id && edge.target === afterA?.id),
    'subroutine b returns only after call b',
    model.edges,
  )

  const repeated = buildFlowchart(
    `call a\nsend 'first'\ncall a\nsend 'second'\nend\n:a\nreturn`,
    { sourceId: 'main', sourceName: 'main.ttl' },
  )
  const repeatedReturn = repeated.nodes.find((node) => node.line === 7)
  assert(
    repeated.edges.filter((edge) => edge.source === repeatedReturn?.id && edge.kind === 'return').length === 2,
    'same subroutine can return to both call sites',
    repeated.edges,
  )
}

console.log('\n=== 10. repeated include has unique graph IDs ===')
{
  const childSource = `send 'child'`
  const childResolver: IncludeResolver = {
    resolve: () => null,
    resolveDynamic: () => null,
    getLinkedTabId: () => undefined,
    resolverForLinkedTab: () => null,
  }
  const rootResolver: IncludeResolver = {
    resolve: () => childSource,
    resolveDynamic: () => null,
    getLinkedTabId: () => 'child-tab',
    resolverForLinkedTab: () => childResolver,
  }
  const model = buildFlowchart(`include 'child.ttl'\ninclude 'child.ttl'`, {
    sourceId: 'main',
    sourceName: 'main.ttl',
    includeResolver: rootResolver,
  })
  assert(new Set(model.nodes.map((node) => node.id)).size === model.nodes.length, 'node IDs are unique')
  assert(new Set(model.edges.map((edge) => edge.id)).size === model.edges.length, 'edge IDs are unique')
  assert(model.nodes.filter((node) => node.sourceId === 'child-tab').length === 6, 'both include instances expand')
}

console.log('\n=== 11. include end terminates whole macro ===')
{
  const childResolver: IncludeResolver = {
    resolve: () => null,
    resolveDynamic: () => null,
    getLinkedTabId: () => undefined,
    resolverForLinkedTab: () => null,
  }
  const rootResolver: IncludeResolver = {
    resolve: () => `send 'child'\nend`,
    resolveDynamic: () => null,
    getLinkedTabId: () => 'child',
    resolverForLinkedTab: () => childResolver,
  }
  const model = buildFlowchart(`include 'child.ttl'\nsend 'parent'`, {
    sourceId: 'main',
    sourceName: 'main.ttl',
    includeResolver: rootResolver,
  })
  const childEnd = model.nodes.find((node) => node.sourceId === 'child' && node.kind === 'terminal')
  const parentSend = model.nodes.find((node) => node.sourceId === 'main' && node.line === 2)
  const rootExit = model.nodes.find((node) => node.id === 'main-exit')
  assert(
    model.edges.some((edge) => edge.source === childEnd?.id && edge.target === rootExit?.id),
    'child end targets root exit',
    model.edges,
  )
  assert(
    !model.edges.some((edge) => edge.source === childEnd?.id && edge.target === parentSend?.id),
    'child end does not resume parent',
  )
}

console.log('\n=== 12. post-test until and unconditional do ===')
{
  const untilModel = buildFlowchart(`until done\nsend 'body'\nenduntil\nsend 'after'`, {
    sourceId: 'main',
    sourceName: 'main.ttl',
  })
  const entry = untilModel.nodes.find((node) => node.kind === 'entry')
  const untilNode = untilModel.nodes.find((node) => node.line === 1 && node.kind === 'loop')
  const body = untilModel.nodes.find((node) => node.line === 2)
  const after = untilModel.nodes.find((node) => node.line === 4)
  assert(
    untilModel.edges.some((edge) => edge.source === entry?.id && edge.target === body?.id),
    'until enters body before condition',
    untilModel.edges,
  )
  assert(
    untilModel.edges.some((edge) => edge.source === untilNode?.id && edge.target === after?.id && edge.kind === 'true'),
    'until true exits loop',
  )

  const doModel = buildFlowchart(`do\nsend 'body'\nloop\nsend 'after'`, {
    sourceId: 'main',
    sourceName: 'main.ttl',
  })
  const loopNode = doModel.nodes.find((node) => node.line === 3)
  const doAfter = doModel.nodes.find((node) => node.line === 4)
  assert(
    !doModel.edges.some((edge) => edge.source === loopNode?.id && edge.target === doAfter?.id),
    'unconditional do has no exit edge',
    doModel.edges,
  )
}

console.log('\n=== 13. empty and loop dynamic include ===')
{
  const emptyChild: IncludeResolver = {
    resolve: () => null,
    resolveDynamic: () => null,
    getLinkedTabId: () => undefined,
    resolverForLinkedTab: () => null,
  }
  const emptyRoot: IncludeResolver = {
    resolve: () => '',
    resolveDynamic: () => null,
    getLinkedTabId: () => 'empty',
    resolverForLinkedTab: () => emptyChild,
  }
  const emptyModel = buildFlowchart(`include 'empty.ttl'`, {
    sourceId: 'main',
    sourceName: 'main.ttl',
    includeResolver: emptyRoot,
  })
  assert(emptyModel.nodes.some((node) => node.sourceId === 'empty'), 'empty include is expanded')

  const dynamicRoot: IncludeResolver = {
    resolve: () => null,
    resolveDynamic(_raw, context) {
      return context?.effectiveRaw === 'a.ttl' ? `send 'a'` : null
    },
    getLinkedTabId(_key, _raw, effectiveRaw) {
      return effectiveRaw === 'a.ttl' ? 'a-tab' : undefined
    },
    resolverForLinkedTab: () => emptyChild,
  }
  const dynamicModel = buildFlowchart(
    `strdim hosts 1\nhosts[0] = 'a.ttl'\nfor i 0 0\ninclude hosts[i]\nnext`,
    {
      sourceId: 'main',
      sourceName: 'main.ttl',
      includeResolver: dynamicRoot,
    },
  )
  assert(
    dynamicModel.nodes.some((node) => node.sourceId === 'a-tab'),
    'for-loop dynamic include is resolved per iteration',
    dynamicModel.warnings,
  )
}

console.log('\n=== 14. optional detailed wait nodes ===')
{
  const source = `wait 'prompt'\nwaitln 'line'\nwaitregex 'rx'\nwait4all 'a' 'b'\nwaitrecv 'x' 1 1\nrecvln\nsendln 'done'`
  const compact = buildFlowchart(source, { sourceId: 'main', sourceName: 'main.ttl' })
  const compactLabels = compact.nodes.map((node) => node.label)
  assert(!compactLabels.some((label) => label.startsWith('wait ')), 'wait is hidden by default')
  assert(!compactLabels.some((label) => label.startsWith('waitln ')), 'waitln is hidden by default')
  assert(!compactLabels.some((label) => label.startsWith('waitregex ')), 'waitregex is hidden by default')
  assert(!compactLabels.some((label) => label.startsWith('wait4all ')), 'wait4all is hidden by default')
  assert(!compactLabels.some((label) => label.startsWith('waitrecv ')), 'waitrecv is hidden by default')
  assert(!compactLabels.some((label) => label === 'recvln'), 'recvln is hidden by default')

  const detailed = buildFlowchart(source, {
    sourceId: 'main',
    sourceName: 'main.ttl',
    showDetailedWaits: true,
  })
  const detailedLabels = detailed.nodes.map((node) => node.label)
  assert(detailedLabels.some((label) => label.startsWith('wait ')), 'wait can be shown')
  assert(detailedLabels.some((label) => label.startsWith('waitln ')), 'detailed waits can be shown')
  assert(detailedLabels.some((label) => label === 'recvln'), 'recvln can be shown')
}

console.log('\n=== 15. optional assignment nodes ===')
{
  const source = `a = 1\nb = 2\nstrconcat x 'hello'\nsendln 'done'`
  const compact = buildFlowchart(source, { sourceId: 'main', sourceName: 'main.ttl' })
  assert(!compact.nodes.some((node) => node.kind === 'assignment'), 'assignments are hidden by default')
  assert(!compact.nodes.some((node) => node.kind === 'process'), 'other processing stays hidden')

  const withAssignments = buildFlowchart(source, {
    sourceId: 'main',
    sourceName: 'main.ttl',
    showAssignments: true,
  })
  assert(withAssignments.nodes.some((node) => node.kind === 'assignment'), 'assignments can be shown')
  assert(!withAssignments.nodes.some((node) => node.kind === 'process'), 'strconcat processing stays hidden')
  const assignmentNode = withAssignments.nodes.find((node) => node.kind === 'assignment')
  assert(assignmentNode?.label.includes('a = 1'), 'assignment label is preserved', assignmentNode?.label)
}

console.log(`\n=== FLOWCHART RESULT: ${passed} passed, ${failed} failed ===`)
if (failed > 0) process.exit(1)
