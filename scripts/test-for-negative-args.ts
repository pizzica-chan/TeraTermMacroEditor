/**
 * for の負の整数定数（公式 appendixes/negative）:
 * `for i 5 -1` は第2引数が 5-1 になり第3欠落 → エラー。
 * 回避策 0-1 / (-1) / 変数経由は 5→-1 に展開。
 */
import assert from 'node:assert/strict'
import { analyzeTTL } from '../src/ttl/analyzer.ts'
import { countCommandArgs, checkCommandArgs } from '../src/ttl/argChecker.ts'
import { evaluateTTL } from '../src/ttl/evaluator.ts'
import { findIncludeRefs } from '../src/ttl/includeRefs.ts'
import { tokenizeLine } from '../src/ttl/tokenize.ts'

function payloads(src: string): string {
  return evaluateTTL(src).sendEntries.map((e) => e.payload).join(',')
}

function forErrors(src: string): string[] {
  return analyzeTTL(src).diagnostics
    .filter((d) => d.severity === 'error' && d.message.includes("'for'"))
    .map((d) => d.message)
}

// 罠: for i 5 -1 → 引数不足エラー、誤展開しない
{
  const src = `for i 5 -1
sendln i
next
`
  const toks = tokenizeLine('for i 5 -1', 1)
  assert.equal(countCommandArgs('for', toks), 2, 'for i 5 -1 counts as 2 args')
  const msgs = forErrors(src)
  assert.ok(msgs.length >= 1, 'should diagnose for i 5 -1')
  assert.ok(
    msgs.some((m) => m.includes('不足') && m.includes('0-1')),
    `hint about workarounds: ${msgs.join(' | ')}`,
  )
  assert.ok(
    payloads(src) !== '4,3,2,1,0,-1' && payloads(src) !== '5,4,3,2,1,0,-1',
    `must not unroll for i 5 -1 as numeric range, got ${payloads(src)}`,
  )
}

// 回避策1: 0-1
{
  const src = `for i 5 0-1
sendln i
next
`
  assert.equal(countCommandArgs('for', tokenizeLine('for i 5 0-1', 1)), 3)
  assert.equal(forErrors(src).length, 0, `0-1 should be valid: ${forErrors(src)}`)
  assert.equal(payloads(src), '5,4,3,2,1,0,-1')
}

// 回避策2: (-1)
{
  const src = `for i 5 (-1)
sendln i
next
`
  assert.equal(payloads(src), '5,4,3,2,1,0,-1')
  assert.equal(forErrors(src).length, 0)
}

// 回避策3: 変数
{
  const src = `A = -1
for i 5 A
sendln i
next
`
  assert.equal(payloads(src), '5,4,3,2,1,0,-1')
  assert.equal(forErrors(src).length, 0)
}

// 単項負の開始は従来どおり OK（付録の罠とは別）
{
  const src = `for i -1 1
sendln i
next
`
  assert.equal(payloads(src), '-1,0,1')
  assert.equal(forErrors(src).length, 0)
}

// includeRefs: 罠形は展開しない / 回避策は展開
{
  const bad = findIncludeRefs(`for i 5 -1
  include host[i]
next`)
  assert.equal(bad[0]?.loopContext, undefined, 'bad for must not get loopContext')

  const ok = findIncludeRefs(`for i 5 0-1
  include host[i]
next`)
  assert.equal(ok[0]?.loopContext?.values.join(','), '5,4,3,2,1,0,-1')

  const paren = findIncludeRefs(`for i 5 (-1)
  include host[i]
next`)
  assert.equal(paren[0]?.loopContext?.values.join(','), '5,4,3,2,1,0,-1')
}

// 余分な第4引数
{
  const diags = checkCommandArgs('for', tokenizeLine('for i 1 2 3', 1), 1, 1)
  assert.ok(
    diags.some((d) => d.message.includes('多すぎ')),
    `trailing arg: ${diags.map((d) => d.message).join('; ')}`,
  )
}

console.log('for-negative-args: ok')
