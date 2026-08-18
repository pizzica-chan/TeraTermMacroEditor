/**
 * 連続 send / sendln の間に wait・ダイアログがない警告のテスト。
 */
import { readFileSync } from 'node:fs'
import { analyzeTTL } from '../src/ttl/analyzer'
import {
  buildConsecutiveSendMessage,
  collectConsecutiveSendDiagnostics,
} from '../src/ttl/consecutiveSend'
import { pruneConsecutiveSendWarningIgnores } from '../src/ttl/consecutiveSendWarningIgnores'
import {
  getEditorAnalyzeOptions,
  setConsecutiveSendCheck,
} from '../src/ttl/analysisContext'

export interface TestRunResult {
  passed: number
  failed: number
}

function analyzeWithOption(src: string) {
  return analyzeTTL(src, { checkConsecutiveSend: true })
}

function warningLines(src: string): number[] {
  return analyzeWithOption(src)
    .diagnostics.filter((d) => d.code === 'consecutive-send')
    .map((d) => d.line)
}

export function runConsecutiveSendTests(): TestRunResult {
  let passed = 0
  let failed = 0

  console.log('=== 連続 send チェック ===')

  function ok(label: string) {
    passed++
    console.log(`  OK  ${label}`)
  }

  function ng(label: string, detail?: unknown) {
    failed++
    console.error(`  NG  ${label}`, detail ?? '')
  }

  const consecutive = `sendln 'aaa'\nsendln 'bbb'\nend`
  if (JSON.stringify(warningLines(consecutive)) === JSON.stringify([2]))
    ok('連続 sendln は 2 つ目だけ警告')
  else ng('連続 sendln は 2 つ目だけ警告', warningLines(consecutive))

  const offResult = analyzeTTL(consecutive)
  if (!offResult.diagnostics.some((d) => d.code === 'consecutive-send')) ok('オプション OFF では警告なし')
  else ng('オプション OFF では警告なし', offResult.diagnostics)

  const withWait = `sendln 'aaa'\nwait '$'\nsendln 'bbb'\nend`
  if (warningLines(withWait).length === 0) ok('間に wait があれば警告なし')
  else ng('間に wait があれば警告なし', warningLines(withWait))

  const withDialog = `sendln 'aaa'\nmessagebox 'ok' 'info'\nsendln 'bbb'\nend`
  if (warningLines(withDialog).length === 0) ok('間に messagebox があれば警告なし')
  else ng('間に messagebox があれば警告なし', warningLines(withDialog))

  const withYesno = `sendln 'aaa'\nyesnobox 'ok?' 'q'\nsendln 'bbb'\nend`
  if (warningLines(withYesno).length === 0) ok('間に yesnobox があれば警告なし')
  else ng('間に yesnobox があれば警告なし', warningLines(withYesno))

  const mixed = `send 'a'\nsendln 'b'\nsend 'c'\nend`
  if (JSON.stringify(warningLines(mixed)) === JSON.stringify([2, 3]))
    ok('send と sendln の混在も 2 つ目以降を警告')
  else ng('send と sendln の混在も 2 つ目以降を警告', warningLines(mixed))

  const broadcast = `sendln 'aaa'\nsendbroadcast 'bbb'\nsendln 'ccc'\nend`
  if (JSON.stringify(warningLines(broadcast)) === JSON.stringify([3]))
    ok('sendbroadcast は対象外（間にあっても区切りにしない）')
  else ng('sendbroadcast は対象外（間にあっても区切りにしない）', warningLines(broadcast))

  const pauseBetween = `sendln 'aaa'\npause 1\nsendln 'bbb'\nend`
  if (JSON.stringify(warningLines(pauseBetween)) === JSON.stringify([3]))
    ok('pause は wait 扱いしない')
  else ng('pause は wait 扱いしない', warningLines(pauseBetween))

  const statusboxBetween = `sendln 'aaa'\nstatusbox 'm' 't'\nsendln 'bbb'\nend`
  if (JSON.stringify(warningLines(statusboxBetween)) === JSON.stringify([3]))
    ok('statusbox はダイアログ扱いしない')
  else ng('statusbox はダイアログ扱いしない', warningLines(statusboxBetween))

  const waitlnOk = `sendln 'aaa'\nwaitln '$'\nsendln 'bbb'\nend`
  if (warningLines(waitlnOk).length === 0) ok('waitln で区切れば警告なし')
  else ng('waitln で区切れば警告なし', warningLines(waitlnOk))

  const recvlnOk = `sendln 'aaa'\nrecvln\nsendln 'bbb'\nend`
  if (warningLines(recvlnOk).length === 0) ok('recvln で区切れば警告なし')
  else ng('recvln で区切れば警告なし', warningLines(recvlnOk))

  const afterEnd = `sendln 'aaa'\nend\nsendln 'bbb'\n`
  if (warningLines(afterEnd).length === 0) ok('end で区間が分かれる')
  else ng('end で区間が分かれる', warningLines(afterEnd))

  const afterReturn = `sendln 'from-sub'\nreturn\nsendln 'next'\n`
  if (warningLines(afterReturn).length === 0) ok('return で区間が分かれる')
  else ng('return で区間が分かれる', warningLines(afterReturn))

  const afterCall = `sendln 'aaa'\ncall sub\nsendln 'bbb'\nend`
  if (warningLines(afterCall).length === 0) ok('call で区間が分かれる')
  else ng('call で区間が分かれる', warningLines(afterCall))

  const afterInclude = `sendln 'aaa'\ninclude 'sub.ttl'\nsendln 'bbb'\nend`
  if (warningLines(afterInclude).length === 0) ok('include で区間が分かれる')
  else ng('include で区間が分かれる', warningLines(afterInclude))

  const afterIf = `sendln 'aaa'\nif 1 then\nsendln 'bbb'\nendif\nend`
  if (JSON.stringify(warningLines(afterIf)) === JSON.stringify([3]))
    ok('if は区切りにしない')
  else ng('if は区切りにしない', warningLines(afterIf))

  const triple = `sendln 'a'\nsendln 'b'\nwait '$'\nsendln 'c'\nsendln 'd'\nend`
  if (JSON.stringify(warningLines(triple)) === JSON.stringify([2, 5]))
    ok('wait の前後でそれぞれ 2 つ目を警告')
  else ng('wait の前後でそれぞれ 2 つ目を警告', warningLines(triple))

  const msg = buildConsecutiveSendMessage('sendln')
  if (msg.includes('sendln') && msg.includes('wait')) ok('警告メッセージに sendln と wait を含む')
  else ng('警告メッセージに sendln と wait を含む', msg)

  const direct = collectConsecutiveSendDiagnostics(['sendln \'a\'', 'sendln \'b\'', 'end'])
  if (direct.length === 1 && direct[0]?.line === 2) ok('collectConsecutiveSendDiagnostics が 2 行目')
  else ng('collectConsecutiveSendDiagnostics が 2 行目', direct)

  const ignored = analyzeTTL(consecutive, {
    checkConsecutiveSend: true,
    ignoredConsecutiveSendWarningLines: new Set([2]),
  })
  if (!ignored.diagnostics.some((d) => d.code === 'consecutive-send')) ok('無視行は診断に出ない')
  else ng('無視行は診断に出ない', ignored.diagnostics)

  try {
    setConsecutiveSendCheck(true)
    const lintMiss = analyzeTTL(consecutive, getEditorAnalyzeOptions())
    if (lintMiss.diagnostics.some((d) => d.line === 2 && d.code === 'consecutive-send'))
      ok('linter フォールバックでもチェック ON なら警告')
    else ng('linter フォールバックでもチェック ON なら警告', lintMiss.diagnostics)

    setConsecutiveSendCheck(true, new Set([2]))
    const lintIgnored = analyzeTTL(consecutive, getEditorAnalyzeOptions())
    if (!lintIgnored.diagnostics.some((d) => d.code === 'consecutive-send'))
      ok('linter フォールバックでも無視行は診断に出ない')
    else ng('linter フォールバックでも無視行は診断に出ない', lintIgnored.diagnostics)

    setConsecutiveSendCheck(false)
    const lintOff = analyzeTTL(consecutive, getEditorAnalyzeOptions())
    if (!lintOff.diagnostics.some((d) => d.code === 'consecutive-send'))
      ok('linter フォールバックはチェック OFF なら警告なし')
    else ng('linter フォールバックはチェック OFF なら警告なし', lintOff.diagnostics)
  } finally {
    setConsecutiveSendCheck(false)
  }

  const pruned = pruneConsecutiveSendWarningIgnores({ '2': true, '9': true }, new Set([2]))
  if (pruned['2'] === true && pruned['9'] === undefined) ok('警告対象でなくなった無視行は prune される')
  else ng('警告対象でなくなった無視行は prune される', pruned)

  const sample = readFileSync(new URL('../samples/consecutive-send-verify.ttl', import.meta.url), 'utf8')
  const sampleWarnLines = warningLines(sample)
  if (JSON.stringify(sampleWarnLines) === JSON.stringify([28, 54, 63]))
    ok('検証用サンプルの警告行')
  else ng('検証用サンプルの警告行', sampleWarnLines)

  return { passed, failed }
}

const isDirectRun = process.argv[1]?.replace(/\\/g, '/').endsWith('test-consecutive-send.ts')
if (isDirectRun) {
  const { passed, failed } = runConsecutiveSendTests()
  console.log(`\n=== CONSECUTIVE SEND: ${passed} passed, ${failed} failed ===`)
  process.exit(failed > 0 ? 1 : 0)
}
