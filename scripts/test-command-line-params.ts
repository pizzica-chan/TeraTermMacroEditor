/**
 * コマンドライン系システム変数（params / param1〜9 / paramcnt）の公式寄せ
 */
import assert from 'node:assert/strict'
import {
  basenameMacroFile,
  buildCommandLineParamsSnapshot,
  formatParamcntHoverNote,
  formatParamNHoverNote,
  formatParamsIndexHoverNote,
  synthesizeCommandLine,
} from '../src/ttl/commandLineParams.ts'
import { evaluateTTL, initMacroEnvironment } from '../src/ttl/evaluator.ts'
import { getSystemVariableMeta } from '../src/ttl/commands.ts'

// ── basename / 合成 ──
assert.equal(basenameMacroFile('C:\\macros\\login.ttl'), 'login.ttl')
assert.equal(basenameMacroFile('/home/u/a.ttl'), 'a.ttl')
assert.equal(basenameMacroFile('plain.ttl'), 'plain.ttl')
assert.equal(
  synthesizeCommandLine('a.ttl', ['x', 'y']),
  'TTPMACRO.EXE a.ttl x y',
)

// ── 方針 A: 未指定 ──
{
  const snap = buildCommandLineParamsSnapshot()
  assert.equal(snap.specified, false)
  assert.equal(snap.paramcnt, 0)
  assert.equal(snap.params.size, 0)
  assert.ok(snap.param1to9.every((s) => s === ''))

  const env = initMacroEnvironment()
  const paramcnt = env.get('paramcnt')
  assert.ok(paramcnt?.kind === 'int' && paramcnt.value === 0)
  assert.equal(paramcnt.origin, 'system-default')
  const param1 = env.get('param1')
  assert.ok(param1?.kind === 'str' && param1.value === '')
  assert.equal(param1.origin, 'system-default')
  const params = env.get('params')
  assert.ok(params?.kind === 'array')
  assert.equal(params.elements.size, 0)
}

// ── 空のファイル名スロットでも params[1] / paramcnt に含める（後方互換） ──
{
  const snap = buildCommandLineParamsSnapshot(['', 'user1'])
  assert.equal(snap.specified, true)
  assert.equal(snap.paramcnt, 2)
  assert.equal(snap.params.get(1), '')
  assert.equal(snap.params.get(2), 'user1')
  assert.equal(snap.param1to9[0], '')
  assert.equal(snap.param1to9[1], 'user1')
  assert.equal(snap.params.get(0), 'TTPMACRO.EXE "" user1')

  const ev = evaluateTTL(`send param1\nsend paramcnt\nsend params[2]`, {
    macroArgv: ['', 'user1'],
  })
  assert.equal(ev.sendEntries[0]?.payload, '')
  assert.equal(ev.sendEntries[1]?.payload, '2')
  assert.equal(ev.sendEntries[2]?.payload, 'user1')
}

// ── 先頭のみ空（引数なし）: paramcnt=1・param1 空 ──
{
  const snap = buildCommandLineParamsSnapshot([''])
  assert.equal(snap.specified, true)
  assert.equal(snap.paramcnt, 1)
  assert.equal(snap.params.get(1), '')
  assert.equal(snap.param1to9[0], '')
}


// ── 後方互換 string[]: [ファイル名, 引数…] ──
{
  const snap = buildCommandLineParamsSnapshot(['script.ttl', 'user1', 'user2'])
  assert.equal(snap.specified, true)
  assert.equal(snap.paramcnt, 3)
  assert.equal(snap.params.get(0), 'TTPMACRO.EXE script.ttl user1 user2')
  assert.equal(snap.params.get(1), 'script.ttl')
  assert.equal(snap.params.get(2), 'user1')
  assert.equal(snap.params.get(3), 'user2')
  assert.equal(snap.param1to9[0], 'script.ttl')
  assert.equal(snap.param1to9[1], 'user1')
  assert.equal(snap.param1to9[2], 'user2')
}

// ── パス付きファイル名は basename のみ ──
{
  const snap = buildCommandLineParamsSnapshot(['D:/work/a.ttl', 'arg'])
  assert.equal(snap.params.get(1), 'a.ttl')
  assert.equal(snap.param1to9[0], 'a.ttl')
  assert.equal(snap.paramcnt, 2)
}

// ── MacroLaunchArgv 構造体 ──
{
  const snap = buildCommandLineParamsSnapshot({
    commandLine: 'custom.exe foo.ttl bar',
    macroFileName: 'C:\\x\\foo.ttl',
    args: ['bar'],
  })
  assert.equal(snap.params.get(0), 'custom.exe foo.ttl bar')
  assert.equal(snap.params.get(1), 'foo.ttl')
  assert.equal(snap.params.get(2), 'bar')
  assert.equal(snap.paramcnt, 2)
}

// ── evaluateTTL 統合（既存 smoke 相当） ──
{
  const ev = evaluateTTL(`send param1\nsend param2\nsend paramcnt\nsend params[0]\nsend params[2]`, {
    macroArgv: ['script.ttl', 'user1', 'user2'],
  })
  assert.equal(ev.sendEntries[0]?.payload, 'script.ttl')
  assert.equal(ev.sendEntries[1]?.payload, 'user1')
  assert.equal(ev.sendEntries[2]?.payload, '3')
  assert.equal(ev.sendEntries[3]?.payload, 'TTPMACRO.EXE script.ttl user1 user2')
  assert.equal(ev.sendEntries[4]?.payload, 'user1')
}

// ── 未指定時ホバー ──
{
  const src = `send param1\nsend paramcnt\nsend params[0]\n`
  const ev = evaluateTTL(src)
  const p1 = ev.getHoverAt(1, src.split('\n')[0]!.toLowerCase().indexOf('param1') + 1)?.info
  assert.ok(p1?.note?.includes('param1'))
  assert.ok(p1?.note?.includes('未指定') || p1?.valueKind === 'system-default')

  const pc = ev.getHoverAt(2, src.split('\n')[1]!.toLowerCase().indexOf('paramcnt') + 1)?.info
  assert.ok(pc?.note?.includes('paramcnt'))
  assert.ok(pc?.note?.includes('未指定'))

  const p0 = ev.getHoverAt(3, src.split('\n')[2]!.indexOf('params') + 1)?.info
  assert.ok(p0?.note?.includes('params[0]') || p0?.note?.includes('コマンドライン'))
}

// ── 指定時ホバー ──
{
  const src = `send param1\nsend params[2]\n`
  const ev = evaluateTTL(src, { macroArgv: ['a.ttl', 'first'] })
  const p1 = ev.getHoverAt(1, 6)?.info
  assert.ok(p1?.note?.includes('マクロファイル名'))
  assert.equal(p1?.display, `'a.ttl'`)

  const line2 = src.split('\n')[1]!
  const p2 = ev.getHoverAt(2, line2.indexOf('params') + 1)?.info
  assert.ok(p2?.note?.includes('params[2]') || p2?.display?.includes('first'))
}

// ── META ──
assert.ok(getSystemVariableMeta('param1')?.description.includes('ファイル名'))
assert.ok(getSystemVariableMeta('param2')?.description.includes('params[2]'))
assert.ok(getSystemVariableMeta('paramcnt')?.description.includes('params[1]'))
assert.ok(getSystemVariableMeta('params')?.description.includes('[0]'))
assert.ok(formatParamNHoverNote(1).includes('params[1]'))
assert.ok(formatParamsIndexHoverNote(0).includes('コマンドライン'))
assert.ok(formatParamcntHoverNote(false).includes('未指定'))

// ── 未指定のまま if paramcnt=0 は静的に断定しない（system-default） ──
{
  const env = initMacroEnvironment()
  const v = env.get('paramcnt')
  assert.equal(v?.kind === 'int' ? v.origin : null, 'system-default')
}

console.log('command-line-params: ok')
