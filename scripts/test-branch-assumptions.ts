/**
 * 未確定 if/elseif のユーザー分岐仮定（branchAssumptions）のテスト。
 *
 * include が未確定 if 内にあるとき、仮定なしでは子ファイルの代入が親 env に載らない。
 * ユーザーが True を選ぶと then 本体（include 含む）が評価され、親に反映される。
 */
import type { IncludeResolver } from '../src/ttl/analyzer'
import { evaluateTTL } from '../src/ttl/evaluator'
import { collectIndeterminateIfBranches } from '../src/ttl/branchAssumptions'

export interface TestRunResult {
  passed: number
  failed: number
}

function scalarString(
  env: Map<string, { kind: string; value?: unknown }> | undefined,
  name: string,
): string | undefined {
  const v = env?.get(name.toLowerCase())
  if (!v || v.kind !== 'str') return undefined
  return v.value as string
}

const INCLUDE_MAIN = `yesnobox '' ''
if result <> 0 then
 include 'sub.ttl'
endif
send x
end`

const INCLUDE_SUB = `x = 'from-sub'`

const includeResolver: IncludeResolver = {
  resolve: (path) => (path === 'sub.ttl' ? INCLUDE_SUB : null),
  resolveDynamic: () => null,
  getLinkedTabId: () => null,
  resolverForLinkedTab: () => null,
}

export function runBranchAssumptionTests(): TestRunResult {
  let passed = 0
  let failed = 0

  console.log('=== 未確定分岐仮定（branchAssumptions） ===')

  function ok(label: string) {
    passed++
    console.log(`  OK  ${label}`)
  }

  function ng(label: string, detail?: unknown) {
    failed++
    console.error(`  NG  ${label}`, detail ?? '')
  }

  const baseEval = evaluateTTL(INCLUDE_MAIN, { includeResolver })
  const branches = collectIndeterminateIfBranches(INCLUDE_MAIN, baseEval.beforeLine)
  const ifLine = branches.find((b) => b.command === 'if')?.line

  if (ifLine === 2) ok('未確定 if を L2 として検出')
  else ng('未確定 if を L2 として検出', { branches })

  const xWithout = scalarString(baseEval.beforeLine.get(5), 'x')
  if (xWithout === undefined) ok('仮定なし: include 内の x 代入は親に反映されない')
  else ng('仮定なし: include 内の x 代入は親に反映されない', { x: xWithout })

  const assumedTrue = evaluateTTL(INCLUDE_MAIN, {
    includeResolver,
    branchAssumptions: new Map([[2, true]]),
  })
  const xWithTrue = scalarString(assumedTrue.beforeLine.get(5), 'x')
  if (xWithTrue === 'from-sub') ok('仮定 True: include 内の x 代入が親に反映される')
  else ng('仮定 True: include 内の x 代入が親に反映される', { x: xWithTrue })

  const assumedFalse = evaluateTTL(INCLUDE_MAIN, {
    includeResolver,
    branchAssumptions: new Map([[2, false]]),
  })
  const xWithFalse = scalarString(assumedFalse.beforeLine.get(5), 'x')
  if (xWithFalse === undefined) ok('仮定 False: then 本体をスキップし x は未設定')
  else ng('仮定 False: then 本体をスキップし x は未設定', { x: xWithFalse })

  const sendWithout = baseEval.sendEntries.map((e) => e.payload)
  const sendWithTrue = assumedTrue.sendEntries.map((e) => e.payload)
  if (!sendWithout.includes('from-sub') && sendWithTrue.includes('from-sub')) {
    ok('仮定 True: send x が from-sub を送信データに含める')
  } else {
    ng('仮定 True: send x が from-sub を送信データに含める', {
      sendWithout,
      sendWithTrue,
    })
  }

  const conditionalEndSource = `yesnobox '続行しますか？' '確認'
if result <> 0 then
 end
endif
sendln 'after-yesnobox'`
  const conditionalEndDefault = evaluateTTL(conditionalEndSource)
  const conditionalEndTrue = evaluateTTL(conditionalEndSource, {
    branchAssumptions: new Map([[2, true]]),
  })
  const defaultSends = conditionalEndDefault.sendEntries.map((e) => e.payload)
  const trueSends = conditionalEndTrue.sendEntries.map((e) => e.payload)
  if (defaultSends.includes('after-yesnobox') && !trueSends.includes('after-yesnobox')) {
    ok('仮定 True: if 内 end により後続 sendln を送信データから除外')
  } else {
    ng('仮定 True: if 内 end により後続 sendln を送信データから除外', {
      defaultSends,
      trueSends,
    })
  }

  const singleLineEnd = evaluateTTL(
    `if result <> 0 then end
sendln 'after-single-line'`,
    { branchAssumptions: new Map([[1, true]]) },
  )
  if (!singleLineEnd.sendEntries.some((e) => e.payload === 'after-single-line')) {
    ok('単行 if の仮定 True: end により後続 sendln を除外')
  } else {
    ng('単行 if の仮定 True: end により後続 sendln を除外', singleLineEnd.sendEntries)
  }

  const falseToElseEnd = evaluateTTL(
    `if result <> 0 then
 sendln 'then'
else
 end
endif
sendln 'after-else'`,
    { branchAssumptions: new Map([[1, false]]) },
  )
  if (!falseToElseEnd.sendEntries.some((e) => e.payload === 'after-else')) {
    ok('仮定 False: 選択された else 内 end により後続 sendln を除外')
  } else {
    ng('仮定 False: 選択された else 内 end により後続 sendln を除外', falseToElseEnd.sendEntries)
  }

  const unresolvedElseif = evaluateTTL(
    `if result = 0 then
 sendln 'first'
elseif result <> 1 then
 sendln 'second'
else
 end
endif
sendln 'after-unresolved-elseif'`,
    { branchAssumptions: new Map([[1, false]]) },
  )
  if (unresolvedElseif.sendEntries.some((e) => e.payload === 'after-unresolved-elseif')) {
    ok('後続 elseif が未確定: else 内 end を確定終了にしない')
  } else {
    ng('後続 elseif が未確定: else 内 end を確定終了にしない', unresolvedElseif.sendEntries)
  }

  const allBranchesFalse = evaluateTTL(
    `if result = 0 then
 sendln 'first'
elseif result <> 1 then
 sendln 'second'
else
 end
endif
sendln 'after-all-false'`,
    { branchAssumptions: new Map([[1, false], [3, false]]) },
  )
  if (!allBranchesFalse.sendEntries.some((e) => e.payload === 'after-all-false')) {
    ok('if/elseif がともに仮定 False: else 内 end を確定終了として扱う')
  } else {
    ng('if/elseif がともに仮定 False: else 内 end を確定終了として扱う', allBranchesFalse.sendEntries)
  }

  const elseifTrueAfterUnassumedIf = evaluateTTL(
    `if result <> 0 then
 sendln 'first'
elseif result = 0 then
 end
endif
sendln 'after-elseif-true'`,
    { branchAssumptions: new Map([[3, true]]) },
  )
  if (!elseifTrueAfterUnassumedIf.sendEntries.some((e) => e.payload === 'after-elseif-true')) {
    ok('elseif の仮定 True: 先行 if が未選択でも elseif 内 end を確定終了として扱う')
  } else {
    ng(
      'elseif の仮定 True: 先行 if が未選択でも elseif 内 end を確定終了として扱う',
      elseifTrueAfterUnassumedIf.sendEntries,
    )
  }

  const elseifTrueAfterFalseIf = evaluateTTL(
    `if result <> 0 then
 sendln 'first'
elseif result = 0 then
 end
endif
sendln 'after-elseif-false-true'`,
    { branchAssumptions: new Map([[1, false], [3, true]]) },
  )
  if (!elseifTrueAfterFalseIf.sendEntries.some((e) => e.payload === 'after-elseif-false-true')) {
    ok('if=False / elseif=True: elseif 内 end を確定終了として扱う')
  } else {
    ng(
      'if=False / elseif=True: elseif 内 end を確定終了として扱う',
      elseifTrueAfterFalseIf.sendEntries,
    )
  }

  const collidingChild = `yesnobox '' ''
if result <> 0 then
 end
endif
x = 'child-complete'`
  const collisionResolver: IncludeResolver = {
    resolve: (path) => (path === 'collision.ttl' ? collidingChild : null),
    resolveDynamic: () => null,
    getLinkedTabId: () => null,
    resolverForLinkedTab: () => null,
  }
  const includeLineCollision = evaluateTTL(
    `yesnobox '' ''
if result <> 0 then
 include 'collision.ttl'
endif
send x`,
    {
      includeResolver: collisionResolver,
      branchAssumptions: new Map([[2, true]]),
    },
  )
  if (includeLineCollision.sendEntries.some((e) => e.payload === 'child-complete')) {
    ok('親の行番号仮定を同じ行番号の include 先へ漏らさない')
  } else {
    ng('親の行番号仮定を同じ行番号の include 先へ漏らさない', includeLineCollision.sendEntries)
  }

  const childOwnAssumptionResolver: IncludeResolver = {
    ...collisionResolver,
    getLinkedTabId: () => 'collision-tab',
    getBranchAssumptions: (tabId) =>
      tabId === 'collision-tab' ? new Map([[2, true]]) : undefined,
  }
  const childOwnAssumption = evaluateTTL(
    `include 'collision.ttl'
sendln 'parent-after-child'`,
    { includeResolver: childOwnAssumptionResolver },
  )
  if (!childOwnAssumption.sendEntries.some((e) => e.payload === 'parent-after-child')) {
    ok('include 先ではリンク先ソース自身の仮定を使用する')
  } else {
    ng('include 先ではリンク先ソース自身の仮定を使用する', childOwnAssumption.sendEntries)
  }

  const nestedAssumedEnd = evaluateTTL(
    `if result = 0 then
 if result <> 0 then
  end
 endif
 sendln 'after-inner'
endif
sendln 'after-outer'`,
    { branchAssumptions: new Map([[1, true], [2, true]]) },
  )
  if (nestedAssumedEnd.sendEntries.length === 0) {
    ok('ネストした仮定 True: 内側 end をマクロ全体へ伝播する')
  } else {
    ng('ネストした仮定 True: 内側 end をマクロ全体へ伝播する', nestedAssumedEnd.sendEntries)
  }

  return { passed, failed }
}

const isDirectRun = process.argv[1]?.replace(/\\/g, '/').endsWith('test-branch-assumptions.ts')
if (isDirectRun) {
  const { passed, failed } = runBranchAssumptionTests()
  console.log(`\n=== BRANCH ASSUMPTIONS: ${passed} passed, ${failed} failed ===`)
  process.exit(failed > 0 ? 1 : 0)
}
