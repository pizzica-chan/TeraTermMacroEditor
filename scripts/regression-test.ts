/**
 * サブルーチン対応前後で変わってはいけない挙動の回帰テスト
 */
import { analyzeTTL, type IncludeResolver } from '../src/ttl/analyzer'
import { evaluateTTL } from '../src/ttl/evaluator'
import { includeLoopIterationBindingKey } from '../src/ttl/includeRefs'

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

console.log('\n=== I. evaluator 制御フロー整合 ===')
const whileFalse = evaluateTTL(`while 0\nsend 'wrong'\nendwhile\nend`)
assert(whileFalse.sendEntries.length === 0, 'while false skips body', whileFalse.sendEntries)

const whileRepeat = evaluateTTL(`i = 0\nwhile i < 3\ni = i + 1\nsend i\nendwhile\nend`)
assert(
  whileRepeat.sendEntries.map((entry) => entry.payload).join(',') === '1,2,3',
  'while repeats while condition is true',
  whileRepeat.sendEntries,
)

const untilRepeat = evaluateTTL(`i = 0\nuntil i = 2\ni = i + 1\nsend i\nenduntil\nend`)
assert(
  untilRepeat.sendEntries.map((entry) => entry.payload).join(',') === '1,2',
  'until runs body before condition',
  untilRepeat.sendEntries,
)

const exitStopsMain = evaluateTTL(`while 1\nsend 'in'\nexit\nendwhile\nsend 'after'\nend`)
assert(
  exitStopsMain.sendEntries.map((entry) => entry.payload).join(',') === 'in',
  'exit in main loop stops macro',
  exitStopsMain.sendEntries,
)

const endStopsMain = evaluateTTL(`while 1\nsend 'in'\nend\nendwhile\nsend 'after'`)
assert(
  endStopsMain.sendEntries.map((entry) => entry.payload).join(',') === 'in',
  'end in block stops macro',
  endStopsMain.sendEntries,
)
const endAnalysis = analyzeTTL(`while 1\nsend 'in'\nend\nendwhile\nsend 'after'`)
assert(
  endAnalysis.diagnostics.some((diag) => diag.line === 5 && diag.message.includes('到達しません')),
  'end in block marks following main code unreachable',
  endAnalysis.diagnostics,
)

const endInConditionalIf = analyzeTTL(`if result = 0 then\nend\nendif\naaa = 0`)
assert(
  !endInConditionalIf.diagnostics.some((diag) => diag.line === 4 && diag.message.includes('到達しません')),
  'end inside conditional if does not mark code after endif unreachable',
  endInConditionalIf.diagnostics,
)

const exitInConditionalIf = analyzeTTL(`if result = 0 then\nexit\nendif\naaa = 0`)
assert(
  !exitInConditionalIf.diagnostics.some((diag) => diag.line === 4 && diag.message.includes('到達しません')),
  'exit inside conditional if does not mark code after endif unreachable',
  exitInConditionalIf.diagnostics,
)

const exitInWhileStopsMain = analyzeTTL(`while 1\nexit\nendwhile\nsend 'after'`)
assert(
  exitInWhileStopsMain.diagnostics.some((diag) => diag.line === 4 && diag.message.includes('到達しません')),
  'exit inside guaranteed while marks following main code unreachable',
  exitInWhileStopsMain.diagnostics,
)

const exitInConditionalWhile = analyzeTTL(`while result = 0\nexit\nendwhile\nsend 'after'`)
assert(
  !exitInConditionalWhile.diagnostics.some((diag) => diag.line === 4 && diag.message.includes('到達しません')),
  'exit inside conditional while does not mark following code unreachable',
  exitInConditionalWhile.diagnostics,
)

const gotoInConditionalIf = analyzeTTL(`if result = 0 then\ngoto target\nendif\naaa = 0\n:target\nend`)
assert(
  !gotoInConditionalIf.diagnostics.some((diag) => diag.line === 4 && diag.message.includes('到達しません')),
  'goto inside conditional if does not mark code after endif unreachable',
  gotoInConditionalIf.diagnostics,
)

const definiteEndInIf = analyzeTTL(`if 1 then\nend\nendif\naaa = 0`)
assert(
  definiteEndInIf.diagnostics.some((diag) => diag.line === 4 && diag.message.includes('到達しません')),
  'end inside statically true if marks code after endif unreachable',
  definiteEndInIf.diagnostics,
)

const singleLineIfEnd = analyzeTTL(`if result = 0 then end\naaa = 0`)
assert(
  !singleLineIfEnd.diagnostics.some((diag) => diag.line === 2 && diag.message.includes('到達しません')),
  'single-line if with unknown condition end does not mark following code unreachable',
  singleLineIfEnd.diagnostics,
)

const singleLineIfGoto = analyzeTTL(`if result = 0 goto target\naaa = 0\n:target\nend`)
assert(
  !singleLineIfGoto.diagnostics.some((diag) => diag.line === 2 && diag.message.includes('到達しません')),
  'single-line if goto with unknown condition does not mark following code unreachable',
  singleLineIfGoto.diagnostics,
)

const yesnoboxNotEqualIf = analyzeTTL(
  `yesnobox '' ''\nif result <> 0 then\n end\nendif\n\naaa = 0`,
)
assert(
  !yesnoboxNotEqualIf.diagnostics.some((diag) => diag.line === 6 && diag.message.includes('到達しません')),
  'yesnobox後の if result<>0 then end は endif 以降を到達不能にしない',
  yesnoboxNotEqualIf.diagnostics,
)

const conditionallyAssignedConstant = analyzeTTL(
  `x = 0\nif result = 0 then\nx = 1\nendif\nif x = 1 then\nend\nendif\naaa = 0`,
)
assert(
  !conditionallyAssignedConstant.diagnostics.some(
    (diag) => diag.line === 8 && diag.message.includes('到達しません'),
  ),
  'conditionally assigned value does not make a later end definite',
  conditionallyAssignedConstant.diagnostics,
)

const unsupportedCompoundCondition = analyzeTTL(`if 1 + 0 = 0 then\nend\nendif\naaa = 0`)
assert(
  !unsupportedCompoundCondition.diagnostics.some(
    (diag) => diag.line === 4 && diag.message.includes('到達しません'),
  ),
  'unsupported compound condition is not treated as definitely true',
  unsupportedCompoundCondition.diagnostics,
)

const nestedDefiniteEnd = analyzeTTL(
  `if 1 then\nif result = 0 then\nendif\nend\nendif\naaa = 0`,
)
assert(
  nestedDefiniteEnd.diagnostics.some(
    (diag) => diag.line === 6 && diag.message.includes('到達しません'),
  ),
  'nested conditional does not discard an outer guaranteed branch',
  nestedDefiniteEnd.diagnostics,
)

const unknownIf = evaluateTTL(`msg = 'hello'\nif msg = 1\nsend 'wrong'\nendif\nsend 'after'`)
assert(
  unknownIf.sendEntries.map((entry) => entry.payload).join(',') === 'after',
  'unknown condition does not execute branch',
  unknownIf.sendEntries,
)

console.log('\n=== J. include内endの伝播 ===')
const includeResolver: IncludeResolver = {
  resolve: (path) => (path === 'sub.ttl' ? `send 'inc'\nend` : null),
  resolveDynamic: () => null,
  getLinkedTabId: () => null,
  resolverForLinkedTab: () => null,
}
const includeSource = `include 'sub.ttl'\nsend 'after'\nend`
const includeEval = evaluateTTL(includeSource, { includeResolver })
assert(
  includeEval.sendEntries.map((entry) => entry.payload).join(',') === 'inc',
  'include end stops parent evaluation',
  includeEval.sendEntries,
)
const includeAnalysis = analyzeTTL(includeSource, { includeResolver })
assert(
  includeAnalysis.diagnostics.some((diag) => diag.line === 2 && diag.message.includes('到達しません')),
  'include end marks parent continuation unreachable',
  includeAnalysis.diagnostics,
)

const blockEndResolver: IncludeResolver = {
  ...includeResolver,
  resolve: (path) => (path === 'sub.ttl' ? `while 1\nend\nendwhile` : null),
}
const blockEndAnalysis = analyzeTTL(includeSource, { includeResolver: blockEndResolver })
assert(
  blockEndAnalysis.diagnostics.some((diag) => diag.line === 2 && diag.message.includes('到達しません')),
  'include block end marks parent continuation unreachable',
  blockEndAnalysis.diagnostics,
)

const includeCallResolver: IncludeResolver = {
  ...includeResolver,
  resolve: (path) =>
    path === 'sub.ttl'
      ? `call sub\ngoto done\n:sub\nsend 'called'\nreturn\n:done\nsend 'child-done'`
      : null,
}
const includeCallEval = evaluateTTL(includeSource, { includeResolver: includeCallResolver })
assert(
  includeCallEval.sendEntries.map((entry) => entry.payload).join(',') === 'called,child-done,after',
  'call and return inside include resume correctly',
  includeCallEval.sendEntries,
)

const includeValueResolver: IncludeResolver = {
  ...includeResolver,
  resolve: (path) => (path === 'values.ttl' ? `included_value = 42` : null),
}
const includeValueSource = `include 'values.ttl'\nsend included_value`
const includeValueEval = evaluateTTL(includeValueSource, { includeResolver: includeValueResolver })
assert(
  includeValueEval.sendEntries[0]?.payload === '42',
  'value assigned in include is available to parent evaluation',
  includeValueEval.sendEntries,
)
assert(
  includeValueEval.getHoverAt(2, 6)?.info.display === '42',
  'value assigned in include is available to parent hover',
  includeValueEval.getHoverAt(2, 6),
)

const dynamicIncludeValueResolver: IncludeResolver = {
  resolve: () => null,
  resolveDynamic: (_rawArg, context) =>
    context?.effectiveRaw === 'values.ttl' ? `dynamic_value = 84` : null,
  getLinkedTabId: () => null,
  resolverForLinkedTab: () => null,
}
const dynamicIncludeValueSource =
  `include_file = 'values.ttl'\ninclude include_file\nsend dynamic_value`
const dynamicIncludeValueEval = evaluateTTL(dynamicIncludeValueSource, {
  includeResolver: dynamicIncludeValueResolver,
})
assert(
  dynamicIncludeValueEval.getHoverAt(3, 6)?.info.display === '84',
  'value assigned in variable-path include is available to parent hover',
  dynamicIncludeValueEval.getHoverAt(3, 6),
)

const hoverReferences = evaluateTTL(`hover_value = 123\nsend hover_value\ncopy = hover_value`)
assert(
  hoverReferences.getHoverAt(2, 6)?.info.display === '123',
  'assigned value is shown when hovering a command argument reference',
  hoverReferences.getHoverAt(2, 6),
)
assert(
  hoverReferences.getHoverAt(3, 7)?.info.display === '123',
  'assigned value is shown when hovering an assignment RHS reference',
  hoverReferences.getHoverAt(3, 7),
)

const loopSendBindingKey = includeLoopIterationBindingKey(4, 0)
const loopSendResolver: IncludeResolver = {
  resolve: () => null,
  resolveDynamic: (_rawArg, context) =>
    context?.loopValue === 0 ? `send 'from-loop'\nend` : null,
  getLinkedTabId: (bindingKey) =>
    bindingKey === loopSendBindingKey || bindingKey === 'sub.ttl' ? 'sub-tab' : null,
  resolverForLinkedTab: () => null,
}
const loopSendEval = evaluateTTL(
  `strdim files 1\nfiles[0] = 'sub.ttl'\nfor i 0 0\n  include files[i]\nnext\nend`,
  { includeResolver: loopSendResolver },
)
assert(
  loopSendEval.sendEntries[0]?.location === `${loopSendBindingKey}:L1`,
  'loop include send location uses loop binding key',
  loopSendEval.sendEntries[0]?.location,
)

console.log(`\n=== REGRESSION RESULT: ${passed} passed, ${failed} failed ===`)
process.exit(failed > 0 ? 1 : 0)
