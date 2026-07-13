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
const callMultiArg = `call mysub 'a' 'b'`
const callMultiAnalysis = analyzeTTL(callMultiArg + `\n:mysub\nreturn`)
assert(
  !callMultiAnalysis.diagnostics.some((d) => d.message.includes('引数が多すぎます')),
  'call allows multiple subroutine args',
  callMultiAnalysis.diagnostics,
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

const tooManyCallArgs = analyzeTTL(`call sub 1 2 3 4 5 6 7 8 9 10\n:sub\nreturn`)
assert(
  tooManyCallArgs.diagnostics.some((d) => d.message.includes('最大 9 個')),
  'call rejects more than 9 subroutine args',
  tooManyCallArgs.diagnostics,
)

const callParamEval = evaluateTTL(`call mysub 'hello'\n:mysub\nsend param1\nreturn`)
assert(
  callParamEval.sendEntries[0]?.payload === 'hello',
  'evaluator binds call args to param1',
  callParamEval.sendEntries[0]?.payload,
)

const gotoSkipEval = evaluateTTL(`goto sub\nsend skipped\n:sub\nsend 'ok'\nend`)
assert(
  gotoSkipEval.sendEntries.length === 1 && gotoSkipEval.sendEntries[0]?.payload === 'ok',
  'evaluator goto skips fallthrough send',
  gotoSkipEval.sendEntries,
)

const callReturnEval = evaluateTTL(`msg = 'hi'\ncall sub\nsend msg\n:sub\nreturn`)
assert(
  callReturnEval.sendEntries.some((e) => e.payload === 'hi'),
  'evaluator return resumes after call',
  callReturnEval.sendEntries,
)

console.log(`\n=== RESULT: ${passed} passed, ${failed} failed ===`)
process.exit(failed > 0 ? 1 : 0)
