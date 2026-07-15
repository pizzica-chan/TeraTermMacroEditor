/** main ブランチとの core 挙動比較用スナップショット */
import { analyzeTTL } from '../src/ttl/analyzer'
import { evaluateTTL } from '../src/ttl/evaluator'

const cases: Record<string, string> = {
  sample: `timeout = 30\nhostname = '1.2.3.4'\nusername = 'u'\npassword = 'p'\nwhile 1\n  sendln username\n  break\nendwhile\nend`,
  endDead: `send 'a'\nend\nsend 'b'`,
  forLoop: `for i 0 1\n  send i\nnext`,
  gettime: `gettime t "%Y"\nsendln t`,
  strcopy: `strcopy 'abc' 2 2 s\nsend s`,
  labelOnly: `x = 'main'\n:unused\nsend x\nend`,
  arrayOob: `strdim a 2\na[5] = 'x'`,
  undefVar: `send unknown_var`,
}

const snapshot: Record<string, unknown> = {}
for (const [name, src] of Object.entries(cases)) {
  const analysis = analyzeTTL(src)
  const evaluation = evaluateTTL(src)
  snapshot[name] = {
    errors: analysis.diagnostics.filter((d) => d.severity === 'error').length,
    warnings: analysis.diagnostics.map((d) => `${d.line}:${d.message}`),
    sends: evaluation.sendEntries.map((e) => ({ p: e.payload, u: e.unresolved })),
  }
}
console.log(JSON.stringify(snapshot, null, 2))
