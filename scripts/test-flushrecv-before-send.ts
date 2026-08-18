/**
 * flushrecv → send → wait 順序チェックのテスト。
 */
import { readFileSync } from 'node:fs'
import { analyzeTTL } from '../src/ttl/analyzer'
import {
  buildFlushrecvBeforeSendMessage,
  collectFlushrecvBeforeSendDiagnostics,
  hasFlushrecvBeforeSend,
  isFlushrecvFollowedByWaitWithoutSend,
} from '../src/ttl/flushrecvBeforeSend'
import { pruneFlushrecvWarningIgnores } from '../src/ttl/flushrecvWarningIgnores'
import {
  getEditorAnalyzeOptions,
  setFlushrecvBeforeSendCheck,
} from '../src/ttl/analysisContext'
import { stripComments } from '../src/ttl/tokenize'

export interface TestRunResult {
  passed: number
  failed: number
}

function analyzeWithOption(src: string) {
  return analyzeTTL(src, { checkFlushrecvBeforeSend: true })
}

function hasWarning(src: string, includes: string, line = 1): boolean {
  return analyzeWithOption(src).diagnostics.some(
    (d) => d.line === line && d.severity === 'warning' && d.message.includes(includes),
  )
}

function hasNoFlushrecvWarning(src: string): boolean {
  return analyzeWithOption(src).diagnostics.every(
    (d) => d.severity !== 'warning' || !d.message.includes('flushrecv'),
  )
}

export function runFlushrecvBeforeSendTests(): TestRunResult {
  let passed = 0
  let failed = 0

  console.log('=== flushrecv → send → wait チェック ===')

  function ok(label: string) {
    passed++
    console.log(`  OK  ${label}`)
  }

  function ng(label: string, detail?: unknown) {
    failed++
    console.error(`  NG  ${label}`, detail ?? '')
  }

  const warnExample = `sendln 'aaa'\nflushrecv\nwait '$'\nend`
  if (hasWarning(warnExample, 'sendln', 1)) ok('sendln → flushrecv → wait で sendln に警告')
  else ng('sendln → flushrecv → wait で sendln に警告', analyzeWithOption(warnExample).diagnostics)

  const offResult = analyzeTTL(warnExample)
  if (!offResult.diagnostics.some((d) => d.message.includes('flushrecv'))) ok('オプション OFF では警告なし')
  else ng('オプション OFF では警告なし', offResult.diagnostics)

  const okPattern = `flushrecv\nsendln 'aaa'\nwait '$'\nend`
  if (hasNoFlushrecvWarning(okPattern)) ok('flushrecv → sendln → wait は警告なし')
  else ng('flushrecv → sendln → wait は警告なし', analyzeWithOption(okPattern).diagnostics)

  const sendBetween = `sendln 'aaa'\nflushrecv\nsendln 'bbb'\nwait '$'\nend`
  if (hasWarning(sendBetween, 'sendln', 1)) ok('flushrecv 手前の sendln は警告対象')
  else ng('flushrecv 手前の sendln は警告対象', analyzeWithOption(sendBetween).diagnostics)

  if (!hasWarning(sendBetween, 'sendln', 3)) ok('flushrecv 直後の sendln は警告なし')
  else ng('flushrecv 直後の sendln は警告なし', analyzeWithOption(sendBetween).diagnostics)

  const multiSendBetween = `flushrecv\nsendln 'aaa'\nsendln 'bbb'\nwait '$'\nend`
  if (hasWarning(multiSendBetween, 'sendln', 3)) ok('flushrecv と wait の間に send が 2 つ以上なら 2 つ目に警告')
  else ng('flushrecv と wait の間に send が 2 つ以上なら 2 つ目に警告', analyzeWithOption(multiSendBetween).diagnostics)

  if (!hasWarning(multiSendBetween, 'sendln', 2)) ok('1 つ目の send（直後 flushrecv あり）は警告なし')
  else ng('1 つ目の send（直後 flushrecv あり）は警告なし', analyzeWithOption(multiSendBetween).diagnostics)

  const doubleSend = `sendln 'aaa'\nsendln 'bbb'\nflushrecv\nwait '$'\nend`
  if (hasWarning(doubleSend, 'sendln', 1) && hasWarning(doubleSend, 'sendln', 2))
    ok('連続 send がともに flushrecv なしなら両方警告')
  else ng('連続 send がともに flushrecv なしなら両方警告', analyzeWithOption(doubleSend).diagnostics)

  const flushBeforeSend = `flushrecv\nsendln 'aaa'\nflushrecv\nwait '$'\nend`
  if (hasNoFlushrecvWarning(flushBeforeSend)) ok('flushrecv → send → flushrecv → wait は警告なし')
  else ng('flushrecv → send → flushrecv → wait は警告なし', analyzeWithOption(flushBeforeSend).diagnostics)

  const secondSendNoFlush = `flushrecv\nsendln 'aaa'\nsendln 'bbb'\nflushrecv\nwait '$'\nend`
  if (hasWarning(secondSendNoFlush, 'sendln', 3)) ok('2 つ目の send に flushrecv がない場合は警告')
  else ng('2 つ目の send に flushrecv がない場合は警告', analyzeWithOption(secondSendNoFlush).diagnostics)

  const lines = stripComments(warnExample)
  if (isFlushrecvFollowedByWaitWithoutSend(lines, 1)) ok('flushrecv の後に wait まで send なしを検出')
  else ng('flushrecv の後に wait まで send なしを検出')

  if (!hasFlushrecvBeforeSend(lines, 0)) ok('send 行の直前に flushrecv がない')
  else ng('send 行の直前に flushrecv がない')

  const msg = buildFlushrecvBeforeSendMessage('sendln')
  if (msg.includes('flushrecv') && msg.includes('sendln')) ok('警告メッセージに flushrecv と sendln を含む')
  else ng('警告メッセージに flushrecv と sendln を含む', msg)

  const direct = collectFlushrecvBeforeSendDiagnostics(lines)
  if (direct.length === 1 && direct[0]?.line === 1) ok('collectFlushrecvBeforeSendDiagnostics が 1 件')
  else ng('collectFlushrecvBeforeSendDiagnostics が 1 件', direct)

  const ignored = analyzeTTL(warnExample, {
    checkFlushrecvBeforeSend: true,
    ignoredFlushrecvWarningLines: new Set([1]),
  })
  if (!ignored.diagnostics.some((d) => d.message.includes('flushrecv'))) ok('無視行は診断に出ない')
  else ng('無視行は診断に出ない', ignored.diagnostics)

  try {
    setFlushrecvBeforeSendCheck(true)
    const lintMiss = analyzeTTL(warnExample, getEditorAnalyzeOptions())
    if (lintMiss.diagnostics.some((d) => d.line === 1 && d.message.includes('flushrecv')))
      ok('linter フォールバック（キャッシュ未ヒット）でもチェック ON なら警告')
    else ng('linter フォールバック（キャッシュ未ヒット）でもチェック ON なら警告', lintMiss.diagnostics)

    setFlushrecvBeforeSendCheck(true, new Set([1]))
    const lintIgnored = analyzeTTL(warnExample, getEditorAnalyzeOptions())
    if (!lintIgnored.diagnostics.some((d) => d.message.includes('flushrecv')))
      ok('linter フォールバックでも無視行は診断に出ない')
    else ng('linter フォールバックでも無視行は診断に出ない', lintIgnored.diagnostics)

    setFlushrecvBeforeSendCheck(false)
    const lintOff = analyzeTTL(warnExample, getEditorAnalyzeOptions())
    if (!lintOff.diagnostics.some((d) => d.message.includes('flushrecv')))
      ok('linter フォールバックはチェック OFF なら警告なし')
    else ng('linter フォールバックはチェック OFF なら警告なし', lintOff.diagnostics)
  } finally {
    setFlushrecvBeforeSendCheck(false)
  }

  const waitnWarn = `sendln 'aaa'\nflushrecv\nwaitn 10\nend`
  if (hasWarning(waitnWarn, 'sendln', 1)) ok('sendln → flushrecv → waitn で sendln に警告')
  else ng('sendln → flushrecv → waitn で sendln に警告', analyzeWithOption(waitnWarn).diagnostics)

  const waitnOk = `flushrecv\nsendln 'aaa'\nwaitn 10\nend`
  if (hasNoFlushrecvWarning(waitnOk)) ok('flushrecv → sendln → waitn は警告なし')
  else ng('flushrecv → sendln → waitn は警告なし', analyzeWithOption(waitnOk).diagnostics)

  const waitnMulti = `flushrecv\nsendln 'aaa'\nsendln 'bbb'\nwaitn 10\nend`
  if (hasWarning(waitnMulti, 'sendln', 3) && !hasWarning(waitnMulti, 'sendln', 2))
    ok('waitn でも 2 つ目の send に警告')
  else ng('waitn でも 2 つ目の send に警告', analyzeWithOption(waitnMulti).diagnostics)

  const waitlnWarn = `sendln 'aaa'\nflushrecv\nwaitln '$'\nend`
  if (hasWarning(waitlnWarn, 'sendln', 1)) ok('waitln でも flushrecv 手前の send を警告')
  else ng('waitln でも flushrecv 手前の send を警告', analyzeWithOption(waitlnWarn).diagnostics)

  const recvlnWarn = `sendln 'aaa'\nflushrecv\nrecvln\nend`
  if (hasWarning(recvlnWarn, 'sendln', 1)) ok('recvln でも flushrecv 手前の send を警告')
  else ng('recvln でも flushrecv 手前の send を警告', analyzeWithOption(recvlnWarn).diagnostics)

  const afterEnd = `sendln 'goodbye'\nend\n\n:retry\nflushrecv\nsendln 'cmd'\nwait '$'\n`
  if (!hasWarning(afterEnd, 'sendln', 1) && !hasWarning(afterEnd, 'sendln', 6))
    ok('end より前の send を後続サブルーチンの flushrecv で警告しない')
  else ng('end より前の send を後続サブルーチンの flushrecv で警告しない', analyzeWithOption(afterEnd).diagnostics)

  const afterReturn = `sendln 'from-sub'\nreturn\n\n:next\nflushrecv\nsendln 'cmd'\nwait '$'\n`
  if (!hasWarning(afterReturn, 'sendln', 1) && !hasWarning(afterReturn, 'sendln', 6))
    ok('return より前の send を後続サブルーチンの flushrecv で警告しない')
  else ng('return より前の send を後続サブルーチンの flushrecv で警告しない', analyzeWithOption(afterReturn).diagnostics)

  const sameSub = `sendln 'aaa'\nflushrecv\nwait '$'\nreturn`
  if (hasWarning(sameSub, 'sendln', 1)) ok('同一サブルーチン内の send → flushrecv → wait は警告')
  else ng('同一サブルーチン内の send → flushrecv → wait は警告', analyzeWithOption(sameSub).diagnostics)

  const pruned = pruneFlushrecvWarningIgnores({ '1': true, '9': true }, new Set([1]))
  if (pruned['1'] === true && pruned['9'] === undefined) ok('警告対象でなくなった無視行は prune される')
  else ng('警告対象でなくなった無視行は prune される', pruned)

  const sample = readFileSync(new URL('../samples/flushrecv-before-send-verify.ttl', import.meta.url), 'utf8')
  const sampleWarnLines = analyzeWithOption(sample)
    .diagnostics.filter((d) => d.message.includes('flushrecv'))
    .map((d) => d.line)
  if (JSON.stringify(sampleWarnLines) === JSON.stringify([38, 46, 54, 65, 80, 89]))
    ok('検証用サンプルの警告行')
  else ng('検証用サンプルの警告行', sampleWarnLines)

  return { passed, failed }
}

const isDirectRun = process.argv[1]?.replace(/\\/g, '/').endsWith('test-flushrecv-before-send.ts')
if (isDirectRun) {
  const { passed, failed } = runFlushrecvBeforeSendTests()
  console.log(`\n=== FLUSHRECV BEFORE SEND: ${passed} passed, ${failed} failed ===`)
  process.exit(failed > 0 ? 1 : 0)
}
