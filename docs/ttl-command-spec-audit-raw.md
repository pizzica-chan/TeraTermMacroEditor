# TTL コマンド仕様取り込み調査レポート

- 調査日: 2026-08-13
- 公式基準: [Manual 5 英語版 TTL command reference](https://teratermproject.github.io/manual/5/en/macro/command/index.html)
- 日本語目次: [TTL コマンドリファレンス](https://teratermproject.github.io/manual/5/ja/macro/command/index.html)
- 調査対象: 公式 index に掲載の全コマンド（制御キーワードのページ共有分を含む）

## 調査方針

各コマンドについて次を照合した。

1. **登録**: `TTL_COMMANDS` / `CONTROL_KEYWORDS` への収録
2. **引数個数**: `COMMAND_ARG_SPECS` と公式 SYNOPSIS の推定
3. **result**: 公式ページの system variable `result` 記述と `RESULT_COMMAND_META`
4. **出力変数**: `COMMAND_OUTPUT_EFFECTS` / `getCommandOutputEffect`

判定記号:

| 記号 | 意味 |
|------|------|
| OK | 登録あり、引数・result に大きな食い違いなし（SYNOPSIS 自動推定ベース） |
| DIFF | 引数個数推定または result 有無で差分候補 |
| GAP | アプリ側レジストリ欠落 |
| SKIP | 単独コマンドとして扱わない構文要素 |
| EXTRA | 公式 index に無いがアプリが認識（別名等） |

**注意**: SYNOPSIS からの引数個数推定は機械的で誤検知があり得る。DIFF は要人手確認リストである。実行セマンティクス（ドライランの完全再現）までは本レポートの主対象外とし、レジストリ整合を中心とする。

## サマリー

| 判定 | 件数 |
|------|------|
| OK | 115 |
| DIFF（要確認） | 93 |
| GAP | 0 |
| SKIP | 1 |
| 公式コマンド行数 | 209 |
| アプリ EXTRA | 1 |

## アプリ側 EXTRA（公式 index に無い名前）

| 名前 | 備考 |
|------|------|
| `strlength` | 公式 index に無い。本エディタが strlen の別名として扱う。 |

## DIFF / GAP 一覧（優先確認）

| コマンド | 判定 | カテゴリ | メモ |
|----------|------|----------|------|
| [`connect`](https://teratermproject.github.io/manual/5/en/macro/command/connect.html) | DIFF | Communication | 引数個数の推定差: app=1..1 / doc≈0..3 |
| [`cygconnect`](https://teratermproject.github.io/manual/5/en/macro/command/cygconnect.html) | DIFF | Communication | 引数個数の推定差: app=0..1 / doc≈0..3 |
| [`getttpos`](https://teratermproject.github.io/manual/5/en/macro/command/getttpos.html) | DIFF | Communication | 引数個数の推定差: app=9..9 / doc≈0..17 |
| [`logopen`](https://teratermproject.github.io/manual/5/en/macro/command/logopen.html) | DIFF | Communication | 引数個数の推定差: app=3..7 / doc≈0..19 |
| [`recvfile`](https://teratermproject.github.io/manual/5/en/macro/command/recvfile.html) | DIFF | Communication | 引数個数の推定差: app=3..3 / doc≈0..6 |
| [`scprecv`](https://teratermproject.github.io/manual/5/en/macro/command/scprecv.html) | DIFF | Communication | 引数個数の推定差: app=1..2 / doc≈0..4 |
| [`sendfile`](https://teratermproject.github.io/manual/5/en/macro/command/sendfile.html) | DIFF | Communication | 引数個数の推定差: app=2..2 / doc≈0..3 |
| [`sendkcode`](https://teratermproject.github.io/manual/5/en/macro/command/sendkcode.html) | DIFF | Communication | 引数個数の推定差: app=2..2 / doc≈0..4 |
| [`showtt`](https://teratermproject.github.io/manual/5/en/macro/command/showtt.html) | DIFF | Communication | 引数個数の推定差: app=1..1 / doc≈0..4 |
| [`wait`](https://teratermproject.github.io/manual/5/en/macro/command/wait.html) | DIFF | Communication | 引数個数の推定差: app=1..10 / doc≈0..∞ |
| [`wait4all`](https://teratermproject.github.io/manual/5/en/macro/command/wait4all.html) | DIFF | Communication | 引数個数の推定差: app=1..10 / doc≈0..∞ |
| [`waitln`](https://teratermproject.github.io/manual/5/en/macro/command/waitln.html) | DIFF | Communication | 引数個数の推定差: app=1..10 / doc≈0..∞ |
| [`waitn`](https://teratermproject.github.io/manual/5/en/macro/command/waitn.html) | DIFF | Communication | 引数個数の推定差: app=1..1 / doc≈0..3 |
| [`waitrecv`](https://teratermproject.github.io/manual/5/en/macro/command/waitrecv.html) | DIFF | Communication | 引数個数の推定差: app=3..3 / doc≈0..3 |
| [`waitregex`](https://teratermproject.github.io/manual/5/en/macro/command/waitregex.html) | DIFF | Communication | 引数個数の推定差: app=1..10 / doc≈0..∞ |
| [`xmodemrecv`](https://teratermproject.github.io/manual/5/en/macro/command/xmodemrecv.html) | DIFF | Communication | 引数個数の推定差: app=3..3 / doc≈0..4 |
| [`xmodemsend`](https://teratermproject.github.io/manual/5/en/macro/command/xmodemsend.html) | DIFF | Communication | 引数個数の推定差: app=2..2 / doc≈0..2 |
| [`zmodemsend`](https://teratermproject.github.io/manual/5/en/macro/command/zmodemsend.html) | DIFF | Communication | 引数個数の推定差: app=2..2 / doc≈0..3 |
| [`do`](https://teratermproject.github.io/manual/5/en/macro/command/doloop.html) | DIFF | Control | 引数個数の推定差: app=0..2 / doc≈0..4 |
| [`loop`](https://teratermproject.github.io/manual/5/en/macro/command/doloop.html) | DIFF | Control | 引数個数の推定差: app=0..2 / doc≈0..4 |
| [`for`](https://teratermproject.github.io/manual/5/en/macro/command/fornext.html) | DIFF | Control | 引数個数の推定差: app=3..3 / doc≈1..3 |
| [`include`](https://teratermproject.github.io/manual/5/en/macro/command/include.html) | DIFF | Control | 引数個数の推定差: app=1..1 / doc≈0..3 |
| [`code2str`](https://teratermproject.github.io/manual/5/en/macro/command/code2str.html) | DIFF | String | 引数個数の推定差: app=2..2 / doc≈0..3 |
| [`int2str`](https://teratermproject.github.io/manual/5/en/macro/command/int2str.html) | DIFF | String | 引数個数の推定差: app=2..2 / doc≈0..3 |
| [`sprintf2`](https://teratermproject.github.io/manual/5/en/macro/command/sprintf2.html) | DIFF | String | 引数個数の推定差: app=2..∞ / doc≈0..∞ |
| [`str2code`](https://teratermproject.github.io/manual/5/en/macro/command/str2code.html) | DIFF | String | 引数個数の推定差: app=2..2 / doc≈0..2 |
| [`str2int`](https://teratermproject.github.io/manual/5/en/macro/command/str2int.html) | DIFF | String | 引数個数の推定差: app=2..2 / doc≈0..2 |
| [`strcompare`](https://teratermproject.github.io/manual/5/en/macro/command/strcompare.html) | DIFF | String | 引数個数の推定差: app=2..2 / doc≈0..∞ |
| [`strconcat`](https://teratermproject.github.io/manual/5/en/macro/command/strconcat.html) | DIFF | String | 引数個数の推定差: app=2..2 / doc≈0..3 |
| [`strcopy`](https://teratermproject.github.io/manual/5/en/macro/command/strcopy.html) | DIFF | String | 引数個数の推定差: app=4..4 / doc≈0..5 |
| [`strinsert`](https://teratermproject.github.io/manual/5/en/macro/command/strinsert.html) | DIFF | String | 引数個数の推定差: app=3..3 / doc≈4..5 |
| [`strjoin`](https://teratermproject.github.io/manual/5/en/macro/command/strjoin.html) | DIFF | String | 引数個数の推定差: app=2..3 / doc≈0..3 |
| [`strmatch`](https://teratermproject.github.io/manual/5/en/macro/command/strmatch.html) | DIFF | String | 引数個数の推定差: app=2..2 / doc≈0..6 |
| [`strremove`](https://teratermproject.github.io/manual/5/en/macro/command/strremove.html) | DIFF | String | 引数個数の推定差: app=3..3 / doc≈4..5 |
| [`strreplace`](https://teratermproject.github.io/manual/5/en/macro/command/strreplace.html) | DIFF | String | 引数個数の推定差: app=4..4 / doc≈0..4 |
| [`strscan`](https://teratermproject.github.io/manual/5/en/macro/command/strscan.html) | DIFF | String | 引数個数の推定差: app=2..2 / doc≈0..3 |
| [`strsplit`](https://teratermproject.github.io/manual/5/en/macro/command/strsplit.html) | DIFF | String | 引数個数の推定差: app=2..3 / doc≈0..3 |
| [`strtrim`](https://teratermproject.github.io/manual/5/en/macro/command/strtrim.html) | DIFF | String | 引数個数の推定差: app=2..2 / doc≈0..2 |
| [`tolower`](https://teratermproject.github.io/manual/5/en/macro/command/tolower.html) | DIFF | String | 引数個数の推定差: app=2..2 / doc≈0..2 |
| [`toupper`](https://teratermproject.github.io/manual/5/en/macro/command/toupper.html) | DIFF | String | 引数個数の推定差: app=2..2 / doc≈0..2 |
| [`basename`](https://teratermproject.github.io/manual/5/en/macro/command/basename.html) | DIFF | File | 引数個数の推定差: app=2..2 / doc≈0..2 |
| [`dirname`](https://teratermproject.github.io/manual/5/en/macro/command/dirname.html) | DIFF | File | 引数個数の推定差: app=2..2 / doc≈0..2 |
| [`fileconcat`](https://teratermproject.github.io/manual/5/en/macro/command/fileconcat.html) | DIFF | File | 引数個数の推定差: app=2..2 / doc≈0..2 |
| [`filecopy`](https://teratermproject.github.io/manual/5/en/macro/command/filecopy.html) | DIFF | File | 引数個数の推定差: app=2..2 / doc≈0..2 |
| [`filecreate`](https://teratermproject.github.io/manual/5/en/macro/command/filecreate.html) | DIFF | File | 引数個数の推定差: app=2..2 / doc≈0..3 |
| [`fileopen`](https://teratermproject.github.io/manual/5/en/macro/command/fileopen.html) | DIFF | File | 引数個数の推定差: app=3..4 / doc≈0..7 |
| [`filereadln`](https://teratermproject.github.io/manual/5/en/macro/command/filereadln.html) | DIFF | File | 引数個数の推定差: app=2..2 / doc≈0..3 |
| [`fileread`](https://teratermproject.github.io/manual/5/en/macro/command/fileread.html) | DIFF | File | 引数個数の推定差: app=3..3 / doc≈0..5 |
| [`filerename`](https://teratermproject.github.io/manual/5/en/macro/command/filerename.html) | DIFF | File | 引数個数の推定差: app=2..2 / doc≈0..2 |
| [`fileseek`](https://teratermproject.github.io/manual/5/en/macro/command/fileseek.html) | DIFF | File | 引数個数の推定差: app=3..3 / doc≈0..4 |
| [`filestat`](https://teratermproject.github.io/manual/5/en/macro/command/filestat.html) | DIFF | File | 引数個数の推定差: app=2..4 / doc≈0..4 |
| [`filestrseek`](https://teratermproject.github.io/manual/5/en/macro/command/filestrseek.html) | DIFF | File | 引数個数の推定差: app=2..2 / doc≈0..3 |
| [`filestrseek2`](https://teratermproject.github.io/manual/5/en/macro/command/filestrseek2.html) | DIFF | File | 引数個数の推定差: app=2..2 / doc≈0..3 |
| [`filetruncate`](https://teratermproject.github.io/manual/5/en/macro/command/filetruncate.html) | DIFF | File | 引数個数の推定差: app=2..2 / doc≈0..2 |
| [`filewrite`](https://teratermproject.github.io/manual/5/en/macro/command/filewrite.html) | DIFF | File | 引数個数の推定差: app=2..2 / doc≈0..3 |
| [`filewriteln`](https://teratermproject.github.io/manual/5/en/macro/command/filewriteln.html) | DIFF | File | 引数個数の推定差: app=2..2 / doc≈0..3 |
| [`makepath`](https://teratermproject.github.io/manual/5/en/macro/command/makepath.html) | DIFF | File | 引数個数の推定差: app=3..3 / doc≈0..3 |
| [`setfileattr`](https://teratermproject.github.io/manual/5/en/macro/command/setfileattr.html) | DIFF | File | 引数個数の推定差: app=2..2 / doc≈0..2 |
| [`findfirst`](https://teratermproject.github.io/manual/5/en/macro/command/findoperations.html) | DIFF | File | 引数個数の推定差: app=3..3 / doc≈0..5 |
| [`findnext`](https://teratermproject.github.io/manual/5/en/macro/command/findoperations.html) | DIFF | File | 引数個数の推定差: app=2..2 / doc≈0..0 |
| [`findclose`](https://teratermproject.github.io/manual/5/en/macro/command/findoperations.html) | DIFF | File | 公式が result を設定する記述あり → RESULT_COMMAND_META 未登録の可能性 |
| [`delpassword`](https://teratermproject.github.io/manual/5/en/macro/command/delpassword.html) | DIFF | Password | 引数個数の推定差: app=2..2 / doc≈0..3 |
| [`delpassword2`](https://teratermproject.github.io/manual/5/en/macro/command/delpassword2.html) | DIFF | Password | 引数個数の推定差: app=2..2 / doc≈0..3 |
| [`getpassword`](https://teratermproject.github.io/manual/5/en/macro/command/getpassword.html) | DIFF | Password | 引数個数の推定差: app=3..3 / doc≈0..5 |
| [`getpassword2`](https://teratermproject.github.io/manual/5/en/macro/command/getpassword2.html) | DIFF | Password | 引数個数の推定差: app=4..4 / doc≈0..7 |
| [`ispassword`](https://teratermproject.github.io/manual/5/en/macro/command/ispassword.html) | DIFF | Password | 引数個数の推定差: app=2..2 / doc≈0..5 |
| [`ispassword2`](https://teratermproject.github.io/manual/5/en/macro/command/ispassword2.html) | DIFF | Password | 引数個数の推定差: app=2..2 / doc≈0..5 |
| [`passwordbox`](https://teratermproject.github.io/manual/5/en/macro/command/passwordbox.html) | DIFF | Password | 引数個数の推定差: app=2..3 / doc≈0..3 |
| [`setpassword`](https://teratermproject.github.io/manual/5/en/macro/command/setpassword.html) | DIFF | Password | 引数個数の推定差: app=3..3 / doc≈0..4 |
| [`setpassword2`](https://teratermproject.github.io/manual/5/en/macro/command/setpassword2.html) | DIFF | Password | 引数個数の推定差: app=4..4 / doc≈0..6 |
| [`exec`](https://teratermproject.github.io/manual/5/en/macro/command/exec.html) | DIFF | Miscellaneous | 引数個数の推定差: app=1..4 / doc≈0..6 |
| [`getenv`](https://teratermproject.github.io/manual/5/en/macro/command/getenv.html) | DIFF | Miscellaneous | 引数個数の推定差: app=2..2 / doc≈0..2 |
| [`getipv4addr`](https://teratermproject.github.io/manual/5/en/macro/command/getipv4addr.html) | DIFF | Miscellaneous | 引数個数の推定差: app=2..2 / doc≈0..3 |
| [`getipv6addr`](https://teratermproject.github.io/manual/5/en/macro/command/getipv6addr.html) | DIFF | Miscellaneous | 引数個数の推定差: app=2..2 / doc≈0..3 |
| [`getspecialfolder`](https://teratermproject.github.io/manual/5/en/macro/command/getspecialfolder.html) | DIFF | Miscellaneous | 引数個数の推定差: app=2..2 / doc≈0..2 |
| [`inputbox`](https://teratermproject.github.io/manual/5/en/macro/command/inputbox.html) | DIFF | Miscellaneous | 引数個数の推定差: app=2..4 / doc≈0..4 |
| [`intdim`](https://teratermproject.github.io/manual/5/en/macro/command/intdim.html) | DIFF | Miscellaneous | 引数個数の推定差: app=2..2 / doc≈0..2 |
| [`listbox`](https://teratermproject.github.io/manual/5/en/macro/command/listbox.html) | DIFF | Miscellaneous | 引数個数の推定差: app=3..∞ / doc≈0..∞ |
| [`messagebox`](https://teratermproject.github.io/manual/5/en/macro/command/messagebox.html) | DIFF | Miscellaneous | 引数個数の推定差: app=2..3 / doc≈0..3 |
| [`random`](https://teratermproject.github.io/manual/5/en/macro/command/random.html) | DIFF | Miscellaneous | 引数個数の推定差: app=2..2 / doc≈0..4 |
| [`rotateleft`](https://teratermproject.github.io/manual/5/en/macro/command/rotateleft.html) | DIFF | Miscellaneous | 引数個数の推定差: app=3..3 / doc≈0..3 |
| [`rotateright`](https://teratermproject.github.io/manual/5/en/macro/command/rotateright.html) | DIFF | Miscellaneous | 引数個数の推定差: app=3..3 / doc≈0..3 |
| [`setdlgpos`](https://teratermproject.github.io/manual/5/en/macro/command/setdlgpos.html) | DIFF | Miscellaneous | 引数個数の推定差: app=0..5 / doc≈0..7 |
| [`setenv`](https://teratermproject.github.io/manual/5/en/macro/command/setenv.html) | DIFF | Miscellaneous | 引数個数の推定差: app=2..2 / doc≈0..2 |
| [`statusbox`](https://teratermproject.github.io/manual/5/en/macro/command/statusbox.html) | DIFF | Miscellaneous | 引数個数の推定差: app=2..3 / doc≈0..3 |
| [`strdim`](https://teratermproject.github.io/manual/5/en/macro/command/strdim.html) | DIFF | Miscellaneous | 引数個数の推定差: app=2..2 / doc≈0..2 |
| [`var2clipb`](https://teratermproject.github.io/manual/5/en/macro/command/var2clipb.html) | DIFF | Miscellaneous | 引数個数の推定差: app=1..1 / doc≈0..3 |
| [`yesnobox`](https://teratermproject.github.io/manual/5/en/macro/command/yesnobox.html) | DIFF | Miscellaneous | 引数個数の推定差: app=2..3 / doc≈0..4 |
| [`checksum8`](https://teratermproject.github.io/manual/5/en/macro/command/checksum8.html) | DIFF | Miscellaneous | 公式が result を設定する記述あり → RESULT_COMMAND_META 未登録の可能性 |
| [`checksum16`](https://teratermproject.github.io/manual/5/en/macro/command/checksum16.html) | DIFF | Miscellaneous | 公式が result を設定する記述あり → RESULT_COMMAND_META 未登録の可能性 |
| [`checksum32`](https://teratermproject.github.io/manual/5/en/macro/command/checksum32.html) | DIFF | Miscellaneous | 公式が result を設定する記述あり → RESULT_COMMAND_META 未登録の可能性 |
| [`crc16`](https://teratermproject.github.io/manual/5/en/macro/command/crc16.html) | DIFF | Miscellaneous | 公式が result を設定する記述あり → RESULT_COMMAND_META 未登録の可能性 |
| [`crc32`](https://teratermproject.github.io/manual/5/en/macro/command/crc32.html) | DIFF | Miscellaneous | 公式が result を設定する記述あり → RESULT_COMMAND_META 未登録の可能性 |

## Communication

| コマンド | 判定 | 登録 | 引数(app) | 引数(doc≈) | result(app) | result(doc) | SYNOPSIS抜粋 | メモ |
|----------|------|------|-----------|------------|-------------|-------------|--------------|------|
| [`bplusrecv`](https://teratermproject.github.io/manual/5/en/macro/command/bplusrecv.html) | OK | Y | 0..0 | 0..0 | Y | Y | `bplusrecv` | — |
| [`bplussend`](https://teratermproject.github.io/manual/5/en/macro/command/bplussend.html) | OK | Y | 1..1 | 0..1 | Y | Y | `bplussend` | — |
| [`callmenu`](https://teratermproject.github.io/manual/5/en/macro/command/callmenu.html) | OK | Y | 1..1 | 0..2 | N | N | `callmenu` | — |
| [`changedir`](https://teratermproject.github.io/manual/5/en/macro/command/changedir.html) | OK | Y | 1..1 | 0..1 | N | N | `changedir` | — |
| [`clearscreen`](https://teratermproject.github.io/manual/5/en/macro/command/clearscreen.html) | OK | Y | 1..1 | 0..1 | N | N | `clearscreen` | — |
| [`closett`](https://teratermproject.github.io/manual/5/en/macro/command/closett.html) | OK | Y | 0..0 | 0..0 | N | N | `closett` | — |
| [`connect`](https://teratermproject.github.io/manual/5/en/macro/command/connect.html) | DIFF | Y | 1..1 | 0..3 | Y | Y | `connect` | 引数個数の推定差: app=1..1 / doc≈0..3 |
| [`cygconnect`](https://teratermproject.github.io/manual/5/en/macro/command/cygconnect.html) | DIFF | Y | 0..1 | 0..3 | Y | Y | `cygconnect` | 引数個数の推定差: app=0..1 / doc≈0..3 |
| [`disconnect`](https://teratermproject.github.io/manual/5/en/macro/command/disconnect.html) | OK | Y | 0..1 | 0..1 | N | N | `disconnect` | — |
| [`dispstr`](https://teratermproject.github.io/manual/5/en/macro/command/dispstr.html) | OK | Y | 1..∞ | 0..∞ | N | N | `dispstr` | — |
| [`enablekeyb`](https://teratermproject.github.io/manual/5/en/macro/command/enablekeyb.html) | OK | Y | 1..1 | 0..1 | N | N | `enablekeyb` | — |
| [`flushrecv`](https://teratermproject.github.io/manual/5/en/macro/command/flushrecv.html) | OK | Y | 0..0 | 0..0 | N | N | `flushrecv` | — |
| [`gethostname`](https://teratermproject.github.io/manual/5/en/macro/command/gethostname.html) | OK | Y | 1..1 | 0..1 | N | N | `gethostname` | — |
| [`getmodemstatus`](https://teratermproject.github.io/manual/5/en/macro/command/getmodemstatus.html) | OK | Y | 1..1 | 0..1 | Y | Y | `getmodemstatus` | — |
| [`gettitle`](https://teratermproject.github.io/manual/5/en/macro/command/gettitle.html) | OK | Y | 1..1 | 0..1 | N | N | `gettitle` | — |
| [`getttpos`](https://teratermproject.github.io/manual/5/en/macro/command/getttpos.html) | DIFF | Y | 9..9 | 0..17 | Y | Y | `getttpos` | 引数個数の推定差: app=9..9 / doc≈0..17 |
| [`kmtfinish`](https://teratermproject.github.io/manual/5/en/macro/command/kmtfinish.html) | OK | Y | 0..0 | 0..0 | Y | Y | `kmtfinish` | — |
| [`kmtget`](https://teratermproject.github.io/manual/5/en/macro/command/kmtget.html) | OK | Y | 1..1 | 0..1 | Y | Y | `kmtget` | — |
| [`kmtrecv`](https://teratermproject.github.io/manual/5/en/macro/command/kmtrecv.html) | OK | Y | 0..0 | 0..0 | Y | Y | `kmtrecv` | — |
| [`kmtsend`](https://teratermproject.github.io/manual/5/en/macro/command/kmtsend.html) | OK | Y | 1..1 | 0..1 | Y | Y | `kmtsend` | — |
| [`loadkeymap`](https://teratermproject.github.io/manual/5/en/macro/command/loadkeymap.html) | OK | Y | 1..1 | 0..1 | N | N | `loadkeymap` | — |
| [`logautoclosemode`](https://teratermproject.github.io/manual/5/en/macro/command/logautoclosemode.html) | OK | Y | 1..1 | 0..1 | N | N | `logautoclosemode` | — |
| [`logclose`](https://teratermproject.github.io/manual/5/en/macro/command/logclose.html) | OK | Y | 0..0 | 0..0 | N | N | `logclose` | — |
| [`loginfo`](https://teratermproject.github.io/manual/5/en/macro/command/loginfo.html) | OK | Y | 1..1 | 0..1 | Y | Y | `loginfo` | result と文字列出力の両方。ヒントはフラグビット。 |
| [`logopen`](https://teratermproject.github.io/manual/5/en/macro/command/logopen.html) | DIFF | Y | 3..7 | 0..19 | Y | Y | `logopen` | 引数個数の推定差: app=3..7 / doc≈0..19 |
| [`logpause`](https://teratermproject.github.io/manual/5/en/macro/command/logpause.html) | OK | Y | 0..0 | 0..0 | N | N | `logpause` | — |
| [`logrotate`](https://teratermproject.github.io/manual/5/en/macro/command/logrotate.html) | OK | Y | 1..2 | 0..2 | N | N | `logrotate` | — |
| [`logstart`](https://teratermproject.github.io/manual/5/en/macro/command/logstart.html) | OK | Y | 0..0 | 0..0 | N | N | `logstart` | — |
| [`logwrite`](https://teratermproject.github.io/manual/5/en/macro/command/logwrite.html) | OK | Y | 1..1 | 0..0 | N | N | `error occurs.` | — |
| [`quickvanrecv`](https://teratermproject.github.io/manual/5/en/macro/command/quickvanrecv.html) | OK | Y | 0..0 | 0..0 | Y | Y | `quickvanrecv` | — |
| [`quickvansend`](https://teratermproject.github.io/manual/5/en/macro/command/quickvansend.html) | OK | Y | 1..1 | 0..1 | Y | Y | `quickvansend` | — |
| [`recvln`](https://teratermproject.github.io/manual/5/en/macro/command/recvln.html) | OK | Y | 0..0 | 0..0 | Y | Y | `recvln` | — |
| [`recvfile`](https://teratermproject.github.io/manual/5/en/macro/command/recvfile.html) | DIFF | Y | 3..3 | 0..6 | Y | Y | `recvfile` | 引数個数の推定差: app=3..3 / doc≈0..6 |
| [`restoresetup`](https://teratermproject.github.io/manual/5/en/macro/command/restoresetup.html) | OK | Y | 1..1 | 0..1 | N | N | `restoresetup` | — |
| [`scprecv`](https://teratermproject.github.io/manual/5/en/macro/command/scprecv.html) | DIFF | Y | 1..2 | 0..4 | N | N | `scprecv` | 引数個数の推定差: app=1..2 / doc≈0..4 |
| [`scpsend`](https://teratermproject.github.io/manual/5/en/macro/command/scpsend.html) | OK | Y | 1..2 | 0..3 | N | N | `scpsend` | — |
| [`send`](https://teratermproject.github.io/manual/5/en/macro/command/send.html) | OK | Y | 0..∞ | 0..∞ | N | N | `send` | — |
| [`sendbinary`](https://teratermproject.github.io/manual/5/en/macro/command/sendbinary.html) | OK | Y | 0..∞ | 0..∞ | N | N | `sendbinary` | — |
| [`sendbreak`](https://teratermproject.github.io/manual/5/en/macro/command/sendbreak.html) | OK | Y | 0..0 | 0..0 | N | N | `sendbreak` | — |
| [`sendbroadcast`](https://teratermproject.github.io/manual/5/en/macro/command/sendbroadcast.html) | OK | Y | 0..∞ | 0..∞ | N | N | `sendbroadcast` | — |
| [`sendfile`](https://teratermproject.github.io/manual/5/en/macro/command/sendfile.html) | DIFF | Y | 2..2 | 0..3 | N | N | `sendfile` | 引数個数の推定差: app=2..2 / doc≈0..3 |
| [`sendkcode`](https://teratermproject.github.io/manual/5/en/macro/command/sendkcode.html) | DIFF | Y | 2..2 | 0..4 | N | N | `sendkcode` | 引数個数の推定差: app=2..2 / doc≈0..4 |
| [`sendln`](https://teratermproject.github.io/manual/5/en/macro/command/sendln.html) | OK | Y | 0..∞ | 0..∞ | N | N | `sendln` | — |
| [`sendlnbroadcast`](https://teratermproject.github.io/manual/5/en/macro/command/sendlnbroadcast.html) | OK | Y | 0..∞ | 0..∞ | N | N | `sendlnbroadcast` | — |
| [`sendlnmulticast`](https://teratermproject.github.io/manual/5/en/macro/command/sendlnmulticast.html) | OK | Y | 1..∞ | 0..∞ | N | N | `sendlnmulticast` | — |
| [`sendtext`](https://teratermproject.github.io/manual/5/en/macro/command/sendtext.html) | OK | Y | 0..∞ | 0..∞ | N | N | `sendtext` | — |
| [`sendmulticast`](https://teratermproject.github.io/manual/5/en/macro/command/sendmulticast.html) | OK | Y | 1..∞ | 0..∞ | N | N | `sendmulticast` | — |
| [`setbaud`](https://teratermproject.github.io/manual/5/en/macro/command/setbaud.html) | OK | Y | 1..1 | 0..1 | N | N | `setbaud` | — |
| [`setdebug`](https://teratermproject.github.io/manual/5/en/macro/command/setdebug.html) | OK | Y | 1..1 | 0..1 | N | N | `setdebug` | — |
| [`setdtr`](https://teratermproject.github.io/manual/5/en/macro/command/setdtr.html) | OK | Y | 1..1 | 0..1 | N | N | `setdtr` | — |
| [`setecho`](https://teratermproject.github.io/manual/5/en/macro/command/setecho.html) | OK | Y | 1..1 | 0..2 | N | N | `setecho` | — |
| [`setflowctrl`](https://teratermproject.github.io/manual/5/en/macro/command/setflowctrl.html) | OK | Y | 1..1 | 0..1 | N | N | `setflowctrl` | — |
| [`setmulticastname`](https://teratermproject.github.io/manual/5/en/macro/command/setmulticastname.html) | OK | Y | 1..1 | 0..1 | N | N | `setmulticastname` | — |
| [`setrts`](https://teratermproject.github.io/manual/5/en/macro/command/setrts.html) | OK | Y | 1..1 | 0..1 | N | N | `setrts` | — |
| [`setserialdelaychar`](https://teratermproject.github.io/manual/5/en/macro/command/setserialdelaychar.html) | OK | Y | 1..1 | 0..1 | N | N | `setserialdelaychar` | — |
| [`setserialdelayline`](https://teratermproject.github.io/manual/5/en/macro/command/setserialdelayline.html) | OK | Y | 1..1 | 0..1 | N | N | `setserialdelayline` | — |
| [`setspeed`](https://teratermproject.github.io/manual/5/en/macro/command/setspeed.html) | OK | Y | 1..1 | 0..1 | N | N | `setspeed` | — |
| [`setsync`](https://teratermproject.github.io/manual/5/en/macro/command/setsync.html) | OK | Y | 1..1 | 0..2 | N | N | `setsync` | — |
| [`settitle`](https://teratermproject.github.io/manual/5/en/macro/command/settitle.html) | OK | Y | 1..1 | 0..2 | N | N | `settitle` | — |
| [`showtt`](https://teratermproject.github.io/manual/5/en/macro/command/showtt.html) | DIFF | Y | 1..1 | 0..4 | N | N | `showtt` | 引数個数の推定差: app=1..1 / doc≈0..4 |
| [`testlink`](https://teratermproject.github.io/manual/5/en/macro/command/testlink.html) | OK | Y | 0..0 | 0..0 | Y | Y | `testlink` | — |
| [`unlink`](https://teratermproject.github.io/manual/5/en/macro/command/unlink.html) | OK | Y | 0..0 | 0..0 | N | N | `unlink` | — |
| [`wait`](https://teratermproject.github.io/manual/5/en/macro/command/wait.html) | DIFF | Y | 1..10 | 0..∞ | Y | Y | `wait` | 引数個数の推定差: app=1..10 / doc≈0..∞ |
| [`wait4all`](https://teratermproject.github.io/manual/5/en/macro/command/wait4all.html) | DIFF | Y | 1..10 | 0..∞ | Y | Y | `wait4all` | 引数個数の推定差: app=1..10 / doc≈0..∞ |
| [`waitevent`](https://teratermproject.github.io/manual/5/en/macro/command/waitevent.html) | OK | Y | 1..1 | 0..1 | Y | Y | `waitevent` | — |
| [`waitln`](https://teratermproject.github.io/manual/5/en/macro/command/waitln.html) | DIFF | Y | 1..10 | 0..∞ | Y | Y | `waitln` | 引数個数の推定差: app=1..10 / doc≈0..∞ |
| [`waitn`](https://teratermproject.github.io/manual/5/en/macro/command/waitn.html) | DIFF | Y | 1..1 | 0..3 | Y | Y | `waitn` | 引数個数の推定差: app=1..1 / doc≈0..3 |
| [`waitrecv`](https://teratermproject.github.io/manual/5/en/macro/command/waitrecv.html) | DIFF | Y | 3..3 | 0..3 | Y | Y | `waitrecv` | 引数個数の推定差: app=3..3 / doc≈0..3 |
| [`waitregex`](https://teratermproject.github.io/manual/5/en/macro/command/waitregex.html) | DIFF | Y | 1..10 | 0..∞ | Y | Y | `waitregex` | 引数個数の推定差: app=1..10 / doc≈0..∞ |
| [`xmodemrecv`](https://teratermproject.github.io/manual/5/en/macro/command/xmodemrecv.html) | DIFF | Y | 3..3 | 0..4 | Y | Y | `xmodemrecv` | 引数個数の推定差: app=3..3 / doc≈0..4 |
| [`xmodemsend`](https://teratermproject.github.io/manual/5/en/macro/command/xmodemsend.html) | DIFF | Y | 2..2 | 0..2 | Y | Y | `xmodemsend` | 引数個数の推定差: app=2..2 / doc≈0..2 |
| [`ymodemrecv`](https://teratermproject.github.io/manual/5/en/macro/command/ymodemrecv.html) | OK | Y | 0..0 | 0..0 | Y | Y | `ymodemrecv` | — |
| [`ymodemsend`](https://teratermproject.github.io/manual/5/en/macro/command/ymodemsend.html) | OK | Y | 1..1 | 0..1 | Y | Y | `ymodemsend` | — |
| [`zmodemrecv`](https://teratermproject.github.io/manual/5/en/macro/command/zmodemrecv.html) | OK | Y | 0..0 | 0..0 | Y | Y | `zmodemrecv` | — |
| [`zmodemsend`](https://teratermproject.github.io/manual/5/en/macro/command/zmodemsend.html) | DIFF | Y | 2..2 | 0..3 | Y | Y | `zmodemsend` | 引数個数の推定差: app=2..2 / doc≈0..3 |

## Control

| コマンド | 判定 | 登録 | 引数(app) | 引数(doc≈) | result(app) | result(doc) | SYNOPSIS抜粋 | メモ |
|----------|------|------|-----------|------------|-------------|-------------|--------------|------|
| [`break`](https://teratermproject.github.io/manual/5/en/macro/command/break.html) | OK | Y | 0..0 | 0..0 | N | N | `break` | — |
| [`call`](https://teratermproject.github.io/manual/5/en/macro/command/call.html) | OK | Y | 1..1 | 0..1 | N | N | `call` | — |
| [`continue`](https://teratermproject.github.io/manual/5/en/macro/command/continue.html) | OK | Y | 0..0 | 0..0 | N | N | `continue` | — |
| [`do`](https://teratermproject.github.io/manual/5/en/macro/command/doloop.html) | DIFF | Y | 0..2 | 0..4 | N | N | `do, loop` | 引数個数の推定差: app=0..2 / doc≈0..4 |
| [`loop`](https://teratermproject.github.io/manual/5/en/macro/command/doloop.html) | DIFF | Y | 0..2 | 0..4 | N | N | `loop [ { while \| until } <expression> (option)]` | 引数個数の推定差: app=0..2 / doc≈0..4 |
| [`end`](https://teratermproject.github.io/manual/5/en/macro/command/end.html) | OK | Y | 0..0 | 0..0 | N | N | `end` | — |
| [`execcmnd`](https://teratermproject.github.io/manual/5/en/macro/command/execcmnd.html) | OK | Y | 1..1 | 0..0 | N | N | `error` | — |
| [`exit`](https://teratermproject.github.io/manual/5/en/macro/command/exit.html) | OK | Y | 0..0 | 0..0 | N | N | `exit` | — |
| [`for`](https://teratermproject.github.io/manual/5/en/macro/command/fornext.html) | DIFF | Y | 3..3 | 1..3 | N | N | `for, next` | 引数個数の推定差: app=3..3 / doc≈1..3 |
| [`next`](https://teratermproject.github.io/manual/5/en/macro/command/fornext.html) | OK | Y | 0..0 | 0..0 | N | N | `next` | for 系キーワード。 |
| [`goto`](https://teratermproject.github.io/manual/5/en/macro/command/goto.html) | OK | Y | 1..1 | 0..1 | N | N | `goto` | — |
| [`if`](https://teratermproject.github.io/manual/5/en/macro/command/ifthenelseif.html) | OK | Y | 1..1 | 2..2 | N | N | `if code != 100` | — |
| [`then`](https://teratermproject.github.io/manual/5/en/macro/command/ifthenelseif.html) | SKIP | Y | — | 0..0 | N | N | `error occurs when then is not described.` | 制御構文の一部（単独コマンドではない）; if 構文の一部。COMMAND_ARG_SPECS には通常載せない。 |
| [`elseif`](https://teratermproject.github.io/manual/5/en/macro/command/ifthenelseif.html) | OK | Y | 1..1 | 0..0 | N | N | `error occurs when then is not described.` | if 系キーワード。 |
| [`else`](https://teratermproject.github.io/manual/5/en/macro/command/ifthenelseif.html) | OK | Y | 0..0 | 0..0 | N | N | `else` | if 系キーワード。 |
| [`endif`](https://teratermproject.github.io/manual/5/en/macro/command/ifthenelseif.html) | OK | Y | 0..0 | 0..0 | N | N | `endif` | if 系キーワード。 |
| [`include`](https://teratermproject.github.io/manual/5/en/macro/command/include.html) | DIFF | Y | 1..1 | 0..3 | N | N | `include` | 引数個数の推定差: app=1..1 / doc≈0..3 |
| [`mpause`](https://teratermproject.github.io/manual/5/en/macro/command/mpause.html) | OK | Y | 1..1 | 0..1 | N | N | `mpause` | — |
| [`pause`](https://teratermproject.github.io/manual/5/en/macro/command/pause.html) | OK | Y | 1..1 | 0..1 | N | N | `pause` | — |
| [`return`](https://teratermproject.github.io/manual/5/en/macro/command/return.html) | OK | Y | 0..0 | 0..0 | N | N | `return` | — |
| [`until`](https://teratermproject.github.io/manual/5/en/macro/command/until.html) | OK | Y | 1..1 | 1..2 | N | N | `until, enduntil` | — |
| [`enduntil`](https://teratermproject.github.io/manual/5/en/macro/command/until.html) | OK | Y | 0..0 | 0..0 | N | N | `enduntil` | until 系キーワード。 |
| [`while`](https://teratermproject.github.io/manual/5/en/macro/command/while.html) | OK | Y | 1..1 | 1..2 | N | N | `while, endwhile` | — |
| [`endwhile`](https://teratermproject.github.io/manual/5/en/macro/command/while.html) | OK | Y | 0..0 | 0..0 | N | N | `endwhile` | while 系キーワード。 |

## String

| コマンド | 判定 | 登録 | 引数(app) | 引数(doc≈) | result(app) | result(doc) | SYNOPSIS抜粋 | メモ |
|----------|------|------|-----------|------------|-------------|-------------|--------------|------|
| [`code2str`](https://teratermproject.github.io/manual/5/en/macro/command/code2str.html) | DIFF | Y | 2..2 | 0..3 | N | N | `code2str` | 引数個数の推定差: app=2..2 / doc≈0..3 |
| [`expandenv`](https://teratermproject.github.io/manual/5/en/macro/command/expandenv.html) | OK | Y | 1..2 | 0..2 | N | N | `expandenv` | — |
| [`int2str`](https://teratermproject.github.io/manual/5/en/macro/command/int2str.html) | DIFF | Y | 2..2 | 0..3 | N | N | `int2str` | 引数個数の推定差: app=2..2 / doc≈0..3 |
| [`regexoption`](https://teratermproject.github.io/manual/5/en/macro/command/regexoption.html) | OK | Y | 1..∞ | 1..∞ | N | N | `regexoption <option1> [<option2> ...]` | — |
| [`sprintf`](https://teratermproject.github.io/manual/5/en/macro/command/sprintf.html) | OK | Y | 1..∞ | 0..∞ | Y | Y | `sprintf` | — |
| [`sprintf2`](https://teratermproject.github.io/manual/5/en/macro/command/sprintf2.html) | DIFF | Y | 2..∞ | 0..∞ | Y | Y | `sprintf2` | 引数個数の推定差: app=2..∞ / doc≈0..∞ |
| [`str2code`](https://teratermproject.github.io/manual/5/en/macro/command/str2code.html) | DIFF | Y | 2..2 | 0..2 | N | N | `str2code` | 引数個数の推定差: app=2..2 / doc≈0..2 |
| [`str2int`](https://teratermproject.github.io/manual/5/en/macro/command/str2int.html) | DIFF | Y | 2..2 | 0..2 | Y | Y | `str2int` | 引数個数の推定差: app=2..2 / doc≈0..2 |
| [`strcompare`](https://teratermproject.github.io/manual/5/en/macro/command/strcompare.html) | DIFF | Y | 2..2 | 0..∞ | Y | Y | `strcompare` | 引数個数の推定差: app=2..2 / doc≈0..∞ |
| [`strconcat`](https://teratermproject.github.io/manual/5/en/macro/command/strconcat.html) | DIFF | Y | 2..2 | 0..3 | N | N | `strconcat` | 引数個数の推定差: app=2..2 / doc≈0..3 |
| [`strcopy`](https://teratermproject.github.io/manual/5/en/macro/command/strcopy.html) | DIFF | Y | 4..4 | 0..5 | N | N | `strcopy` | 引数個数の推定差: app=4..4 / doc≈0..5 |
| [`strinsert`](https://teratermproject.github.io/manual/5/en/macro/command/strinsert.html) | DIFF | Y | 3..3 | 4..5 | N | N | `strinsert s 0 'XYZ' ; Syntax error` | 引数個数の推定差: app=3..3 / doc≈4..5 |
| [`strjoin`](https://teratermproject.github.io/manual/5/en/macro/command/strjoin.html) | DIFF | Y | 2..3 | 0..3 | N | N | `strjoin` | 引数個数の推定差: app=2..3 / doc≈0..3 |
| [`strlen`](https://teratermproject.github.io/manual/5/en/macro/command/strlen.html) | OK | Y | 1..1 | 0..1 | Y | Y | `strlen` | — |
| [`strmatch`](https://teratermproject.github.io/manual/5/en/macro/command/strmatch.html) | DIFF | Y | 2..2 | 0..6 | Y | Y | `strmatch` | 引数個数の推定差: app=2..2 / doc≈0..6 |
| [`strremove`](https://teratermproject.github.io/manual/5/en/macro/command/strremove.html) | DIFF | Y | 3..3 | 4..5 | N | N | `strremove s 0 3 ; Syntax error` | 引数個数の推定差: app=3..3 / doc≈4..5 |
| [`strreplace`](https://teratermproject.github.io/manual/5/en/macro/command/strreplace.html) | DIFF | Y | 4..4 | 0..4 | Y | Y | `strreplace` | 引数個数の推定差: app=4..4 / doc≈0..4 |
| [`strscan`](https://teratermproject.github.io/manual/5/en/macro/command/strscan.html) | DIFF | Y | 2..2 | 0..3 | Y | Y | `strscan` | 引数個数の推定差: app=2..2 / doc≈0..3 |
| [`strspecial`](https://teratermproject.github.io/manual/5/en/macro/command/strspecial.html) | OK | Y | 1..2 | 0..2 | N | N | `strspecial` | — |
| [`strsplit`](https://teratermproject.github.io/manual/5/en/macro/command/strsplit.html) | DIFF | Y | 2..3 | 0..3 | Y | Y | `strsplit` | 引数個数の推定差: app=2..3 / doc≈0..3 |
| [`strtrim`](https://teratermproject.github.io/manual/5/en/macro/command/strtrim.html) | DIFF | Y | 2..2 | 0..2 | N | N | `strtrim` | 引数個数の推定差: app=2..2 / doc≈0..2 |
| [`tolower`](https://teratermproject.github.io/manual/5/en/macro/command/tolower.html) | DIFF | Y | 2..2 | 0..2 | N | N | `tolower` | 引数個数の推定差: app=2..2 / doc≈0..2 |
| [`toupper`](https://teratermproject.github.io/manual/5/en/macro/command/toupper.html) | DIFF | Y | 2..2 | 0..2 | N | N | `toupper` | 引数個数の推定差: app=2..2 / doc≈0..2 |

## File

| コマンド | 判定 | 登録 | 引数(app) | 引数(doc≈) | result(app) | result(doc) | SYNOPSIS抜粋 | メモ |
|----------|------|------|-----------|------------|-------------|-------------|--------------|------|
| [`basename`](https://teratermproject.github.io/manual/5/en/macro/command/basename.html) | DIFF | Y | 2..2 | 0..2 | N | N | `basename` | 引数個数の推定差: app=2..2 / doc≈0..2 |
| [`dirname`](https://teratermproject.github.io/manual/5/en/macro/command/dirname.html) | DIFF | Y | 2..2 | 0..2 | N | N | `dirname` | 引数個数の推定差: app=2..2 / doc≈0..2 |
| [`fileclose`](https://teratermproject.github.io/manual/5/en/macro/command/fileclose.html) | OK | Y | 1..1 | 0..2 | N | N | `fileclose` | — |
| [`fileconcat`](https://teratermproject.github.io/manual/5/en/macro/command/fileconcat.html) | DIFF | Y | 2..2 | 0..2 | Y | Y | `fileconcat` | 引数個数の推定差: app=2..2 / doc≈0..2 |
| [`filecopy`](https://teratermproject.github.io/manual/5/en/macro/command/filecopy.html) | DIFF | Y | 2..2 | 0..2 | Y | Y | `filecopy` | 引数個数の推定差: app=2..2 / doc≈0..2 |
| [`filecreate`](https://teratermproject.github.io/manual/5/en/macro/command/filecreate.html) | DIFF | Y | 2..2 | 0..3 | Y | Y | `filecreate` | 引数個数の推定差: app=2..2 / doc≈0..3 |
| [`filedelete`](https://teratermproject.github.io/manual/5/en/macro/command/filedelete.html) | OK | Y | 1..1 | 0..1 | Y | Y | `filedelete` | — |
| [`filelock`](https://teratermproject.github.io/manual/5/en/macro/command/filelock.html) | OK | Y | 1..2 | 0..3 | Y | Y | `filelock` | — |
| [`filemarkptr`](https://teratermproject.github.io/manual/5/en/macro/command/filemarkptr.html) | OK | Y | 1..1 | 0..2 | N | N | `filemarkptr` | — |
| [`fileopen`](https://teratermproject.github.io/manual/5/en/macro/command/fileopen.html) | DIFF | Y | 3..4 | 0..7 | N | N | `fileopen` | 引数個数の推定差: app=3..4 / doc≈0..7 |
| [`filereadln`](https://teratermproject.github.io/manual/5/en/macro/command/filereadln.html) | DIFF | Y | 2..2 | 0..3 | Y | Y | `filereadln` | 引数個数の推定差: app=2..2 / doc≈0..3 |
| [`fileread`](https://teratermproject.github.io/manual/5/en/macro/command/fileread.html) | DIFF | Y | 3..3 | 0..5 | Y | Y | `fileread` | 引数個数の推定差: app=3..3 / doc≈0..5 |
| [`filerename`](https://teratermproject.github.io/manual/5/en/macro/command/filerename.html) | DIFF | Y | 2..2 | 0..2 | Y | Y | `filerename` | 引数個数の推定差: app=2..2 / doc≈0..2 |
| [`filesearch`](https://teratermproject.github.io/manual/5/en/macro/command/filesearch.html) | OK | Y | 1..1 | 0..1 | Y | Y | `filesearch` | — |
| [`fileseek`](https://teratermproject.github.io/manual/5/en/macro/command/fileseek.html) | DIFF | Y | 3..3 | 0..4 | N | N | `fileseek` | 引数個数の推定差: app=3..3 / doc≈0..4 |
| [`fileseekback`](https://teratermproject.github.io/manual/5/en/macro/command/fileseekback.html) | OK | Y | 1..1 | 0..2 | N | N | `fileseekback` | — |
| [`filestat`](https://teratermproject.github.io/manual/5/en/macro/command/filestat.html) | DIFF | Y | 2..4 | 0..4 | Y | Y | `filestat` | 引数個数の推定差: app=2..4 / doc≈0..4 |
| [`filestrseek`](https://teratermproject.github.io/manual/5/en/macro/command/filestrseek.html) | DIFF | Y | 2..2 | 0..3 | Y | Y | `filestrseek` | 引数個数の推定差: app=2..2 / doc≈0..3 |
| [`filestrseek2`](https://teratermproject.github.io/manual/5/en/macro/command/filestrseek2.html) | DIFF | Y | 2..2 | 0..3 | Y | Y | `filestrseek2` | 引数個数の推定差: app=2..2 / doc≈0..3 |
| [`filetruncate`](https://teratermproject.github.io/manual/5/en/macro/command/filetruncate.html) | DIFF | Y | 2..2 | 0..2 | Y | Y | `filetruncate` | 引数個数の推定差: app=2..2 / doc≈0..2 |
| [`fileunlock`](https://teratermproject.github.io/manual/5/en/macro/command/fileunlock.html) | OK | Y | 1..1 | 0..2 | Y | Y | `fileunlock` | — |
| [`filewrite`](https://teratermproject.github.io/manual/5/en/macro/command/filewrite.html) | DIFF | Y | 2..2 | 0..3 | N | N | `filewrite` | 引数個数の推定差: app=2..2 / doc≈0..3 |
| [`filewriteln`](https://teratermproject.github.io/manual/5/en/macro/command/filewriteln.html) | DIFF | Y | 2..2 | 0..3 | N | N | `filewriteln` | 引数個数の推定差: app=2..2 / doc≈0..3 |
| [`foldercreate`](https://teratermproject.github.io/manual/5/en/macro/command/foldercreate.html) | OK | Y | 1..1 | 0..1 | Y | Y | `foldercreate` | — |
| [`folderdelete`](https://teratermproject.github.io/manual/5/en/macro/command/folderdelete.html) | OK | Y | 1..1 | 0..1 | Y | Y | `folderdelete` | — |
| [`foldersearch`](https://teratermproject.github.io/manual/5/en/macro/command/foldersearch.html) | OK | Y | 1..1 | 0..1 | Y | Y | `foldersearch` | — |
| [`getdir`](https://teratermproject.github.io/manual/5/en/macro/command/getdir.html) | OK | Y | 1..1 | 0..1 | N | N | `getdir` | — |
| [`getfileattr`](https://teratermproject.github.io/manual/5/en/macro/command/getfileattr.html) | OK | Y | 1..1 | 0..1 | Y | Y | `getfileattr` | — |
| [`makepath`](https://teratermproject.github.io/manual/5/en/macro/command/makepath.html) | DIFF | Y | 3..3 | 0..3 | N | N | `makepath` | 引数個数の推定差: app=3..3 / doc≈0..3 |
| [`setdir`](https://teratermproject.github.io/manual/5/en/macro/command/setdir.html) | OK | Y | 1..1 | 0..1 | N | N | `setdir` | — |
| [`setfileattr`](https://teratermproject.github.io/manual/5/en/macro/command/setfileattr.html) | DIFF | Y | 2..2 | 0..2 | Y | Y | `setfileattr` | 引数個数の推定差: app=2..2 / doc≈0..2 |
| [`findfirst`](https://teratermproject.github.io/manual/5/en/macro/command/findoperations.html) | DIFF | Y | 3..3 | 0..5 | Y | Y | `findfirst, findnext, findclose` | 引数個数の推定差: app=3..3 / doc≈0..5 |
| [`findnext`](https://teratermproject.github.io/manual/5/en/macro/command/findoperations.html) | DIFF | Y | 2..2 | 0..0 | Y | Y | `findnext` | 引数個数の推定差: app=2..2 / doc≈0..0 |
| [`findclose`](https://teratermproject.github.io/manual/5/en/macro/command/findoperations.html) | DIFF | Y | 1..1 | 0..0 | N | Y | `findfirst, findnext, findclose` | 公式が result を設定する記述あり → RESULT_COMMAND_META 未登録の可能性 |

## Password

| コマンド | 判定 | 登録 | 引数(app) | 引数(doc≈) | result(app) | result(doc) | SYNOPSIS抜粋 | メモ |
|----------|------|------|-----------|------------|-------------|-------------|--------------|------|
| [`delpassword`](https://teratermproject.github.io/manual/5/en/macro/command/delpassword.html) | DIFF | Y | 2..2 | 0..3 | N | N | `delpassword` | 引数個数の推定差: app=2..2 / doc≈0..3 |
| [`delpassword2`](https://teratermproject.github.io/manual/5/en/macro/command/delpassword2.html) | DIFF | Y | 2..2 | 0..3 | N | N | `delpassword2` | 引数個数の推定差: app=2..2 / doc≈0..3 |
| [`getpassword`](https://teratermproject.github.io/manual/5/en/macro/command/getpassword.html) | DIFF | Y | 3..3 | 0..5 | Y | Y | `getpassword` | 引数個数の推定差: app=3..3 / doc≈0..5 |
| [`getpassword2`](https://teratermproject.github.io/manual/5/en/macro/command/getpassword2.html) | DIFF | Y | 4..4 | 0..7 | Y | Y | `getpassword2` | 引数個数の推定差: app=4..4 / doc≈0..7 |
| [`ispassword`](https://teratermproject.github.io/manual/5/en/macro/command/ispassword.html) | DIFF | Y | 2..2 | 0..5 | Y | Y | `ispassword` | 引数個数の推定差: app=2..2 / doc≈0..5 |
| [`ispassword2`](https://teratermproject.github.io/manual/5/en/macro/command/ispassword2.html) | DIFF | Y | 2..2 | 0..5 | Y | Y | `ispassword2` | 引数個数の推定差: app=2..2 / doc≈0..5 |
| [`passwordbox`](https://teratermproject.github.io/manual/5/en/macro/command/passwordbox.html) | DIFF | Y | 2..3 | 0..3 | N | N | `passwordbox` | 引数個数の推定差: app=2..3 / doc≈0..3 |
| [`setpassword`](https://teratermproject.github.io/manual/5/en/macro/command/setpassword.html) | DIFF | Y | 3..3 | 0..4 | Y | Y | `setpassword` | 引数個数の推定差: app=3..3 / doc≈0..4 |
| [`setpassword2`](https://teratermproject.github.io/manual/5/en/macro/command/setpassword2.html) | DIFF | Y | 4..4 | 0..6 | Y | Y | `setpassword2` | 引数個数の推定差: app=4..4 / doc≈0..6 |

## Miscellaneous

| コマンド | 判定 | 登録 | 引数(app) | 引数(doc≈) | result(app) | result(doc) | SYNOPSIS抜粋 | メモ |
|----------|------|------|-----------|------------|-------------|-------------|--------------|------|
| [`beep`](https://teratermproject.github.io/manual/5/en/macro/command/beep.html) | OK | Y | 0..1 | 0..2 | N | N | `beep` | — |
| [`bringupbox`](https://teratermproject.github.io/manual/5/en/macro/command/bringupbox.html) | OK | Y | 0..0 | 0..0 | N | N | `bringupbox` | — |
| [`closesbox`](https://teratermproject.github.io/manual/5/en/macro/command/closesbox.html) | OK | Y | 0..0 | 0..0 | N | N | `closesbox` | — |
| [`clipb2var`](https://teratermproject.github.io/manual/5/en/macro/command/clipb2var.html) | OK | Y | 1..2 | 0..2 | Y | Y | `clipb2var` | 任意 offset（max:2）。公式どおり。 |
| [`exec`](https://teratermproject.github.io/manual/5/en/macro/command/exec.html) | DIFF | Y | 1..4 | 0..6 | Y | Y | `exec` | 引数個数の推定差: app=1..4 / doc≈0..6 |
| [`dirnamebox`](https://teratermproject.github.io/manual/5/en/macro/command/dirnamebox.html) | OK | Y | 1..2 | 0..3 | Y | Y | `dirnamebox` | — |
| [`filenamebox`](https://teratermproject.github.io/manual/5/en/macro/command/filenamebox.html) | OK | Y | 1..3 | 0..3 | Y | Y | `filenamebox` | — |
| [`getdate`](https://teratermproject.github.io/manual/5/en/macro/command/getdate.html) | OK | Y | 1..3 | 0..3 | Y | Y | `getdate` | — |
| [`getenv`](https://teratermproject.github.io/manual/5/en/macro/command/getenv.html) | DIFF | Y | 2..2 | 0..2 | N | N | `getenv` | 引数個数の推定差: app=2..2 / doc≈0..2 |
| [`getipv4addr`](https://teratermproject.github.io/manual/5/en/macro/command/getipv4addr.html) | DIFF | Y | 2..2 | 0..3 | Y | Y | `getipv4addr` | 引数個数の推定差: app=2..2 / doc≈0..3 |
| [`getipv6addr`](https://teratermproject.github.io/manual/5/en/macro/command/getipv6addr.html) | DIFF | Y | 2..2 | 0..3 | Y | Y | `getipv6addr` | 引数個数の推定差: app=2..2 / doc≈0..3 |
| [`getspecialfolder`](https://teratermproject.github.io/manual/5/en/macro/command/getspecialfolder.html) | DIFF | Y | 2..2 | 0..2 | Y | Y | `getspecialfolder` | 引数個数の推定差: app=2..2 / doc≈0..2 |
| [`gettime`](https://teratermproject.github.io/manual/5/en/macro/command/gettime.html) | OK | Y | 1..3 | 0..3 | Y | Y | `gettime` | — |
| [`getttdir`](https://teratermproject.github.io/manual/5/en/macro/command/getttdir.html) | OK | Y | 1..1 | 0..1 | Y | Y | `getttdir` | — |
| [`getver`](https://teratermproject.github.io/manual/5/en/macro/command/getver.html) | OK | Y | 1..2 | 0..2 | Y | Y | `getver` | 引数なし時は result を変更しない（メタに明記）。 |
| [`ifdefined`](https://teratermproject.github.io/manual/5/en/macro/command/ifdefined.html) | OK | Y | 1..1 | 0..1 | Y | Y | `ifdefined` | — |
| [`inputbox`](https://teratermproject.github.io/manual/5/en/macro/command/inputbox.html) | DIFF | Y | 2..4 | 0..4 | N | N | `inputbox` | 引数個数の推定差: app=2..4 / doc≈0..4 |
| [`intdim`](https://teratermproject.github.io/manual/5/en/macro/command/intdim.html) | DIFF | Y | 2..2 | 0..2 | N | N | `intdim` | 引数個数の推定差: app=2..2 / doc≈0..2 |
| [`listbox`](https://teratermproject.github.io/manual/5/en/macro/command/listbox.html) | DIFF | Y | 3..∞ | 0..∞ | Y | Y | `listbox` | 引数個数の推定差: app=3..∞ / doc≈0..∞ |
| [`messagebox`](https://teratermproject.github.io/manual/5/en/macro/command/messagebox.html) | DIFF | Y | 2..3 | 0..3 | N | N | `messagebox` | 引数個数の推定差: app=2..3 / doc≈0..3; 公式は result を設定しない（ドライランは UI シミュ用に更新し得る）。 |
| [`random`](https://teratermproject.github.io/manual/5/en/macro/command/random.html) | DIFF | Y | 2..2 | 0..4 | N | N | `random` | 引数個数の推定差: app=2..2 / doc≈0..4 |
| [`rotateleft`](https://teratermproject.github.io/manual/5/en/macro/command/rotateleft.html) | DIFF | Y | 3..3 | 0..3 | N | N | `rotateleft` | 引数個数の推定差: app=3..3 / doc≈0..3 |
| [`rotateright`](https://teratermproject.github.io/manual/5/en/macro/command/rotateright.html) | DIFF | Y | 3..3 | 0..3 | N | N | `rotateright` | 引数個数の推定差: app=3..3 / doc≈0..3 |
| [`setdate`](https://teratermproject.github.io/manual/5/en/macro/command/setdate.html) | OK | Y | 1..1 | 0..1 | N | N | `setdate` | — |
| [`setdlgpos`](https://teratermproject.github.io/manual/5/en/macro/command/setdlgpos.html) | DIFF | Y | 0..5 | 0..7 | N | N | `setdlgpos` | 引数個数の推定差: app=0..5 / doc≈0..7 |
| [`setenv`](https://teratermproject.github.io/manual/5/en/macro/command/setenv.html) | DIFF | Y | 2..2 | 0..2 | N | N | `setenv` | 引数個数の推定差: app=2..2 / doc≈0..2 |
| [`setexitcode`](https://teratermproject.github.io/manual/5/en/macro/command/setexitcode.html) | OK | Y | 1..1 | 0..2 | N | N | `setexitcode` | — |
| [`settime`](https://teratermproject.github.io/manual/5/en/macro/command/settime.html) | OK | Y | 1..1 | 0..1 | N | N | `settime` | — |
| [`show`](https://teratermproject.github.io/manual/5/en/macro/command/show.html) | OK | Y | 1..1 | 0..2 | N | N | `show` | — |
| [`statusbox`](https://teratermproject.github.io/manual/5/en/macro/command/statusbox.html) | DIFF | Y | 2..3 | 0..3 | N | N | `statusbox` | 引数個数の推定差: app=2..3 / doc≈0..3 |
| [`strdim`](https://teratermproject.github.io/manual/5/en/macro/command/strdim.html) | DIFF | Y | 2..2 | 0..2 | N | N | `strdim` | 引数個数の推定差: app=2..2 / doc≈0..2 |
| [`uptime`](https://teratermproject.github.io/manual/5/en/macro/command/uptime.html) | OK | Y | 1..1 | 0..1 | N | N | `uptime` | — |
| [`var2clipb`](https://teratermproject.github.io/manual/5/en/macro/command/var2clipb.html) | DIFF | Y | 1..1 | 0..3 | Y | Y | `var2clipb` | 引数個数の推定差: app=1..1 / doc≈0..3 |
| [`yesnobox`](https://teratermproject.github.io/manual/5/en/macro/command/yesnobox.html) | DIFF | Y | 2..3 | 0..4 | Y | Y | `yesnobox` | 引数個数の推定差: app=2..3 / doc≈0..4 |
| [`checksum8`](https://teratermproject.github.io/manual/5/en/macro/command/checksum8.html) | DIFF | Y | 2..2 | 1..2 | N | Y | `checksum8, checksum8file` | 公式が result を設定する記述あり → RESULT_COMMAND_META 未登録の可能性; 文字列版は result を設定しない（file 版のみ）。 |
| [`checksum8file`](https://teratermproject.github.io/manual/5/en/macro/command/checksum8.html) | OK | Y | 2..2 | 2..2 | Y | Y | `checksum8file <intvar> <filename>` | — |
| [`checksum16`](https://teratermproject.github.io/manual/5/en/macro/command/checksum16.html) | DIFF | Y | 2..2 | 1..2 | N | Y | `checksum16, checksum16file` | 公式が result を設定する記述あり → RESULT_COMMAND_META 未登録の可能性 |
| [`checksum16file`](https://teratermproject.github.io/manual/5/en/macro/command/checksum16.html) | OK | Y | 2..2 | 2..2 | Y | Y | `checksum16file <intvar> <filename>` | — |
| [`checksum32`](https://teratermproject.github.io/manual/5/en/macro/command/checksum32.html) | DIFF | Y | 2..2 | 1..2 | N | Y | `checksum32, checksum32file` | 公式が result を設定する記述あり → RESULT_COMMAND_META 未登録の可能性 |
| [`checksum32file`](https://teratermproject.github.io/manual/5/en/macro/command/checksum32.html) | OK | Y | 2..2 | 2..2 | Y | Y | `checksum32file <intvar> <filename>` | — |
| [`crc16`](https://teratermproject.github.io/manual/5/en/macro/command/crc16.html) | DIFF | Y | 2..2 | 1..2 | N | Y | `crc16, crc16file` | 公式が result を設定する記述あり → RESULT_COMMAND_META 未登録の可能性 |
| [`crc16file`](https://teratermproject.github.io/manual/5/en/macro/command/crc16.html) | OK | Y | 2..2 | 2..2 | Y | Y | `crc16file <intvar> <filename>` | — |
| [`crc32`](https://teratermproject.github.io/manual/5/en/macro/command/crc32.html) | DIFF | Y | 2..2 | 1..2 | N | Y | `crc32, crc32file` | 公式が result を設定する記述あり → RESULT_COMMAND_META 未登録の可能性 |
| [`crc32file`](https://teratermproject.github.io/manual/5/en/macro/command/crc32.html) | OK | Y | 2..2 | 2..2 | Y | Y | `crc32file <intvar> <filename>` | — |

## 手動確認チェックリスト（実行・セマンティクス）

レジストリ以外でエディタ固有の実装深度がある領域:

- 制御構文: `if` / `for` / `while` / `do` / `until` / `goto` / `call` / `include`（evaluator / dryRun）
- 送信: `send` / `sendln` / `sendtext` / `sendbinary` 等（sendText）
- 文字列静的評価: `staticCommandEval.ts`（strlen, strcompare, strcopy, sprintf 等）
- 日時: `ttlDateTime.ts`（getdate / gettime）
- sprintf: `ttlSprintf.ts`
- 負の整数定数と for: `parseForLoopRangeExprs`（公式 appendixes/negative）

## キャッシュ

公式 HTML の取得結果は `docs/_audit-cache.json` に保存する。再調査時はキャッシュを再利用または削除して再取得する。

---

*本レポートは自動突合＋人手向けフラグ付け。DIFF 行は公式ページを開いて最終確認すること。*