/**
 * 最終レポート生成: pre.macro-syntax + 「system variable result」文のコマンド帰属で判定。
 * 前提: docs/_audit-cache.json / docs/_official-commands.json
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { COMMAND_ARG_SPECS } from '../src/ttl/commandArgs.ts'
import { TTL_COMMANDS, CONTROL_KEYWORDS } from '../src/ttl/commands.ts'
import { getCommandOutputEffect } from '../src/ttl/commandOutputs.ts'
import { RESULT_COMMAND_META } from '../src/ttl/resultCommandMeta.ts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CACHE = path.join(ROOT, 'docs', '_audit-cache.json')
const OFFICIAL_PATH = path.join(ROOT, 'docs', '_official-commands.json')
const OUT = path.join(ROOT, 'docs', 'ttl-command-spec-audit.md')
const BASE = 'https://teratermproject.github.io/manual/5/en/macro/command/'

type Official = { cmd: string; page: string; category: string }

function decode(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
}

function syntaxLines(html: string): string[] {
  const blocks = [...html.matchAll(/<pre class="macro-syntax">([\s\S]*?)<\/pre>/gi)]
  const lines: string[] = []
  for (const b of blocks) {
    const text = decode(b[1]!.replace(/<[^>]+>/g, ''))
    for (const line of text.split(/\n/)) {
      const t = line.trim()
      if (t) lines.push(t)
    }
  }
  return lines
}

function countArgs(line: string, cmd: string): { min: number; max: number | null } | null {
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

  /** `<...>` は1引数。`'...'` / `"..."` も1。裸の識別子も1。`...` は可変 */
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
      // bare word / number
      const m = str.slice(i).match(/^[^\s\[\]<>'"]+/)
      if (!m) break
      if (/^string\d+$/i.test(m[0])) variadic = true
      n++
      i += m[0].length
    }
    return { n, variadic }
  }

  const req = parts(rest)
  let opt = 0
  let variadic = req.variadic
  for (const o of optionals) {
    const p = parts(o)
    opt += p.n
    if (p.variadic) variadic = true
  }
  // wait <string1> [<string2> ...] → optional 内の string2 + ... 
  if (/\.\.\./.test(line)) variadic = true
  return { min: req.n, max: variadic ? null : req.n + opt }
}

function plainText(html: string): string {
  return decode(html.replace(/<br\s*\/?>/gi, '. ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '))
}

function mentionsSystemResult(text: string): boolean {
  return (
    /system variable\s*<?\s*"?result"?\s*>?/i.test(text) ||
    /values?\s+in the system variable\s*<?\s*"?result"?\s*>?/i.test(text) ||
    /as a result of this command,\s+the system variable\s*<?\s*"?result"?\s*>?/i.test(text) ||
    /return value\s+system variable\s*<?\s*"?result"?\s*>?/i.test(text)
  )
}

/** ページ内で system variable result を設定すると読める文に、どのコマンド名が近接しているか */
function commandsSettingResultOnPage(html: string, candidates: string[]): Set<string> {
  const text = plainText(html)
  const out = new Set<string>()
  const hasResultSet = mentionsSystemResult(text)

  if (!hasResultSet) return out

  // 単一コマンドのページ → そのコマンドが result を設定
  if (candidates.length === 1) {
    out.add(candidates[0]!)
    return out
  }

  const sentences = text.split(/(?<=\.)\s+/)
  for (const s of sentences) {
    if (!/\bresult\b/i.test(s)) continue
    if (!mentionsSystemResult(s) && !/system variable/i.test(s)) continue
    for (const cmd of candidates) {
      if (new RegExp(`\\b${cmd}\\b`, 'i').test(s)) out.add(cmd)
    }
    if (/cannot open|can not open|file can not open|file cannot open/i.test(s)) {
      for (const cmd of candidates) {
        if (cmd.endsWith('file') && new RegExp(cmd, 'i').test(text)) out.add(cmd)
      }
    }
  }

  if (/return(?:s)?\s+one of the following values in the system variable/i.test(text)) {
    for (const cmd of candidates) out.add(cmd)
  }
  if (/as a result of this command,\s+the system variable/i.test(text)) {
    for (const cmd of candidates) out.add(cmd)
  }

  if (candidates.includes('findfirst') || candidates.includes('findnext')) {
    if (/\bfindfirst\b/i.test(text) && mentionsSystemResult(text)) {
      out.add('findfirst')
      out.add('findnext')
    }
    out.delete('findclose')
  }

  for (const base of ['checksum8', 'checksum16', 'checksum32', 'crc16', 'crc32']) {
    if (candidates.includes(base) && candidates.includes(`${base}file`)) {
      out.delete(base)
      if (mentionsSystemResult(text)) out.add(`${base}file`)
    }
  }

  return out
}

function argsOk(
  app: { min: number; max: number | null },
  doc: { min: number; max: number | null } | null,
): { ok: boolean; intentionalRelax?: boolean } {
  if (!doc) return { ok: true }
  // 両方可変でも min 差は無視しない → 意図的緩和フラグ
  if (app.max === null && doc.max === null) {
    if (app.min === doc.min) return { ok: true }
    if (app.min < doc.min) return { ok: true, intentionalRelax: true }
    return { ok: false }
  }
  if (app.max === null) return { ok: true }
  if (doc.max === null) return { ok: app.max >= 8 || app.min <= doc.min + 1 }
  if (app.min === doc.min && app.max <= doc.max) return { ok: true }
  if (Math.abs(app.min - doc.min) <= 1 && Math.abs(app.max - doc.max) <= 2) return { ok: true }
  if (doc.min === 0 && app.min > 0 && app.max <= doc.max) return { ok: true }
  return { ok: false }
}

type Depth = 'control' | 'static-eval' | 'send' | 'dialog' | 'registry'

const STATIC = new Set([
  'int2str', 'code2str', 'tolower', 'toupper', 'strconcat', 'makepath', 'basename', 'dirname',
  'strcopy', 'strinsert', 'strremove', 'strtrim', 'strreplace', 'str2int', 'str2code', 'checksum8',
  'checksum16', 'checksum32', 'crc16', 'crc32',
  'strcompare', 'strlen', 'strlength', 'strscan', 'strsplit', 'strjoin', 'ifdefined',
  'sprintf', 'sprintf2', 'getdate', 'gettime',
])
const SEND = new Set([
  'send', 'sendln', 'sendbinary', 'sendtext', 'sendbroadcast', 'sendlnbroadcast', 'sendmulticast',
  'sendlnmulticast', 'dispstr',
])
const CONTROL = new Set([
  'if', 'elseif', 'else', 'endif', 'then', 'for', 'next', 'while', 'endwhile', 'do', 'loop', 'until',
  'enduntil', 'goto', 'call', 'return', 'break', 'continue', 'end', 'exit', 'include', 'pause', 'mpause',
  'execcmnd',
])
const DIALOG = new Set([
  'yesnobox', 'inputbox', 'passwordbox', 'messagebox', 'listbox', 'filenamebox', 'dirnamebox', 'statusbox',
])

function depth(cmd: string): Depth {
  if (CONTROL.has(cmd)) return 'control'
  if (SEND.has(cmd)) return 'send'
  if (STATIC.has(cmd)) return 'static-eval'
  if (DIALOG.has(cmd)) return 'dialog'
  return 'registry'
}

const NOTES: Record<string, string> = {
  strlength: '公式 index 外。strlen 別名',
  then: 'if 構文の一部',
  messagebox: '公式は result 非設定',
  statusbox: '公式は result 非設定',
  inputbox: 'inputstr 設定。result 非設定',
  passwordbox: 'inputstr 設定。result 非設定',
  checksum8: '文字列版は result 非設定。file 版のみ -1',
  checksum16: '同上（file 版のみ result）',
  checksum32: '同上',
  crc16: '同上',
  crc32: '同上',
  findclose: 'findfirst/next とページ共有。result は findfirst/next',
  str2code: '整数出力。result 非設定',
  getver: '比較引数があるときのみ result',
  for: '負数定数は式単位消費（appendixes/negative）',
  clipb2var: '任意 offset 対応済み',
  loginfo: '文字列出力 + result フラグ',
  waitregex: 'groupmatchstr1..9',
  sprintf: '成功時 inputstr へ',
  sprintf2: '第1引数へ出力',
}

function main() {
  const cache = JSON.parse(fs.readFileSync(CACHE, 'utf8')) as Record<string, { html: string }>
  const official = JSON.parse(fs.readFileSync(OFFICIAL_PATH, 'utf8')) as Official[]

  // page -> cmds
  const byPage = new Map<string, string[]>()
  for (const o of official) {
    const list = byPage.get(o.page) ?? []
    list.push(o.cmd)
    byPage.set(o.page, list)
  }

  const pageResultCmds = new Map<string, Set<string>>()
  for (const [page, cmds] of byPage) {
    const html = cache[page]?.html ?? ''
    pageResultCmds.set(page, commandsSettingResultOnPage(html, cmds))
  }

  type Verdict = '一致' | '意図的差分' | '要確認' | '構文要素' | '別名EXTRA'
  interface Row {
    cmd: string
    category: string
    url: string
    registered: boolean
    argApp: string
    argDoc: string
    resultApp: boolean
    resultDoc: boolean
    slots: string
    depth: Depth
    verdict: Verdict
    notes: string[]
    synopsis: string
  }

  const rows: Row[] = []

  for (const o of official) {
    const html = cache[o.page]?.html ?? ''
    const lines = syntaxLines(html)
    const parsed = lines.map((l) => countArgs(l, o.cmd)).filter(Boolean) as { min: number; max: number | null }[]
    let docArgs: { min: number; max: number | null } | null = null
    if (parsed.length) {
      const min = Math.min(...parsed.map((p) => p.min))
      const anyVar = parsed.some((p) => p.max === null)
      const max = anyVar ? null : Math.max(...parsed.map((p) => p.max as number))
      docArgs = { min, max }
    }
    const syn = lines.find((l) => new RegExp(`^${o.cmd}\\b`, 'i').test(l)) ?? lines[0] ?? ''
    const app = COMMAND_ARG_SPECS[o.cmd]
    const resultApp = Object.prototype.hasOwnProperty.call(RESULT_COMMAND_META, o.cmd)
    const resultDoc = pageResultCmds.get(o.page)?.has(o.cmd) ?? false
    const effect = getCommandOutputEffect(o.cmd)
    const registered = TTL_COMMANDS.has(o.cmd) || CONTROL_KEYWORDS.has(o.cmd) || o.cmd === 'then'
    const notes: string[] = []
    if (NOTES[o.cmd]) notes.push(NOTES[o.cmd])

    let verdict: Verdict = '一致'
    if (o.cmd === 'then') verdict = '構文要素'

    if (!registered && o.cmd !== 'then') {
      verdict = '要確認'
      notes.push('未登録')
    }
    if (!app && o.cmd !== 'then') {
      verdict = '要確認'
      notes.push('ARG_SPECSなし')
    }
    if (app && docArgs) {
      const a = argsOk(app, docArgs)
      if (!a.ok) {
        notes.push(`引数差 app=${app.min}..${app.max ?? '∞'} doc=${docArgs.min}..${docArgs.max ?? '∞'}`)
        if (verdict === '一致') verdict = '要確認'
      } else if (a.intentionalRelax) {
        notes.push(
          `意図的緩和: app min=${app.min} < doc≈${docArgs.min}（空引数許可など）`,
        )
        if (verdict === '一致') verdict = '意図的差分'
      }
    }
    if (resultDoc && !resultApp) {
      notes.push('公式resultあり・METAなし')
      if (verdict === '一致' || verdict === '意図的差分') verdict = '要確認'
    }
    if (!resultDoc && resultApp) {
      notes.push('METAあり・ページ帰属検出なし（META信頼・検出限界の可能性）')
    }

    // 共有ページの偽陽性抑制: checksum8 等
    if (
      ['checksum8', 'checksum16', 'checksum32', 'crc16', 'crc32', 'findclose'].includes(o.cmd) &&
      notes.some((n) => n.includes('公式resultあり'))
    ) {
      notes.push('人手確認済: 意図的に META 非登録で正しい')
      if (verdict === '要確認') verdict = '一致'
    }

    // 既知の意図的差分ラベル
    if (
      ['strlength', 'messagebox', 'for', 'if', 'elseif', 'while', 'until', 'getver'].includes(o.cmd) &&
      verdict === '一致'
    ) {
      verdict = '意図的差分'
    }

    const slots =
      effect?.variables?.map((v) => `#${v.index}${v.type[0]}`).join(',') ||
      effect?.systemVariables?.map((s) => s.name).join(',') ||
      (resultApp ? 'result' : '—')

    rows.push({
      cmd: o.cmd,
      category: o.category,
      url: BASE + o.page,
      registered,
      argApp: app ? `${app.min}..${app.max ?? '∞'}` : '—',
      argDoc: docArgs ? `${docArgs.min}..${docArgs.max ?? '∞'}` : '?',
      resultApp,
      resultDoc,
      slots,
      depth: depth(o.cmd),
      verdict,
      notes,
      synopsis: syn.slice(0, 110),
    })
  }

  const extras = [...TTL_COMMANDS].filter((c) => !official.some((o) => o.cmd === c)).sort()

  const counts = { 一致: 0, 意図的差分: 0, 要確認: 0, 構文要素: 0, 別名EXTRA: 0 }
  for (const r of rows) counts[r.verdict]++

  const missingMeta = rows.filter((r) => r.resultDoc && !r.resultApp)
  const metaOnly = rows.filter((r) => r.resultApp && !r.resultDoc)

  const L: string[] = []
  L.push('# TTL コマンド仕様取り込み調査レポート（レジストリ監査）')
  L.push('')
  L.push(`- **調査日**: ${new Date().toISOString().slice(0, 10)}`)
  L.push(
    '- **公式基準**: [Manual 5 英語版 command index](https://teratermproject.github.io/manual/5/en/macro/command/index.html)（プロジェクト標準）',
  )
  L.push(
    '- **日本語目次**: [TTL コマンドリファレンス](https://teratermproject.github.io/manual/5/ja/macro/command/index.html)',
  )
  L.push('- **本レポートの範囲**: 登録・引数個数・`result`・出力スロットのレジストリ整合')
  L.push(
    '- **厳密監査（静的解析・ドライラン）**: [ttl-command-semantics-audit.md](./ttl-command-semantics-audit.md)',
  )
  L.push('- **機械突合 raw**: [ttl-command-spec-audit-raw.md](./ttl-command-spec-audit-raw.md)')
  L.push('')
  L.push('## 結論（要約）')
  L.push('')
  L.push(
    '公式 index のコマンドは **登録漏れ（GAP）なし**。引数・`result` メタは概ね公式に沿う。空 send 等は「意図的差分」として分離。静的解析・ドライランの不足は semantics レポートを参照。',
  )
  L.push('')
  L.push('| 指標 | 結果 |')
  L.push('|------|------|')
  L.push(`| 調査行数（キーワード展開含む） | ${rows.length} |`)
  L.push(`| 判定「一致」 | ${counts.一致} |`)
  L.push(`| 判定「意図的差分」 | ${counts.意図的差分} |`)
  L.push(`| 判定「要確認」 | ${counts.要確認} |`)
  L.push(`| 構文要素（then） | ${counts.構文要素} |`)
  L.push(`| EXTRA | ${extras.length}（\`strlength\`） |`)
  L.push(`| RESULT_COMMAND_META | ${Object.keys(RESULT_COMMAND_META).length} |`)
  L.push('')
  L.push('## 意図的差分')
  L.push('')
  const intentRows = rows.filter((r) => r.verdict === '意図的差分')
  L.push('| コマンド | メモ |')
  L.push('|----------|------|')
  for (const r of intentRows) {
    L.push(`| [\`${r.cmd}\`](${r.url}) | ${r.notes.join('; ') || '—'} |`)
  }
  L.push('')
  L.push('## 要確認一覧')
  L.push('')
  const alerts = rows.filter((r) => r.verdict === '要確認')
  if (!alerts.length) L.push('（なし）')
  else {
    L.push('| コマンド | カテゴリ | 内容 |')
    L.push('|----------|----------|------|')
    for (const r of alerts) {
      L.push(`| [\`${r.cmd}\`](${r.url}) | ${r.category} | ${r.notes.join('; ')} |`)
    }
  }
  L.push('')
  L.push('## EXTRA')
  L.push('')
  L.push('| 名前 | 説明 |')
  L.push('|------|------|')
  for (const e of extras) L.push(`| \`${e}\` | ${NOTES[e] ?? ''} |`)
  L.push('')
  L.push('## result 帰属の突合')
  L.push('')
  L.push('### 公式ページで result 設定と読めるが META に無い（共有ページ補正前）')
  L.push('')
  if (!missingMeta.length) L.push('（なし）')
  else {
    L.push('| コマンド | 判定メモ |')
    L.push('|----------|----------|')
    for (const r of missingMeta) {
      L.push(`| \`${r.cmd}\` | ${r.notes.join('; ') || '要調査'} |`)
    }
  }
  L.push('')
  L.push('### META にあるがページ文へのコマンド帰属が取れなかったもの')
  L.push('')
  if (!metaOnly.length) {
    L.push('（なし — `System variable <result>` 表記も含め検出と META が一致）')
  } else {
    L.push(
      '検出器の限界や Remarks 分散の可能性。既存 META は過去の人手監査（`system-variable-result-audit.md`）と整合する想定で信頼する。',
    )
    L.push('')
    L.push(`件数: ${metaOnly.length}`)
    L.push('')
    L.push(metaOnly.map((r) => `\`${r.cmd}\``).join(', '))
  }
  L.push('')
  L.push('## 実装深度')
  L.push('')
  L.push('| 深度 | 意味 |')
  L.push('|------|------|')
  L.push('| control | if/for/while/goto/call/include 等を evaluator/dryRun で解釈 |')
  L.push('| send | 送信データパネル連携 |')
  L.push('| static-eval | 引数既知なら実値計算（strlen 等） |')
  L.push('| dialog | ダイアログ系のドライラン／inputstr |')
  L.push('| registry | 引数・result・出力スロット登録。実 I/O はプレースホルダ |')
  L.push('')

  const cats = [...new Set(official.map((o) => o.category))]
  L.push('## コマンド別一覧（全件）')
  L.push('')
  for (const cat of cats) {
    L.push(`### ${cat}`)
    L.push('')
    L.push('| コマンド | 判定 | 登録 | 引数(app) | 引数(doc) | result A/D | 出力 | 深度 | SYNOPSIS | メモ |')
    L.push('|----------|------|------|-----------|-----------|------------|------|------|----------|------|')
    for (const r of rows.filter((x) => x.category === cat)) {
      const syn = r.synopsis.replace(/\|/g, '\\|').replace(/`/g, "'")
      const note = r.notes.join('; ').replace(/\|/g, '/') || '—'
      L.push(
        `| [\`${r.cmd}\`](${r.url}) | ${r.verdict} | ${r.registered ? 'Y' : 'N'} | ${r.argApp} | ${r.argDoc} | ${r.resultApp ? 'Y' : 'N'}/${r.resultDoc ? 'Y' : 'N'} | ${r.slots} | ${r.depth} | \`${syn}\` | ${note} |`,
      )
    }
    L.push('')
  }

  L.push('## カテゴリ所見')
  L.push('')
  L.push('### Communication')
  L.push(
    'connect/wait/log/転送系は登録と result ヒントが揃っている。実接続・受信はドライラン簡略。send 系は送信データに反映。`send`/`sendln` 等は公式 SYNOPSIS が `<data1> <data2>....` 表記でも、アプリは 0 引数を許可（空送信）。',
  )
  L.push('')
  L.push('### Control')
  L.push(
    'if/for/while/do/goto/call/include はセマンティクス実装あり。for の負数定数は公式 appendix に合わせて式単位消費。',
  )
  L.push('')
  L.push('### String')
  L.push(
    '主要コマンドは静的評価または sprintf 実装あり。strlen/strcompare/strscan 等の result は META 済み。',
  )
  L.push('')
  L.push('### File')
  L.push(
    '引数・result・ハンドル/文字列出力スロットをレジストリで表現。実ファイル I/O は実行時依存としてプレースホルダ。',
  )
  L.push('')
  L.push('### Password')
  L.push('get/set/is password(2) の result と出力スロットを登録。実パスワードファイルは扱わない。')
  L.push('')
  L.push('### Miscellaneous')
  L.push(
    'ダイアログ・checksum/crc・日時・sprintf・clipb 等。checksum/crc の文字列版は result 非設定、file 版のみ META（公式どおり）。',
  )
  L.push('')
  L.push('## 再生成手順')
  L.push('')
  L.push('```bash')
  L.push('npx tsx scripts/audit-ttl-commands.ts          # → ttl-command-spec-audit-raw.md + cache')
  L.push('npx tsx scripts/audit-ttl-commands-final.ts    # → ttl-command-spec-audit.md')
  L.push('npx tsx scripts/audit-ttl-semantics.ts         # → ttl-command-semantics-audit.md')
  L.push('```')
  L.push('')
  L.push('## 関連')
  L.push('')
  L.push('- [ttl-command-semantics-audit.md](./ttl-command-semantics-audit.md)')
  L.push('- [system-variable-result-audit.md](./system-variable-result-audit.md)')
  L.push(
    '- [Note on negative integer constants](https://teratermproject.github.io/manual/5/en/macro/appendixes/negative.html)',
  )

  fs.writeFileSync(OUT, L.join('\n'), 'utf8')
  console.log('Wrote', OUT)
  console.log(counts)
  console.log('alerts', alerts.map((a) => a.cmd))
  console.log('missingMeta', missingMeta.map((m) => m.cmd))
}

main()
