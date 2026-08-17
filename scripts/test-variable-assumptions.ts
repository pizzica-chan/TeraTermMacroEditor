/**
 * 未確定変数のユーザー仮定（variableAssumptions）のテスト。
 *
 * inputbox / getenv / random 等で静的に決まらない値を仮定すると、
 * 送信データ・ホバー・後続の if 条件に反映される。ドライランには混入しない。
 */
import type { IncludeResolver } from '../src/ttl/analyzer'
import { evaluateTTL } from '../src/ttl/evaluator'
import {
  collectIndeterminateVariables,
  isValidVariableAssumptionInput,
  variableAssumptionKey,
  variableAssumptionsFromRecord,
  pruneVariableAssumptions,
} from '../src/ttl/variableAssumptions'
import { collectIndeterminateIfBranches } from '../src/ttl/branchAssumptions'

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

  return { passed, failed }
}

const isDirectRun = process.argv[1]?.replace(/\\/g, '/').endsWith('test-variable-assumptions.ts')
if (isDirectRun) {
  const { passed, failed } = runVariableAssumptionTests()
  console.log(`\n=== VARIABLE ASSUMPTIONS: ${passed} passed, ${failed} failed ===`)
  process.exit(failed > 0 ? 1 : 0)
}
