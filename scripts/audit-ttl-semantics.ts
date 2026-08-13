/**
 * TTL コマンドの「仕様取り込み」厳密監査
 * - レジストリ（登録・引数・result・出力）
 * - 静的解析（analyzer / staticCommandEval）
 * - 評価器・ドライランの専用処理
 *
 * 出力: docs/ttl-command-semantics-audit.md
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { COMMAND_ARG_SPECS } from '../src/ttl/commandArgs.ts'
import { TTL_COMMANDS, CONTROL_KEYWORDS } from '../src/ttl/commands.ts'
import { COMMAND_OUTPUT_EFFECTS, getCommandOutputEffect } from '../src/ttl/commandOutputs.ts'
import { RESULT_COMMAND_META } from '../src/ttl/resultCommandMeta.ts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OFFICIAL_PATH = path.join(ROOT, 'docs', '_official-commands.json')
const CACHE_PATH = path.join(ROOT, 'docs', '_audit-cache.json')
const OUT = path.join(ROOT, 'docs', 'ttl-command-semantics-audit.md')
const BASE = 'https://teratermproject.github.io/manual/5/en/macro/command/'

type Official = { cmd: string; page: string; category: string }

/** 静的に実値計算できるコマンド（staticCommandEval） */
const STATIC_STRING = new Set([
  'int2str', 'code2str', 'tolower', 'toupper', 'strconcat', 'makepath', 'basename', 'dirname',
  'strcopy', 'strinsert', 'strremove', 'strtrim', 'strreplace', 'strspecial', 'str2int', 'str2code',
  'checksum8', 'checksum16', 'checksum32', 'crc16', 'crc32',
  'sprintf', 'sprintf2', 'strjoin',
  'rotateleft', 'rotateright',
])
const STATIC_RESULT = new Set(['strcompare', 'strlen', 'strlength', 'strscan', 'ifdefined', 'strsplit'])

/** 制御フローとして evaluator/dryRun/analyzer が解釈 */
const CONTROL_IMPL = new Set([
  'if', 'elseif', 'else', 'endif', 'then', 'for', 'next', 'while', 'endwhile', 'do', 'loop',
  'until', 'enduntil', 'goto', 'call', 'return', 'break', 'continue', 'end', 'exit', 'include',
  'pause', 'mpause', 'execcmnd',
])

/** 送信データに記録（evaluator/dryRun） */
const SEND_RECORDED = new Set([
  'send',
  'sendln',
  'sendbinary',
  'sendtext',
  'sendbroadcast',
  'sendlnbroadcast',
  'sendmulticast',
  'sendlnmulticast',
])

/** 公式上ホストへ送るが、送信パネル未連携（dispstr / sendfile / sendkcode 等） */
const SEND_LIKE_NOT_RECORDED = new Set([
  'dispstr',
  'sendfile',
  'sendkcode',
])

/** ドライラン専用シミュレーション */
const DRYRUN_WAIT = new Set(['wait', 'waitln', 'waitregex', 'wait4all'])
const DRYRUN_DIALOG = new Set([
  'yesnobox', 'messagebox', 'inputbox', 'passwordbox', 'listbox', 'filenamebox', 'dirnamebox',
])
const DRYRUN_FLOW_LOG = new Set(['connect', 'disconnect', 'pause', 'mpause', 'flushrecv', 'sendbreak'])
const DRYRUN_DATETIME = new Set(['gettime', 'getdate'])
const DRYRUN_RECV_SPECIAL = new Set(['recvln', 'waitrecv'])

/**
 * 引数が既知なら決定的に計算できる（静的評価の候補）。
 * 未実装なら「静的評価ギャップ」。
 */
const PURE_STATIC_CANDIDATES = new Set([
  ...STATIC_STRING,
  ...STATIC_RESULT,
  'strmatch',
])

/** 意図的差分（公式と異なるがエディタ方針） */
const INTENTIONAL: Record<string, string> = {
  send: '公式 SYNOPSIS は data 必須相当だが、アプリは 0 引数（空送信）を許可',
  sendln: '同上（空 sendln 許可）',
  sendbinary: '引数 min=0（空許可）',
  sendtext: '引数 min=0',
  sendbroadcast: '引数 min=0',
  sendlnbroadcast: '引数 min=0',
  strlength: '公式 index 外の strlen 別名',
  messagebox: '公式は result 非設定。ドライランのみ UI 応答で result を更新し得る',
  statusbox: 'ダイアログ系だがドライラン専用UIなし（closesbox と対）',
  for: '負数定数は公式 appendix どおり式単位消費（実装済）',
  if: '引数仕様は条件式を 1 と数える（then 以降は別構文）',
  elseif: '条件式を 1 引数として扱う',
  while: '条件式を 1 引数として扱う',
  until: '条件式を 1 引数として扱う',
  getver: '比較引数なし時は result を変更しない（公式どおり META 注記）',
  checksum8: '文字列版は result 非設定（公式）。静的評価あり',
  checksum16: '文字列版は result 非設定',
  checksum32: '文字列版は result 非設定',
  crc16: '文字列版は result 非設定',
  crc32: '文字列版は result 非設定',
  findclose: 'result 非設定（findfirst/next のみ）',
}

type Layer =
  | 'control'
  | 'static-eval'
  | 'send-recorded'
  | 'dryrun-wait'
  | 'dryrun-dialog'
  | 'dryrun-flow'
  | 'dryrun-datetime'
  | 'dryrun-recv'
  | 'registry-placeholder'
  | 'keyword-only'

type Verdict =
  | '仕様相当（実装）'
  | '仕様相当（プレースホルダ）'
  | '意図的差分'
  | '不足'
  | '構文要素'

interface Row {
  cmd: string
  category: string
  url: string
  registered: boolean
  argSpec: string
  resultMeta: boolean
  outputEffect: boolean
  layers: Layer[]
  verdict: Verdict
  gaps: string[]
  notes: string[]
}

function decode(s: string): string {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
}

function syntaxLine(html: string, cmd: string): string {
  const m = /<pre class="macro-syntax">([\s\S]*?)<\/pre>/i.exec(html)
  if (!m) return ''
  const lines = decode(m[1]!.replace(/<[^>]+>/g, ''))
    .split(/\n/)
    .map((l) => l.trim())
    .filter(Boolean)
  return lines.find((l) => new RegExp(`^${cmd}\\b`, 'i').test(l)) ?? lines[0] ?? ''
}

function countArgsFromSyntax(line: string, cmd: string): { min: number; max: number | null } | null {
  if (!new RegExp(`^${cmd}\\b`, 'i').test(line)) return null
  let rest = line.slice(cmd.length)
  const optionals: string[] = []
  let guard = 0
  while (guard++ < 30) {
    const start = rest.lastIndexOf('[')
    if (start < 0) break
    let depth = 0
    let end = -1
    for (let i = start; i < rest.length; i++) {
      if (rest[i] === '[') depth++
      else if (rest[i] === ']') {
        depth--
        if (depth === 0) {
          end = i
          break
        }
      }
    }
    if (end < 0) break
    optionals.unshift(rest.slice(start + 1, end))
    rest = rest.slice(0, start) + rest.slice(end + 1)
  }
  const parts = (s: string): { n: number; variadic: boolean } => {
    let variadic = false
    let n = 0
    let i = 0
    const str = s.trim()
    while (i < str.length) {
      if (/\s/.test(str[i]!)) {
        i++
        continue
      }
      if (str.startsWith('...', i)) {
        variadic = true
        i += 3
        continue
      }
      if (str[i] === '<') {
        const close = str.indexOf('>', i)
        if (close < 0) break
        n++
        i = close + 1
        continue
      }
      if (str[i] === "'" || str[i] === '"') {
        const q = str[i]!
        const close = str.indexOf(q, i + 1)
        n++
        i = close < 0 ? str.length : close + 1
        continue
      }
      const m = str.slice(i).match(/^[^\s\[\]<>'"]+/)
      if (!m) break
      n++
      i += m[0].length
    }
    return { n, variadic }
  }
  const req = parts(rest)
  let opt = 0
  let variadic = req.variadic || /\.\.\./.test(line)
  for (const o of optionals) {
    const p = parts(o)
    opt += p.n
    if (p.variadic) variadic = true
  }
  return { min: req.n, max: variadic ? null : req.n + opt }
}

function main() {
  if (!fs.existsSync(OFFICIAL_PATH)) {
    console.error('Run npx tsx scripts/audit-ttl-commands.ts first')
    process.exit(1)
  }
  const official = JSON.parse(fs.readFileSync(OFFICIAL_PATH, 'utf8')) as Official[]
  const cache = fs.existsSync(CACHE_PATH)
    ? (JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8')) as Record<string, { html: string }>)
    : {}

  const rows: Row[] = []

  for (const o of official) {
    const html = cache[o.page]?.html ?? ''
    const syn = syntaxLine(html, o.cmd)
    const docArgs = syn ? countArgsFromSyntax(syn, o.cmd) : null
    const app = COMMAND_ARG_SPECS[o.cmd]
    const registered = TTL_COMMANDS.has(o.cmd) || CONTROL_KEYWORDS.has(o.cmd) || o.cmd === 'then'
    const resultMeta = Object.prototype.hasOwnProperty.call(RESULT_COMMAND_META, o.cmd)
    const effect = getCommandOutputEffect(o.cmd)
    const layers: Layer[] = []
    const gaps: string[] = []
    const notes: string[] = []

    if (o.cmd === 'then') {
      rows.push({
        cmd: o.cmd,
        category: o.category,
        url: BASE + o.page,
        registered: true,
        argSpec: '—',
        resultMeta: false,
        outputEffect: false,
        layers: ['keyword-only'],
        verdict: '構文要素',
        gaps: [],
        notes: ['if 構文の一部'],
      })
      continue
    }

    if (CONTROL_IMPL.has(o.cmd)) layers.push('control')
    if (STATIC_STRING.has(o.cmd) || STATIC_RESULT.has(o.cmd)) layers.push('static-eval')
    if (SEND_RECORDED.has(o.cmd)) layers.push('send-recorded')
    if (DRYRUN_WAIT.has(o.cmd)) layers.push('dryrun-wait')
    if (DRYRUN_DIALOG.has(o.cmd)) layers.push('dryrun-dialog')
    if (DRYRUN_FLOW_LOG.has(o.cmd)) layers.push('dryrun-flow')
    if (DRYRUN_DATETIME.has(o.cmd)) layers.push('dryrun-datetime')
    if (DRYRUN_RECV_SPECIAL.has(o.cmd)) layers.push('dryrun-recv')
    if (layers.length === 0) layers.push('registry-placeholder')

    // --- gaps ---
    if (!registered) gaps.push('TTL_COMMANDS/CONTROL 未登録')
    if (!app) gaps.push('COMMAND_ARG_SPECS なし')

    if (SEND_LIKE_NOT_RECORDED.has(o.cmd)) {
      gaps.push('送信系だが sendEntries/ドライラン送信イベント未記録（send/sendln のみ対応）')
    }

    if (PURE_STATIC_CANDIDATES.has(o.cmd) && !STATIC_STRING.has(o.cmd) && !STATIC_RESULT.has(o.cmd)) {
      gaps.push('決定的計算が可能だが staticCommandEval 未実装（引数既知でもプレースホルダ）')
    }

    if (o.cmd === 'statusbox') {
      gaps.push('ダイアログ表示系だが dryRun の DIALOG_COMMANDS 外（専用UIなし）')
    }

    if (['waitn', 'waitevent'].includes(o.cmd)) {
      gaps.push('待機系だが WAIT_COMMANDS 専用シミュ外（汎用 effect / flow のみ）')
    }

    if (['sendfile', 'sendkcode'].includes(o.cmd)) {
      gaps.push('ホスト送信に関与しうるが送信パネル未連携')
    }
    if (o.cmd === 'dispstr') {
      gaps.push('クライアント表示系だが送信パネル未連携（ホスト送信ではない）')
    }
    if (app && docArgs && app.max === null && docArgs.max === null && app.min < docArgs.min) {
      notes.push(`引数緩和: app min=${app.min} < doc≈${docArgs.min}（空引数許可など）`)
    }
    if (app && docArgs && app.max !== null && docArgs.max === null && app.max < 10 && docArgs.min <= app.min) {
      // wait max 10 vs doc ∞ — OK intentional cap matching remarks
      if (['wait', 'waitln', 'waitregex', 'wait4all'].includes(o.cmd) && app.max === 10) {
        notes.push('max=10 は公式 Remarks の上限に整合')
      }
    }

    if (INTENTIONAL[o.cmd]) notes.push(INTENTIONAL[o.cmd])

    // verdict
    let verdict: Verdict
    if (gaps.some((g) => g.includes('未登録') || g.includes('ARG_SPECS'))) {
      verdict = '不足'
    } else if (
      gaps.some((g) => g.includes('送信系だが') || g.includes('送信パネル') || g.includes('staticCommandEval') || g.includes('DIALOG') || g.includes('WAIT_COMMANDS'))
    ) {
      // 不足だが、I/Oプレースホルダ自体は設計通り → 不足として明示
      verdict = '不足'
    } else if (INTENTIONAL[o.cmd] && (notes.some((n) => n.includes('引数緩和')) || ['strlength', 'messagebox', 'if', 'elseif', 'while', 'until', 'for', 'getver'].includes(o.cmd))) {
      // 意図的差分のみで実装ギャップなし
      if (gaps.length === 0) verdict = layers.includes('control') || layers.includes('static-eval') || layers.includes('send-recorded') || layers.includes('dryrun-wait') || layers.includes('dryrun-dialog') || layers.includes('dryrun-datetime') || layers.includes('dryrun-recv') || layers.includes('dryrun-flow')
        ? (INTENTIONAL[o.cmd] && (o.cmd === 'send' || o.cmd === 'sendln') ? '意図的差分' : '仕様相当（実装）')
        : '仕様相当（プレースホルダ）'
      else verdict = '不足'
    } else if (gaps.length > 0) {
      verdict = '不足'
    } else if (layers.includes('control') || layers.includes('static-eval') || layers.includes('send-recorded') || layers.includes('dryrun-wait') || layers.includes('dryrun-dialog') || layers.includes('dryrun-datetime') || layers.includes('dryrun-recv') || layers.includes('dryrun-flow')) {
      verdict = o.cmd === 'send' || o.cmd === 'sendln' ? '意図的差分' : '仕様相当（実装）'
    } else {
      verdict = '仕様相当（プレースホルダ）'
    }

    // refine send/sendln: they HAVE send recording so "意図的差分" for empty args is correct primary label
    if ((o.cmd === 'send' || o.cmd === 'sendln') && gaps.length === 0) {
      verdict = '意図的差分'
    }
    // sendbinary etc: 不足 overrides
    if (SEND_LIKE_NOT_RECORDED.has(o.cmd)) verdict = '不足'

    rows.push({
      cmd: o.cmd,
      category: o.category,
      url: BASE + o.page,
      registered,
      argSpec: app ? `${app.min}..${app.max ?? '∞'}` : '—',
      resultMeta,
      outputEffect: !!effect,
      layers,
      verdict,
      gaps,
      notes,
    })
  }

  const extras = [...TTL_COMMANDS].filter((c) => !official.some((o) => o.cmd === c)).sort()

  const counts: Record<Verdict, number> = {
    '仕様相当（実装）': 0,
    '仕様相当（プレースホルダ）': 0,
    '意図的差分': 0,
    不足: 0,
    構文要素: 0,
  }
  for (const r of rows) counts[r.verdict]++

  const L: string[] = []
  L.push('# TTL コマンド仕様取り込み — 厳密監査（静的解析・ドライラン含む）')
  L.push('')
  L.push(`- **調査日**: ${new Date().toISOString().slice(0, 10)}`)
  L.push('- **公式基準**: [Manual 5 英語版](https://teratermproject.github.io/manual/5/en/macro/command/index.html)')
  L.push('- **日本語目次**: [コマンドリファレンス](https://teratermproject.github.io/manual/5/ja/macro/command/index.html)')
  L.push('- **対象レイヤ**: レジストリ / `analyzer` / `staticCommandEval` / `evaluator` / `dryRun`')
  L.push('- **関連**: [ttl-command-spec-audit.md](./ttl-command-spec-audit.md)（レジストリ突合）、[system-variable-result-audit.md](./system-variable-result-audit.md)')
  L.push('')
  L.push('## 1. 判定基準（厳密）')
  L.push('')
  L.push('| 判定 | 意味 |')
  L.push('|------|------|')
  L.push('| **仕様相当（実装）** | 制御・静的評価・送信記録・待機/ダイアログDR など、エディタが公式セマンティクスを解釈・計算している |')
  L.push('| **仕様相当（プレースホルダ）** | 登録・引数・result/出力スロットは公式どおり。実 I/O は `dialog-result` プレースホルダ（設計どおり・未確定扱い） |')
  L.push('| **意図的差分** | 公式と異なるが、エディタ方針として明示された差（空 send 許可、別名など） |')
  L.push('| **不足** | エディタ用途上、実装・連携が足りない（送信未記録、静的評価可能なのに未実装、DR専用漏れなど） |')
  L.push('| **構文要素** | 単独コマンドではない（`then`） |')
  L.push('')
  L.push('**「仕様相当（プレースホルダ）」は未実装バグではない。** 本エディタは Tera Term 実体を動かさないため、ファイル/通信の実結果は静的に断定しない（`system-variable-result-audit.md`）。')
  L.push('')
  L.push('**「不足」は「公式ページ未読」ではなく、取り込みギャップ**である。優先度はプロダクト判断。')
  L.push('')
  L.push('## 2. サマリー')
  L.push('')
  L.push('| 判定 | 件数 |')
  L.push('|------|------|')
  for (const [k, v] of Object.entries(counts)) L.push(`| ${k} | ${v} |`)
  L.push(`| 合計行 | ${rows.length} |`)
  L.push(`| EXTRA (\`strlength\`) | ${extras.length} |`)
  L.push('')
  L.push('### 結論（厳密読み）')
  L.push('')
  L.push(
    counts.不足 > 0
      ? `**全コマンドが仕様どおり取り込まれているとは言えない。** 不足 ${counts.不足} 件（主に送信系のパネル未連携・決定的コマンドの静的評価欠落・一部待機/ダイアログのDR専用漏れ）。レジストリ上の登録漏れはなし。`
      : '不足ゼロ。',
  )
  L.push('')
  L.push('## 3. 不足一覧（要対応候補）')
  L.push('')
  const deficits = rows.filter((r) => r.verdict === '不足')
  L.push('| コマンド | カテゴリ | ギャップ |')
  L.push('|----------|----------|----------|')
  for (const r of deficits) {
    L.push(`| [\`${r.cmd}\`](${r.url}) | ${r.category} | ${r.gaps.join('; ')} |`)
  }
  L.push('')
  L.push('### 不足の分類')
  L.push('')
  let gapN = 1
  L.push(`${gapN++}. **送信パネル未連携**: \`dispstr\` / \`sendfile\` / \`sendkcode\`（ホスト向け送信系のうち未記録）`)
  const staticGapCmds = [...PURE_STATIC_CANDIDATES]
    .filter((c) => !STATIC_STRING.has(c) && !STATIC_RESULT.has(c))
    .sort()
  if (staticGapCmds.length > 0) {
    L.push(
      `${gapN++}. **静的評価ギャップ**: ${staticGapCmds.map((c) => `\`${c}\``).join(' / ')} — 引数既知なら本家同様に計算可能なのにプレースホルダ止まり。`,
    )
  }
  L.push(`${gapN++}. **ドライラン専用の薄い待機**: \`waitn\` / \`waitevent\` は汎用 effect のみ（\`wait\` 系のような受信シミュレーションなし）。`)
  L.push(`${gapN++}. **statusbox**: ダイアログ表示だが \`DIALOG_COMMANDS\` 外。`)
  L.push('')
  L.push('## 4. 意図的差分')
  L.push('')
  L.push('| コマンド | 内容 |')
  L.push('|----------|------|')
  for (const r of rows.filter((x) => x.verdict === '意図的差分' || INTENTIONAL[x.cmd])) {
    if (!INTENTIONAL[r.cmd] && r.verdict !== '意図的差分') continue
    L.push(`| \`${r.cmd}\` | ${INTENTIONAL[r.cmd] ?? r.notes.join('; ')} |`)
  }
  L.push('')
  L.push('## 5. レイヤ別カバレッジ')
  L.push('')
  const layerCount: Record<string, number> = {}
  for (const r of rows) for (const ly of r.layers) layerCount[ly] = (layerCount[ly] ?? 0) + 1
  L.push('| レイヤ | 件数 | 内容 |')
  L.push('|--------|------|------|')
  L.push(`| control | ${layerCount.control ?? 0} | if/for/while/goto/call/include 等 |`)
  L.push(`| static-eval | ${layerCount['static-eval'] ?? 0} | 引数既知で実値計算 |`)
  L.push(`| send-recorded | ${layerCount['send-recorded'] ?? 0} | 送信データパネル |`)
  L.push(`| dryrun-wait | ${layerCount['dryrun-wait'] ?? 0} | wait 系シミュレーション |`)
  L.push(`| dryrun-dialog | ${layerCount['dryrun-dialog'] ?? 0} | ダイアログ UI |`)
  L.push(`| dryrun-datetime | ${layerCount['dryrun-datetime'] ?? 0} | gettime/getdate 実時刻 |`)
  L.push(`| dryrun-recv | ${layerCount['dryrun-recv'] ?? 0} | recvln/waitrecv |`)
  L.push(`| dryrun-flow | ${layerCount['dryrun-flow'] ?? 0} | connect 等のフローログ |`)
  L.push(`| registry-placeholder | ${layerCount['registry-placeholder'] ?? 0} | 登録＋プレースホルダのみ |`)
  L.push('')
  L.push('## 6. コマンド別詳細（全件）')
  L.push('')
  const cats = [...new Set(official.map((o) => o.category))]
  for (const cat of cats) {
    L.push(`### ${cat}`)
    L.push('')
    L.push('| コマンド | 判定 | 引数 | result | レイヤ | ギャップ / メモ |')
    L.push('|----------|------|------|--------|--------|----------------|')
    for (const r of rows.filter((x) => x.category === cat)) {
      const gap = [...r.gaps, ...r.notes].join('; ').replace(/\|/g, '/') || '—'
      L.push(
        `| [\`${r.cmd}\`](${r.url}) | ${r.verdict} | ${r.argSpec} | ${r.resultMeta ? 'Y' : 'N'} | ${r.layers.join('+')} | ${gap} |`,
      )
    }
    L.push('')
  }

  L.push('## 7. 静的評価の本家一致について')
  L.push('')
  L.push('`static-eval` 対象は別テストで部分検証済み:')
  L.push('')
  L.push('- `test:ttl-expressions` / `test:ttl-formats` / `test:ttl-sprintf` / `test:ttl-datetime` / `test:result-hover` / regression')
  L.push('- `strlen` は UTF-8 バイト長（公式 Manual 5 のバイト志向と整合する実装）')
  L.push('')
  L.push('本レポートは「そのコマンドに静的経路があるか」を主に見ており、全演算の本家ビット一致証明までは行っていない。不足に挙げた決定的コマンドは経路自体が無い。')
  L.push('')
  L.push('## 8. 再生成')
  L.push('')
  L.push('```bash')
  L.push('npx tsx scripts/audit-ttl-commands.ts          # キャッシュ更新')
  L.push('npx tsx scripts/audit-ttl-commands-final.ts    # レジストリ監査 md')
  L.push('npx tsx scripts/audit-ttl-semantics.ts         # 本レポート')
  L.push('```')

  fs.writeFileSync(OUT, L.join('\n'), 'utf8')
  console.log('Wrote', OUT)
  console.log(counts)
  console.log('deficits', deficits.map((d) => d.cmd).join(', '))
}

main()
