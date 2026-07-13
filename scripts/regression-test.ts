/**
 * サブルーチン対応前後で変わってはいけない挙動の回帰テスト
 */
import { analyzeTTL } from '../src/ttl/analyzer'
import { evaluateTTL } from '../src/ttl/evaluator'

let passed = 0
let failed = 0

function assert(cond: boolean, label: string, detail?: unknown) {
  if (cond) {
    passed++
    console.log(`  OK  ${label}`)
  } else {
    failed++
    console.error(`  NG  ${label}`, detail ?? '')
  }
}

console.log('=== A. サンプルマクロ（サブルーチンなし） ===')
const sample = `timeout = 30
hostname = '192.168.1.1'
username = 'admin'
password = 'secret'
connect hostname
while 1
  wait 'login:'
  sendln username
  wait 'Password:'
  sendln password
  break
endwhile
end`
const sampleDiags = analyzeTTL(sample).diagnostics
assert(sampleDiags.filter((d) => d.severity === 'error').length === 0, 'sample: no errors')
assert(evaluateTTL(sample).sendEntries.length === 2, 'sample: 2 send entries')
assert(
  evaluateTTL(sample).sendEntries.every((e) => e.payload === 'admin' || e.payload === 'secret'),
  'sample: send payloads unchanged',
)

console.log('\n=== B. end/exit デッドコード（既存） ===')
const endDead = analyzeTTL(`send 'a'\nend\nsend 'b'`)
assert(
  endDead.diagnostics.some((d) => d.line === 3 && d.message.includes('end / exit')),
  'end marks file dead after macro end',
)
const exitInWhile = analyzeTTL(`while 1\n  send 'a'\n  exit\n  send 'b'\nendwhile`)
assert(
  exitInWhile.diagnostics.some((d) => d.line === 4 && d.message.includes('end / exit')),
  'exit marks block dead inside while',
)

console.log('\n=== C. for / if / while 評価 ===')
const forEval = evaluateTTL(`for i 0 1\n  send i\nnext`)
assert(forEval.sendEntries.length === 2, 'for loop unrolls 2 sends')
assert(forEval.sendEntries[0]?.payload === '0' && forEval.sendEntries[1]?.payload === '1', 'for loop payloads')

const ifEval = evaluateTTL(`x = 1\nif x = 1 then\n  send 'yes'\nendif`)
assert(ifEval.sendEntries.length === 1 && ifEval.sendEntries[0]?.payload === 'yes', 'if block send')

console.log('\n=== D. include / gettime / strcopy（既存） ===')
const gettime = `gettime t "%Y"\nstrconcat t 'x'\nsendln t`
assert(evaluateTTL(gettime).sendEntries[0]?.payload.includes('実行時'), 'gettime runtime placeholder')

const strcopy = `strcopy 'abc' 2 2 s\nsend s`
assert(evaluateTTL(strcopy).sendEntries[0]?.payload === 'bc', 'strcopy eval')

console.log('\n=== E. ラベルだけのマクロ（call/goto なし） ===')
const labelOnly = `x = 'main'\n:unused\nsend x\nend`
assert(
  !analyzeTTL(labelOnly).diagnostics.some((d) => d.message.includes('到達しません') && d.line === 3),
  'label-only macro: send after label not dead',
)
assert(evaluateTTL(labelOnly).sendEntries[0]?.payload === 'main', 'label-only macro: sequential eval')

console.log('\n=== F. サブルーチンと既存コードの共存 ===')
const mixed = `host = '10.0.0.1'\ncall connect_host\ngoto main_end\n:connect_host\nsend host\nreturn\n:main_end\nsend 'done'`
const mixedSends = evaluateTTL(mixed).sendEntries.map((e) => e.payload)
assert(mixedSends.length === 2, 'mixed: 2 sends', mixedSends)
assert(mixedSends[0] === '10.0.0.1' && mixedSends[1] === 'done', 'mixed: call/return order')

const mixedDead = analyzeTTL(`goto end\nsend 'skip'\n:call\nreturn\n:end\nsend 'ok'`)
assert(
  mixedDead.diagnostics.some((d) => d.line === 2 && d.message.includes('フォールスルー')),
  'mixed: goto dead code on main path',
)
assert(
  !mixedDead.diagnostics.some((d) => d.line === 6 && d.message.includes('到達しません')),
  'mixed: code at end label reachable',
)

console.log('\n=== G. param システム変数（CLI 未指定時） ===')
const noCliParam = evaluateTTL(`send param1\nend`)
assert(
  noCliParam.sendEntries[0]?.payload === '',
  'param1 without CLI argv is empty',
  noCliParam.sendEntries[0]?.payload,
)

console.log('\n=== H. 配列・未定義変数（解析） ===')
const arraySrc = `strdim a 2\na[5] = 'x'`
assert(
  analyzeTTL(arraySrc).diagnostics.some((d) => d.message.includes('範囲外')),
  'array OOB still warned',
)
const undef = analyzeTTL(`send unknown_var`)
assert(
  undef.diagnostics.some((d) => d.message.includes('未定義')),
  'undefined var still warned',
)

console.log(`\n=== REGRESSION RESULT: ${passed} passed, ${failed} failed ===`)
process.exit(failed > 0 ? 1 : 0)
