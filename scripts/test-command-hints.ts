/**
 * TTL コマンドホバーヒントのテスト。
 */
import {
  findCommandHoverTarget,
  getCommandHint,
  isCommandHoverTarget,
} from '../src/ttl/commandHints'
import { isPositionInBlockComment, tokenizeLine } from '../src/ttl/tokenize'

function tokenColumn(line: string, word: string): number {
  const tok = tokenizeLine(line, 1).find((t) => t.text.toLowerCase() === word.toLowerCase())
  if (!tok) throw new Error(`token '${word}' not found in: ${line}`)
  return tok.column
}

export interface TestRunResult {
  passed: number
  failed: number
}

export function runCommandHintTests(): TestRunResult {
  let passed = 0
  let failed = 0

  console.log('=== コマンドホバーヒント ===')

  function ok(label: string) {
    passed++
    console.log(`  OK  ${label}`)
  }

  function ng(label: string, detail?: unknown) {
    failed++
    console.error(`  NG  ${label}`, detail ?? '')
  }

  const getdate = getCommandHint('getdate')
  if (getdate?.summary.includes('日付') && getdate.usage.includes('getdate')) {
    ok('getdate の要約と usage')
  } else {
    ng('getdate の要約と usage', getdate)
  }

  const sendln = getCommandHint('sendln')
  if (sendln?.usage.includes('sendln')) ok('sendln の usage')
  else ng('sendln の usage', sendln)

  const ifHint = getCommandHint('if')
  if (ifHint?.kind === 'keyword' && ifHint.usage.includes('if')) ok('if はキーワードヒント')
  else ng('if はキーワードヒント', ifHint)

  if (ifHint?.manualUrl?.includes('/ja/macro/command/ifthenelseif.html')) {
    ok('if は ifthenelseif ページへリンク')
  } else {
    ng('if は ifthenelseif ページへリンク', ifHint?.manualUrl)
  }

  const elseifHint = getCommandHint('elseif')
  if (elseifHint?.manualUrl?.includes('ifthenelseif.html')) ok('elseif も ifthenelseif ページへリンク')
  else ng('elseif も ifthenelseif ページへリンク', elseifHint?.manualUrl)

  const andHint = getCommandHint('and')
  if (andHint?.manualUrl?.includes('/ja/macro/syntax/expressions.html')) {
    ok('and は式と演算子ページへリンク')
  } else {
    ng('and は式と演算子ページへリンク', andHint?.manualUrl)
  }

  const randomHint = getCommandHint('random')
  if (randomHint?.note && (randomHint.note.includes('result:') || randomHint.note.includes('出力:'))) {
    ok('random に補足情報')
  } else {
    ng('random に補足情報', randomHint?.note)
  }

  const unknown = getCommandHint('not_a_command')
  if (unknown === undefined) ok('未知の識別子は undefined')
  else ng('未知の識別子は undefined', unknown)

  const target = findCommandHoverTarget('getdate datestr', 1, 2)
  if (target?.cmd === 'getdate' && target.from === 0) ok('getdate コマンド上を検出')
  else ng('getdate コマンド上を検出', target)

  const notCmd = findCommandHoverTarget('datestr = getdate', 1, 10)
  if (notCmd === null) ok('代入右辺の getdate はコマンドホバー対象外')
  else ng('代入右辺の getdate はコマンドホバー対象外', notCmd)

  const assignLhs = findCommandHoverTarget("getdate = '2026-01-01'", 1, 2)
  if (assignLhs === null) ok('代入左辺の getdate はコマンドホバー対象外')
  else ng('代入左辺の getdate はコマンドホバー対象外', assignLhs)

  const pauseHint = getCommandHint('pause')
  if (
    pauseHint?.summary.includes('秒')
    && !pauseHint.summary.includes('1/100')
    && pauseHint.usage.includes('pause')
  ) {
    ok('pause は秒単位')
  } else {
    ng('pause は秒単位', pauseHint)
  }

  const exitHint = getCommandHint('exit')
  if (
    exitHint?.summary.includes('include')
    && exitHint.summary.includes('end')
    && !exitHint.summary.includes('ブロック')
  ) {
    ok('exit は include から戻る / メインでは end')
  } else {
    ng('exit は include から戻る / メインでは end', exitHint)
  }

  const untilHint = getCommandHint('until')
  if (
    untilHint?.usage.includes('until 条件')
    && untilHint.usage.includes('enduntil')
    && !untilHint.usage.includes('do ... until')
  ) {
    ok('until は until/enduntil 形式')
  } else {
    ng('until は until/enduntil 形式', untilHint)
  }

  const doHint = getCommandHint('do')
  const loopHint = getCommandHint('loop')
  if (
    doHint?.usage.includes('while')
    && doHint.usage.includes('until')
    && !doHint.summary.includes('do / until')
    && loopHint?.usage.includes('while')
    && loopHint.usage.includes('until')
  ) {
    ok('do/loop は while と until の両方')
  } else {
    ng('do/loop は while と until の両方', { doHint, loopHint })
  }

  const wait4allHint = getCommandHint('wait4all')
  if (
    wait4allHint?.summary.includes('全端末')
    && !wait4allHint.summary.includes('複数パターンすべて')
  ) {
    ok('wait4all は全端末のいずれか')
  } else {
    ng('wait4all は全端末のいずれか', wait4allHint)
  }

  const strmatchHint = getCommandHint('strmatch')
  if (
    strmatchHint?.usage.includes("'対象'")
    && strmatchHint.usage.includes("'正規表現'")
    && (strmatchHint.usage.indexOf("'対象'") < strmatchHint.usage.indexOf("'正規表現'"))
  ) {
    ok('strmatch は対象→正規表現の順')
  } else {
    ng('strmatch は対象→正規表現の順', strmatchHint?.usage)
  }

  const strjoinHint = getCommandHint('strjoin')
  if (
    strjoinHint?.summary.includes('groupmatchstr')
    && !strjoinHint.summary.includes('配列')
  ) {
    ok('strjoin は groupmatchstr の連結')
  } else {
    ng('strjoin は groupmatchstr の連結', strjoinHint)
  }

  const strconcatHint = getCommandHint('strconcat')
  if (
    strconcatHint?.usage.includes('strconcat dest')
    && !strconcatHint.usage.includes("'a' 'b'")
  ) {
    ok('strconcat は追加文字列が1つ')
  } else {
    ng('strconcat は追加文字列が1つ', strconcatHint?.usage)
  }

  const sendfileHint = getCommandHint('sendfile')
  if (
    sendfileHint?.usage.includes('sendfile')
    && sendfileHint.usage.includes('バイナリフラグ')
  ) {
    ok('sendfile はバイナリフラグ付き')
  } else {
    ng('sendfile はバイナリフラグ付き', sendfileHint?.usage)
  }

  const waitrecvHint = getCommandHint('waitrecv')
  if (
    waitrecvHint?.usage.includes('len')
    && waitrecvHint.usage.includes('pos')
    && !waitrecvHint.usage.includes('start len')
  ) {
    ok('waitrecv は substring len pos')
  } else {
    ng('waitrecv は substring len pos', waitrecvHint?.usage)
  }

  const callHint = getCommandHint('call')
  if (callHint?.usage === 'call ラベル名') ok('call はラベルのみ')
  else ng('call はラベルのみ', callHint?.usage)

  const disconnectHint = getCommandHint('disconnect')
  if (
    disconnectHint?.usage.includes('confirm')
    && !disconnectHint.usage.includes('force')
  ) {
    ok('disconnect は confirm 引数')
  } else {
    ng('disconnect は confirm 引数', disconnectHint)
  }

  const breakHint = getCommandHint('break')
  const continueHint = getCommandHint('continue')
  if (
    breakHint?.summary.includes('for')
    && breakHint.summary.includes('while')
    && !breakHint.summary.includes('do')
    && continueHint?.summary.includes('for')
    && continueHint.summary.includes('while')
    && !continueHint.summary.includes('do')
  ) {
    ok('break/continue は for/while のみ')
  } else {
    ng('break/continue は for/while のみ', { breakHint, continueHint })
  }

  const labeled = ':lab getdate datestr'
  const labelLine = findCommandHoverTarget(labeled, 1, tokenColumn(labeled, 'getdate'))
  if (labelLine?.cmd === 'getdate') ok('ラベル直後のコマンドを検出')
  else ng('ラベル直後のコマンドを検出', labelLine)

  const ifThenSend = "if 1 then sendln 'ok'"
  const thenHover = findCommandHoverTarget(ifThenSend, 1, tokenColumn(ifThenSend, 'then'))
  const sendlnHover = findCommandHoverTarget(ifThenSend, 1, tokenColumn(ifThenSend, 'sendln'))
  const ifHover = findCommandHoverTarget(ifThenSend, 1, tokenColumn(ifThenSend, 'if'))
  if (ifHover?.cmd === 'if' && thenHover?.cmd === 'then' && sendlnHover?.cmd === 'sendln') {
    ok('単行 if の then と直後コマンドを検出')
  } else {
    ng('単行 if の then と直後コマンドを検出', { ifHover, thenHover, sendlnHover })
  }

  const elseSend = "else sendln 'x'"
  const elseSendHover = findCommandHoverTarget(elseSend, 1, tokenColumn(elseSend, 'sendln'))
  if (elseSendHover?.cmd === 'sendln') ok('else 直後のコマンドを検出')
  else ng('else 直後のコマンドを検出', elseSendHover)

  const ifAssign = 'if 1 then datestr = getdate'
  const ifAssignHover = findCommandHoverTarget(ifAssign, 1, tokenColumn(ifAssign, 'if'))
  const rhsHover = findCommandHoverTarget(ifAssign, 1, tokenColumn(ifAssign, 'getdate'))
  if (ifAssignHover?.cmd === 'if' && rhsHover === null) {
    ok('then 後の代入では if のみ対象で右辺コマンドは対象外')
  } else {
    ng('then 後の代入では if のみ対象で右辺コマンドは対象外', { ifAssignHover, rhsHover })
  }

  if (isCommandHoverTarget('wait')) ok('wait はホバー対象')
  else ng('wait はホバー対象')

  const fallback = getCommandHint('setbaud')
  if (fallback?.summary && fallback.manualUrl?.includes('/ja/macro/command/setbaud.html')) {
    ok('未整備コマンドはフォールバックヒント')
  } else {
    ng('未整備コマンドはフォールバックヒント', fallback)
  }

  const blockCommentSource = "/*\nsend 'foo'\n*/\nsend 'bar'"
  if (isPositionInBlockComment(blockCommentSource, 2, 1)) {
    ok('複数行ブロックコメント内の行はコメント扱い')
  } else {
    ng('複数行ブロックコメント内の行はコメント扱い')
  }
  if (!isPositionInBlockComment(blockCommentSource, 4, 1)) {
    ok('ブロックコメント終了後の行はコメント扱いにならない')
  } else {
    ng('ブロックコメント終了後の行はコメント扱いにならない')
  }

  const singleLineBlockComment = "/* memo */ send 'after'"
  const afterCommentCol = tokenColumn(singleLineBlockComment, 'send')
  if (!isPositionInBlockComment(singleLineBlockComment, 1, afterCommentCol)) {
    ok('同一行で閉じたブロックコメント後は対象外')
  } else {
    ng('同一行で閉じたブロックコメント後は対象外')
  }

  const commentMarkerInString = "send '/* not a comment */'"
  const stringCol = tokenColumn(commentMarkerInString, 'send')
  if (!isPositionInBlockComment(commentMarkerInString, 1, stringCol)) {
    ok('文字列リテラル内の /* はブロックコメント開始とみなさない')
  } else {
    ng('文字列リテラル内の /* はブロックコメント開始とみなさない')
  }

  return { passed, failed }
}

const isDirectRun = process.argv[1]?.replace(/\\/g, '/').endsWith('test-command-hints.ts')
if (isDirectRun) {
  const { passed, failed } = runCommandHintTests()
  console.log(`\n=== COMMAND HINTS: ${passed} passed, ${failed} failed ===`)
  process.exit(failed > 0 ? 1 : 0)
}
