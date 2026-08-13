# TTL コマンド仕様取り込み調査レポート（レジストリ監査）

- **調査日**: 2026-08-13
- **公式基準**: [Manual 5 英語版 command index](https://teratermproject.github.io/manual/5/en/macro/command/index.html)（プロジェクト標準）
- **日本語目次**: [TTL コマンドリファレンス](https://teratermproject.github.io/manual/5/ja/macro/command/index.html)
- **本レポートの範囲**: 登録・引数個数・`result`・出力スロットのレジストリ整合
- **厳密監査（静的解析・ドライラン）**: [ttl-command-semantics-audit.md](./ttl-command-semantics-audit.md)
- **機械突合 raw**: [ttl-command-spec-audit-raw.md](./ttl-command-spec-audit-raw.md)

## 結論（要約）

公式 index のコマンドは **登録漏れ（GAP）なし**。引数・`result` メタは概ね公式に沿う。空 send 等は「意図的差分」として分離。静的解析・ドライランの不足は semantics レポートを参照。

| 指標 | 結果 |
|------|------|
| 調査行数（キーワード展開含む） | 209 |
| 判定「一致」 | 193 |
| 判定「意図的差分」 | 15 |
| 判定「要確認」 | 0 |
| 構文要素（then） | 1 |
| EXTRA | 1（`strlength`） |
| RESULT_COMMAND_META | 87 |

## 意図的差分

| コマンド | メモ |
|----------|------|
| [`send`](https://teratermproject.github.io/manual/5/en/macro/command/send.html) | 意図的緩和: app min=0 < doc≈3（空引数許可など） |
| [`sendbinary`](https://teratermproject.github.io/manual/5/en/macro/command/sendbinary.html) | 意図的緩和: app min=0 < doc≈3（空引数許可など） |
| [`sendbroadcast`](https://teratermproject.github.io/manual/5/en/macro/command/sendbroadcast.html) | 意図的緩和: app min=0 < doc≈3（空引数許可など） |
| [`sendln`](https://teratermproject.github.io/manual/5/en/macro/command/sendln.html) | 意図的緩和: app min=0 < doc≈3（空引数許可など） |
| [`sendlnbroadcast`](https://teratermproject.github.io/manual/5/en/macro/command/sendlnbroadcast.html) | 意図的緩和: app min=0 < doc≈3（空引数許可など） |
| [`sendlnmulticast`](https://teratermproject.github.io/manual/5/en/macro/command/sendlnmulticast.html) | 意図的緩和: app min=1 < doc≈4（空引数許可など） |
| [`sendtext`](https://teratermproject.github.io/manual/5/en/macro/command/sendtext.html) | 意図的緩和: app min=0 < doc≈3（空引数許可など） |
| [`sendmulticast`](https://teratermproject.github.io/manual/5/en/macro/command/sendmulticast.html) | 意図的緩和: app min=1 < doc≈4（空引数許可など） |
| [`for`](https://teratermproject.github.io/manual/5/en/macro/command/fornext.html) | 負数定数は式単位消費（appendixes/negative） |
| [`if`](https://teratermproject.github.io/manual/5/en/macro/command/ifthenelseif.html) | — |
| [`elseif`](https://teratermproject.github.io/manual/5/en/macro/command/ifthenelseif.html) | — |
| [`until`](https://teratermproject.github.io/manual/5/en/macro/command/until.html) | — |
| [`while`](https://teratermproject.github.io/manual/5/en/macro/command/while.html) | — |
| [`getver`](https://teratermproject.github.io/manual/5/en/macro/command/getver.html) | 比較引数があるときのみ result |
| [`messagebox`](https://teratermproject.github.io/manual/5/en/macro/command/messagebox.html) | 公式は result 非設定 |

## 要確認一覧

（なし）

## EXTRA

| 名前 | 説明 |
|------|------|
| `strlength` | 公式 index 外。strlen 別名 |

## result 帰属の突合

### 公式ページで result 設定と読めるが META に無い（共有ページ補正前）

（なし）

### META にあるがページ文へのコマンド帰属が取れなかったもの

（なし — `System variable <result>` 表記も含め検出と META が一致）

## 実装深度

| 深度 | 意味 |
|------|------|
| control | if/for/while/goto/call/include 等を evaluator/dryRun で解釈 |
| send | 送信データパネル連携 |
| static-eval | 引数既知なら実値計算（strlen 等） |
| dialog | ダイアログ系のドライラン／inputstr |
| registry | 引数・result・出力スロット登録。実 I/O はプレースホルダ |

## コマンド別一覧（全件）

### Communication

| コマンド | 判定 | 登録 | 引数(app) | 引数(doc) | result A/D | 出力 | 深度 | SYNOPSIS | メモ |
|----------|------|------|-----------|-----------|------------|------|------|----------|------|
| [`bplusrecv`](https://teratermproject.github.io/manual/5/en/macro/command/bplusrecv.html) | 一致 | Y | 0..0 | 0..0 | Y/Y | result | registry | `bplusrecv` | — |
| [`bplussend`](https://teratermproject.github.io/manual/5/en/macro/command/bplussend.html) | 一致 | Y | 1..1 | 1..1 | Y/Y | result | registry | `bplussend <filename>` | — |
| [`callmenu`](https://teratermproject.github.io/manual/5/en/macro/command/callmenu.html) | 一致 | Y | 1..1 | 1..1 | N/N | — | registry | `callmenu <menu ID>` | — |
| [`changedir`](https://teratermproject.github.io/manual/5/en/macro/command/changedir.html) | 一致 | Y | 1..1 | 1..1 | N/N | — | registry | `changedir <path>` | — |
| [`clearscreen`](https://teratermproject.github.io/manual/5/en/macro/command/clearscreen.html) | 一致 | Y | 1..1 | 1..1 | N/N | — | registry | `clearscreen <int>` | — |
| [`closett`](https://teratermproject.github.io/manual/5/en/macro/command/closett.html) | 一致 | Y | 0..0 | 0..0 | N/N | — | registry | `closett` | — |
| [`connect`](https://teratermproject.github.io/manual/5/en/macro/command/connect.html) | 一致 | Y | 1..1 | 1..1 | Y/Y | result | registry | `connect <command line parameters>` | — |
| [`cygconnect`](https://teratermproject.github.io/manual/5/en/macro/command/cygconnect.html) | 一致 | Y | 0..1 | 0..1 | Y/Y | result | registry | `cygconnect [<command line parameters>]` | — |
| [`disconnect`](https://teratermproject.github.io/manual/5/en/macro/command/disconnect.html) | 一致 | Y | 0..1 | 0..1 | N/N | — | registry | `disconnect [<confirm>]` | — |
| [`dispstr`](https://teratermproject.github.io/manual/5/en/macro/command/dispstr.html) | 一致 | Y | 1..∞ | 1..∞ | N/N | — | send | `dispstr <data1> [<data2>....]` | — |
| [`enablekeyb`](https://teratermproject.github.io/manual/5/en/macro/command/enablekeyb.html) | 一致 | Y | 1..1 | 1..1 | N/N | — | registry | `enablekeyb <flag>` | — |
| [`flushrecv`](https://teratermproject.github.io/manual/5/en/macro/command/flushrecv.html) | 一致 | Y | 0..0 | 0..0 | N/N | — | registry | `flushrecv` | — |
| [`gethostname`](https://teratermproject.github.io/manual/5/en/macro/command/gethostname.html) | 一致 | Y | 1..1 | 1..1 | N/N | #1s | registry | `gethostname <strvar>` | — |
| [`getmodemstatus`](https://teratermproject.github.io/manual/5/en/macro/command/getmodemstatus.html) | 一致 | Y | 1..1 | 1..1 | Y/Y | #1i | registry | `getmodemstatus <intvar>` | — |
| [`gettitle`](https://teratermproject.github.io/manual/5/en/macro/command/gettitle.html) | 一致 | Y | 1..1 | 1..1 | N/N | #1s | registry | `gettitle <strvar>` | — |
| [`getttpos`](https://teratermproject.github.io/manual/5/en/macro/command/getttpos.html) | 一致 | Y | 9..9 | 9..9 | Y/Y | #1i,#2i,#3i,#4i,#5i,#6i,#7i,#8i,#9i | registry | `getttpos <showflag> <window x> <window y> <window width> <window height> <client x> <client y> <client width> ` | — |
| [`kmtfinish`](https://teratermproject.github.io/manual/5/en/macro/command/kmtfinish.html) | 一致 | Y | 0..0 | 0..0 | Y/Y | result | registry | `kmtfinish` | — |
| [`kmtget`](https://teratermproject.github.io/manual/5/en/macro/command/kmtget.html) | 一致 | Y | 1..1 | 1..1 | Y/Y | result | registry | `kmtget <filename>` | — |
| [`kmtrecv`](https://teratermproject.github.io/manual/5/en/macro/command/kmtrecv.html) | 一致 | Y | 0..0 | 0..0 | Y/Y | result | registry | `kmtrecv` | — |
| [`kmtsend`](https://teratermproject.github.io/manual/5/en/macro/command/kmtsend.html) | 一致 | Y | 1..1 | 1..1 | Y/Y | result | registry | `kmtsend <filename>` | — |
| [`loadkeymap`](https://teratermproject.github.io/manual/5/en/macro/command/loadkeymap.html) | 一致 | Y | 1..1 | 1..1 | N/N | — | registry | `loadkeymap <filename>` | — |
| [`logautoclosemode`](https://teratermproject.github.io/manual/5/en/macro/command/logautoclosemode.html) | 一致 | Y | 1..1 | 1..1 | N/N | — | registry | `logautoclosemode <flag>` | — |
| [`logclose`](https://teratermproject.github.io/manual/5/en/macro/command/logclose.html) | 一致 | Y | 0..0 | 0..0 | N/N | — | registry | `logclose` | — |
| [`loginfo`](https://teratermproject.github.io/manual/5/en/macro/command/loginfo.html) | 一致 | Y | 1..1 | 1..1 | Y/Y | #1s | registry | `loginfo <strvar>` | 文字列出力 + result フラグ |
| [`logopen`](https://teratermproject.github.io/manual/5/en/macro/command/logopen.html) | 一致 | Y | 3..7 | 3..7 | Y/Y | result | registry | `logopen <filename> <binary flag> <append flag> [<plain text flag> [<timestamp flag> [<hide dialog flag> [<incl` | — |
| [`logpause`](https://teratermproject.github.io/manual/5/en/macro/command/logpause.html) | 一致 | Y | 0..0 | 0..0 | N/N | — | registry | `logpause` | — |
| [`logrotate`](https://teratermproject.github.io/manual/5/en/macro/command/logrotate.html) | 一致 | Y | 1..2 | 1..2 | N/N | — | registry | `logrotate 'size' '<size>'` | — |
| [`logstart`](https://teratermproject.github.io/manual/5/en/macro/command/logstart.html) | 一致 | Y | 0..0 | 0..0 | N/N | — | registry | `logstart` | — |
| [`logwrite`](https://teratermproject.github.io/manual/5/en/macro/command/logwrite.html) | 一致 | Y | 1..1 | 1..1 | N/N | — | registry | `logwrite <string>` | — |
| [`quickvanrecv`](https://teratermproject.github.io/manual/5/en/macro/command/quickvanrecv.html) | 一致 | Y | 0..0 | 0..0 | Y/Y | result | registry | `quickvanrecv` | — |
| [`quickvansend`](https://teratermproject.github.io/manual/5/en/macro/command/quickvansend.html) | 一致 | Y | 1..1 | 1..1 | Y/Y | result | registry | `quickvansend <filename>` | — |
| [`recvln`](https://teratermproject.github.io/manual/5/en/macro/command/recvln.html) | 一致 | Y | 0..0 | 0..0 | Y/Y | inputstr | registry | `recvln` | — |
| [`recvfile`](https://teratermproject.github.io/manual/5/en/macro/command/recvfile.html) | 一致 | Y | 3..3 | 3..3 | Y/Y | result | registry | `recvfile <filename> <binary flag> <auto-stop wait time>` | — |
| [`restoresetup`](https://teratermproject.github.io/manual/5/en/macro/command/restoresetup.html) | 一致 | Y | 1..1 | 1..1 | N/N | — | registry | `restoresetup <filename>` | — |
| [`scprecv`](https://teratermproject.github.io/manual/5/en/macro/command/scprecv.html) | 一致 | Y | 1..2 | 1..2 | N/N | — | registry | `scprecv <remote filename> [<local filename>]` | — |
| [`scpsend`](https://teratermproject.github.io/manual/5/en/macro/command/scpsend.html) | 一致 | Y | 1..2 | 1..2 | N/N | — | registry | `scpsend <filename> [<destination filename>]` | — |
| [`send`](https://teratermproject.github.io/manual/5/en/macro/command/send.html) | 意図的差分 | Y | 0..∞ | 3..∞ | N/N | — | send | `send <data1> <data2>....` | 意図的緩和: app min=0 < doc≈3（空引数許可など） |
| [`sendbinary`](https://teratermproject.github.io/manual/5/en/macro/command/sendbinary.html) | 意図的差分 | Y | 0..∞ | 3..∞ | N/N | — | send | `sendbinary <data1> <data2>....` | 意図的緩和: app min=0 < doc≈3（空引数許可など） |
| [`sendbreak`](https://teratermproject.github.io/manual/5/en/macro/command/sendbreak.html) | 一致 | Y | 0..0 | 0..0 | N/N | — | registry | `sendbreak` | — |
| [`sendbroadcast`](https://teratermproject.github.io/manual/5/en/macro/command/sendbroadcast.html) | 意図的差分 | Y | 0..∞ | 3..∞ | N/N | — | send | `sendbroadcast <data1> <data2>....` | 意図的緩和: app min=0 < doc≈3（空引数許可など） |
| [`sendfile`](https://teratermproject.github.io/manual/5/en/macro/command/sendfile.html) | 一致 | Y | 2..2 | 2..2 | N/N | — | registry | `sendfile <filename> <binary flag>` | — |
| [`sendkcode`](https://teratermproject.github.io/manual/5/en/macro/command/sendkcode.html) | 一致 | Y | 2..2 | 2..2 | N/N | — | registry | `sendkcode <key code> <repeat count>` | — |
| [`sendln`](https://teratermproject.github.io/manual/5/en/macro/command/sendln.html) | 意図的差分 | Y | 0..∞ | 3..∞ | N/N | — | send | `sendln <data1> <data2>....` | 意図的緩和: app min=0 < doc≈3（空引数許可など） |
| [`sendlnbroadcast`](https://teratermproject.github.io/manual/5/en/macro/command/sendlnbroadcast.html) | 意図的差分 | Y | 0..∞ | 3..∞ | N/N | — | send | `sendlnbroadcast <data1> <data2>....` | 意図的緩和: app min=0 < doc≈3（空引数許可など） |
| [`sendlnmulticast`](https://teratermproject.github.io/manual/5/en/macro/command/sendlnmulticast.html) | 意図的差分 | Y | 1..∞ | 4..∞ | N/N | — | send | `sendlnmulticast <multicastname> <data1> <data2>....` | 意図的緩和: app min=1 < doc≈4（空引数許可など） |
| [`sendtext`](https://teratermproject.github.io/manual/5/en/macro/command/sendtext.html) | 意図的差分 | Y | 0..∞ | 3..∞ | N/N | — | send | `sendtext <data1> <data2>....` | 意図的緩和: app min=0 < doc≈3（空引数許可など） |
| [`sendmulticast`](https://teratermproject.github.io/manual/5/en/macro/command/sendmulticast.html) | 意図的差分 | Y | 1..∞ | 4..∞ | N/N | — | send | `sendmulticast <multicastname> <data1> <data2>....` | 意図的緩和: app min=1 < doc≈4（空引数許可など） |
| [`setbaud`](https://teratermproject.github.io/manual/5/en/macro/command/setbaud.html) | 一致 | Y | 1..1 | 1..1 | N/N | — | registry | `setbaud <value>` | — |
| [`setdebug`](https://teratermproject.github.io/manual/5/en/macro/command/setdebug.html) | 一致 | Y | 1..1 | 1..1 | N/N | — | registry | `setdebug <flag>` | — |
| [`setdtr`](https://teratermproject.github.io/manual/5/en/macro/command/setdtr.html) | 一致 | Y | 1..1 | 1..1 | N/N | — | registry | `setdtr <flag>` | — |
| [`setecho`](https://teratermproject.github.io/manual/5/en/macro/command/setecho.html) | 一致 | Y | 1..1 | 1..1 | N/N | — | registry | `setecho <echo flag>` | — |
| [`setflowctrl`](https://teratermproject.github.io/manual/5/en/macro/command/setflowctrl.html) | 一致 | Y | 1..1 | 1..1 | N/N | — | registry | `setflowctrl <value>` | — |
| [`setmulticastname`](https://teratermproject.github.io/manual/5/en/macro/command/setmulticastname.html) | 一致 | Y | 1..1 | 1..1 | N/N | — | registry | `setmulticastname <multicastname>` | — |
| [`setrts`](https://teratermproject.github.io/manual/5/en/macro/command/setrts.html) | 一致 | Y | 1..1 | 1..1 | N/N | — | registry | `setrts <flag>` | — |
| [`setserialdelaychar`](https://teratermproject.github.io/manual/5/en/macro/command/setserialdelaychar.html) | 一致 | Y | 1..1 | 1..1 | N/N | — | registry | `setserialdelaychar <delay>` | — |
| [`setserialdelayline`](https://teratermproject.github.io/manual/5/en/macro/command/setserialdelayline.html) | 一致 | Y | 1..1 | 1..1 | N/N | — | registry | `setserialdelayline <delay>` | — |
| [`setspeed`](https://teratermproject.github.io/manual/5/en/macro/command/setspeed.html) | 一致 | Y | 1..1 | 1..1 | N/N | — | registry | `setspeed <value>` | — |
| [`setsync`](https://teratermproject.github.io/manual/5/en/macro/command/setsync.html) | 一致 | Y | 1..1 | 1..1 | N/N | — | registry | `setsync <sync flag>` | — |
| [`settitle`](https://teratermproject.github.io/manual/5/en/macro/command/settitle.html) | 一致 | Y | 1..1 | 1..1 | N/N | — | registry | `settitle <title>` | — |
| [`showtt`](https://teratermproject.github.io/manual/5/en/macro/command/showtt.html) | 一致 | Y | 1..1 | 1..1 | N/N | — | registry | `showtt <show flag>` | — |
| [`testlink`](https://teratermproject.github.io/manual/5/en/macro/command/testlink.html) | 一致 | Y | 0..0 | 0..0 | Y/Y | result | registry | `testlink` | — |
| [`unlink`](https://teratermproject.github.io/manual/5/en/macro/command/unlink.html) | 一致 | Y | 0..0 | 0..0 | N/N | — | registry | `unlink` | — |
| [`wait`](https://teratermproject.github.io/manual/5/en/macro/command/wait.html) | 一致 | Y | 1..10 | 1..∞ | Y/Y | result | registry | `wait <string1> [<string2> ...]` | — |
| [`wait4all`](https://teratermproject.github.io/manual/5/en/macro/command/wait4all.html) | 一致 | Y | 1..10 | 1..∞ | Y/Y | result | registry | `wait4all <string1> [<string2> ...]` | — |
| [`waitevent`](https://teratermproject.github.io/manual/5/en/macro/command/waitevent.html) | 一致 | Y | 1..1 | 1..1 | Y/Y | result | registry | `waitevent <events>` | — |
| [`waitln`](https://teratermproject.github.io/manual/5/en/macro/command/waitln.html) | 一致 | Y | 1..10 | 1..∞ | Y/Y | result | registry | `waitln <string1> [<string2> ...]` | — |
| [`waitn`](https://teratermproject.github.io/manual/5/en/macro/command/waitn.html) | 一致 | Y | 1..1 | 1..1 | Y/Y | result | registry | `waitn <received byte count>` | — |
| [`waitrecv`](https://teratermproject.github.io/manual/5/en/macro/command/waitrecv.html) | 一致 | Y | 3..3 | 3..3 | Y/Y | inputstr | registry | `waitrecv <sub-string> <len> <pos>` | — |
| [`waitregex`](https://teratermproject.github.io/manual/5/en/macro/command/waitregex.html) | 一致 | Y | 1..10 | 1..∞ | Y/Y | result | registry | `waitregex <string1 with regular expression> [<string2 with regular expression> ...]` | groupmatchstr1..9 |
| [`xmodemrecv`](https://teratermproject.github.io/manual/5/en/macro/command/xmodemrecv.html) | 一致 | Y | 3..3 | 3..3 | Y/Y | result | registry | `xmodemrecv <filename> <binary flag> <option>` | — |
| [`xmodemsend`](https://teratermproject.github.io/manual/5/en/macro/command/xmodemsend.html) | 一致 | Y | 2..2 | 2..2 | Y/Y | result | registry | `xmodemsend <filename> <option>` | — |
| [`ymodemrecv`](https://teratermproject.github.io/manual/5/en/macro/command/ymodemrecv.html) | 一致 | Y | 0..0 | 0..0 | Y/Y | result | registry | `ymodemrecv` | — |
| [`ymodemsend`](https://teratermproject.github.io/manual/5/en/macro/command/ymodemsend.html) | 一致 | Y | 1..1 | 1..1 | Y/Y | result | registry | `ymodemsend <filename>` | — |
| [`zmodemrecv`](https://teratermproject.github.io/manual/5/en/macro/command/zmodemrecv.html) | 一致 | Y | 0..0 | 0..0 | Y/Y | result | registry | `zmodemrecv` | — |
| [`zmodemsend`](https://teratermproject.github.io/manual/5/en/macro/command/zmodemsend.html) | 一致 | Y | 2..2 | 2..2 | Y/Y | result | registry | `zmodemsend <filename> <binary flag>` | — |

### Control

| コマンド | 判定 | 登録 | 引数(app) | 引数(doc) | result A/D | 出力 | 深度 | SYNOPSIS | メモ |
|----------|------|------|-----------|-----------|------------|------|------|----------|------|
| [`break`](https://teratermproject.github.io/manual/5/en/macro/command/break.html) | 一致 | Y | 0..0 | 0..0 | N/N | — | control | `break` | — |
| [`call`](https://teratermproject.github.io/manual/5/en/macro/command/call.html) | 一致 | Y | 1..1 | 1..1 | N/N | — | control | `call <label>` | — |
| [`continue`](https://teratermproject.github.io/manual/5/en/macro/command/continue.html) | 一致 | Y | 0..0 | 0..0 | N/N | — | control | `continue` | — |
| [`do`](https://teratermproject.github.io/manual/5/en/macro/command/doloop.html) | 一致 | Y | 0..2 | 0..7 | N/N | — | control | `do [ { while \| until } <expression> (option)]` | — |
| [`loop`](https://teratermproject.github.io/manual/5/en/macro/command/doloop.html) | 一致 | Y | 0..2 | 0..7 | N/N | — | control | `loop [ { while \| until } <expression> (option)]` | — |
| [`end`](https://teratermproject.github.io/manual/5/en/macro/command/end.html) | 一致 | Y | 0..0 | 0..0 | N/N | — | control | `end` | — |
| [`execcmnd`](https://teratermproject.github.io/manual/5/en/macro/command/execcmnd.html) | 一致 | Y | 1..1 | 1..1 | N/N | — | control | `execcmnd <statement>` | — |
| [`exit`](https://teratermproject.github.io/manual/5/en/macro/command/exit.html) | 一致 | Y | 0..0 | 0..0 | N/N | — | control | `exit` | — |
| [`for`](https://teratermproject.github.io/manual/5/en/macro/command/fornext.html) | 意図的差分 | Y | 3..3 | 3..3 | N/N | — | control | `for <intvar> <first> <last>` | 負数定数は式単位消費（appendixes/negative） |
| [`next`](https://teratermproject.github.io/manual/5/en/macro/command/fornext.html) | 一致 | Y | 0..0 | 0..0 | N/N | — | control | `next` | — |
| [`goto`](https://teratermproject.github.io/manual/5/en/macro/command/goto.html) | 一致 | Y | 1..1 | 1..1 | N/N | — | control | `goto <label>` | — |
| [`if`](https://teratermproject.github.io/manual/5/en/macro/command/ifthenelseif.html) | 意図的差分 | Y | 1..1 | 2..2 | N/N | — | control | `if <expression> <statement>` | — |
| [`then`](https://teratermproject.github.io/manual/5/en/macro/command/ifthenelseif.html) | 構文要素 | Y | — | ? | N/N | — | control | `if <expression> <statement>` | if 構文の一部 |
| [`elseif`](https://teratermproject.github.io/manual/5/en/macro/command/ifthenelseif.html) | 意図的差分 | Y | 1..1 | ? | N/N | — | control | `if <expression> <statement>` | — |
| [`else`](https://teratermproject.github.io/manual/5/en/macro/command/ifthenelseif.html) | 一致 | Y | 0..0 | ? | N/N | — | control | `if <expression> <statement>` | — |
| [`endif`](https://teratermproject.github.io/manual/5/en/macro/command/ifthenelseif.html) | 一致 | Y | 0..0 | 0..0 | N/N | — | control | `endif` | — |
| [`include`](https://teratermproject.github.io/manual/5/en/macro/command/include.html) | 一致 | Y | 1..1 | 1..1 | N/N | — | control | `include '<include file name>'` | — |
| [`mpause`](https://teratermproject.github.io/manual/5/en/macro/command/mpause.html) | 一致 | Y | 1..1 | 1..1 | N/N | — | control | `mpause <time>` | — |
| [`pause`](https://teratermproject.github.io/manual/5/en/macro/command/pause.html) | 一致 | Y | 1..1 | 1..1 | N/N | — | control | `pause <time>` | — |
| [`return`](https://teratermproject.github.io/manual/5/en/macro/command/return.html) | 一致 | Y | 0..0 | 0..0 | N/N | — | control | `return` | — |
| [`until`](https://teratermproject.github.io/manual/5/en/macro/command/until.html) | 意図的差分 | Y | 1..1 | 1..1 | N/N | — | control | `until <expression>` | — |
| [`enduntil`](https://teratermproject.github.io/manual/5/en/macro/command/until.html) | 一致 | Y | 0..0 | 0..0 | N/N | — | control | `enduntil` | — |
| [`while`](https://teratermproject.github.io/manual/5/en/macro/command/while.html) | 意図的差分 | Y | 1..1 | 1..1 | N/N | — | control | `while <expression>` | — |
| [`endwhile`](https://teratermproject.github.io/manual/5/en/macro/command/while.html) | 一致 | Y | 0..0 | 0..0 | N/N | — | control | `endwhile` | — |

### String

| コマンド | 判定 | 登録 | 引数(app) | 引数(doc) | result A/D | 出力 | 深度 | SYNOPSIS | メモ |
|----------|------|------|-----------|-----------|------------|------|------|----------|------|
| [`code2str`](https://teratermproject.github.io/manual/5/en/macro/command/code2str.html) | 一致 | Y | 2..2 | 2..2 | N/N | #1s | static-eval | `code2str <strvar> <ASCII code>` | — |
| [`expandenv`](https://teratermproject.github.io/manual/5/en/macro/command/expandenv.html) | 一致 | Y | 1..2 | 1..2 | N/N | #1s | registry | `expandenv <strvar> [<strval>]` | — |
| [`int2str`](https://teratermproject.github.io/manual/5/en/macro/command/int2str.html) | 一致 | Y | 2..2 | 2..2 | N/N | #1s | static-eval | `int2str <strvar> <integer value>` | — |
| [`regexoption`](https://teratermproject.github.io/manual/5/en/macro/command/regexoption.html) | 一致 | Y | 1..∞ | 1..∞ | N/N | — | registry | `regexoption <option1> [<option2> ...]` | — |
| [`sprintf`](https://teratermproject.github.io/manual/5/en/macro/command/sprintf.html) | 一致 | Y | 1..∞ | 1..∞ | Y/Y | inputstr | static-eval | `sprintf FORMAT [ARGUMENT ...]` | 成功時 inputstr へ |
| [`sprintf2`](https://teratermproject.github.io/manual/5/en/macro/command/sprintf2.html) | 一致 | Y | 2..∞ | 2..∞ | Y/Y | #1s | static-eval | `sprintf2 strvar FORMAT [ARGUMENT ...]` | 第1引数へ出力 |
| [`str2code`](https://teratermproject.github.io/manual/5/en/macro/command/str2code.html) | 一致 | Y | 2..2 | 2..2 | N/N | #1i | static-eval | `str2code <intvar> <string>` | 整数出力。result 非設定 |
| [`str2int`](https://teratermproject.github.io/manual/5/en/macro/command/str2int.html) | 一致 | Y | 2..2 | 2..2 | Y/Y | #1i | static-eval | `str2int <intvar> <string>` | — |
| [`strcompare`](https://teratermproject.github.io/manual/5/en/macro/command/strcompare.html) | 一致 | Y | 2..2 | 2..2 | Y/Y | result | static-eval | `strcompare <string1> <string2>` | — |
| [`strconcat`](https://teratermproject.github.io/manual/5/en/macro/command/strconcat.html) | 一致 | Y | 2..2 | 2..2 | N/N | #1s | static-eval | `strconcat <strvar> <string>` | — |
| [`strcopy`](https://teratermproject.github.io/manual/5/en/macro/command/strcopy.html) | 一致 | Y | 4..4 | 4..4 | N/N | #4s | static-eval | `strcopy <string> <pos> <len> <strvar>` | — |
| [`strinsert`](https://teratermproject.github.io/manual/5/en/macro/command/strinsert.html) | 一致 | Y | 3..3 | 3..3 | N/N | #1s | static-eval | `strinsert <strvar> <index> <string>` | — |
| [`strjoin`](https://teratermproject.github.io/manual/5/en/macro/command/strjoin.html) | 一致 | Y | 2..3 | 2..3 | N/N | #1s | static-eval | `strjoin <strvar> <separator> [<count>]` | — |
| [`strlen`](https://teratermproject.github.io/manual/5/en/macro/command/strlen.html) | 一致 | Y | 1..1 | 1..1 | Y/Y | result | static-eval | `strlen <string>` | — |
| [`strmatch`](https://teratermproject.github.io/manual/5/en/macro/command/strmatch.html) | 一致 | Y | 2..2 | 2..2 | Y/Y | matchstr,groupmatchstr1,groupmatchstr2,groupmatchstr3,groupmatchstr4,groupmatchstr5,groupmatchstr6,groupmatchstr7,groupmatchstr8,groupmatchstr9 | registry | `strmatch <target string> <string with regular expression>` | — |
| [`strremove`](https://teratermproject.github.io/manual/5/en/macro/command/strremove.html) | 一致 | Y | 3..3 | 3..3 | N/N | #1s | static-eval | `strremove <strvar> <index> <len>` | — |
| [`strreplace`](https://teratermproject.github.io/manual/5/en/macro/command/strreplace.html) | 一致 | Y | 4..4 | 4..4 | Y/Y | #1s | static-eval | `strreplace <strvar> <index> <regex> <newstr>` | — |
| [`strscan`](https://teratermproject.github.io/manual/5/en/macro/command/strscan.html) | 一致 | Y | 2..2 | 2..2 | Y/Y | result | static-eval | `strscan <string> <substring>` | — |
| [`strspecial`](https://teratermproject.github.io/manual/5/en/macro/command/strspecial.html) | 一致 | Y | 1..2 | 1..2 | N/N | — | registry | `strspecial <strvar> [<strval>]` | — |
| [`strsplit`](https://teratermproject.github.io/manual/5/en/macro/command/strsplit.html) | 一致 | Y | 2..3 | 2..3 | Y/Y | groupmatchstr1,groupmatchstr2,groupmatchstr3,groupmatchstr4,groupmatchstr5,groupmatchstr6,groupmatchstr7,groupmatchstr8,groupmatchstr9 | static-eval | `strsplit <strval> <separator> [<count>]` | — |
| [`strtrim`](https://teratermproject.github.io/manual/5/en/macro/command/strtrim.html) | 一致 | Y | 2..2 | 2..2 | N/N | #1s | static-eval | `strtrim <strvar> <trimchars>` | — |
| [`tolower`](https://teratermproject.github.io/manual/5/en/macro/command/tolower.html) | 一致 | Y | 2..2 | 2..2 | N/N | #1s | static-eval | `tolower <strvar> <string>` | — |
| [`toupper`](https://teratermproject.github.io/manual/5/en/macro/command/toupper.html) | 一致 | Y | 2..2 | 2..2 | N/N | #1s | static-eval | `toupper <strvar> <string>` | — |

### File

| コマンド | 判定 | 登録 | 引数(app) | 引数(doc) | result A/D | 出力 | 深度 | SYNOPSIS | メモ |
|----------|------|------|-----------|-----------|------------|------|------|----------|------|
| [`basename`](https://teratermproject.github.io/manual/5/en/macro/command/basename.html) | 一致 | Y | 2..2 | 2..2 | N/N | #1s | static-eval | `basename <strvar> <path>` | — |
| [`dirname`](https://teratermproject.github.io/manual/5/en/macro/command/dirname.html) | 一致 | Y | 2..2 | 2..2 | N/N | #1s | static-eval | `dirname <strvar> <path>` | — |
| [`fileclose`](https://teratermproject.github.io/manual/5/en/macro/command/fileclose.html) | 一致 | Y | 1..1 | 1..1 | N/N | — | registry | `fileclose <file handle>` | — |
| [`fileconcat`](https://teratermproject.github.io/manual/5/en/macro/command/fileconcat.html) | 一致 | Y | 2..2 | 2..2 | Y/Y | result | registry | `fileconcat <file1> <file2>` | — |
| [`filecopy`](https://teratermproject.github.io/manual/5/en/macro/command/filecopy.html) | 一致 | Y | 2..2 | 2..2 | Y/Y | result | registry | `filecopy <file1> <file2>` | — |
| [`filecreate`](https://teratermproject.github.io/manual/5/en/macro/command/filecreate.html) | 一致 | Y | 2..2 | 2..2 | Y/Y | #1i | registry | `filecreate <file handle> <filename>` | — |
| [`filedelete`](https://teratermproject.github.io/manual/5/en/macro/command/filedelete.html) | 一致 | Y | 1..1 | 1..1 | Y/Y | result | registry | `filedelete <filename>` | — |
| [`filelock`](https://teratermproject.github.io/manual/5/en/macro/command/filelock.html) | 一致 | Y | 1..2 | 1..2 | Y/Y | result | registry | `filelock <file handle> [<timeout>]` | — |
| [`filemarkptr`](https://teratermproject.github.io/manual/5/en/macro/command/filemarkptr.html) | 一致 | Y | 1..1 | 1..1 | N/N | — | registry | `filemarkptr <file handle>` | — |
| [`fileopen`](https://teratermproject.github.io/manual/5/en/macro/command/fileopen.html) | 一致 | Y | 3..4 | 3..4 | N/N | #1i | registry | `fileopen <file handle> <filename> <append flag> [<readonly flag>]` | — |
| [`filereadln`](https://teratermproject.github.io/manual/5/en/macro/command/filereadln.html) | 一致 | Y | 2..2 | 2..2 | Y/Y | #2s | registry | `filereadln <file handle> <strvar>` | — |
| [`fileread`](https://teratermproject.github.io/manual/5/en/macro/command/fileread.html) | 一致 | Y | 3..3 | 3..3 | Y/Y | #3s | registry | `fileread <file handle> <read byte> <strvar>` | — |
| [`filerename`](https://teratermproject.github.io/manual/5/en/macro/command/filerename.html) | 一致 | Y | 2..2 | 2..2 | Y/Y | result | registry | `filerename <file1> <file2>` | — |
| [`filesearch`](https://teratermproject.github.io/manual/5/en/macro/command/filesearch.html) | 一致 | Y | 1..1 | 1..1 | Y/Y | result | registry | `filesearch <filename>` | — |
| [`fileseek`](https://teratermproject.github.io/manual/5/en/macro/command/fileseek.html) | 一致 | Y | 3..3 | 3..3 | N/N | — | registry | `fileseek <file handle> <offset> <origin>` | — |
| [`fileseekback`](https://teratermproject.github.io/manual/5/en/macro/command/fileseekback.html) | 一致 | Y | 1..1 | 1..1 | N/N | — | registry | `fileseekback <file handle>` | — |
| [`filestat`](https://teratermproject.github.io/manual/5/en/macro/command/filestat.html) | 一致 | Y | 2..4 | 2..4 | Y/Y | #2i,#3s,#4s | registry | `filestat <filename> <size> [<mtime>] [<drive>]` | — |
| [`filestrseek`](https://teratermproject.github.io/manual/5/en/macro/command/filestrseek.html) | 一致 | Y | 2..2 | 2..2 | Y/Y | result | registry | `filestrseek <file handle> <string>` | — |
| [`filestrseek2`](https://teratermproject.github.io/manual/5/en/macro/command/filestrseek2.html) | 一致 | Y | 2..2 | 2..2 | Y/Y | result | registry | `filestrseek2 <file handle> <string>` | — |
| [`filetruncate`](https://teratermproject.github.io/manual/5/en/macro/command/filetruncate.html) | 一致 | Y | 2..2 | 2..2 | Y/Y | result | registry | `filetruncate <filename> <size>` | — |
| [`fileunlock`](https://teratermproject.github.io/manual/5/en/macro/command/fileunlock.html) | 一致 | Y | 1..1 | 1..1 | Y/Y | result | registry | `fileunlock <file handle>` | — |
| [`filewrite`](https://teratermproject.github.io/manual/5/en/macro/command/filewrite.html) | 一致 | Y | 2..2 | 2..2 | N/N | — | registry | `filewrite <file handle> <data>` | — |
| [`filewriteln`](https://teratermproject.github.io/manual/5/en/macro/command/filewriteln.html) | 一致 | Y | 2..2 | 2..2 | N/N | — | registry | `filewriteln <file handle> <data>` | — |
| [`foldercreate`](https://teratermproject.github.io/manual/5/en/macro/command/foldercreate.html) | 一致 | Y | 1..1 | 1..1 | Y/Y | result | registry | `foldercreate <foldername>` | — |
| [`folderdelete`](https://teratermproject.github.io/manual/5/en/macro/command/folderdelete.html) | 一致 | Y | 1..1 | 1..1 | Y/Y | result | registry | `folderdelete <foldername>` | — |
| [`foldersearch`](https://teratermproject.github.io/manual/5/en/macro/command/foldersearch.html) | 一致 | Y | 1..1 | 1..1 | Y/Y | result | registry | `foldersearch <foldername>` | — |
| [`getdir`](https://teratermproject.github.io/manual/5/en/macro/command/getdir.html) | 一致 | Y | 1..1 | 1..1 | N/N | #1s | registry | `getdir <strvar>` | — |
| [`getfileattr`](https://teratermproject.github.io/manual/5/en/macro/command/getfileattr.html) | 一致 | Y | 1..1 | 1..1 | Y/Y | result | registry | `getfileattr <filename>` | — |
| [`makepath`](https://teratermproject.github.io/manual/5/en/macro/command/makepath.html) | 一致 | Y | 3..3 | 3..3 | N/N | #1s | static-eval | `makepath <strvar> <dir> <name>` | — |
| [`setdir`](https://teratermproject.github.io/manual/5/en/macro/command/setdir.html) | 一致 | Y | 1..1 | 1..1 | N/N | — | registry | `setdir <dir>` | — |
| [`setfileattr`](https://teratermproject.github.io/manual/5/en/macro/command/setfileattr.html) | 一致 | Y | 2..2 | 2..2 | Y/Y | result | registry | `setfileattr <filename> <attributes>` | — |
| [`findfirst`](https://teratermproject.github.io/manual/5/en/macro/command/findoperations.html) | 一致 | Y | 3..3 | 3..3 | Y/Y | #1i,#3s | registry | `findfirst <dir handle> <file name> <strvar>` | — |
| [`findnext`](https://teratermproject.github.io/manual/5/en/macro/command/findoperations.html) | 一致 | Y | 2..2 | 2..2 | Y/Y | #2s | registry | `findnext <dir handle> <strvar>` | — |
| [`findclose`](https://teratermproject.github.io/manual/5/en/macro/command/findoperations.html) | 一致 | Y | 1..1 | 1..1 | N/N | — | registry | `findclose <dir handle>` | findfirst/next とページ共有。result は findfirst/next |

### Password

| コマンド | 判定 | 登録 | 引数(app) | 引数(doc) | result A/D | 出力 | 深度 | SYNOPSIS | メモ |
|----------|------|------|-----------|-----------|------------|------|------|----------|------|
| [`delpassword`](https://teratermproject.github.io/manual/5/en/macro/command/delpassword.html) | 一致 | Y | 2..2 | 2..2 | N/N | — | registry | `delpassword <filename> <password name>` | — |
| [`delpassword2`](https://teratermproject.github.io/manual/5/en/macro/command/delpassword2.html) | 一致 | Y | 2..2 | 2..2 | N/N | — | registry | `delpassword2 <filename> <password name>` | — |
| [`getpassword`](https://teratermproject.github.io/manual/5/en/macro/command/getpassword.html) | 一致 | Y | 3..3 | 3..3 | Y/Y | #3s | registry | `getpassword <filename> <password name> <password var>` | — |
| [`getpassword2`](https://teratermproject.github.io/manual/5/en/macro/command/getpassword2.html) | 一致 | Y | 4..4 | 4..4 | Y/Y | #4s | registry | `getpassword2 <filename> <password name> <password var> <encrypt str>` | — |
| [`ispassword`](https://teratermproject.github.io/manual/5/en/macro/command/ispassword.html) | 一致 | Y | 2..2 | 2..2 | Y/Y | result | registry | `ispassword <filename> <password name>` | — |
| [`ispassword2`](https://teratermproject.github.io/manual/5/en/macro/command/ispassword2.html) | 一致 | Y | 2..2 | 2..2 | Y/Y | result | registry | `ispassword2 <filename> <password name>` | — |
| [`passwordbox`](https://teratermproject.github.io/manual/5/en/macro/command/passwordbox.html) | 一致 | Y | 2..3 | 2..3 | N/N | inputstr | dialog | `passwordbox <message> <title> [<special>]` | inputstr 設定。result 非設定 |
| [`setpassword`](https://teratermproject.github.io/manual/5/en/macro/command/setpassword.html) | 一致 | Y | 3..3 | 3..3 | Y/Y | result | registry | `setpassword <filename> <password name> <password>` | — |
| [`setpassword2`](https://teratermproject.github.io/manual/5/en/macro/command/setpassword2.html) | 一致 | Y | 4..4 | 4..4 | Y/Y | result | registry | `setpassword2 <filename> <password name> <password> <encrypt str>` | — |

### Miscellaneous

| コマンド | 判定 | 登録 | 引数(app) | 引数(doc) | result A/D | 出力 | 深度 | SYNOPSIS | メモ |
|----------|------|------|-----------|-----------|------------|------|------|----------|------|
| [`beep`](https://teratermproject.github.io/manual/5/en/macro/command/beep.html) | 一致 | Y | 0..1 | 0..1 | N/N | — | registry | `beep [<sound type>]` | — |
| [`bringupbox`](https://teratermproject.github.io/manual/5/en/macro/command/bringupbox.html) | 一致 | Y | 0..0 | 0..0 | N/N | — | registry | `bringupbox` | — |
| [`closesbox`](https://teratermproject.github.io/manual/5/en/macro/command/closesbox.html) | 一致 | Y | 0..0 | 0..0 | N/N | — | registry | `closesbox` | — |
| [`clipb2var`](https://teratermproject.github.io/manual/5/en/macro/command/clipb2var.html) | 一致 | Y | 1..2 | 1..2 | Y/Y | #1s | registry | `clipb2var <strvar> [<offset>]` | 任意 offset 対応済み |
| [`exec`](https://teratermproject.github.io/manual/5/en/macro/command/exec.html) | 一致 | Y | 1..4 | 1..4 | Y/Y | result | registry | `exec <command line> [<show> [<wait> [<current directory>]]]` | — |
| [`dirnamebox`](https://teratermproject.github.io/manual/5/en/macro/command/dirnamebox.html) | 一致 | Y | 1..2 | 1..2 | Y/Y | inputstr | dialog | `dirnamebox <title> [<initialdir>]` | — |
| [`filenamebox`](https://teratermproject.github.io/manual/5/en/macro/command/filenamebox.html) | 一致 | Y | 1..3 | 1..3 | Y/Y | inputstr | dialog | `filenamebox <title> [<dialogtype> [<initialdir>]]` | — |
| [`getdate`](https://teratermproject.github.io/manual/5/en/macro/command/getdate.html) | 一致 | Y | 1..3 | 1..3 | Y/Y | #1s | static-eval | `getdate <strvar> [<format> [<timezone>]]` | — |
| [`getenv`](https://teratermproject.github.io/manual/5/en/macro/command/getenv.html) | 一致 | Y | 2..2 | 2..2 | N/N | #2s | registry | `getenv <envname> <strvar>` | — |
| [`getipv4addr`](https://teratermproject.github.io/manual/5/en/macro/command/getipv4addr.html) | 一致 | Y | 2..2 | 2..2 | Y/Y | #2i | registry | `getipv4addr <string array> <intvar>` | — |
| [`getipv6addr`](https://teratermproject.github.io/manual/5/en/macro/command/getipv6addr.html) | 一致 | Y | 2..2 | 2..2 | Y/Y | #2i | registry | `getipv6addr <string array> <intvar>` | — |
| [`getspecialfolder`](https://teratermproject.github.io/manual/5/en/macro/command/getspecialfolder.html) | 一致 | Y | 2..2 | 2..2 | Y/Y | #1s | registry | `getspecialfolder <strvar> <foldertype>` | — |
| [`gettime`](https://teratermproject.github.io/manual/5/en/macro/command/gettime.html) | 一致 | Y | 1..3 | 1..3 | Y/Y | #1s | static-eval | `gettime <strvar> [<format> [<timezone>]]` | — |
| [`getttdir`](https://teratermproject.github.io/manual/5/en/macro/command/getttdir.html) | 一致 | Y | 1..1 | 1..1 | Y/Y | #1s | registry | `getttdir <strvar>` | — |
| [`getver`](https://teratermproject.github.io/manual/5/en/macro/command/getver.html) | 意図的差分 | Y | 1..2 | 1..2 | Y/Y | #1s | registry | `getver <strvar> [<version>]` | 比較引数があるときのみ result |
| [`ifdefined`](https://teratermproject.github.io/manual/5/en/macro/command/ifdefined.html) | 一致 | Y | 1..1 | 1..1 | Y/Y | result | static-eval | `ifdefined <var>` | — |
| [`inputbox`](https://teratermproject.github.io/manual/5/en/macro/command/inputbox.html) | 一致 | Y | 2..4 | 2..4 | N/N | inputstr | dialog | `inputbox <message> <title> [<default> [<special>]]` | inputstr 設定。result 非設定 |
| [`intdim`](https://teratermproject.github.io/manual/5/en/macro/command/intdim.html) | 一致 | Y | 2..2 | 2..2 | N/N | — | registry | `intdim <array> <size>` | — |
| [`listbox`](https://teratermproject.github.io/manual/5/en/macro/command/listbox.html) | 一致 | Y | 3..∞ | 3..∞ | Y/Y | result | dialog | `listbox <message> <title> <string array> [<selected>] [<keyword parameter>...]` | — |
| [`messagebox`](https://teratermproject.github.io/manual/5/en/macro/command/messagebox.html) | 意図的差分 | Y | 2..3 | 2..3 | N/N | — | dialog | `messagebox <message> <title> [<special>]` | 公式は result 非設定 |
| [`random`](https://teratermproject.github.io/manual/5/en/macro/command/random.html) | 一致 | Y | 2..2 | 2..2 | N/N | #1i | registry | `random <integer variable> <max number>` | — |
| [`rotateleft`](https://teratermproject.github.io/manual/5/en/macro/command/rotateleft.html) | 一致 | Y | 3..3 | 3..3 | N/N | #1i | registry | `rotateleft <intvar> <intval> <count>` | — |
| [`rotateright`](https://teratermproject.github.io/manual/5/en/macro/command/rotateright.html) | 一致 | Y | 3..3 | 3..3 | N/N | #1i | registry | `rotateright <intvar> <intval> <count>` | — |
| [`setdate`](https://teratermproject.github.io/manual/5/en/macro/command/setdate.html) | 一致 | Y | 1..1 | 1..1 | N/N | — | registry | `setdate <date>` | — |
| [`setdlgpos`](https://teratermproject.github.io/manual/5/en/macro/command/setdlgpos.html) | 一致 | Y | 0..5 | 0..5 | N/N | — | registry | `setdlgpos [<x> <y> [<position> [<offset x> <offset y>]]]` | — |
| [`setenv`](https://teratermproject.github.io/manual/5/en/macro/command/setenv.html) | 一致 | Y | 2..2 | 2..2 | N/N | — | registry | `setenv <envname> <strval>` | — |
| [`setexitcode`](https://teratermproject.github.io/manual/5/en/macro/command/setexitcode.html) | 一致 | Y | 1..1 | 1..1 | N/N | — | registry | `setexitcode <exit code>` | — |
| [`settime`](https://teratermproject.github.io/manual/5/en/macro/command/settime.html) | 一致 | Y | 1..1 | 1..1 | N/N | — | registry | `settime <time>` | — |
| [`show`](https://teratermproject.github.io/manual/5/en/macro/command/show.html) | 一致 | Y | 1..1 | 1..1 | N/N | — | registry | `show <show flag>` | — |
| [`statusbox`](https://teratermproject.github.io/manual/5/en/macro/command/statusbox.html) | 一致 | Y | 2..3 | 2..3 | N/N | — | dialog | `statusbox <message> <title> [<special>]` | 公式は result 非設定 |
| [`strdim`](https://teratermproject.github.io/manual/5/en/macro/command/strdim.html) | 一致 | Y | 2..2 | 2..2 | N/N | — | registry | `strdim <array> <size>` | — |
| [`uptime`](https://teratermproject.github.io/manual/5/en/macro/command/uptime.html) | 一致 | Y | 1..1 | 1..1 | N/N | #1i | registry | `uptime <intvar>` | — |
| [`var2clipb`](https://teratermproject.github.io/manual/5/en/macro/command/var2clipb.html) | 一致 | Y | 1..1 | 1..1 | Y/Y | result | registry | `var2clipb <string>` | — |
| [`yesnobox`](https://teratermproject.github.io/manual/5/en/macro/command/yesnobox.html) | 一致 | Y | 2..3 | 2..3 | Y/Y | result | dialog | `yesnobox <message> <title> [<special>]` | — |
| [`checksum8`](https://teratermproject.github.io/manual/5/en/macro/command/checksum8.html) | 一致 | Y | 2..2 | 2..2 | N/N | #1i | static-eval | `checksum8 <intvar> <string>` | 文字列版は result 非設定。file 版のみ -1 |
| [`checksum8file`](https://teratermproject.github.io/manual/5/en/macro/command/checksum8.html) | 一致 | Y | 2..2 | 2..2 | Y/Y | #1i | registry | `checksum8file <intvar> <filename>` | — |
| [`checksum16`](https://teratermproject.github.io/manual/5/en/macro/command/checksum16.html) | 一致 | Y | 2..2 | 2..2 | N/N | #1i | static-eval | `checksum16 <intvar> <string>` | 同上（file 版のみ result） |
| [`checksum16file`](https://teratermproject.github.io/manual/5/en/macro/command/checksum16.html) | 一致 | Y | 2..2 | 2..2 | Y/Y | #1i | registry | `checksum16file <intvar> <filename>` | — |
| [`checksum32`](https://teratermproject.github.io/manual/5/en/macro/command/checksum32.html) | 一致 | Y | 2..2 | 2..2 | N/N | #1i | static-eval | `checksum32 <intvar> <string>` | 同上 |
| [`checksum32file`](https://teratermproject.github.io/manual/5/en/macro/command/checksum32.html) | 一致 | Y | 2..2 | 2..2 | Y/Y | #1i | registry | `checksum32file <intvar> <filename>` | — |
| [`crc16`](https://teratermproject.github.io/manual/5/en/macro/command/crc16.html) | 一致 | Y | 2..2 | 2..2 | N/N | #1i | static-eval | `crc16 <intvar> <string>` | 同上 |
| [`crc16file`](https://teratermproject.github.io/manual/5/en/macro/command/crc16.html) | 一致 | Y | 2..2 | 2..2 | Y/Y | #1i | registry | `crc16file <intvar> <filename>` | — |
| [`crc32`](https://teratermproject.github.io/manual/5/en/macro/command/crc32.html) | 一致 | Y | 2..2 | 2..2 | N/N | #1i | static-eval | `crc32 <intvar> <string>` | 同上 |
| [`crc32file`](https://teratermproject.github.io/manual/5/en/macro/command/crc32.html) | 一致 | Y | 2..2 | 2..2 | Y/Y | #1i | registry | `crc32file <intvar> <filename>` | — |

## カテゴリ所見

### Communication
connect/wait/log/転送系は登録と result ヒントが揃っている。実接続・受信はドライラン簡略。send 系は送信データに反映。`send`/`sendln` 等は公式 SYNOPSIS が `<data1> <data2>....` 表記でも、アプリは 0 引数を許可（空送信）。

### Control
if/for/while/do/goto/call/include はセマンティクス実装あり。for の負数定数は公式 appendix に合わせて式単位消費。

### String
主要コマンドは静的評価または sprintf 実装あり。strlen/strcompare/strscan 等の result は META 済み。

### File
引数・result・ハンドル/文字列出力スロットをレジストリで表現。実ファイル I/O は実行時依存としてプレースホルダ。

### Password
get/set/is password(2) の result と出力スロットを登録。実パスワードファイルは扱わない。

### Miscellaneous
ダイアログ・checksum/crc・日時・sprintf・clipb 等。checksum/crc の文字列版は result 非設定、file 版のみ META（公式どおり）。

## 再生成手順

```bash
npx tsx scripts/audit-ttl-commands.ts          # → ttl-command-spec-audit-raw.md + cache
npx tsx scripts/audit-ttl-commands-final.ts    # → ttl-command-spec-audit.md
npx tsx scripts/audit-ttl-semantics.ts         # → ttl-command-semantics-audit.md
```

## 関連

- [ttl-command-semantics-audit.md](./ttl-command-semantics-audit.md)
- [system-variable-result-audit.md](./system-variable-result-audit.md)
- [Note on negative integer constants](https://teratermproject.github.io/manual/5/en/macro/appendixes/negative.html)