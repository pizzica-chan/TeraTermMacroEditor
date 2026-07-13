/** 主要モジュールのスモークテスト（実行時エラー検出用） */
import { analyzeTTL } from '../src/ttl/analyzer'
import { evaluateTTL } from '../src/ttl/evaluator'
import { findIncludeRefs, computeLoopValues } from '../src/ttl/includeRefs'
import { computeStrcopySubstring, parseStr2int } from '../src/ttl/staticCommandEval'
import { tokenizeLine, stripComments } from '../src/ttl/tokenize'
import { TTL_COMMANDS } from '../src/ttl/commands'
import { COMMAND_ARG_SPECS } from '../src/ttl/commandArgs'

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

console.log('=== 1. tokenize ===')
const tokens = tokenizeLine("server[0] = 'hello'", 1)
assert(tokens.some((t) => t.kind === 'string'), 'string literal tokenized')
assert(stripComments('; comment\nx = 1').length === 2, 'stripComments keeps lines')

console.log('\n=== 2. staticCommandEval ===')
assert(computeStrcopySubstring('tera term', 6, 4) === 'term', 'strcopy')
assert(parseStr2int('0x7b') === 123, 'str2int hex')

console.log('\n=== 3. includeRefs ===')
const includeSrc = `bbb = ''
include bbb
kaisuu = 10
for i 0 kaisuu
  include host[i]
next`
const refs = findIncludeRefs(includeSrc)
assert(refs.length === 2, 'findIncludeRefs count', refs.length)
assert(refs[1]?.loopContext?.values.length === 11, 'loop values 0-10', refs[1]?.loopContext?.values.length)
assert(computeLoopValues(0, 10).length === 11, 'computeLoopValues')

console.log('\n=== 4. analyzer ===')
const arraySrc = `CountCommand = 3
strdim pass CountCommand
pass[5] = "root,パスワード"`
const arrayAnalysis = analyzeTTL(arraySrc)
assert(
  arrayAnalysis.diagnostics.some((d) => d.message.includes('範囲外')),
  'array index out of range warning',
  arrayAnalysis.diagnostics,
)
const forSrc = `for i 0 2
  sendln server[i]
next
strdim server 3`
const forAnalysis = analyzeTTL(forSrc)
assert(!forAnalysis.diagnostics.some((d) => d.message.includes('i') && d.message.includes('未定義')), 'for loop var not undefined')

console.log('\n=== 5. evaluator ===')
const gettimeSrc = `
gettime time_now_str "%Y/%m/%d %H:%M:%S"
strconcat time_now_str 'aaaa'
CMD = "echo "
strconcat CMD time_now_str
sendln CMD`
const evalResult = evaluateTTL(gettimeSrc)
const sendPayload = evalResult.sendEntries[0]?.payload ?? ''
assert(sendPayload.includes('実行時'), 'gettime placeholder preserved after strconcat', sendPayload)

const strcopySrc = `strcopy 'tera term' 6 4 substr\nsend substr`
const strcopyEval = evaluateTTL(strcopySrc)
assert(strcopyEval.sendEntries[0]?.payload === 'term', 'strcopy send', strcopyEval.sendEntries[0]?.payload)

console.log('\n=== 6. command registry ===')
const missingSpecs = [...TTL_COMMANDS].filter((c) => !(c in COMMAND_ARG_SPECS))
assert(missingSpecs.length === 0, 'all TTL_COMMANDS have arg specs', missingSpecs)

console.log('\n=== 7. SAMPLE_MACRO (editor default) ===')
const sample = `; Tera Term マクロ サンプル
timeout = 30
hostname = '192.168.1.1'
username = 'admin'
password = 'secret'
connect hostname
UsernamePrompt = 'login:'
PasswordPrompt = 'Password:'
while 1
  wait UsernamePrompt
  sendln username
  wait PasswordPrompt
  sendln password
  wait '$'
  break
endwhile
messagebox 'ログイン完了' 'info'
end`
const sampleAnalysis = analyzeTTL(sample)
const sampleEval = evaluateTTL(sample)
assert(sampleAnalysis.diagnostics.filter((d) => d.severity === 'error').length === 0, 'sample no errors', sampleAnalysis.diagnostics)
assert(sampleEval.sendEntries.length >= 2, 'sample send entries', sampleEval.sendEntries.length)

console.log('\n=== 8. subroutine (call/goto/return) ===')
const callExtraArgs = analyzeTTL(`call mysub 'a' 'b'\n:mysub\nreturn`)
assert(
  callExtraArgs.diagnostics.some((d) => d.message.includes('引数が多すぎます')),
  'call extra args rejected (official spec)',
  callExtraArgs.diagnostics,
)

const undefinedLabel = analyzeTTL(`goto missing\n:defined`)
assert(
  undefinedLabel.diagnostics.some((d) => d.message.includes("':missing'") && d.message.includes('定義されていません')),
  'undefined goto label warning',
  undefinedLabel.diagnostics,
)

const colonLabelCall = analyzeTTL(`call :mysub\n:mysub\nreturn`)
assert(
  !colonLabelCall.diagnostics.some((d) => d.message.includes('定義されていません')),
  'call :label resolves label token',
  colonLabelCall.diagnostics,
)

const gotoDead = analyzeTTL(`goto sub\nunreachable\n:sub\nreturn`)
assert(
  gotoDead.diagnostics.some((d) => d.line === 2 && d.message.includes('フォールスルー')),
  'goto marks fallthrough dead code',
  gotoDead.diagnostics,
)

const labelEntry = analyzeTTL(`goto sub\n:sub\nreachable\nreturn`)
assert(
  !labelEntry.diagnostics.some((d) => d.line === 3 && d.message.includes('到達しません')),
  'label entry resets fallthrough dead',
  labelEntry.diagnostics,
)

const callFallthrough = analyzeTTL(`call sub\nstill_reachable\n:sub\nreturn`)
assert(
  !callFallthrough.diagnostics.some((d) => d.line === 2 && d.message.includes('到達しません')),
  'call does not mark fallthrough dead',
  callFallthrough.diagnostics,
)

const returnDead = analyzeTTL(`:sub\nreturn\ndead\nend`)
assert(
  returnDead.diagnostics.some((d) => d.line === 3 && d.message.includes('フォールスルー')),
  'return marks fallthrough dead code',
  returnDead.diagnostics,
)

const returnNoCall = analyzeTTL(`return\nend`)
assert(
  returnNoCall.diagnostics.some((d) => d.message.includes('call がありません')),
  'return without call warns',
  returnNoCall.diagnostics,
)

const gotoSkipEval = evaluateTTL(`goto sub\nsend skipped\n:sub send 'ok'\nend`)
assert(
  gotoSkipEval.sendEntries.length === 1 && gotoSkipEval.sendEntries[0]?.payload === 'ok',
  'evaluator goto skips fallthrough; same-line label cmd runs',
  gotoSkipEval.sendEntries,
)

const callReturnEval = evaluateTTL(`msg = 'hi'\ncall sub\ngoto main_end\n:sub\nreturn\n:main_end\nsend msg`)
assert(
  callReturnEval.sendEntries.some((e) => e.payload === 'hi'),
  'evaluator return resumes after call',
  callReturnEval.sendEntries,
)

const nestedCall = evaluateTTL(
  `call outer\ngoto fin\n:outer\ncall inner\ngoto outer_end\n:inner\nsend 'inner'\nreturn\n:outer_end\nreturn\n:fin\nsend 'fin'\nend`,
)
assert(
  nestedCall.sendEntries.map((e) => e.payload).join(',') === 'inner,fin',
  'nested call/return order',
  nestedCall.sendEntries,
)

const singleLineIfGoto = evaluateTTL(`x = 1\nif x = 1 goto target\nsend 'miss'\n:target\nsend 'hit'\nend`)
assert(
  singleLineIfGoto.sendEntries.length === 1 && singleLineIfGoto.sendEntries[0]?.payload === 'hit',
  'single-line if goto',
  singleLineIfGoto.sendEntries,
)

const undefinedGotoEval = evaluateTTL(`goto missing\nsend 'x'\nend`)
assert(
  undefinedGotoEval.sendEntries.length === 0,
  'undefined goto stops evaluation',
  undefinedGotoEval.sendEntries,
)

console.log('\n=== 9. CLI macro arguments ===')
const cliEval = evaluateTTL(`send param1\nsend param2\nsend paramcnt`, {
  macroArgv: ['script.ttl', 'user1', 'user2'],
})
assert(cliEval.sendEntries[0]?.payload === 'script.ttl', 'param1 = argv[0]', cliEval.sendEntries[0]?.payload)
assert(cliEval.sendEntries[1]?.payload === 'user1', 'param2 = argv[1]', cliEval.sendEntries[1]?.payload)
assert(cliEval.sendEntries[2]?.payload === '3', 'paramcnt = argv.length', cliEval.sendEntries[2]?.payload)

const paramsArray = evaluateTTL(`send params[2]`, { macroArgv: ['a.ttl', 'first', 'second'] })
assert(paramsArray.sendEntries[0]?.payload === 'first', 'params[2] is second argv element', paramsArray.sendEntries[0]?.payload)

console.log(`\n=== RESULT: ${passed} passed, ${failed} failed ===`)
process.exit(failed > 0 ? 1 : 0)
