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

// 未確定 if 内の yesnobox 後の result は yesnobox 由来（strcompare のままにしない）
assertNoteContains(
  `inputbox '' ''
command = inputstr
strcompare command 'next'
if result=0 then
  yesnobox '続行しますか？' '確認'
  if result = 1 then
   sendln 'case-b-yes'
  else
   sendln 'case-b-no'
  endif
endif
`,
  6,
  'yesnobox —',
  'nested yesnobox result after indeterminate strcompare if',
)
assertNoteContains(
  `inputbox '' ''
command = inputstr
strcompare command 'next'
if result=0 then
  yesnobox '続行しますか？' '確認'
  if result = 1 then
   sendln 'case-b-yes'
  endif
endif
`,
  6,
  '1=Yes',
  'nested yesnobox result meaning',
)
{
  const info = hoverResult(
    `inputbox '' ''
command = inputstr
strcompare command 'next'
if result=0 then
  yesnobox 'q' 't'
  if result = 1 then
   sendln 'a'
  endif
endif
`,
    6,
  )
  assert.ok(info?.note && !info.note.includes('strcompare'), `must not keep strcompare: ${info?.note}`)
}

// 投機実行が親の loopControl / sendEntries / env を汚さないこと
{
  const src = `while 1
  if result = 0 then
    break
  endif
  sendln 'x'
endwhile
sendln 'after'
`
  const ev = evaluateTTL(src)
  const payloads = ev.sendEntries.map((e) => e.payload)
  assert.ok(payloads.length > 2, `while+indeterminate break must not exit in one iter: ${payloads.join(',')}`)
  assert.equal(payloads[payloads.length - 1], 'after')
  assert.ok(payloads.filter((p) => p === 'x').length > 1, `expected many x, got ${payloads.join(',')}`)
}

{
  // 未確定 if 内の後方 goto でスタックオーバーフローしない
  const src = `:top
if result = 0 then
  goto top
endif
sendln 'ok'
`
  const ev = evaluateTTL(src)
  assert.equal(ev.sendEntries[0]?.payload, 'ok', 'backward goto in speculative if must not hang')
}

{
  // then 内代入が endif 以降の親 env / 送信データに漏れない
  const src2 = `inputbox '' ''
x = 0
if result = 0 then
  x = 99
endif
sendln x
`
  const ev2 = evaluateTTL(src2)
  assert.equal(ev2.sendEntries[0]?.payload, '0', `then assign must not leak: ${ev2.sendEntries[0]?.payload}`)
}

// elseif 未確定 + 内側 result ホバー
assertNoteContains(
  `inputbox '' ''
strcompare inputstr 'a'
if result = 1 then
  sendln 'a'
elseif result = 0 then
  yesnobox 'q' 't'
  if result = 1 then
    sendln 'yes'
  endif
endif
`,
  7,
  'yesnobox —',
  'elseif indeterminate nested yesnobox result',
)

// 分岐仮定 True 時は本実行（送信に反映）の setBy がホバーに使われる
{
  const src = `inputbox '' ''
command = inputstr
strcompare command 'next'
if result=0 then
  yesnobox 'q' 't'
  sendln 'from-then'
  if result = 1 then
   sendln 'yes'
  endif
endif
`
  const without = evaluateTTL(src)
  assert.ok(
    !without.sendEntries.some((e) => e.payload === 'from-then'),
    'without assumption, indeterminate then must not send',
  )
  // L4 = outer if result=0
  const ev = evaluateTTL(src, { branchAssumptions: new Map([[4, true]]) })
  assert.ok(
    ev.sendEntries.some((e) => e.payload === 'from-then'),
    `assumption True should execute then sends: ${ev.sendEntries.map((e) => e.payload).join(',')}`,
  )
  // L7 = inner if result = 1（yesnobox 直後）
  const info = ev.getHoverAt(7, (src.split(/\r?\n/)[6] ?? '').toLowerCase().indexOf('result') + 1)?.info
  assert.ok(info?.note?.includes('yesnobox —'), `assumption True hover: ${info?.note}`)
}

// elseif 仮定 True 時、先行 if の投機 setBy をホバーに残さない
{
  const src = `inputbox '' ''
strcompare inputstr 'a'
if result = 1 then
  yesnobox 'in-first' 't'
  if result = 1 then
    sendln 'first'
  endif
elseif result = 0 then
  sendln 'second'
endif
`
  const lines = src.split(/\r?\n/)
  const elseifLine = lines.findIndex((l) => /^\s*elseif\b/i.test(l)) + 1
  const ev = evaluateTTL(src, { branchAssumptions: new Map([[elseifLine, true]]) })
  assert.deepEqual(
    ev.sendEntries.map((e) => e.payload),
    ['second'],
    'elseif True assumption selects second branch only',
  )
  // L5 = 先行 then 内の if result（投機 yesnobox 由来にしない）
  const info = ev.getHoverAt(5, (lines[4] ?? '').toLowerCase().indexOf('result') + 1)?.info
  assert.ok(info?.note, `hover missing on L5: ${info?.note}`)
  assert.ok(
    !info.note.includes('yesnobox'),
    `elseif True must not leave speculative yesnobox on prior branch: ${info.note}`,
  )
  assert.ok(
    info.note.includes('strcompare'),
    `expected outer strcompare provenance, got ${info.note}`,
  )
}

// else 本体は投機対象外だが、未確定 if では従来どおり本評価で else が走る
assertNoteContains(
  `inputbox '' ''
if result = 1 then
  sendln 'then'
else
  yesnobox 'q' 't'
  if result = 1 then
    sendln 'else-yes'
  endif
endif
`,
  6,
  'yesnobox —',
  'else body result after indeterminate if (real else path)',
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
