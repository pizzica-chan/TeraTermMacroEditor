/**
 * 公式 Manual 5 英語版コマンドページを取得し、アプリ側レジストリと突合する。
 * 出力: docs/ttl-command-spec-audit.md および docs/_audit-cache.json
 *
 * Usage: npx tsx scripts/audit-ttl-commands.ts
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { COMMAND_ARG_SPECS } from '../src/ttl/commandArgs.ts'
import { TTL_COMMANDS, CONTROL_KEYWORDS } from '../src/ttl/commands.ts'
import { COMMAND_OUTPUT_EFFECTS, getCommandOutputEffect } from '../src/ttl/commandOutputs.ts'
import { RESULT_COMMAND_META } from '../src/ttl/resultCommandMeta.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const CACHE = path.join(ROOT, 'docs', '_audit-cache.json')
const OUT_RAW = path.join(ROOT, 'docs', 'ttl-command-spec-audit-raw.md')
const OUT = path.join(ROOT, 'docs', 'ttl-command-spec-audit.md') // 互換: 最終は final が上書き。本スクリプトは raw のみ書く
const BASE = 'https://teratermproject.github.io/manual/5/en/macro/command/'

/** 公式 index のコマンド → ページ HTML 名（複合ページあり） */
const OFFICIAL: Array<{ cmd: string; page: string; category: string }> = [
  // Communication
  ...[
    'bplusrecv', 'bplussend', 'callmenu', 'changedir', 'clearscreen', 'closett',
    'connect', 'cygconnect', 'disconnect', 'dispstr', 'enablekeyb', 'flushrecv',
    'gethostname', 'getmodemstatus', 'gettitle', 'getttpos', 'kmtfinish', 'kmtget',
    'kmtrecv', 'kmtsend', 'loadkeymap', 'logautoclosemode', 'logclose', 'loginfo',
    'logopen', 'logpause', 'logrotate', 'logstart', 'logwrite', 'quickvanrecv',
    'quickvansend', 'recvln', 'recvfile', 'restoresetup', 'scprecv', 'scpsend',
    'send', 'sendbinary', 'sendbreak', 'sendbroadcast', 'sendfile', 'sendkcode',
    'sendln', 'sendlnbroadcast', 'sendlnmulticast', 'sendtext', 'sendmulticast',
    'setbaud', 'setdebug', 'setdtr', 'setecho', 'setflowctrl', 'setmulticastname',
    'setrts', 'setserialdelaychar', 'setserialdelayline', 'setspeed', 'setsync',
    'settitle', 'showtt', 'testlink', 'unlink', 'wait', 'wait4all', 'waitevent',
    'waitln', 'waitn', 'waitrecv', 'waitregex', 'xmodemrecv', 'xmodemsend',
    'ymodemrecv', 'ymodemsend', 'zmodemrecv', 'zmodemsend',
  ].map((cmd) => ({ cmd, page: `${cmd}.html`, category: 'Communication' })),
  // Control
  { cmd: 'break', page: 'break.html', category: 'Control' },
  { cmd: 'call', page: 'call.html', category: 'Control' },
  { cmd: 'continue', page: 'continue.html', category: 'Control' },
  { cmd: 'do', page: 'doloop.html', category: 'Control' },
  { cmd: 'loop', page: 'doloop.html', category: 'Control' },
  { cmd: 'end', page: 'end.html', category: 'Control' },
  { cmd: 'execcmnd', page: 'execcmnd.html', category: 'Control' },
  { cmd: 'exit', page: 'exit.html', category: 'Control' },
  { cmd: 'for', page: 'fornext.html', category: 'Control' },
  { cmd: 'next', page: 'fornext.html', category: 'Control' },
  { cmd: 'goto', page: 'goto.html', category: 'Control' },
  { cmd: 'if', page: 'ifthenelseif.html', category: 'Control' },
  { cmd: 'then', page: 'ifthenelseif.html', category: 'Control' },
  { cmd: 'elseif', page: 'ifthenelseif.html', category: 'Control' },
  { cmd: 'else', page: 'ifthenelseif.html', category: 'Control' },
  { cmd: 'endif', page: 'ifthenelseif.html', category: 'Control' },
  { cmd: 'include', page: 'include.html', category: 'Control' },
  { cmd: 'mpause', page: 'mpause.html', category: 'Control' },
  { cmd: 'pause', page: 'pause.html', category: 'Control' },
  { cmd: 'return', page: 'return.html', category: 'Control' },
  { cmd: 'until', page: 'until.html', category: 'Control' },
  { cmd: 'enduntil', page: 'until.html', category: 'Control' },
  { cmd: 'while', page: 'while.html', category: 'Control' },
  { cmd: 'endwhile', page: 'while.html', category: 'Control' },
  // String
  ...[
    'code2str', 'expandenv', 'int2str', 'regexoption', 'sprintf', 'sprintf2',
    'str2code', 'str2int', 'strcompare', 'strconcat', 'strcopy', 'strinsert',
    'strjoin', 'strlen', 'strmatch', 'strremove', 'strreplace', 'strscan',
    'strspecial', 'strsplit', 'strtrim', 'tolower', 'toupper',
  ].map((cmd) => ({ cmd, page: `${cmd}.html`, category: 'String' })),
  // File
  ...[
    'basename', 'dirname', 'fileclose', 'fileconcat', 'filecopy', 'filecreate',
    'filedelete', 'filelock', 'filemarkptr', 'fileopen', 'filereadln', 'fileread',
    'filerename', 'filesearch', 'fileseek', 'fileseekback', 'filestat',
    'filestrseek', 'filestrseek2', 'filetruncate', 'fileunlock', 'filewrite',
    'filewriteln', 'foldercreate', 'folderdelete', 'foldersearch', 'getdir',
    'getfileattr', 'makepath', 'setdir', 'setfileattr',
  ].map((cmd) => ({ cmd, page: `${cmd}.html`, category: 'File' })),
  { cmd: 'findfirst', page: 'findoperations.html', category: 'File' },
  { cmd: 'findnext', page: 'findoperations.html', category: 'File' },
  { cmd: 'findclose', page: 'findoperations.html', category: 'File' },
  // Password
  ...[
    'delpassword', 'delpassword2', 'getpassword', 'getpassword2', 'ispassword',
    'ispassword2', 'passwordbox', 'setpassword', 'setpassword2',
  ].map((cmd) => ({ cmd, page: `${cmd}.html`, category: 'Password' })),
  // Misc
  ...[
    'beep', 'bringupbox', 'closesbox', 'clipb2var', 'exec', 'dirnamebox',
    'filenamebox', 'getdate', 'getenv', 'getipv4addr', 'getipv6addr',
    'getspecialfolder', 'gettime', 'getttdir', 'getver', 'ifdefined', 'inputbox',
    'intdim', 'listbox', 'messagebox', 'random', 'rotateleft', 'rotateright',
    'setdate', 'setdlgpos', 'setenv', 'setexitcode', 'settime', 'show',
    'statusbox', 'strdim', 'uptime', 'var2clipb', 'yesnobox',
  ].map((cmd) => ({ cmd, page: `${cmd}.html`, category: 'Miscellaneous' })),
  { cmd: 'checksum8', page: 'checksum8.html', category: 'Miscellaneous' },
  { cmd: 'checksum8file', page: 'checksum8.html', category: 'Miscellaneous' },
  { cmd: 'checksum16', page: 'checksum16.html', category: 'Miscellaneous' },
  { cmd: 'checksum16file', page: 'checksum16.html', category: 'Miscellaneous' },
  { cmd: 'checksum32', page: 'checksum32.html', category: 'Miscellaneous' },
  { cmd: 'checksum32file', page: 'checksum32.html', category: 'Miscellaneous' },
  { cmd: 'crc16', page: 'crc16.html', category: 'Miscellaneous' },
  { cmd: 'crc16file', page: 'crc16.html', category: 'Miscellaneous' },
  { cmd: 'crc32', page: 'crc32.html', category: 'Miscellaneous' },
  { cmd: 'crc32file', page: 'crc32.html', category: 'Miscellaneous' },
]

type PageCache = Record<string, { html: string; fetchedAt: string }>

function stripTags(s: string): string {
  return s
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/h\d>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

function extractSection(text: string, ...titles: string[]): string {
  const lower = text.toLowerCase()
  for (const title of titles) {
    const idx = lower.indexOf(title.toLowerCase())
    if (idx < 0) continue
    const after = text.slice(idx + title.length)
    const next = after.search(
      /\n\s*(synopsis|syntax|parameters?|return values?|system variables?|notes?|example|see also|remarks?)\b/i,
    )
    return (next < 0 ? after : after.slice(0, next)).trim().slice(0, 2500)
  }
  return ''
}

/** SYNOPSIS 行からおおよその必須/任意引数個数を推定 */
function estimateArgsFromSynopsis(synopsis: string, cmd: string): { min: number; max: number | null; raw: string[] } {
  const lines = synopsis
    .split(/\n/)
    .map((l) => l.trim())
    .filter((l) => new RegExp(`^${cmd}\\b`, 'i').test(l) || new RegExp(`^${cmd}\\s`, 'i').test(l))
  const raw = lines.length > 0 ? lines : synopsis.split(/\n/).map((l) => l.trim()).filter(Boolean).slice(0, 6)

  let min = Infinity
  let max: number | null = 0
  let anyVarArgs = false

  for (const line of raw) {
    // コマンド名以降
    const m = line.match(new RegExp(`^${cmd}\\b(.*)$`, 'i'))
    if (!m) continue
    let rest = m[1] ?? ''
    // 角括弧ブロックを任意として数える（ネスト簡易）
    const optionals: string[] = []
    while (true) {
      const start = rest.lastIndexOf('[')
      if (start < 0) break
      const end = rest.indexOf(']', start)
      if (end < 0) break
      optionals.push(rest.slice(start + 1, end))
      rest = rest.slice(0, start) + rest.slice(end + 1)
    }
    const requiredParts = rest
      .replace(/[<>]/g, ' ')
      .split(/\s+/)
      .map((p) => p.trim())
      .filter((p) => p && !/^(then|else)$/i.test(p))
    // "..." や可変は max null
    const optText = optionals.join(' ')
    if (/\.\.\./.test(line) || /string1/i.test(line) || /param\d+/i.test(optText)) anyVarArgs = true

    const reqCount = requiredParts.filter((p) => /[a-zA-Z0-9_]/.test(p)).length
    let optCount = 0
    for (const o of optionals) {
      if (!o.trim()) continue
      // [a] [b] counted separately already; inside one bracket "a b" = up to 2
      const parts = o
        .replace(/[<>]/g, ' ')
        .split(/\s+/)
        .filter((p) => p && p !== '...' && /[a-zA-Z0-9_]/.test(p))
      optCount += Math.max(1, parts.length)
      if (parts.includes('...') || /\.\.\./.test(o)) anyVarArgs = true
    }

    min = Math.min(min, reqCount)
    const lineMax = reqCount + optCount
    if (max !== null) max = Math.max(max, lineMax)
  }

  if (min === Infinity) min = 0
  if (anyVarArgs) max = null
  return { min, max, raw }
}

function mentionsResult(text: string): boolean {
  // system variable result / Return value で result
  return /\bresult\b/i.test(text) && /(system\s+variable|return\s+value)/i.test(text)
}

function pageMentionsResult(html: string, text: string): boolean {
  if (/system variable\s+['`]?result/i.test(text)) return true
  if (/sets?\s+(the\s+)?system variable\s+result/i.test(text)) return true
  if (/system variables?[\s\S]{0,200}\bresult\b/i.test(text)) return true
  // Return values セクションに result の説明
  const ret = extractSection(text, 'Return value', 'Return values', 'System variable')
  if (/\bresult\b/i.test(ret)) return true
  // HTML anchor
  if (/id=["']result/i.test(html)) return true
  return /system variable[^.]{0,80}result/i.test(text)
}

async function fetchPage(page: string, cache: PageCache): Promise<string> {
  if (cache[page]?.html) return cache[page].html
  const url = BASE + page
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`)
  const html = await res.text()
  cache[page] = { html, fetchedAt: new Date().toISOString() }
  return html
}

async function mapPool<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let i = 0
  async function worker() {
    while (i < items.length) {
      const idx = i++
      out[idx] = await fn(items[idx]!)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()))
  return out
}

type Verdict = 'OK' | 'DIFF' | 'GAP' | 'EXTRA' | 'ALIAS' | 'SKIP'

interface Row {
  cmd: string
  category: string
  page: string
  url: string
  inCommands: boolean
  inArgSpecs: boolean
  appArgs?: { min: number; max: number | null }
  docArgs?: { min: number; max: number | null; raw: string[] }
  docSetsResult: boolean | null
  appSetsResult: boolean
  hasOutputEffect: boolean
  synopsisSnippet: string
  notes: string[]
  verdict: Verdict
}

function argsCompatible(
  app: { min: number; max: number | null },
  doc: { min: number; max: number | null },
): boolean {
  // 推定は粗いので、完全一致 or 包含関係を緩めに見る
  if (app.min !== doc.min) {
    // ドキュメント推定が曖昧なとき: app.min が doc.min±1
    if (Math.abs(app.min - doc.min) > 1) return false
  }
  if (app.max === null && doc.max === null) return true
  if (app.max === null || doc.max === null) {
    // 片方だけ可変 → 要確認だが DIFF にはしない場合あり
    return app.max === null // アプリが可変なら許容寄り
  }
  return Math.abs(app.max - doc.max) <= 1
}

async function main() {
  let cache: PageCache = {}
  if (fs.existsSync(CACHE)) {
    try {
      cache = JSON.parse(fs.readFileSync(CACHE, 'utf8')) as PageCache
    } catch {
      cache = {}
    }
  }

  const uniquePages = [...new Set(OFFICIAL.map((o) => o.page))]
  console.log(`Fetching ${uniquePages.length} pages...`)
  await mapPool(uniquePages, 8, async (page) => {
    try {
      await fetchPage(page, cache)
      process.stdout.write('.')
    } catch (e) {
      console.error(`\nFAIL ${page}:`, e)
    }
  })
  console.log('\nDone fetch')
  fs.writeFileSync(CACHE, JSON.stringify(cache, null, 2), 'utf8')
  fs.writeFileSync(
    path.join(ROOT, 'docs', '_official-commands.json'),
    JSON.stringify(OFFICIAL, null, 2),
    'utf8',
  )

  const rows: Row[] = []

  for (const entry of OFFICIAL) {
    const { cmd, page, category } = entry
    const url = BASE + page
    const html = cache[page]?.html ?? ''
    const text = stripTags(html)
    const synopsis = extractSection(text, 'SYNOPSIS', 'Synopsis', 'Syntax', 'SYNTAX')
    const docArgs = estimateArgsFromSynopsis(synopsis || text.slice(0, 800), cmd)
    const docSetsResult = html ? pageMentionsResult(html, text) : null
    const appArgs = COMMAND_ARG_SPECS[cmd]
    const appSetsResult = Object.prototype.hasOwnProperty.call(RESULT_COMMAND_META, cmd)
    const effect = getCommandOutputEffect(cmd)
    const inCommands = TTL_COMMANDS.has(cmd) || CONTROL_KEYWORDS.has(cmd)
    // then is keyword only
    const notes: string[] = []
    let verdict: Verdict = 'OK'

    if (!inCommands && !['then'].includes(cmd)) {
      notes.push('TTL_COMMANDS / CONTROL_KEYWORDS 未登録')
      verdict = 'GAP'
    }
    if (!appArgs && !['then'].includes(cmd)) {
      notes.push('COMMAND_ARG_SPECS 未登録')
      verdict = 'GAP'
    }
    if (appArgs && docArgs.raw.length > 0 && !argsCompatible(appArgs, docArgs)) {
      notes.push(
        `引数個数の推定差: app=${appArgs.min}..${appArgs.max ?? '∞'} / doc≈${docArgs.min}..${docArgs.max ?? '∞'}`,
      )
      if (verdict === 'OK') verdict = 'DIFF'
    }
    if (docSetsResult === true && !appSetsResult) {
      notes.push('公式が result を設定する記述あり → RESULT_COMMAND_META 未登録の可能性')
      if (verdict === 'OK') verdict = 'DIFF'
    }
    if (docSetsResult === false && appSetsResult) {
      notes.push('RESULT_COMMAND_META にあるが公式ページに result 記述を検出できず（要手動確認）')
      if (verdict === 'OK') verdict = 'DIFF'
    }
    if (!effect && inCommands && !['then', 'else', 'endif', 'next', 'endwhile', 'enduntil'].includes(cmd)) {
      // 多くのコマンドは出力なしで正常
    }

    // 制御キーワード then はコマンド一覧に単独登録不要
    if (cmd === 'then') {
      verdict = 'SKIP'
      notes.push('制御構文の一部（単独コマンドではない）')
    }

    rows.push({
      cmd,
      category,
      page,
      url,
      inCommands,
      inArgSpecs: !!appArgs,
      appArgs,
      docArgs,
      docSetsResult,
      appSetsResult,
      hasOutputEffect: !!COMMAND_OUTPUT_EFFECTS[cmd] || !!effect,
      synopsisSnippet: (docArgs.raw[0] ?? synopsis.split('\n')[0] ?? '').slice(0, 120),
      notes,
      verdict,
    })
  }

  // アプリ側 EXTRA（公式 index に無い）
  const officialSet = new Set(OFFICIAL.map((o) => o.cmd))
  const extras: string[] = []
  for (const cmd of [...TTL_COMMANDS].sort()) {
    if (!officialSet.has(cmd)) extras.push(cmd)
  }

  // 手動精査メモ（既知の差分・意図）
  const MANUAL_NOTES: Record<string, string> = {
    strlength: '公式 index に無い。本エディタが strlen の別名として扱う。',
    then: 'if 構文の一部。COMMAND_ARG_SPECS には通常載せない。',
    elseif: 'if 系キーワード。',
    else: 'if 系キーワード。',
    endif: 'if 系キーワード。',
    next: 'for 系キーワード。',
    endwhile: 'while 系キーワード。',
    enduntil: 'until 系キーワード。',
    loginfo: 'result と文字列出力の両方。ヒントはフラグビット。',
    clipb2var: '任意 offset（max:2）。公式どおり。',
    messagebox: '公式は result を設定しない（ドライランは UI シミュ用に更新し得る）。',
    checksum8: '文字列版は result を設定しない（file 版のみ）。',
    getver: '引数なし時は result を変更しない（メタに明記）。',
  }

  const counts = { OK: 0, DIFF: 0, GAP: 0, EXTRA: 0, ALIAS: 0, SKIP: 0 }
  for (const r of rows) counts[r.verdict]++

  const lines: string[] = []
  lines.push('# TTL コマンド仕様取り込み調査レポート')
  lines.push('')
  lines.push(`- 調査日: ${new Date().toISOString().slice(0, 10)}`)
  lines.push('- 公式基準: [Manual 5 英語版 TTL command reference](https://teratermproject.github.io/manual/5/en/macro/command/index.html)')
  lines.push('- 日本語目次: [TTL コマンドリファレンス](https://teratermproject.github.io/manual/5/ja/macro/command/index.html)')
  lines.push('- 調査対象: 公式 index に掲載の全コマンド（制御キーワードのページ共有分を含む）')
  lines.push('')
  lines.push('## 調査方針')
  lines.push('')
  lines.push('各コマンドについて次を照合した。')
  lines.push('')
  lines.push('1. **登録**: `TTL_COMMANDS` / `CONTROL_KEYWORDS` への収録')
  lines.push('2. **引数個数**: `COMMAND_ARG_SPECS` と公式 SYNOPSIS の推定')
  lines.push('3. **result**: 公式ページの system variable `result` 記述と `RESULT_COMMAND_META`')
  lines.push('4. **出力変数**: `COMMAND_OUTPUT_EFFECTS` / `getCommandOutputEffect`')
  lines.push('')
  lines.push('判定記号:')
  lines.push('')
  lines.push('| 記号 | 意味 |')
  lines.push('|------|------|')
  lines.push('| OK | 登録あり、引数・result に大きな食い違いなし（SYNOPSIS 自動推定ベース） |')
  lines.push('| DIFF | 引数個数推定または result 有無で差分候補 |')
  lines.push('| GAP | アプリ側レジストリ欠落 |')
  lines.push('| SKIP | 単独コマンドとして扱わない構文要素 |')
  lines.push('| EXTRA | 公式 index に無いがアプリが認識（別名等） |')
  lines.push('')
  lines.push('**注意**: SYNOPSIS からの引数個数推定は機械的で誤検知があり得る。DIFF は要人手確認リストである。実行セマンティクス（ドライランの完全再現）までは本レポートの主対象外とし、レジストリ整合を中心とする。')
  lines.push('')
  lines.push('## サマリー')
  lines.push('')
  lines.push(`| 判定 | 件数 |`)
  lines.push(`|------|------|`)
  lines.push(`| OK | ${counts.OK} |`)
  lines.push(`| DIFF（要確認） | ${counts.DIFF} |`)
  lines.push(`| GAP | ${counts.GAP} |`)
  lines.push(`| SKIP | ${counts.SKIP} |`)
  lines.push(`| 公式コマンド行数 | ${rows.length} |`)
  lines.push(`| アプリ EXTRA | ${extras.length} |`)
  lines.push('')

  // EXTRA section
  lines.push('## アプリ側 EXTRA（公式 index に無い名前）')
  lines.push('')
  if (extras.length === 0) lines.push('（なし）')
  else {
    lines.push('| 名前 | 備考 |')
    lines.push('|------|------|')
    for (const e of extras) {
      lines.push(`| \`${e}\` | ${MANUAL_NOTES[e] ?? '要確認'} |`)
    }
  }
  lines.push('')

  lines.push('## DIFF / GAP 一覧（優先確認）')
  lines.push('')
  const alerts = rows.filter((r) => r.verdict === 'DIFF' || r.verdict === 'GAP')
  if (alerts.length === 0) lines.push('（自動検出なし）')
  else {
    lines.push('| コマンド | 判定 | カテゴリ | メモ |')
    lines.push('|----------|------|----------|------|')
    for (const r of alerts) {
      lines.push(`| [\`${r.cmd}\`](${r.url}) | ${r.verdict} | ${r.category} | ${r.notes.join('; ') || '—'} |`)
    }
  }
  lines.push('')

  // Per category detailed tables
  const cats = [...new Set(OFFICIAL.map((o) => o.category))]
  for (const cat of cats) {
    lines.push(`## ${cat}`)
    lines.push('')
    lines.push('| コマンド | 判定 | 登録 | 引数(app) | 引数(doc≈) | result(app) | result(doc) | SYNOPSIS抜粋 | メモ |')
    lines.push('|----------|------|------|-----------|------------|-------------|-------------|--------------|------|')
    for (const r of rows.filter((x) => x.category === cat)) {
      const appA = r.appArgs ? `${r.appArgs.min}..${r.appArgs.max ?? '∞'}` : '—'
      const docA = r.docArgs ? `${r.docArgs.min}..${r.docArgs.max ?? '∞'}` : '—'
      const note = [...r.notes, MANUAL_NOTES[r.cmd] ?? ''].filter(Boolean).join('; ') || '—'
      lines.push(
        `| [\`${r.cmd}\`](${r.url}) | ${r.verdict} | ${r.inCommands ? 'Y' : 'N'} | ${appA} | ${docA} | ${r.appSetsResult ? 'Y' : 'N'} | ${r.docSetsResult === null ? '?' : r.docSetsResult ? 'Y' : 'N'} | \`${r.synopsisSnippet.replace(/\|/g, '\\|').replace(/`/g, '')}\` | ${note.replace(/\|/g, '/')} |`,
      )
    }
    lines.push('')
  }

  lines.push('## 手動確認チェックリスト（実行・セマンティクス）')
  lines.push('')
  lines.push('レジストリ以外でエディタ固有の実装深度がある領域:')
  lines.push('')
  lines.push('- 制御構文: `if` / `for` / `while` / `do` / `until` / `goto` / `call` / `include`（evaluator / dryRun）')
  lines.push('- 送信: `send` / `sendln` / `sendtext` / `sendbinary` 等（sendText）')
  lines.push('- 文字列静的評価: `staticCommandEval.ts`（strlen, strcompare, strcopy, sprintf 等）')
  lines.push('- 日時: `ttlDateTime.ts`（getdate / gettime）')
  lines.push('- sprintf: `ttlSprintf.ts`')
  lines.push('- 負の整数定数と for: `parseForLoopRangeExprs`（公式 appendixes/negative）')
  lines.push('')
  lines.push('## キャッシュ')
  lines.push('')
  lines.push('公式 HTML の取得結果は `docs/_audit-cache.json` に保存する。再調査時はキャッシュを再利用または削除して再取得する。')
  lines.push('')
  lines.push('---')
  lines.push('')
  lines.push('*本レポートは自動突合＋人手向けフラグ付け。DIFF 行は公式ページを開いて最終確認すること。*')

  fs.writeFileSync(OUT_RAW, lines.join('\n'), 'utf8')
  console.log(`Wrote ${OUT_RAW}`)
  console.log(counts)
  console.log('EXTRAS', extras)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
