/**
 * 未確定変数のユーザー仮定（variableAssumptions）のテスト。
 *
 * inputbox / getenv / random 等で静的に決まらない値を仮定すると、
 * 送信データ・ホバー・後続の if 条件に反映される。ドライランには混入しない。
 */
import type { IncludeResolver } from '../src/ttl/analyzer'
import {
  importedEnvFromParentIncludes,
  collectImportedEnvParentCandidates,
  formatImportedEnvParentOptionLabel,
  importedEnvParentKey,
  pruneImportedEnvParentKey,
  type IncludeWorkspaceHost,
} from '../src/app/analysisCoordinator'
import { evaluateTTL, unresolvedSourceIdsOf, type RuntimeValue } from '../src/ttl/evaluator'
import {
  collectIndeterminateVariables,
  isValidVariableAssumptionInput,
  variableAssumptionKey,
  variableAssumptionsFromRecord,
  pruneVariableAssumptions,
} from '../src/ttl/variableAssumptions'
import { collectIndeterminateIfBranches } from '../src/ttl/branchAssumptions'
import {
  commandIntroducesIndependentOutput,
  getCommandOutputEffect,
  INDEPENDENT_OUTPUT_COMMANDS,
} from '../src/ttl/commandOutputs'
import {
  findIncludeRefs,
  includeDynamicBindingKey,
  includeLoopIterationBindingKey,
  includeLoopLineBindingKey,
  normalizeIncludePath,
} from '../src/ttl/includeRefs'
import type { EditorTab } from '../src/ui/tabManager'

export interface TestRunResult {
  passed: number
  failed: number
}

function hoverAt(src: string, lineNo: number, name: string, opts?: Parameters<typeof evaluateTTL>[1]) {
  const line = src.split(/\r?\n/)[lineNo - 1] ?? ''
  const col = line.toLowerCase().indexOf(name.toLowerCase())
  if (col < 0) return undefined
  return evaluateTTL(src, opts).getHoverAt(lineNo, col)?.info
}

export function runVariableAssumptionTests(): TestRunResult {
  let passed = 0
  let failed = 0

  console.log('=== 未確定変数仮定（variableAssumptions） ===')

  function ok(label: string) {
    passed++
    console.log(`  OK  ${label}`)
  }

  function ng(label: string, detail?: unknown) {
    failed++
    console.error(`  NG  ${label}`, detail ?? '')
  }

  const inputSrc = `inputbox 'name' 'title'
sendln inputstr
end`

  const baseEval = evaluateTTL(inputSrc)
  const vars = collectIndeterminateVariables(inputSrc, baseEval.beforeLine, baseEval.afterLine)
  const inputstrItem = vars.find((v) => v.name === 'inputstr' && v.line === 1)
  if (inputstrItem?.valueType === 'string') ok('inputbox の inputstr を未確定変数として検出')
  else ng('inputbox の inputstr を未確定変数として検出', vars)

  const resultListed = vars.some((v) => v.name === 'result')
  if (!resultListed) ok('result は変数仮定の対象にしない')
  else ng('result は変数仮定の対象にしない', vars)

  const assumedInput = evaluateTTL(inputSrc, {
    variableAssumptions: variableAssumptionsFromRecord({
      [variableAssumptionKey(1, 'inputstr')]: 'alice',
    }),
  })
  if (assumedInput.sendEntries[0]?.payload === 'alice' && assumedInput.sendEntries[0]?.unresolved === false) {
    ok('仮定した inputstr が送信データに反映される')
  } else {
    ng('仮定した inputstr が送信データに反映される', assumedInput.sendEntries)
  }

  const hover = hoverAt(inputSrc, 2, 'inputstr', {
    variableAssumptions: variableAssumptionsFromRecord({
      [variableAssumptionKey(1, 'inputstr')]: 'alice',
    }),
  })
  if (hover?.display.includes('alice') && hover.note?.includes('仮定') && hover.valueKind === 'assumed') {
    ok('ホバーに仮定値と仮定である旨が表示される')
  } else {
    ng('ホバーに仮定値と仮定である旨が表示される', hover)
  }

  const quoted = evaluateTTL(inputSrc, {
    variableAssumptions: variableAssumptionsFromRecord({
      [variableAssumptionKey(1, 'inputstr')]: "'bob'",
    }),
  })
  if (quoted.sendEntries[0]?.payload === 'bob') ok('文字列仮定の周囲クォートを外す')
  else ng('文字列仮定の周囲クォートを外す', quoted.sendEntries)

  const copySrc = `inputbox 'name' 'title'
s = inputstr
sendln s
end`
  const copyEval = evaluateTTL(copySrc, {
    variableAssumptions: variableAssumptionsFromRecord({
      [variableAssumptionKey(1, 'inputstr')]: 'carol',
    }),
  })
  if (copyEval.sendEntries[0]?.payload === 'carol') ok('仮定した inputstr の代入先にも値が伝播する')
  else ng('仮定した inputstr の代入先にも値が伝播する', copyEval.sendEntries)

  const copyVars = collectIndeterminateVariables(copySrc, evaluateTTL(copySrc).beforeLine, evaluateTTL(copySrc).afterLine)
  if (
    copyVars.some((v) => v.name === 'inputstr' && v.line === 1)
    && !copyVars.some((v) => v.name === 's')
  ) {
    ok('inputstr の代入先 s は未確定変数リストに出さない')
  } else {
    ng('inputstr の代入先 s は未確定変数リストに出さない', copyVars)
  }

  const derivedSrc = `getdate d
msg = 'hoge'
strconcat msg d
cmd = msg
sendln cmd
end`
  const derivedBase = evaluateTTL(derivedSrc)
  const derivedVars = collectIndeterminateVariables(derivedSrc, derivedBase.beforeLine, derivedBase.afterLine)
  const derivedNames = derivedVars.map((v) => `${v.line}:${v.name}`)
  const derivedItem = derivedVars.find((v) => v.name === 'd' && v.line === 1)
  if (derivedVars.length === 1 && derivedItem) {
    ok('getdate の出力だけを未確定変数として検出し派生の msg/cmd は出さない')
  } else {
    ng('getdate の出力だけを未確定変数として検出し派生の msg/cmd は出さない', derivedNames)
  }
  if (derivedItem?.reason.includes('hoge')) {
    ok('派生変数へ代入・連結した内容を原因変数の表示に含める')
  } else {
    ng('派生変数へ代入・連結した内容を原因変数の表示に含める', derivedItem)
  }

  const derivedAssumed = evaluateTTL(derivedSrc, {
    variableAssumptions: variableAssumptionsFromRecord({
      [variableAssumptionKey(1, 'd')]: '20260102',
    }),
  })
  if (derivedAssumed.sendEntries[0]?.payload === 'hoge20260102' && derivedAssumed.sendEntries[0]?.unresolved === false) {
    ok('原因変数の仮定が strconcat / 代入先の送信データに伝播する')
  } else {
    ng('原因変数の仮定が strconcat / 代入先の送信データに伝播する', derivedAssumed.sendEntries)
  }

  const twoDateSrc = `getdate a
getdate b
sendln a
sendln b
end`
  const twoDateEval = evaluateTTL(twoDateSrc)
  const twoDateVars = collectIndeterminateVariables(twoDateSrc, twoDateEval.beforeLine, twoDateEval.afterLine)
  if (
    twoDateVars.some((v) => v.name === 'a' && v.line === 1)
    && twoDateVars.some((v) => v.name === 'b' && v.line === 2)
    && twoDateVars.length === 2
  ) {
    ok('独立した getdate はそれぞれ原因変数として検出する')
  } else {
    ng('独立した getdate はそれぞれ原因変数として検出する', twoDateVars)
  }

  const sprintfSrc = `getdate d
sprintf2 dest '%s-x' d
sendln dest
end`
  const sprintfEval = evaluateTTL(sprintfSrc)
  const sprintfVars = collectIndeterminateVariables(sprintfSrc, sprintfEval.beforeLine, sprintfEval.afterLine)
  if (
    sprintfVars.some((v) => v.name === 'd' && v.line === 1)
    && !sprintfVars.some((v) => v.name === 'dest')
  ) {
    ok('sprintf2 の出力 dest は getdate の派生としてリストに出さない')
  } else {
    ng('sprintf2 の出力 dest は getdate の派生としてリストに出さない', sprintfVars)
  }

  const sprintfOverwriteSrc = `getdate dest
getenv 'HOME' home
sprintf2 dest '%s' home
end`
  const sprintfOverwriteEval = evaluateTTL(sprintfOverwriteSrc)
  const destAfterDate = sprintfOverwriteEval.afterLine.get(1)?.get('dest')
  const homeAfterGetenv = sprintfOverwriteEval.afterLine.get(2)?.get('home')
  const destAfterSprintf = sprintfOverwriteEval.afterLine.get(3)?.get('dest')
  const dateIds = destAfterDate ? unresolvedSourceIdsOf(destAfterDate) : []
  const homeIds = homeAfterGetenv ? unresolvedSourceIdsOf(homeAfterGetenv) : []
  const destIds = destAfterSprintf ? unresolvedSourceIdsOf(destAfterSprintf) : []
  const sprintfOverwriteVars = collectIndeterminateVariables(
    sprintfOverwriteSrc,
    sprintfOverwriteEval.beforeLine,
    sprintfOverwriteEval.afterLine,
  )
  if (
    homeIds.length > 0
    && destIds.length === homeIds.length
    && destIds.every((id) => homeIds.includes(id))
    && dateIds.every((id) => !destIds.includes(id))
    && sprintfOverwriteVars.some((v) => v.name === 'dest' && v.line === 1)
    && sprintfOverwriteVars.some((v) => v.name === 'home' && v.line === 2)
    && !sprintfOverwriteVars.some((v) => v.name === 'dest' && v.line === 3)
  ) {
    ok('sprintf2 の出力 dest は上書き前の dest ではなく引数の根源 ID を継承する')
  } else {
    ng('sprintf2 の出力 dest は上書き前の dest ではなく引数の根源 ID を継承する', {
      dateIds,
      homeIds,
      destIds,
      listed: sprintfOverwriteVars.map((v) => `${v.line}:${v.name}`),
    })
  }

  const inPlaceSrc = `getdate d
strreplace d 1 'x' 'y'
strinsert d 1 '_'
end`
  const inPlaceEval = evaluateTTL(inPlaceSrc)
  const inPlaceVars = collectIndeterminateVariables(inPlaceSrc, inPlaceEval.beforeLine, inPlaceEval.afterLine)
  if (inPlaceVars.length === 1 && inPlaceVars[0]?.name === 'd' && inPlaceVars[0]?.line === 1) {
    ok('strreplace / strinsert のインプレース先は新しい原因変数にしない')
  } else {
    ng('strreplace / strinsert のインプレース先は新しい原因変数にしない', inPlaceVars)
  }

  const mixedSrc = `getdate a
getdate b
x = a
strconcat x b
end`
  const mixedEval = evaluateTTL(mixedSrc)
  const mixedVars = collectIndeterminateVariables(mixedSrc, mixedEval.beforeLine, mixedEval.afterLine)
  const mixedA = mixedVars.find((v) => v.name === 'a' && v.line === 1)
  const mixedB = mixedVars.find((v) => v.name === 'b' && v.line === 2)
  const mixedJoined = '（getdate の出力） + （getdate の出力）'
  if (
    mixedVars.length === 2
    && mixedA
    && mixedB
    && mixedA.reason !== mixedJoined
    && mixedB.reason !== mixedJoined
    && !mixedVars.some((v) => v.name === 'x')
  ) {
    ok('別の未確定根源と連結した値を原因変数の表示に混ぜない')
  } else {
    ng('別の未確定根源と連結した値を原因変数の表示に混ぜない', mixedVars)
  }

  const sprintfAssumed = evaluateTTL(sprintfSrc, {
    variableAssumptions: variableAssumptionsFromRecord({
      [variableAssumptionKey(1, 'd')]: 'ok',
    }),
  })
  if (sprintfAssumed.sendEntries[0]?.payload === 'ok-x') {
    ok('原因変数の仮定で sprintf2 の出力が静的に確定する')
  } else {
    ng('原因変数の仮定で sprintf2 の出力が静的に確定する', sprintfAssumed.sendEntries)
  }

  const groupedSrc = `getdate d
msg = 'hoge' d
sendln msg
end`
  const groupedEval = evaluateTTL(groupedSrc)
  const groupedVars = collectIndeterminateVariables(groupedSrc, groupedEval.beforeLine, groupedEval.afterLine)
  if (
    groupedVars.some((v) => v.name === 'd' && v.line === 1)
    && !groupedVars.some((v) => v.name === 'msg')
  ) {
    ok('連結代入の左辺 msg は原因変数リストに出さない')
  } else {
    ng('連結代入の左辺 msg は原因変数リストに出さない', groupedVars)
  }

  const laterConcatSrc = `getdate d
strconcat d '_x'
end`
  const laterConcatEval = evaluateTTL(laterConcatSrc)
  const laterConcatVars = collectIndeterminateVariables(
    laterConcatSrc,
    laterConcatEval.beforeLine,
    laterConcatEval.afterLine,
  )
  const laterConcatItem = laterConcatVars.find((v) => v.name === 'd' && v.line === 1)
  if (laterConcatItem?.reason.includes('_x') && laterConcatVars.length === 1) {
    ok('後続 strconcat を原因変数の内容表示に含める')
  } else {
    ng('後続 strconcat を原因変数の内容表示に含める', laterConcatItem)
  }

  const INCLUDE_COPY = `msg = 'from-sub'
strconcat msg d`
  const includeCopyParentSrc = `getdate d
include 'sub.ttl'
end`
  const includeCopyResolver: IncludeResolver = {
    resolve: (path) => (path === 'sub.ttl' ? INCLUDE_COPY : null),
    resolveDynamic: () => null,
    getLinkedTabId: () => 'sub-tab',
    resolverForLinkedTab: () => includeCopyResolver,
  }
  const includeCopyEval = evaluateTTL(includeCopyParentSrc, { includeResolver: includeCopyResolver })
  const includeCopyVars = collectIndeterminateVariables(
    includeCopyParentSrc,
    includeCopyEval.beforeLine,
    includeCopyEval.afterLine,
  )
  const includeCopyItem = includeCopyVars.find((v) => v.name === 'd' && v.line === 1)
  if (includeCopyItem?.reason.includes('from-sub') && includeCopyVars.length === 1) {
    ok('include 先の別変数へ代入・連結した内容を原因変数の表示に含める')
  } else {
    ng('include 先の別変数へ代入・連結した内容を原因変数の表示に含める', includeCopyItem)
  }

  const INCLUDE_MUTATE = `suffix = '_from_sub'
strconcat d suffix`
  const includeParentSrc = `getdate d
include 'sub.ttl'
end`
  const includeMutateResolver: IncludeResolver = {
    resolve: (path) => (path === 'sub.ttl' ? INCLUDE_MUTATE : null),
    resolveDynamic: () => null,
    getLinkedTabId: () => 'sub-tab',
    resolverForLinkedTab: () => includeMutateResolver,
  }
  const includeMutateEval = evaluateTTL(includeParentSrc, { includeResolver: includeMutateResolver })
  const includeMutateVars = collectIndeterminateVariables(
    includeParentSrc,
    includeMutateEval.beforeLine,
    includeMutateEval.afterLine,
  )
  const includeMutateItem = includeMutateVars.find((v) => v.name === 'd' && v.line === 1)
  if (
    includeMutateItem?.reason.includes('_from_sub')
    && includeMutateVars.length === 1
  ) {
    ok('include 先で連結した値を原因変数の内容表示に含める')
  } else {
    ng('include 先で連結した値を原因変数の内容表示に含める', includeMutateItem)
  }

  const includeOwnSrc = `getdate d
suffix = '_own'
strconcat d suffix
end`
  const includeOwnEval = evaluateTTL(includeOwnSrc)
  const includeOwnVars = collectIndeterminateVariables(
    includeOwnSrc,
    includeOwnEval.beforeLine,
    includeOwnEval.afterLine,
  )
  const includeOwnItem = includeOwnVars.find((v) => v.name === 'd')
  if (includeOwnItem?.reason.includes('_own')) {
    ok('同一ファイル内で代入した連結先を内容表示に含める')
  } else {
    ng('同一ファイル内で代入した連結先を内容表示に含める', includeOwnItem)
  }

  const includeTabSrc = `msg = 'from-sub'
getdate d
strconcat msg d
end`
  const includeTabEval = evaluateTTL(includeTabSrc)
  const includeTabVars = collectIndeterminateVariables(
    includeTabSrc,
    includeTabEval.beforeLine,
    includeTabEval.afterLine,
  )
  const includeTabItem = includeTabVars.find((v) => v.name === 'd')
  if (includeTabItem?.reason.includes('from-sub') && includeTabVars.length === 1) {
    ok('include 先タブ内で別変数に代入した内容を原因変数の表示に含める')
  } else {
    ng('include 先タブ内で別変数に代入した内容を原因変数の表示に含める', includeTabItem)
  }

  const orphanA: RuntimeValue = { kind: 'str', value: '', hint: '（getdate の出力）' }
  const unrelatedB: RuntimeValue = {
    kind: 'str',
    value: '',
    hint: "'unrelated-long-hint' + （getenv の出力）",
    hasUnresolvedParts: true,
  }
  const orphanSrc = `getdate a
sendln b
end`
  const orphanAfter1 = new Map<string, RuntimeValue>([['a', orphanA]])
  const orphanAfter2 = new Map<string, RuntimeValue>([
    ['a', orphanA],
    ['b', unrelatedB],
  ])
  const orphanVars = collectIndeterminateVariables(
    orphanSrc,
    new Map([
      [1, new Map()],
      [2, orphanAfter1],
    ]),
    new Map([
      [1, orphanAfter1],
      [2, orphanAfter2],
    ]),
  )
  const orphanItem = orphanVars.find((v) => v.name === 'a' && v.line === 1)
  if (orphanItem?.reason === '（getdate の出力）' && !orphanItem.reason.includes('unrelated')) {
    ok('根源 ID が無い未確定値の表示を無関係な変数へすり替えない')
  } else {
    ng('根源 ID が無い未確定値の表示を無関係な変数へすり替えない', orphanItem)
  }

  const importedPrefix: RuntimeValue = { kind: 'str', value: 'hello', origin: 'literal' }
  const importedEnv = new Map<string, RuntimeValue>([['prefix', importedPrefix]])
  const importedSrc = `getdate d
strconcat d prefix
end`
  const importedEval = evaluateTTL(importedSrc, { importedEnv })
  const importedVars = collectIndeterminateVariables(
    importedSrc,
    importedEval.beforeLine,
    importedEval.afterLine,
  )
  const importedItem = importedVars.find((v) => v.name === 'd')
  if (importedItem?.reason.includes('hello')) {
    ok('親から渡した env の代入値が include 先の内容表示に載る')
  } else {
    ng('親から渡した env の代入値が include 先の内容表示に載る', importedItem)
  }

  const parentWithDate = evaluateTTL(`getdate d
include 'sub.ttl'
end`)
  const childOwnSrc = `getenv 'HOME' home
sendln home
end`
  const childOwnEval = evaluateTTL(childOwnSrc, {
    importedEnv: parentWithDate.beforeLine.get(2),
  })
  const childOwnVars = collectIndeterminateVariables(
    childOwnSrc,
    childOwnEval.beforeLine,
    childOwnEval.afterLine,
  )
  const homeFromChild = childOwnVars.find((v) => v.name === 'home')
  const parentDateIds = unresolvedSourceIdsOf(parentWithDate.afterLine.get(1)?.get('d')!)
  const childHomeIds = unresolvedSourceIdsOf(childOwnEval.afterLine.get(1)?.get('home')!)
  if (
    homeFromChild
    && parentDateIds.length > 0
    && childHomeIds.length > 0
    && parentDateIds.every((id) => !childHomeIds.includes(id))
  ) {
    ok('親 env の未確定 ID と子の getenv を衝突させず原因変数として検出する')
  } else {
    ng('親 env の未確定 ID と子の getenv を衝突させず原因変数として検出する', {
      listed: childOwnVars.map((v) => `${v.line}:${v.name}`),
      parentDateIds,
      childHomeIds,
    })
  }

  const missingIndependent = [...INDEPENDENT_OUTPUT_COMMANDS].filter(
    (cmd) => !commandIntroducesIndependentOutput(cmd) || !getCommandOutputEffect(cmd),
  )
  if (missingIndependent.length === 0) {
    ok('独立出力コマンドは COMMAND_OUTPUT_EFFECTS に載っている')
  } else {
    ng('独立出力コマンドは COMMAND_OUTPUT_EFFECTS に載っている', missingIndependent)
  }

  const getenvSrc = `getenv 'HOME' home
sendln home
end`
  const getenvEval = evaluateTTL(getenvSrc)
  const getenvVars = collectIndeterminateVariables(getenvSrc, getenvEval.beforeLine, getenvEval.afterLine)
  const homeItem = getenvVars.find((v) => v.name === 'home')
  if (homeItem?.valueType === 'string') ok('getenv の出力変数を未確定として検出')
  else ng('getenv の出力変数を未確定として検出', getenvVars)

  const getenvAssumed = evaluateTTL(getenvSrc, {
    variableAssumptions: variableAssumptionsFromRecord({
      [variableAssumptionKey(homeItem?.line ?? 1, 'home')]: '/tmp',
    }),
  })
  if (getenvAssumed.sendEntries[0]?.payload === '/tmp') ok('仮定した getenv 出力が送信データに載る')
  else ng('仮定した getenv 出力が送信データに載る', getenvAssumed.sendEntries)

  const randomSrc = `random n
if n = 3 then
  sendln 'yes'
endif
end`
  const randomEval = evaluateTTL(randomSrc)
  const randomVars = collectIndeterminateVariables(randomSrc, randomEval.beforeLine, randomEval.afterLine)
  const nItem = randomVars.find((v) => v.name === 'n')
  if (nItem?.valueType === 'integer' && nItem.line === 1) ok('random の整数出力を未確定として検出')
  else ng('random の整数出力を未確定として検出', randomVars)

  const nAssumed = evaluateTTL(randomSrc, {
    variableAssumptions: variableAssumptionsFromRecord({
      [variableAssumptionKey(1, 'n')]: '3',
    }),
  })
  if (nAssumed.sendEntries[0]?.payload === 'yes') ok('整数仮定で後続 if が静的に確定する')
  else ng('整数仮定で後続 if が静的に確定する', nAssumed.sendEntries)

  const branchesAfterAssume = collectIndeterminateIfBranches(randomSrc, nAssumed.beforeLine)
  if (branchesAfterAssume.length === 0) ok('変数仮定後は確定した if を未確定分岐に残さない')
  else ng('変数仮定後は確定した if を未確定分岐に残さない', branchesAfterAssume)

  const invalidInt = evaluateTTL(randomSrc, {
    variableAssumptions: variableAssumptionsFromRecord({
      [variableAssumptionKey(1, 'n')]: 'abc',
    }),
  })
  if (invalidInt.sendEntries.length === 0) ok('整数として解釈できない仮定は適用しない')
  else ng('整数として解釈できない仮定は適用しない', invalidInt.sendEntries)

  if (!isValidVariableAssumptionInput('integer', 'abc')) ok('整数仮定入力のバリデーションで abc を拒否')
  else ng('整数仮定入力のバリデーションで abc を拒否')
  if (isValidVariableAssumptionInput('integer', '3')) ok('整数仮定入力のバリデーションで 3 を受理')
  else ng('整数仮定入力のバリデーションで 3 を受理')
  if (!isValidVariableAssumptionInput('integer', '')) ok('整数仮定入力のバリデーションで空文字を拒否')
  else ng('整数仮定入力のバリデーションで空文字を拒否')

  const INCLUDE_MAIN = `include 'sub.ttl'
sendln x
end`
  const INCLUDE_SUB = `getenv 'HOME' x`
  const includeResolver: IncludeResolver = {
    resolve: (path) => (path === 'sub.ttl' ? INCLUDE_SUB : null),
    resolveDynamic: () => null,
    getLinkedTabId: () => 'sub-tab',
    resolverForLinkedTab: () => includeResolver,
    getVariableAssumptions: (tabId) =>
      tabId === 'sub-tab'
        ? variableAssumptionsFromRecord({ [variableAssumptionKey(1, 'x')]: 'from-sub' })
        : undefined,
  }
  const includeAssumed = evaluateTTL(INCLUDE_MAIN, { includeResolver })
  if (includeAssumed.sendEntries[0]?.payload === 'from-sub') {
    ok('include 先の変数仮定が親の送信データに反映される')
  } else {
    ng('include 先の変数仮定が親の送信データに反映される', includeAssumed.sendEntries)
  }

  const leakResolver: IncludeResolver = {
    resolve: (path) => (path === 'sub.ttl' ? INCLUDE_SUB : null),
    resolveDynamic: () => null,
    getLinkedTabId: () => 'sub-tab',
    resolverForLinkedTab: () => leakResolver,
    getVariableAssumptions: () => undefined,
  }
  const leakEval = evaluateTTL(INCLUDE_MAIN, {
    includeResolver: leakResolver,
    variableAssumptions: variableAssumptionsFromRecord({
      [variableAssumptionKey(1, 'x')]: 'from-parent',
    }),
  })
  if (leakEval.sendEntries[0]?.payload !== 'from-parent') {
    ok('親の行番号仮定を同じ行番号の include 先へ漏らさない')
  } else {
    ng('親の行番号仮定を同じ行番号の include 先へ漏らさない', leakEval.sendEntries)
  }

  const pruned = pruneVariableAssumptions(
    { '1:inputstr': 'a', '9:gone': 'b' },
    new Set(['1:inputstr']),
  )
  if (pruned['1:inputstr'] === 'a' && pruned['9:gone'] === undefined) {
    ok('存在しなくなった変数仮定を prune する')
  } else {
    ng('存在しなくなった変数仮定を prune する', pruned)
  }

  const prunedInvalidInt = pruneVariableAssumptions(
    { '2:n': 'abc', '3:inputstr': 'hello' },
    new Set(['2:n', '3:inputstr']),
    new Map([
      ['2:n', 'integer'],
      ['3:inputstr', 'string'],
    ]),
  )
  if (
    prunedInvalidInt['2:n'] === undefined &&
    prunedInvalidInt['3:inputstr'] === 'hello'
  ) {
    ok('TTL 整数として解釈できない整数仮定を prune する')
  } else {
    ng('TTL 整数として解釈できない整数仮定を prune する', prunedInvalidInt)
  }

  const without = evaluateTTL(inputSrc)
  if (without.sendEntries[0]?.unresolved === true) ok('仮定なしでは inputstr 送信は未解決のまま')
  else ng('仮定なしでは inputstr 送信は未解決のまま', without.sendEntries)

  function stubTab(id: string, bindings: Record<string, string> = {}): EditorTab {
    return { id, fileName: `${id}.ttl`, includeBindings: bindings } as EditorTab
  }

  function importedPrefixOf(tab: EditorTab, host: IncludeWorkspaceHost): string | undefined {
    const env = importedEnvFromParentIncludes(host, tab)
    const prefix = env?.get('prefix')
    return prefix?.kind === 'str' ? prefix.value : undefined
  }

  function importedIntOf(tab: EditorTab, host: IncludeWorkspaceHost, name: string): number | undefined {
    const env = importedEnvFromParentIncludes(host, tab)
    const value = env?.get(name)
    return value?.kind === 'int' ? value.value : undefined
  }

  const loopParentSrc = `prefix = 'hello'
for i 0 1
  include host[i]
next
end`
  const loopIncludeLine = findIncludeRefs(loopParentSrc).find((ref) => ref.loopContext)?.line ?? 0
  const loopChildA = stubTab('child-a')
  const loopChildB = stubTab('child-b')
  const loopParent = stubTab('parent', {
    [includeLoopIterationBindingKey(loopIncludeLine, 0)]: loopChildA.id,
    [includeLoopIterationBindingKey(loopIncludeLine, 1)]: loopChildB.id,
  })
  const loopContents: Record<string, string> = {
    [loopParent.id]: loopParentSrc,
    [loopChildA.id]: 'end',
    [loopChildB.id]: 'sendln prefix',
  }
  const loopHost: IncludeWorkspaceHost = {
    allTabs: [loopParent, loopChildA, loopChildB],
    getTabContent: (tab) => loopContents[tab.id] ?? '',
  }
  if (
    importedPrefixOf(loopChildA, loopHost) === 'hello'
    && importedPrefixOf(loopChildB, loopHost) === 'hello'
  ) {
    ok('ループ include の反復ごとに別タブでも親の include 直前 env を渡す')
  } else {
    ng('ループ include の反復ごとに別タブでも親の include 直前 env を渡す', {
      a: importedPrefixOf(loopChildA, loopHost),
      b: importedPrefixOf(loopChildB, loopHost),
      line: loopIncludeLine,
    })
  }

  const commonLoopChild = stubTab('common-child')
  const commonLoopParent = stubTab('common-parent', {
    [includeLoopLineBindingKey(loopIncludeLine)]: commonLoopChild.id,
  })
  const commonLoopHost: IncludeWorkspaceHost = {
    allTabs: [commonLoopParent, commonLoopChild],
    getTabContent: (tab) =>
      tab.id === commonLoopParent.id ? loopParentSrc : 'sendln prefix',
  }
  if (importedPrefixOf(commonLoopChild, commonLoopHost) === 'hello') {
    ok('ループ include の全反復キーでも親 env を渡す')
  } else {
    ng('ループ include の全反復キーでも親 env を渡す', {
      prefix: importedPrefixOf(commonLoopChild, commonLoopHost),
      line: loopIncludeLine,
    })
  }

  const dynRaw = findIncludeRefs(loopParentSrc).find((ref) => ref.loopContext)?.raw ?? 'host[i]'
  const dynLoopChild = stubTab('dyn-child')
  const dynLoopParent = stubTab('dyn-parent', {
    [includeDynamicBindingKey(dynRaw)]: dynLoopChild.id,
  })
  const dynLoopHost: IncludeWorkspaceHost = {
    allTabs: [dynLoopParent, dynLoopChild],
    getTabContent: (tab) =>
      tab.id === dynLoopParent.id ? loopParentSrc : 'sendln prefix',
  }
  if (importedPrefixOf(dynLoopChild, dynLoopHost) === 'hello') {
    ok('ループ include の @dynamic キーだけでも親 env を渡す')
  } else {
    ng('ループ include の @dynamic キーだけでも親 env を渡す', {
      prefix: importedPrefixOf(dynLoopChild, dynLoopHost),
      raw: dynRaw,
    })
  }

  const iterParentSrc = `for i 0 1
  x = i
  include host[i]
next
end`
  const iterIncludeLine = findIncludeRefs(iterParentSrc).find((ref) => ref.loopContext)?.line ?? 0
  const iterChildA = stubTab('iter-a')
  const iterChildB = stubTab('iter-b')
  const iterParent = stubTab('iter-parent', {
    [includeLoopIterationBindingKey(iterIncludeLine, 0)]: iterChildA.id,
    [includeLoopIterationBindingKey(iterIncludeLine, 1)]: iterChildB.id,
  })
  const iterHost: IncludeWorkspaceHost = {
    allTabs: [iterParent, iterChildA, iterChildB],
    getTabContent: (tab) => (tab.id === iterParent.id ? iterParentSrc : 'sendln x'),
  }
  if (
    importedIntOf(iterChildA, iterHost, 'x') === 0
    && importedIntOf(iterChildB, iterHost, 'x') === 1
  ) {
    ok('ループ include の反復別タブにはその回の直前 env を渡す')
  } else {
    ng('ループ include の反復別タブにはその回の直前 env を渡す', {
      a: importedIntOf(iterChildA, iterHost, 'x'),
      b: importedIntOf(iterChildB, iterHost, 'x'),
      line: iterIncludeLine,
    })
  }

  const stopLoopSrc = `for i 0 2
  x = i
  include host[i]
next
end`
  const stopLoopSub = `while i = 1
  end
endwhile`
  const stopLoopResolver: IncludeResolver = {
    resolve: () => null,
    resolveDynamic: () => stopLoopSub,
    getLinkedTabId: () => 'sub-tab',
    resolverForLinkedTab: () => stopLoopResolver,
  }
  const stopLoopEval = evaluateTTL(stopLoopSrc, { includeResolver: stopLoopResolver })
  const stopLoopIncludeLine = findIncludeRefs(stopLoopSrc).find((ref) => ref.loopContext)?.line ?? 0
  const xBeforeStoppedInclude = stopLoopEval.beforeLine.get(stopLoopIncludeLine)?.get('x')
  const xBeforeStoppedIncludeValue =
    xBeforeStoppedInclude?.kind === 'int' ? xBeforeStoppedInclude.value : undefined
  if (xBeforeStoppedIncludeValue === 1) {
    ok('ループ途中の include 内 end では止まる反復の直前 env を残す')
  } else {
    ng('ループ途中の include 内 end では止まる反復の直前 env を残す', {
      x: xBeforeStoppedIncludeValue,
      line: stopLoopIncludeLine,
    })
  }

  const stopLoopChild = stubTab('stop-child')
  const stopLoopParent = stubTab('stop-parent', {
    [includeLoopLineBindingKey(stopLoopIncludeLine)]: stopLoopChild.id,
  })
  const stopLoopHost: IncludeWorkspaceHost = {
    allTabs: [stopLoopParent, stopLoopChild],
    getTabContent: (tab) => (tab.id === stopLoopParent.id ? stopLoopSrc : stopLoopSub),
  }
  if (importedIntOf(stopLoopChild, stopLoopHost, 'x') === 1) {
    ok('ループ途中終了の全反復共通タブには止まる反復の直前 env を渡す')
  } else {
    ng('ループ途中終了の全反復共通タブには止まる反復の直前 env を渡す', {
      x: importedIntOf(stopLoopChild, stopLoopHost, 'x'),
      line: stopLoopIncludeLine,
    })
  }

  const pathLoopSrc = `strdim host 2
host[0] = 'a.ttl'
host[1] = 'b.ttl'
for i 0 1
  x = i
  include host[i]
next
end`
  const pathLoopIncludeLine = findIncludeRefs(pathLoopSrc).find((ref) => ref.loopContext)?.line ?? 0
  const pathLoopChildA = stubTab('path-a')
  const pathLoopChildB = stubTab('path-b')
  const pathLoopParent = stubTab('path-parent', {
    [includeLoopIterationBindingKey(pathLoopIncludeLine, 0)]: pathLoopChildA.id,
    [includeLoopIterationBindingKey(pathLoopIncludeLine, 1)]: pathLoopChildB.id,
  })
  const pathLoopHost: IncludeWorkspaceHost = {
    allTabs: [pathLoopParent, pathLoopChildA, pathLoopChildB],
    getTabContent: (tab) => (tab.id === pathLoopParent.id ? pathLoopSrc : 'sendln x'),
  }
  if (
    importedIntOf(pathLoopChildA, pathLoopHost, 'x') === 0
    && importedIntOf(pathLoopChildB, pathLoopHost, 'x') === 1
  ) {
    ok('実効パスがあるループ include でも @loop:L行:値 の紐づけで反復 env を渡す')
  } else {
    ng('実効パスがあるループ include でも @loop:L行:値 の紐づけで反復 env を渡す', {
      a: importedIntOf(pathLoopChildA, pathLoopHost, 'x'),
      b: importedIntOf(pathLoopChildB, pathLoopHost, 'x'),
      line: pathLoopIncludeLine,
      ref: findIncludeRefs(pathLoopSrc).find((ref) => ref.loopContext),
    })
  }

  const multiChild = stubTab('shared-child')
  const parentASrc = `prefix = 'from-a'
include 'child.ttl'
end`
  const parentBSrc = `prefix = 'from-b'
include 'child.ttl'
end`
  const parentAIncludeLine = findIncludeRefs(parentASrc)[0]?.line ?? 0
  const parentBIncludeLine = findIncludeRefs(parentBSrc)[0]?.line ?? 0
  const parentA = stubTab('parent-a', {
    [normalizeIncludePath('child.ttl')]: multiChild.id,
  })
  const parentB = stubTab('parent-b', {
    [normalizeIncludePath('child.ttl')]: multiChild.id,
  })
  const multiHost: IncludeWorkspaceHost = {
    allTabs: [parentA, parentB, multiChild],
    getTabContent: (tab) => {
      if (tab.id === parentA.id) return parentASrc
      if (tab.id === parentB.id) return parentBSrc
      return 'sendln prefix'
    },
  }
  const multiCandidates = collectImportedEnvParentCandidates(multiHost, multiChild)
  if (
    multiCandidates.length === 2
    && multiCandidates[0]?.parentTabId === parentA.id
    && multiCandidates[1]?.parentTabId === parentB.id
  ) {
    ok('複数親の候補を allTabs 順で列挙する')
  } else {
    ng('複数親の候補を allTabs 順で列挙する', multiCandidates)
  }
  if (importedPrefixOf(multiChild, multiHost) === 'from-a') {
    ok('親が複数でも未選択なら先頭の親 env を使う')
  } else {
    ng('親が複数でも未選択なら先頭の親 env を使う', importedPrefixOf(multiChild, multiHost))
  }
  multiChild.importedEnvParentKey = importedEnvParentKey(parentB.id, parentBIncludeLine)
  if (importedPrefixOf(multiChild, multiHost) === 'from-b') {
    ok('前提で選んだ親の include 直前 env を使う')
  } else {
    ng('前提で選んだ親の include 直前 env を使う', {
      prefix: importedPrefixOf(multiChild, multiHost),
      key: multiChild.importedEnvParentKey,
      aLine: parentAIncludeLine,
      bLine: parentBIncludeLine,
    })
  }
  multiChild.importedEnvParentKey = 'missing-tab:99'
  if (
    pruneImportedEnvParentKey(multiChild, multiCandidates)
    && multiChild.importedEnvParentKey === undefined
    && importedPrefixOf(multiChild, multiHost) === 'from-a'
  ) {
    ok('紐づかない親選択は prune して先頭の親へ戻す')
  } else {
    ng('紐づかない親選択は prune して先頭の親へ戻す', {
      key: multiChild.importedEnvParentKey,
      prefix: importedPrefixOf(multiChild, multiHost),
    })
  }

  const dualIncludeChild = stubTab('dual-child')
  const dualParentSrc = `prefix = 'first'
include 'child.ttl'
prefix = 'second'
include 'child.ttl'
end`
  const dualRefs = findIncludeRefs(dualParentSrc)
  const dualLine1 = dualRefs[0]?.line ?? 0
  const dualLine2 = dualRefs[1]?.line ?? 0
  const dualParent = stubTab('dual-parent', {
    [normalizeIncludePath('child.ttl')]: dualIncludeChild.id,
  })
  const dualHost: IncludeWorkspaceHost = {
    allTabs: [dualParent, dualIncludeChild],
    getTabContent: (tab) => (tab.id === dualParent.id ? dualParentSrc : 'sendln prefix'),
  }
  const dualCandidates = collectImportedEnvParentCandidates(dualHost, dualIncludeChild)
  dualIncludeChild.importedEnvParentKey = importedEnvParentKey(dualParent.id, dualLine2)
  if (
    dualCandidates.length === 2
    && dualLine1 !== dualLine2
    && importedPrefixOf(dualIncludeChild, dualHost) === 'second'
  ) {
    ok('同一親の複数 include 行から選んだ行の直前 env を使う')
  } else {
    ng('同一親の複数 include 行から選んだ行の直前 env を使う', {
      candidates: dualCandidates,
      prefix: importedPrefixOf(dualIncludeChild, dualHost),
      dualLine1,
      dualLine2,
    })
  }

  const sameNameA = {
    key: 'tab-a:2',
    parentTabId: 'tab-a',
    parentFileName: '未保存',
    includeLine: 2,
  }
  const sameNameB = {
    key: 'tab-b:2',
    parentTabId: 'tab-b',
    parentFileName: '未保存',
    includeLine: 2,
  }
  const distinctName = {
    key: 'tab-c:4',
    parentTabId: 'tab-c',
    parentFileName: 'parent.ttl',
    includeLine: 4,
  }
  const sameParentLine2 = {
    key: 'tab-d:2',
    parentTabId: 'tab-d',
    parentFileName: 'dual.ttl',
    includeLine: 2,
  }
  const sameParentLine4 = {
    key: 'tab-d:4',
    parentTabId: 'tab-d',
    parentFileName: 'dual.ttl',
    includeLine: 4,
  }
  if (
    formatImportedEnvParentOptionLabel(sameNameA, [sameNameA, sameNameB]) === '未保存 #1（L2）'
    && formatImportedEnvParentOptionLabel(sameNameB, [sameNameA, sameNameB]) === '未保存 #2（L2）'
  ) {
    ok('同名の親タブは登場順の番号でラベルを区別する')
  } else {
    ng('同名の親タブは登場順の番号でラベルを区別する', {
      a: formatImportedEnvParentOptionLabel(sameNameA, [sameNameA, sameNameB]),
      b: formatImportedEnvParentOptionLabel(sameNameB, [sameNameA, sameNameB]),
    })
  }
  if (formatImportedEnvParentOptionLabel(distinctName, [sameNameA, distinctName]) === 'parent.ttl（L4）') {
    ok('ファイル名が異なれば番号を付けない')
  } else {
    ng(
      'ファイル名が異なれば番号を付けない',
      formatImportedEnvParentOptionLabel(distinctName, [sameNameA, distinctName]),
    )
  }
  if (
    formatImportedEnvParentOptionLabel(sameParentLine2, [sameParentLine2, sameParentLine4]) === 'dual.ttl（L2）'
    && formatImportedEnvParentOptionLabel(sameParentLine4, [sameParentLine2, sameParentLine4]) === 'dual.ttl（L4）'
  ) {
    ok('同一親の複数 include 行はファイル名を重複させず行番号で区別する')
  } else {
    ng('同一親の複数 include 行はファイル名を重複させず行番号で区別する', {
      line2: formatImportedEnvParentOptionLabel(sameParentLine2, [sameParentLine2, sameParentLine4]),
      line4: formatImportedEnvParentOptionLabel(sameParentLine4, [sameParentLine2, sameParentLine4]),
    })
  }

  return { passed, failed }
}

const isDirectRun = process.argv[1]?.replace(/\\/g, '/').endsWith('test-variable-assumptions.ts')
if (isDirectRun) {
  const { passed, failed } = runVariableAssumptionTests()
  console.log(`\n=== VARIABLE ASSUMPTIONS: ${passed} passed, ${failed} failed ===`)
  process.exit(failed > 0 ? 1 : 0)
}
