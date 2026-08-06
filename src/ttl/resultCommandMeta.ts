/**
 * システム変数 `result` を更新するコマンドの公式仕様（Manual 5 英語版）。
 * 出典: https://teratermproject.github.io/manual/5/en/macro/command/
 *
 * ここに載せるのは公式が system variable `result` を設定すると明記したコマンドのみ。
 * `strlength` は公式 index に無いが本エディタが `strlen` 別名として扱うため同梱する。
 *
 * 意図的除外の例: messagebox / statusbox / inputbox / str2code / findclose / checksum8（文字列版）。
 * なおドライランの messagebox は UI 応答シミュレーションのため result を更新するが、
 * 静的解析・本レジストリには含めない。
 */

export interface ResultCommandMeta {
  /** ホバー用: そのコマンドにおける result の意味（公式に基づく要約） */
  hint: string
}

/** 公式ドキュメント準拠の result 設定コマンド一覧 */
export const RESULT_COMMAND_META: Readonly<Record<string, ResultCommandMeta>> = {
  // ── Communication ──
  connect: { hint: '0=未リンク / 1=リンクのみ / 2=接続済み' },
  cygconnect: { hint: '0=未リンク / 1=リンクのみ / 2=接続済み' },
  testlink: { hint: '0=未リンク / 1=リンクのみ / 2=接続済み' },
  getmodemstatus: { hint: '0=成功 / 1=失敗' },
  getttpos: { hint: '0=成功（失敗時はマクロ一時停止）' },
  bplusrecv: { hint: '1=転送成功 / 0=失敗' },
  bplussend: { hint: '1=転送成功 / 0=失敗' },
  kmtfinish: { hint: '1=成功 / 0=失敗' },
  kmtget: { hint: '1=転送成功 / 0=失敗' },
  kmtrecv: { hint: '1=転送成功 / 0=失敗' },
  kmtsend: { hint: '1=転送成功 / 0=失敗' },
  quickvanrecv: { hint: '1=転送成功 / 0=失敗' },
  quickvansend: { hint: '1=転送成功 / 0=失敗' },
  xmodemrecv: { hint: '1=転送成功 / 0=失敗' },
  xmodemsend: { hint: '1=転送成功 / 0=失敗' },
  ymodemrecv: { hint: '1=転送成功 / 0=失敗' },
  ymodemsend: { hint: '1=転送成功 / 0=失敗' },
  zmodemrecv: { hint: '1=転送成功 / 0=失敗' },
  zmodemsend: { hint: '1=転送成功 / 0=失敗' },
  recvln: { hint: '1=行受信成功 / 0=失敗' },
  recvfile: { hint: '1=無通信で受信終了 / 0=それ以外' },
  wait: { hint: '0=タイムアウト / 1..n=一致したパターン番号' },
  waitln: { hint: '0=タイムアウト / 1..n=一致したパターン番号' },
  waitregex: { hint: '0=タイムアウト / 1..n=一致したパターン番号' },
  wait4all: { hint: '0=タイムアウト / 1..n=一致したパターン番号' },
  waitn: { hint: '0=タイムアウト / 1=指定バイト数を受信（inputstr へ格納）' },
  waitrecv: { hint: '1=条件一致 / 0=タイムアウト / -1=長さ不足でタイムアウト' },
  waitevent: { hint: '発生したイベント識別子（timeout=1 / unlink=2 / disconnect=4 / connect=8）' },
  logopen: { hint: '0=オープン成功 / 1=失敗' },
  loginfo: {
    hint:
      '-1=ログ未開始 / ≥0=ログ開始時フラグの合計（1=バイナリ 2=アペンド 4=プレインテキスト 8=タイムスタンプ 16=ダイアログ非表示）',
  },

  // ── String ──
  strlen: { hint: '文字列のバイト長（UTF-8）' },
  strlength: { hint: '文字列のバイト長（UTF-8）。strlen と同じ' },
  strcompare: { hint: '-1=小さい / 0=等しい / 1=大きい' },
  strscan: { hint: '見つかれば 1-origin 位置 / なければ 0' },
  strmatch: { hint: '0=不一致 / 1以上=マッチ位置（1-origin）' },
  str2int: { hint: '1=変換成功 / 0=失敗' },
  sprintf: { hint: '0=成功 / 1=書式なし / 2=無効な書式 / 3=無効な引数' },
  sprintf2: { hint: '0=成功 / 1=書式なし / 2=無効な書式 / 3=無効な引数 / 4=無効な宛先' },
  strreplace: { hint: '1=置換成功 / 0=不一致 / -1=正規表現不正' },
  strsplit: { hint: '分割数（上限超過時は 10）' },

  // ── File ──
  filesearch: { hint: '1=見つかった / 0=なし' },
  foldersearch: { hint: '1=見つかった / 0=なし' },
  filecreate: { hint: '0=成功 / 非0=失敗' },
  fileconcat: { hint: '0=成功 / 非0=失敗' },
  filecopy: { hint: '0=成功 / 非0=失敗' },
  filedelete: { hint: '0=成功 / 非0=失敗' },
  filerename: { hint: '0=成功 / 非0=失敗' },
  filelock: { hint: '0=成功 / 1=失敗' },
  fileunlock: { hint: '0=成功 / 1=失敗' },
  fileread: { hint: '1=EOF / 0=通常' },
  filereadln: { hint: '1=EOF / 0=通常' },
  filestat: { hint: '-1=エラー（成功時はサイズ等を出力変数へ）' },
  filestrseek: { hint: '1=見つかった / 0=なし' },
  filestrseek2: { hint: '1=見つかった / 0=なし' },
  filetruncate: { hint: '0=成功 / -1=エラー' },
  findfirst: { hint: '1=見つかった / 0=なし' },
  findnext: { hint: '1=見つかった / 0=なし' },
  foldercreate: { hint: '0=成功 / 非0=失敗' },
  folderdelete: { hint: '0=成功 / 非0=失敗' },
  getfileattr: { hint: '属性値 / 失敗時 -1' },
  setfileattr: { hint: '1=成功 / 0=失敗' },

  // ── Password ──
  getpassword: { hint: '1=成功 / 0=パスワードファイル書き込み失敗など' },
  getpassword2: { hint: '1=成功 / 0=パスワードファイル書き込み失敗など' },
  ispassword: { hint: '1=パスワードが存在 / 0=なし' },
  ispassword2: { hint: '1=パスワードが存在 / 0=なし' },
  setpassword: { hint: '1=成功 / 0=パスワードファイル書き込み失敗' },
  setpassword2: { hint: '1=成功 / 0=パスワードファイル書き込み失敗' },

  // ── Miscellaneous ──
  getdate: { hint: '0=成功 / 1=生成文字列が長すぎる / 2=書式不正' },
  gettime: { hint: '0=成功 / 1=生成文字列が長すぎる / 2=書式不正' },
  getipv4addr: { hint: '1=取得成功 / 0=配列不足 / -1=取得失敗' },
  getipv6addr: { hint: '1=取得成功 / 0=配列不足 / -1=取得失敗' },
  getspecialfolder: { hint: '失敗時 0（成功時はパスを出力変数へ）' },
  getttdir: { hint: '0=成功' },
  getver: { hint: '引数あり時のみ: -2=不正 / -1=古い / 0=等しい / 1=新しい（引数なし時は変更しない）' },
  ifdefined: { hint: '0=未定義 / 1=整数 / 3=文字列 / 4=ラベル / 5=整数配列 / 6=文字列配列' },
  listbox: { hint: '0..N-1=選択インデックス / -1=キャンセル' },
  filenamebox: { hint: '非0=OK / 0=キャンセル' },
  dirnamebox: { hint: '1=OK / 0=キャンセル' },
  yesnobox: { hint: '1=Yes / 0=No' },
  exec: { hint: 'wait=1: 終了コード（失敗 -1） / wait≠1: 0=起動成功 / -1=起動失敗' },
  clipb2var: { hint: '0=失敗 / 1=成功 / 2=切り詰めあり' },
  var2clipb: { hint: '0=失敗 / 1=成功' },
  checksum8file: { hint: 'ファイルを開けないとき -1' },
  checksum16file: { hint: 'ファイルを開けないとき -1' },
  checksum32file: { hint: 'ファイルを開けないとき -1' },
  crc16file: { hint: 'ファイルを開けないとき -1' },
  crc32file: { hint: 'ファイルを開けないとき -1' },
}

export function commandSetsResult(cmd: string): boolean {
  return Object.prototype.hasOwnProperty.call(RESULT_COMMAND_META, cmd.toLowerCase())
}

export function getResultCommandMeta(cmd: string): ResultCommandMeta | undefined {
  return RESULT_COMMAND_META[cmd.toLowerCase()]
}

export function getResultCommandHint(cmd: string): string | undefined {
  return getResultCommandMeta(cmd)?.hint
}

/** ホバー note 用（設定元コマンドが分かるとき） */
export function formatResultSetByNote(setBy: string): string {
  const hint = getResultCommandHint(setBy)
  return hint ? `${setBy} — ${hint}` : `${setBy} により設定`
}

/** 網羅テスト・監査用にソート済みコマンド名を返す */
export function listResultSettingCommands(): string[] {
  return Object.keys(RESULT_COMMAND_META).sort()
}
