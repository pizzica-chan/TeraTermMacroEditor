/**
 * 代入右辺にコマンド名を書く誤用（datestr = getdate 等）の警告テスト。
 */
import { analyzeTTL } from '../src/ttl/analyzer'
import {
  buildAssignmentRhsCommandMisuseMessage,
  findAssignmentRhsCommandToken,
  isAssignmentRhsCommandMisuseTarget,
} from '../src/ttl/assignmentCommandMisuse'
import { tokenizeLine } from '../src/ttl/tokenize'
import { findAssignmentIndex } from '../src/ttl/argChecker'

export interface TestRunResult {
  passed: number
  failed: number
}

function hasWarning(src: string, includes: string, line = 1): boolean {
  return analyzeTTL(src).diagnostics.some(
    (d) => d.line === line && d.severity === 'warning' && d.message.includes(includes),
  )
}

export function runAssignmentCommandMisuseTests(): TestRunResult {
  let passed = 0
  let failed = 0

  console.log('=== 代入右辺のコマンド名誤用 ===')

  function ok(label: string) {
    passed++
    console.log(`  OK  ${label}`)
  }

  function ng(label: string, detail?: unknown) {
    failed++
    console.error(`  NG  ${label}`, detail ?? '')
  }

  if (hasWarning('datestr = getdate\nend', 'getdate', 1)) ok('datestr = getdate で警告')
  else ng('datestr = getdate で警告', analyzeTTL('datestr = getdate\nend').diagnostics)

  if (hasWarning('home = getenv\nend', 'getenv', 1)) ok('home = getenv で警告')
  else ng('home = getenv で警告')

  if (hasWarning('n = random\nend', 'random', 1)) ok('n = random で警告')
  else ng('n = random で警告')

  const randomMsg = buildAssignmentRhsCommandMisuseMessage('random', 'n')
  if (randomMsg.includes('random n 最大値')) ok('random の例示に最大値引数を含む')
  else ng('random の例示に最大値引数を含む', randomMsg)

  if (hasWarning('valstr = int2str\nend', 'int2str', 1)) ok('valstr = int2str で警告')
  else ng('valstr = int2str で警告')

  const int2strMsg = buildAssignmentRhsCommandMisuseMessage('int2str', 'valstr')
  if (int2strMsg.includes('int2str valstr')) ok('int2str の例示が公式どおり出力変数が先')
  else ng('int2str の例示が公式どおり出力変数が先', int2strMsg)

  if (hasWarning('val = str2int\nend', 'str2int', 1)) ok('val = str2int で警告')
  else ng('val = str2int で警告')

  if (hasWarning('substr = strcopy\nend', 'strcopy', 1)) ok('substr = strcopy で警告')
  else ng('substr = strcopy で警告')

  const strcopyMsg = buildAssignmentRhsCommandMisuseMessage('strcopy', 'substr')
  if (strcopyMsg.includes("strcopy '文字列'")) ok('strcopy の例示に元文字列引数を含む')
  else ng('strcopy の例示に元文字列引数を含む', strcopyMsg)

  if (hasWarning('line = filereadln\nend', 'filereadln', 1)) ok('line = filereadln で警告')
  else ng('line = filereadln で警告')

  const filereadlnMsg = buildAssignmentRhsCommandMisuseMessage('filereadln', 'line')
  if (filereadlnMsg.includes('filereadln fhandle line')) ok('filereadln の例示にファイルハンドルを含む')
  else ng('filereadln の例示にファイルハンドルを含む', filereadlnMsg)

  if (hasWarning('fhandle = fileopen\nend', 'fileopen', 1)) ok('fhandle = fileopen で警告')
  else ng('fhandle = fileopen で警告')

  if (hasWarning('out = expandenv\nend', 'expandenv', 1)) ok('out = expandenv で警告')
  else ng('out = expandenv で警告')

  if (hasWarning('val = yesnobox\nend', 'yesnobox', 1)) ok('val = yesnobox で警告（result 参照）')
  else ng('val = yesnobox で警告（result 参照）')

  const yesnoMsg = buildAssignmentRhsCommandMisuseMessage('yesnobox', 'val')
  if (yesnoMsg.includes('result')) ok('yesnobox の例示に result を含む')
  else ng('yesnobox の例示に result を含む', yesnoMsg)

  const strsplitMsg = buildAssignmentRhsCommandMisuseMessage('strsplit', 'part')
  if (
    strsplitMsg.includes('groupmatchstr')
    && !strsplitMsg.includes('= matchstr')
  ) {
    ok('strsplit の例示は groupmatchstr')
  } else {
    ng('strsplit の例示は groupmatchstr', strsplitMsg)
  }

  const strmatchMsg = buildAssignmentRhsCommandMisuseMessage('strmatch', 'm')
  if (strmatchMsg.includes('matchstr')) ok('strmatch の例示は matchstr')
  else ng('strmatch の例示は matchstr', strmatchMsg)

  if (hasWarning('len = strlen\nend', 'strlen', 1)) ok('len = strlen で警告')
  else ng('len = strlen で警告')

  if (!hasWarning('getdate datestr\nend', 'getdate', 1)) ok('getdate datestr では警告しない')
  else ng('getdate datestr では警告しない')

  if (!hasWarning('datestr = myvar\nend', 'コマンド', 1)) ok('datestr = myvar では警告しない')
  else ng('datestr = myvar では警告しない')

  if (!hasWarning("datestr = '2026-01-01'\nend", 'コマンド', 1)) {
    ok('文字列リテラル代入では警告しない')
  } else {
    ng('文字列リテラル代入では警告しない')
  }

  if (!hasWarning('x = getdate + 1\nend', 'getdate', 1)) ok('式の一部として getdate があっても警告しない')
  else ng('式の一部として getdate があっても警告しない')

  if (!hasWarning('payload = send\nend', 'send', 1)) ok('payload = send では警告しない（出力コマンドではない）')
  else ng('payload = send では警告しない（出力コマンドではない）')

  if (!hasWarning('r = wait\nend', 'wait', 1)) ok('r = wait では警告しない（result のみの待機コマンド）')
  else ng('r = wait では警告しない（result のみの待機コマンド）')

  if (hasWarning('s = waitrecv\nend', 'waitrecv', 1)) ok('s = waitrecv で警告（inputstr を更新）')
  else ng('s = waitrecv で警告（inputstr を更新）')

  const shadowTokens = tokenizeLine('x = random', 1)
  const shadowAssignIdx = findAssignmentIndex(shadowTokens, 0)
  const shadowVarMap = new Map<string, { isSystem?: boolean }>([
    ['random', { isSystem: false }],
  ])
  if (!findAssignmentRhsCommandToken(shadowTokens, shadowAssignIdx, shadowVarMap)) {
    ok('varMap にユーザー変数 random があれば警告対象にしない')
  } else {
    ng('varMap にユーザー変数 random があれば警告対象にしない')
  }

  if (!isAssignmentRhsCommandMisuseTarget('send')) ok('send は警告対象外')
  else ng('send は警告対象外')
  if (isAssignmentRhsCommandMisuseTarget('getdate')) ok('getdate は警告対象')
  else ng('getdate は警告対象')

  const msg = buildAssignmentRhsCommandMisuseMessage('getdate', 'datestr')
  if (msg.includes('getdate datestr') && msg.includes('datestr = getdate')) {
    ok('getdate 向けメッセージに正しい書き方を含む')
  } else {
    ng('getdate 向けメッセージに正しい書き方を含む', msg)
  }

  const ipv4Msg = buildAssignmentRhsCommandMisuseMessage('getipv4addr', 'num')
  if (
    ipv4Msg.includes('getipv4addr ipaddr num')
    && !ipv4Msg.includes('hostname')
  ) {
    ok('getipv4addr の例示は配列と件数変数')
  } else {
    ng('getipv4addr の例示は配列と件数変数', ipv4Msg)
  }

  const ipv6Msg = buildAssignmentRhsCommandMisuseMessage('getipv6addr', 'num')
  if (
    ipv6Msg.includes('getipv6addr ipaddr num')
    && !ipv6Msg.includes('hostname')
  ) {
    ok('getipv6addr の例示は配列と件数変数')
  } else {
    ng('getipv6addr の例示は配列と件数変数', ipv6Msg)
  }

  const tokens = tokenizeLine('datestr = getdate', 1)
  const assignIdx = findAssignmentIndex(tokens, 0)
  const rhsTok = findAssignmentRhsCommandToken(tokens, assignIdx)
  if (rhsTok?.text.toLowerCase() === 'getdate') ok('単一代入右辺のコマンド識別子を検出')
  else ng('単一代入右辺のコマンド識別子を検出', rhsTok)

  return { passed, failed }
}

const isDirectRun = process.argv[1]?.replace(/\\/g, '/').endsWith('test-assignment-command-misuse.ts')
if (isDirectRun) {
  const { passed, failed } = runAssignmentCommandMisuseTests()
  console.log(`\n=== ASSIGNMENT COMMAND MISUSE: ${passed} passed, ${failed} failed ===`)
  process.exit(failed > 0 ? 1 : 0)
}
