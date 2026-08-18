import {
  formatUnresolvedDisplay,
} from '../src/ttl/unresolvedDisplay'
import { evaluateTTL } from '../src/ttl/evaluator'

export interface TestRunResult {
  passed: number
  failed: number
}

export function runUnresolvedDisplayTests(): TestRunResult {
  let passed = 0
  let failed = 0

  function check(cond: boolean, label: string, detail?: unknown) {
    if (cond) {
      passed++
      console.log(`  OK  ${label}`)
    } else {
      failed++
      console.error(`  NG  ${label}`, detail ?? '')
    }
  }

  function embedded(text: string): string {
    return formatUnresolvedDisplay(text, 'embedded')
  }

  function expression(text: string): string {
    return formatUnresolvedDisplay(text, 'expression')
  }

  console.log('=== 未確定値の表示（埋め込み） ===')

  check(expression("'hoge' + （getdate の出力）") === "'hoge' + （getdate の出力）", '連結式は変換しない')
  check(embedded("'hoge' + （getdate の出力）") === 'hoge{getdateの出力}', "'hoge' + （getdate の出力）")
  check(embedded('（getdate の出力）') === '{getdateの出力}', '単独のコマンド出力')
  check(embedded("（gettime の出力） + 'aaaa'") === '{gettimeの出力}aaaa', '後ろにリテラル')
  check(
    embedded("'echo ' + （gettime の出力） + 'aaaa'") === 'echo {gettimeの出力}aaaa',
    '前後にリテラル',
  )
  check(embedded('（ユーザー入力）') === '{ユーザー入力}', 'ユーザー入力')
  check(embedded('（受信マッチ）') === '{受信マッチ}', '受信マッチ')
  check(embedded('〈未定義: foo〉') === '{未定義: foo}', '未定義プレースホルダ')
  check(embedded('123 + （random の出力）') === '123{randomの出力}', '整数 + 出力')
  check(embedded("'' + （getdate の出力）") === '{getdateの出力}', '空文字リテラル')
  check(embedded('hello') === 'hello', '通常の送信ペイロードは変えない')
  check(embedded('結果（成功）') === '結果（成功）', '通常の全角括弧は変えない')
  check(embedded("'secret'") === "'secret'", '単独の引用符付き文字は変えない')

  const src = `getdate d
msg = 'hoge'
strconcat msg d
sendln msg
end`
  const payload = evaluateTTL(src).sendEntries[0]?.payload ?? ''
  check(payload.includes('の出力') && payload.includes(' + '), 'evaluator は連結式 hint のまま', payload)
  check(embedded(payload) === 'hoge{getdateの出力}', 'evaluator の send を埋め込み表示', payload)

  return { passed, failed }
}

const isDirectRun = process.argv[1]?.replace(/\\/g, '/').endsWith('test-unresolved-display.ts')
if (isDirectRun) {
  const { passed, failed } = runUnresolvedDisplayTests()
  console.log(`\n${passed} passed, ${failed} failed`)
  process.exit(failed > 0 ? 1 : 0)
}
