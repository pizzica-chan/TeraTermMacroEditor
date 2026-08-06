/**
 * result ホバー: 設定元コマンドの公式ヒント表示 + 網羅レジストリの健全性
 */
import assert from 'node:assert/strict'
import { evaluateTTL } from '../src/ttl/evaluator.ts'
import {
  commandSetsResult,
  getResultCommandHint,
  listResultSettingCommands,
  RESULT_COMMAND_META,
} from '../src/ttl/resultCommandMeta.ts'
import { getCommandOutputEffect } from '../src/ttl/commandOutputs.ts'

function hoverResult(src: string, lineNo: number) {
  const line = src.split(/\r?\n/)[lineNo - 1] ?? ''
  const col = line.toLowerCase().indexOf('result') + 1
  assert.ok(col > 0, `result not found on line ${lineNo}`)
  return evaluateTTL(src).getHoverAt(lineNo, col)?.info
}

function assertNoteContains(src: string, lineNo: number, needle: string, label: string) {
  const info = hoverResult(src, lineNo)
  assert.ok(info, `${label}: hover missing`)
  assert.ok(
    info.note?.includes(needle),
    `${label}: note should include "${needle}", got ${JSON.stringify(info.note)}`,
  )
}

// ── 代表コマンドのホバー ──
assertNoteContains(
  `yesnobox 'q' 't'
if result = 0 then
  sendln 'a'
endif
`,
  2,
  'yesnobox —',
  'yesnobox',
)
assertNoteContains(
  `yesnobox 'q' 't'
if result = 0 then
  sendln 'a'
endif
`,
  2,
  '1=Yes',
  'yesnobox meaning',
)

assertNoteContains(
  `strlen 'abc'
if result = 3 then
  sendln 'a'
endif
`,
  2,
  'strlen —',
  'strlen',
)

assertNoteContains(
  `wait 'OK'
if result = 0 then
  sendln 'a'
endif
`,
  2,
  'wait —',
  'wait',
)

assertNoteContains(
  `connect 'host'
if result = 2 then
  sendln 'a'
endif
`,
  2,
  'connect —',
  'connect',
)

assertNoteContains(
  `filesearch 'a.txt'
if result = 0 then
  sendln 'a'
endif
`,
  2,
  'filesearch —',
  'filesearch',
)

assertNoteContains(
  `strmatch 'abc' 'a'
if result = 0 then
  sendln 'a'
endif
`,
  2,
  'strmatch —',
  'strmatch',
)

// 初期状態（未設定）は汎用説明
{
  const info = hoverResult(
    `if result = 0 then
  sendln 'a'
endif
`,
    1,
  )
  assert.equal(info?.valueKind, 'system-default')
  assert.ok(info?.note?.includes('コマンドの成否'), `initial note: ${info?.note}`)
}

// messagebox は公式上 result を設定しない
{
  const info = hoverResult(
    `messagebox 'm' 't'
if result = 0 then
  sendln 'a'
endif
`,
    2,
  )
  assert.equal(info?.valueKind, 'system-default')
  assert.ok(!info?.note?.includes('messagebox —'), `messagebox must not set result: ${info?.note}`)
}

// getver 引数なしは result を変更しない
{
  const info = hoverResult(
    `getver ver
if result = 0 then
  sendln 'a'
endif
`,
    2,
  )
  assert.equal(info?.valueKind, 'system-default')
}

// getver 引数ありは設定する
assertNoteContains(
  `getver ver '5.0'
if result = 0 then
  sendln 'a'
endif
`,
  2,
  'getver —',
  'getver with version',
)

assertNoteContains(
  `loginfo logfile
if result = -1 then
  sendln 'a'
endif
`,
  2,
  'loginfo —',
  'loginfo',
)
assertNoteContains(
  `loginfo logfile
if result = -1 then
  sendln 'a'
endif
`,
  2,
  '-1=ログ未開始',
  'loginfo meaning: not logging',
)
assertNoteContains(
  `loginfo logfile
if result = -1 then
  sendln 'a'
endif
`,
  2,
  '8=タイムスタンプ',
  'loginfo meaning: flag bits',
)

// ── レジストリ健全性 ──
const cmds = listResultSettingCommands()
assert.ok(cmds.length >= 80, `expected 80+ result commands, got ${cmds.length}`)

for (const cmd of cmds) {
  assert.ok(commandSetsResult(cmd), cmd)
  const hint = getResultCommandHint(cmd)
  assert.ok(hint && hint.length > 0, `${cmd} hint`)
  const effect = getCommandOutputEffect(cmd)
  assert.ok(effect?.setsResult, `${cmd} must expose setsResult via getCommandOutputEffect`)
}

// 公式で result を設定しない代表例
for (const cmd of ['messagebox', 'statusbox', 'str2code', 'inputbox', 'passwordbox', 'findclose', 'checksum8']) {
  assert.ok(!commandSetsResult(cmd), `${cmd} must not be in RESULT_COMMAND_META`)
  assert.ok(!getCommandOutputEffect(cmd)?.setsResult, `${cmd} must not setsResult`)
}

// メタキーは小文字・重複なし
assert.deepEqual(Object.keys(RESULT_COMMAND_META), Object.keys(RESULT_COMMAND_META).map((k) => k.toLowerCase()))

// findfirst の出力スロットが resultOnly 上書きで消えないこと
{
  const effect = getCommandOutputEffect('findfirst')
  assert.ok(effect?.setsResult, 'findfirst setsResult')
  const indices = [...(effect?.variables ?? [])].map((v) => v.index).sort((a, b) => a - b)
  assert.deepEqual(indices, [1, 3], `findfirst output indices: ${indices.join(',')}`)
  assert.equal(effect?.variables?.find((v) => v.index === 1)?.type, 'integer')
  assert.equal(effect?.variables?.find((v) => v.index === 3)?.type, 'string')
}

console.log(`result-hover-hint: ok (${cmds.length} commands)`)
