/**
 * 未確定 if ブロック内 end/exit と静的解析（到達不能・送信データ）の不変条件テスト。
 *
 * 背景: 変数条件の if 内 end は実行経路が確定しない。analyzer は endif 以降を到達不能にせず、
 * evaluator は result 等の未確定値で then を実行せず、万が一実行しても stopBlock で endif 以降の
 * send/sendln を収集する。if 1 など確定真の分岐では従来どおりマクロ終了扱い。
 *
 * analyzer / evaluator を変更したら必ず `npm run test:conditional-end` を実行すること。
 */
import { analyzeTTL } from '../src/ttl/analyzer'
import { evaluateTTL } from '../src/ttl/evaluator'

export interface TestRunResult {
  passed: number
  failed: number
}

interface StaticCase {
  name: string
  source: string
  /** 到達不能警告が出てはいけない行（1-based） */
  mustBeReachable?: number[]
  /** 到達不能警告が出なければならない行（1-based） */
  mustBeUnreachable?: number[]
  /** 送信データに含まれなければならない payload */
  mustSend?: string[]
  /** 送信データに含まれてはいけない payload */
  mustNotSend?: string[]
}

const CASES: StaticCase[] = [
  {
    name: 'if result=0 then end / endif 以降は到達可能',
    source: `if result = 0 then\n end\nendif\naaa = 0`,
    mustBeReachable: [4],
  },
  {
    name: 'if result<>0 then end / yesnobox 後も到達可能',
    source: `yesnobox '' ''\nif result <> 0 then\n end\nendif\n\naaa = 0`,
    mustBeReachable: [6],
  },
  {
    name: 'if 1 then end / endif 以降は到達不能',
    source: `if 1 then\n end\nendif\naaa = 0`,
    mustBeUnreachable: [4],
  },
  {
    name: '単行 if result=0 then end の次行は到達可能',
    source: `if result = 0 then end\naaa = 0`,
    mustBeReachable: [2],
  },
  {
    name: '条件付き if 内 exit の次行は到達可能',
    source: `if result = 0 then\nexit\nendif\naaa = 0`,
    mustBeReachable: [4],
  },
  {
    name: '条件付き if 内 goto の次行は到達可能',
    source: `if result = 0 then\ngoto target\nendif\naaa = 0\n:target\nend`,
    mustBeReachable: [4],
  },
  {
    name: '単行 if goto（未確定条件）の次行は到達可能',
    source: `if result = 0 goto target\naaa = 0\n:target\nend`,
    mustBeReachable: [2],
  },
  {
    name: '未確定 if 内 end の後も sendln を送信データに含める',
    source: `if result = 0 then\n end\nendif\nsendln 'after'`,
    mustBeReachable: [4],
    mustSend: ['after'],
  },
  {
    name: 'yesnobox 後の未確定 if 内 end の後も sendln を含める',
    source: `yesnobox '' ''\nif result <> 0 then\n end\nendif\nsendln 'after'`,
    mustSend: ['after'],
  },
  {
    name: 'if 1 内 end の後は sendln を含めない',
    source: `if 1 then\n end\nendif\nsendln 'after'`,
    mustBeUnreachable: [4],
    mustNotSend: ['after'],
  },
  {
    name: 'while 1 内 end の後は sendln を含めない（end はマクロ終了）',
    source: `while 1\nsend 'in'\nend\nendwhile\nsendln 'after'`,
    mustBeUnreachable: [5],
    mustSend: ['in'],
    mustNotSend: ['after'],
  },
  {
    name: '単行 if result<>0 then end の後も sendln を含める',
    source: `if result <> 0 then end\nsendln 'after'`,
    mustSend: ['after'],
  },
  {
    name: '未確定 if の then 内 send は含め、endif 後は含める',
    source: `if result <> 0 then\nsendln 'in-then'\nendif\nsendln 'after'`,
    mustSend: ['after'],
    mustNotSend: ['in-then'],
  },
]

function unreachableLines(source: string): Set<number> {
  return new Set(
    analyzeTTL(source)
      .diagnostics.filter((d) => d.message.includes('到達しません'))
      .map((d) => d.line),
  )
}

function sendPayloads(source: string): string[] {
  return evaluateTTL(source).sendEntries.map((e) => e.payload)
}

export function runConditionalEndStaticTests(): TestRunResult {
  let passed = 0
  let failed = 0

  console.log('=== 未確定 if 内 end / 静的解析（到達不能・送信データ） ===')

  for (const c of CASES) {
    const dead = unreachableLines(c.source)
    const sends = sendPayloads(c.source)
    const errors: string[] = []

    for (const line of c.mustBeReachable ?? []) {
      if (dead.has(line)) errors.push(`L${line} が到達不能になっている`)
    }
    for (const line of c.mustBeUnreachable ?? []) {
      if (!dead.has(line)) errors.push(`L${line} に到達不能警告がない`)
    }
    for (const payload of c.mustSend ?? []) {
      if (!sends.includes(payload)) errors.push(`send '${payload}' がない`)
    }
    for (const payload of c.mustNotSend ?? []) {
      if (sends.includes(payload)) errors.push(`send '${payload}' が含まれている`)
    }

    if (errors.length === 0) {
      passed++
      console.log(`  OK  ${c.name}`)
    } else {
      failed++
      console.error(`  NG  ${c.name}: ${errors.join('; ')}`)
      console.error('      dead:', [...dead], 'sends:', sends)
    }
  }

  return { passed, failed }
}

const isDirectRun = process.argv[1]?.replace(/\\/g, '/').endsWith('test-conditional-end-static.ts')
if (isDirectRun) {
  const { passed, failed } = runConditionalEndStaticTests()
  console.log(`\n=== CONDITIONAL END STATIC: ${passed} passed, ${failed} failed ===`)
  process.exit(failed > 0 ? 1 : 0)
}
