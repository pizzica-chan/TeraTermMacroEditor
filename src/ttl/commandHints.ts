/**
 * TTL コマンド・制御キーワードのホバー用ヒント（Manual 5 準拠の要約）。
 * 仕様の正は英語版。UI の公式リンクは日本語版へ向ける。
 * @see https://teratermproject.github.io/manual/5/en/macro/command/
 */
import { findAssignmentIndex } from './argChecker'
import { getCommandArgSpec, type CommandArgSpec } from './commandArgs'
import { getCommandOutputEffect } from './commandOutputs'
import {
  CONTROL_KEYWORDS,
  LOGICAL_OPERATORS,
  TTL_COMMANDS,
} from './commands'
import { getResultCommandMeta } from './resultCommandMeta'
import { tokenizeLine, type Token } from './tokenize'

export interface CommandHint {
  name: string
  kind: 'command' | 'keyword' | 'operator'
  summary: string
  usage: string
  note?: string
  manualUrl?: string
}

const HOVER_KEYWORDS = new Set([
  ...CONTROL_KEYWORDS,
  ...TTL_COMMANDS,
  ...LOGICAL_OPERATORS,
  'then',
])

/** 公式 SYNOPSIS に沿った要約（主要コマンド） */
const COMMAND_HINT_CURATED: Record<string, Pick<CommandHint, 'summary' | 'usage' | 'note'>> = {
  // 制御構文
  if: { summary: '条件が真のとき then 以降を実行する', usage: 'if 条件 then ...' },
  elseif: { summary: '先行 if が偽のとき、別の条件を試す', usage: 'elseif 条件 then ...' },
  else: { summary: 'if / elseif がすべて偽のとき実行する', usage: 'else ...' },
  endif: { summary: 'if ブロックの終端', usage: 'endif' },
  then: { summary: 'if / elseif の条件が真のとき実行する本体の開始', usage: 'if 条件 then コマンド' },
  for: { summary: 'ループ変数を範囲で繰り返す', usage: 'for 変数 開始 終了' },
  next: { summary: 'for ループの終端', usage: 'next' },
  while: { summary: '条件が真の間、ブロックを繰り返す', usage: 'while 条件 ... endwhile' },
  endwhile: { summary: 'while ループの終端', usage: 'endwhile' },
  do: {
    summary: 'do / loop ループの開始。while または until 条件は do 側か loop 側に書ける',
    usage: 'do [while|until 条件] ... loop',
  },
  loop: {
    summary: 'do ループの終端。while または until 条件を付けられる',
    usage: 'loop [while|until 条件]',
  },
  until: { summary: '条件が 0 の間、enduntil まで繰り返す', usage: 'until 条件 ... enduntil' },
  enduntil: { summary: 'until ループの終端', usage: 'enduntil' },
  goto: { summary: '指定ラベルへ無条件ジャンプ', usage: 'goto ラベル名' },
  call: { summary: 'サブルーチンを呼び出す', usage: 'call ラベル名' },
  return: { summary: 'call から呼び出し元へ戻る', usage: 'return' },
  break: { summary: 'for / while ループを抜ける', usage: 'break' },
  continue: { summary: 'for / while ループの次の反復へ進む', usage: 'continue' },
  end: { summary: 'マクロの実行を終了する', usage: 'end' },
  exit: {
    summary: 'include ファイルから呼び出し元へ戻る。メインファイルでは end と同じ',
    usage: 'exit',
  },
  include: { summary: '別の TTL ファイルを取り込む', usage: "include 'path.ttl'" },
  pause: { summary: '指定秒数だけ待機する', usage: 'pause 秒' },
  mpause: { summary: '指定ミリ秒だけ待機', usage: 'mpause ミリ秒' },

  // 通信
  connect: { summary: 'ホストへ接続する', usage: "connect 'host'" },
  disconnect: {
    summary: 'ホストとの接続を切断する',
    usage: 'disconnect [confirm]',
    note: 'confirm が 0 なら確認なし。省略時・非 0 なら確認ダイアログを表示',
  },
  send: { summary: 'データを送信する（改行なし）', usage: "send 'text'" },
  sendln: { summary: 'データを送信して改行を送る', usage: "sendln 'text'" },
  sendbinary: { summary: 'バイナリデータを送信する', usage: 'sendbinary ...' },
  sendfile: { summary: 'ファイルの内容を送信する', usage: "sendfile 'path' バイナリフラグ" },
  wait: { summary: '受信データがパターンに一致するまで待機', usage: "wait 'OK' 'ERROR'" },
  waitln: { summary: '行単位で受信を待機', usage: "waitln 'prompt:'" },
  waitregex: { summary: '正規表現で受信を待機', usage: "waitregex 'pattern'" },
  wait4all: {
    summary: 'リンク済みの全端末で、いずれかの文字列を受信するまで待つ',
    usage: "wait4all 'a' 'b'",
  },
  waitrecv: { summary: '指定長・位置の部分文字列を受信するまで待つ', usage: "waitrecv 'pattern' len pos" },
  recvln: { summary: '1 行受信する', usage: 'recvln' },
  flushrecv: { summary: '受信バッファをクリアする', usage: 'flushrecv' },

  // 文字列
  sprintf: { summary: '書式文字列で文字列を組み立て inputstr に格納', usage: "sprintf '%s' 'text'" },
  sprintf2: { summary: '書式文字列の結果を変数に格納', usage: "sprintf2 dest '%d' n" },
  int2str: { summary: '整数を文字列に変換', usage: 'int2str strvar 整数' },
  str2int: { summary: '文字列を整数に変換', usage: "str2int intvar '123'" },
  strcopy: { summary: '部分文字列をコピー', usage: "strcopy 'text' 開始 長さ dest" },
  strconcat: { summary: '文字列変数の末尾に文字列を追加する', usage: "strconcat dest '追加'" },
  strreplace: { summary: '文字列の部分を置換', usage: "strreplace dest 1 'old' 'new'" },
  strmatch: { summary: '対象文字列を正規表現でマッチ', usage: "strmatch '対象' '正規表現'" },
  strsplit: { summary: '区切り文字で分割し groupmatchstr1〜9 に格納', usage: "strsplit 'a,b' ',' max" },
  strjoin: { summary: 'groupmatchstr1〜9 を区切り文字で連結して変数に格納', usage: "strjoin dest ',' [count]" },
  strlen: { summary: '文字列長（バイト）を result に設定', usage: "strlen 'text'" },
  strlength: { summary: 'strlen の別名', usage: "strlength 'text'" },
  expandenv: { summary: '環境変数参照を展開', usage: "expandenv strvar ['%PATH%\\app']" },
  getenv: { summary: '環境変数の値を取得', usage: "getenv 'HOME' home" },
  setenv: { summary: '環境変数を設定', usage: "setenv 'VAR' 'value'" },

  // ファイル
  fileopen: { summary: 'ファイルを開きハンドルを得る', usage: "fileopen fhandle 'file.dat' 0" },
  fileclose: { summary: 'ファイルを閉じる', usage: 'fileclose fhandle' },
  filereadln: { summary: 'ファイルから 1 行読み込む', usage: 'filereadln fhandle line' },
  fileread: { summary: 'ファイルからバイナリ読み込み', usage: 'fileread fhandle len data' },
  filewrite: { summary: 'ファイルへデータを書き込む', usage: "filewrite fhandle 'data'" },
  filewriteln: { summary: 'ファイルへ行を書き込む', usage: "filewriteln fhandle 'line'" },

  // 日付・乱数・配列
  getdate: { summary: '現在日付を文字列変数に取得', usage: 'getdate datestr ["%Y-%m-%d"]' },
  gettime: { summary: '現在時刻を文字列変数に取得', usage: 'gettime timestr ["%H:%M:%S"]' },
  random: { summary: '0 以上 max 未満の乱数を生成', usage: 'random n 100' },
  strdim: { summary: '文字列配列を確保', usage: 'strdim arr サイズ' },
  intdim: { summary: '整数配列を確保', usage: 'intdim arr サイズ' },

  // ダイアログ
  messagebox: { summary: 'メッセージボックスを表示', usage: "messagebox 'msg' 'title'" },
  yesnobox: { summary: 'Yes / No ダイアログ（result に 1/0）', usage: "yesnobox 'msg' 'title'" },
  inputbox: { summary: '文字列入力（結果は inputstr）', usage: "inputbox 'msg' 'title'" },
  passwordbox: { summary: 'パスワード入力（結果は inputstr）', usage: "passwordbox 'msg' 'title'" },
  listbox: { summary: 'リストから項目を選択（result にインデックス）', usage: "listbox 'msg' 'title' arr" },
  filenamebox: { summary: 'ファイル名を選択（結果は inputstr）', usage: "filenamebox 'title'" },
  dirnamebox: { summary: 'フォルダを選択（結果は inputstr）', usage: "dirnamebox 'title'" },

  // その他
  execcmnd: { summary: 'Tera Term のコマンドを実行', usage: "execcmnd 'connect host'" },
  exec: { summary: '外部プログラムを起動', usage: "exec 'notepad.exe' 0 0 1" },
}

const SUMMARY_BY_PREFIX: [string, string][] = [
  ['send', 'ホストへデータを送信するコマンド'],
  ['wait', '受信データの到着を待機するコマンド'],
  ['file', 'ファイルを操作するコマンド'],
  ['folder', 'フォルダを操作するコマンド'],
  ['find', 'ファイル検索を行うコマンド'],
  ['get', '値を取得するコマンド'],
  ['set', '設定を変更するコマンド'],
  ['str', '文字列を操作するコマンド'],
  ['log', 'ログファイルを操作するコマンド'],
  ['checksum', 'チェックサムを計算するコマンド'],
  ['crc', 'CRC を計算するコマンド'],
]

/** ホバーの「公式マニュアル」リンク先（日本語 UI 向け） */
const MANUAL_BASE = 'https://teratermproject.github.io/manual/5/ja/macro'

/** コマンド名と公式ページ名が異なる制御キーワード */
const CONTROL_MANUAL_PAGE: Record<string, string> = {
  if: 'ifthenelseif',
  then: 'ifthenelseif',
  elseif: 'ifthenelseif',
  else: 'ifthenelseif',
  endif: 'ifthenelseif',
  for: 'fornext',
  next: 'fornext',
  while: 'while',
  endwhile: 'while',
  do: 'doloop',
  loop: 'doloop',
  until: 'until',
  enduntil: 'until',
}

function manualUrlFor(cmd: string): string | undefined {
  if (LOGICAL_OPERATORS.has(cmd)) {
    return `${MANUAL_BASE}/syntax/expressions.html`
  }
  const page = CONTROL_MANUAL_PAGE[cmd]
  if (page) {
    return `${MANUAL_BASE}/command/${page}.html`
  }
  if (TTL_COMMANDS.has(cmd)) {
    return `${MANUAL_BASE}/command/${cmd}.html`
  }
  return undefined
}

function hintKind(cmd: string): CommandHint['kind'] {
  if (LOGICAL_OPERATORS.has(cmd)) return 'operator'
  if (CONTROL_KEYWORDS.has(cmd) || cmd === 'then') return 'keyword'
  return 'command'
}

function formatArgUsage(cmd: string, spec: CommandArgSpec): string {
  if (spec.min === 0 && spec.max === 0) return cmd
  if (spec.max === null) {
    return spec.min === 0 ? `${cmd} ...` : `${cmd} 引数...`
  }
  if (spec.min === spec.max) {
    if (spec.min === 1) return `${cmd} 引数`
    return `${cmd} 引数×${spec.min}`
  }
  return `${cmd} 引数（${spec.min}〜${spec.max}個）`
}

function inferSummary(cmd: string): string {
  for (const [prefix, summary] of SUMMARY_BY_PREFIX) {
    if (cmd.startsWith(prefix)) return summary
  }
  if (hintKind(cmd) === 'keyword') return 'TTL 制御構文'
  if (hintKind(cmd) === 'operator') return 'ビット演算子（and / or / xor / not）'
  return 'Tera Term マクロコマンド'
}

function buildSupplementalNote(cmd: string): string | undefined {
  const parts: string[] = []
  const effect = getCommandOutputEffect(cmd)
  if (effect?.variables?.length) {
    const outs = effect.variables.map((v) => `第${v.index}引数→${v.type}`).join(', ')
    parts.push(`出力: ${outs}`)
  }
  if (effect?.systemVariables?.length) {
    parts.push(`更新: ${effect.systemVariables.map((v) => v.name).join(', ')}`)
  }
  const resultMeta = getResultCommandMeta(cmd)
  if (resultMeta) parts.push(`result: ${resultMeta.hint}`)
  return parts.length > 0 ? parts.join(' / ') : undefined
}

function buildFallbackHint(cmd: string): CommandHint {
  const spec = getCommandArgSpec(cmd)
  const supplemental = buildSupplementalNote(cmd)
  return {
    name: cmd,
    kind: hintKind(cmd),
    summary: inferSummary(cmd),
    usage: spec ? formatArgUsage(cmd, spec) : cmd,
    note: supplemental,
    manualUrl: manualUrlFor(cmd),
  }
}

export function getCommandHint(cmd: string): CommandHint | undefined {
  const key = cmd.toLowerCase()
  if (!HOVER_KEYWORDS.has(key)) return undefined
  const curated = COMMAND_HINT_CURATED[key]
  if (curated) {
    const supplemental = buildSupplementalNote(key)
    const note = curated.note
      ? supplemental
        ? `${curated.note} / ${supplemental}`
        : curated.note
      : supplemental
    return {
      name: key,
      kind: hintKind(key),
      ...curated,
      note,
      manualUrl: manualUrlFor(key),
    }
  }
  return buildFallbackHint(key)
}

export interface CommandHoverTarget {
  from: number
  to: number
  cmd: string
}

function hoverTargetFromToken(tok: Token): CommandHoverTarget {
  return {
    from: tok.column,
    to: tok.column + tok.text.length,
    cmd: tok.text.toLowerCase(),
  }
}

function isHoverIdentifier(tok: Token | undefined): tok is Token {
  return tok?.kind === 'identifier' && HOVER_KEYWORDS.has(tok.text.toLowerCase())
}

/**
 * 行頭コマンド・キーワード、および if/elseif の then と then/else 直後のコマンド上か。
 * 代入左辺・右辺のコマンド名は対象外。
 */
export function findCommandHoverTarget(
  line: string,
  lineNum: number,
  column: number,
): CommandHoverTarget | null {
  const tokens = tokenizeLine(line, lineNum)
  const stmtOffset = tokens[0]?.kind === 'label' ? 1 : 0
  const stmtTok = tokens[stmtOffset]
  const assignIdx = findAssignmentIndex(tokens, stmtOffset)
  const lhsTok = assignIdx > stmtOffset ? tokens[assignIdx - 1] : undefined

  const candidates: CommandHoverTarget[] = []
  const add = (tok: Token | undefined) => {
    if (!isHoverIdentifier(tok) || tok === lhsTok) return
    candidates.push(hoverTargetFromToken(tok))
  }

  add(stmtTok)

  const cmd = stmtTok?.kind === 'identifier' ? stmtTok.text.toLowerCase() : ''
  if (cmd === 'if' || cmd === 'elseif') {
    const thenIdx = tokens.findIndex(
      (t, i) => i > stmtOffset && t.kind === 'identifier' && t.text.toLowerCase() === 'then',
    )
    if (thenIdx >= 0) {
      add(tokens[thenIdx])
      add(tokens[thenIdx + 1])
    }
  } else if (cmd === 'else') {
    add(tokens[stmtOffset + 1])
  }

  return candidates.find((c) => column >= c.from && column < c.to) ?? null
}

export function isCommandHoverTarget(cmd: string): boolean {
  return HOVER_KEYWORDS.has(cmd.toLowerCase())
}
