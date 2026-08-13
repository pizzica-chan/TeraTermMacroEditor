# TTL コマンド仕様取り込み — 厳密監査（静的解析・ドライラン含む）

- **調査日**: 2026-08-13
- **公式基準**: [Manual 5 英語版](https://teratermproject.github.io/manual/5/en/macro/command/index.html)
- **日本語目次**: [コマンドリファレンス](https://teratermproject.github.io/manual/5/ja/macro/command/index.html)
- **対象レイヤ**: レジストリ / `analyzer` / `staticCommandEval` / `evaluator` / `dryRun`
- **関連**: [ttl-command-spec-audit.md](./ttl-command-spec-audit.md)（レジストリ突合）、[system-variable-result-audit.md](./system-variable-result-audit.md)

## 1. 判定基準（厳密）

| 判定 | 意味 |
|------|------|
| **仕様相当（実装）** | 制御・静的評価・送信記録・待機/ダイアログDR など、エディタが公式セマンティクスを解釈・計算している |
| **仕様相当（プレースホルダ）** | 登録・引数・result/出力スロットは公式どおり。実 I/O は `dialog-result` プレースホルダ（設計どおり・未確定扱い） |
| **意図的差分** | 公式と異なるが、エディタ方針として明示された差（空 send 許可、別名など） |
| **不足** | エディタ用途上、実装・連携が足りない（送信未記録、静的評価可能なのに未実装、DR専用漏れなど） |
| **構文要素** | 単独コマンドではない（`then`） |

**「仕様相当（プレースホルダ）」は未実装バグではない。** 本エディタは Tera Term 実体を動かさないため、ファイル/通信の実結果は静的に断定しない（`system-variable-result-audit.md`）。

**「不足」は「公式ページ未読」ではなく、取り込みギャップ**である。優先度はプロダクト判断。

## 2. サマリー

| 判定 | 件数 |
|------|------|
| 仕様相当（実装） | 79 |
| 仕様相当（プレースホルダ） | 120 |
| 意図的差分 | 2 |
| 不足 | 7 |
| 構文要素 | 1 |
| 合計行 | 209 |
| EXTRA (`strlength`) | 1 |

### 結論（厳密読み）

**全コマンドが仕様どおり取り込まれているとは言えない。** 不足 7 件（主に送信系のパネル未連携・決定的コマンドの静的評価欠落・一部待機/ダイアログのDR専用漏れ）。レジストリ上の登録漏れはなし。

## 3. 不足一覧（要対応候補）

| コマンド | カテゴリ | ギャップ |
|----------|----------|----------|
| [`dispstr`](https://teratermproject.github.io/manual/5/en/macro/command/dispstr.html) | Communication | 送信系だが sendEntries/ドライラン送信イベント未記録（send/sendln のみ対応）; クライアント表示系だが送信パネル未連携（ホスト送信ではない） |
| [`sendfile`](https://teratermproject.github.io/manual/5/en/macro/command/sendfile.html) | Communication | 送信系だが sendEntries/ドライラン送信イベント未記録（send/sendln のみ対応）; ホスト送信に関与しうるが送信パネル未連携 |
| [`sendkcode`](https://teratermproject.github.io/manual/5/en/macro/command/sendkcode.html) | Communication | 送信系だが sendEntries/ドライラン送信イベント未記録（send/sendln のみ対応）; ホスト送信に関与しうるが送信パネル未連携 |
| [`waitevent`](https://teratermproject.github.io/manual/5/en/macro/command/waitevent.html) | Communication | 待機系だが WAIT_COMMANDS 専用シミュ外（汎用 effect / flow のみ） |
| [`waitn`](https://teratermproject.github.io/manual/5/en/macro/command/waitn.html) | Communication | 待機系だが WAIT_COMMANDS 専用シミュ外（汎用 effect / flow のみ） |
| [`strmatch`](https://teratermproject.github.io/manual/5/en/macro/command/strmatch.html) | String | 決定的計算が可能だが staticCommandEval 未実装（引数既知でもプレースホルダ） |
| [`statusbox`](https://teratermproject.github.io/manual/5/en/macro/command/statusbox.html) | Miscellaneous | ダイアログ表示系だが dryRun の DIALOG_COMMANDS 外（専用UIなし） |

### 不足の分類

1. **送信パネル未連携**: `dispstr` / `sendfile` / `sendkcode`（ホスト向け送信系のうち未記録）
2. **静的評価ギャップ**: `strspecial` / `strmatch` / `rotateleft` / `rotateright` — 引数既知なら本家同様に計算可能なのにプレースホルダ止まり。
3. **ドライラン専用の薄い待機**: `waitn` / `waitevent` は汎用 effect のみ（`wait` 系のような受信シミュレーションなし）。
4. **statusbox**: ダイアログ表示だが `DIALOG_COMMANDS` 外。

## 4. 意図的差分

| コマンド | 内容 |
|----------|------|
| `send` | 公式 SYNOPSIS は data 必須相当だが、アプリは 0 引数（空送信）を許可 |
| `sendbinary` | 引数 min=0（空許可） |
| `sendbroadcast` | 引数 min=0 |
| `sendln` | 同上（空 sendln 許可） |
| `sendlnbroadcast` | 引数 min=0 |
| `sendtext` | 引数 min=0 |
| `for` | 負数定数は公式 appendix どおり式単位消費（実装済） |
| `if` | 引数仕様は条件式を 1 と数える（then 以降は別構文） |
| `elseif` | 条件式を 1 引数として扱う |
| `until` | 条件式を 1 引数として扱う |
| `while` | 条件式を 1 引数として扱う |
| `findclose` | result 非設定（findfirst/next のみ） |
| `getver` | 比較引数なし時は result を変更しない（公式どおり META 注記） |
| `messagebox` | 公式は result 非設定。ドライランのみ UI 応答で result を更新し得る |
| `statusbox` | ダイアログ系だがドライラン専用UIなし（closesbox と対） |
| `checksum8` | 文字列版は result 非設定（公式）。静的評価あり |
| `checksum16` | 文字列版は result 非設定 |
| `checksum32` | 文字列版は result 非設定 |
| `crc16` | 文字列版は result 非設定 |
| `crc32` | 文字列版は result 非設定 |

## 5. レイヤ別カバレッジ

| レイヤ | 件数 | 内容 |
|--------|------|------|
| control | 23 | if/for/while/goto/call/include 等 |
| static-eval | 31 | 引数既知で実値計算 |
| send-recorded | 8 | 送信データパネル |
| dryrun-wait | 4 | wait 系シミュレーション |
| dryrun-dialog | 7 | ダイアログ UI |
| dryrun-datetime | 2 | gettime/getdate 実時刻 |
| dryrun-recv | 2 | recvln/waitrecv |
| dryrun-flow | 6 | connect 等のフローログ |
| registry-placeholder | 127 | 登録＋プレースホルダのみ |

## 6. コマンド別詳細（全件）

### Communication

| コマンド | 判定 | 引数 | result | レイヤ | ギャップ / メモ |
|----------|------|------|--------|--------|----------------|
| [`bplusrecv`](https://teratermproject.github.io/manual/5/en/macro/command/bplusrecv.html) | 仕様相当（プレースホルダ） | 0..0 | Y | registry-placeholder | — |
| [`bplussend`](https://teratermproject.github.io/manual/5/en/macro/command/bplussend.html) | 仕様相当（プレースホルダ） | 1..1 | Y | registry-placeholder | — |
| [`callmenu`](https://teratermproject.github.io/manual/5/en/macro/command/callmenu.html) | 仕様相当（プレースホルダ） | 1..1 | N | registry-placeholder | — |
| [`changedir`](https://teratermproject.github.io/manual/5/en/macro/command/changedir.html) | 仕様相当（プレースホルダ） | 1..1 | N | registry-placeholder | — |
| [`clearscreen`](https://teratermproject.github.io/manual/5/en/macro/command/clearscreen.html) | 仕様相当（プレースホルダ） | 1..1 | N | registry-placeholder | — |
| [`closett`](https://teratermproject.github.io/manual/5/en/macro/command/closett.html) | 仕様相当（プレースホルダ） | 0..0 | N | registry-placeholder | — |
| [`connect`](https://teratermproject.github.io/manual/5/en/macro/command/connect.html) | 仕様相当（実装） | 1..1 | Y | dryrun-flow | — |
| [`cygconnect`](https://teratermproject.github.io/manual/5/en/macro/command/cygconnect.html) | 仕様相当（プレースホルダ） | 0..1 | Y | registry-placeholder | — |
| [`disconnect`](https://teratermproject.github.io/manual/5/en/macro/command/disconnect.html) | 仕様相当（実装） | 0..1 | N | dryrun-flow | — |
| [`dispstr`](https://teratermproject.github.io/manual/5/en/macro/command/dispstr.html) | 不足 | 1..∞ | N | registry-placeholder | 送信系だが sendEntries/ドライラン送信イベント未記録（send/sendln のみ対応）; クライアント表示系だが送信パネル未連携（ホスト送信ではない） |
| [`enablekeyb`](https://teratermproject.github.io/manual/5/en/macro/command/enablekeyb.html) | 仕様相当（プレースホルダ） | 1..1 | N | registry-placeholder | — |
| [`flushrecv`](https://teratermproject.github.io/manual/5/en/macro/command/flushrecv.html) | 仕様相当（実装） | 0..0 | N | dryrun-flow | — |
| [`gethostname`](https://teratermproject.github.io/manual/5/en/macro/command/gethostname.html) | 仕様相当（プレースホルダ） | 1..1 | N | registry-placeholder | — |
| [`getmodemstatus`](https://teratermproject.github.io/manual/5/en/macro/command/getmodemstatus.html) | 仕様相当（プレースホルダ） | 1..1 | Y | registry-placeholder | — |
| [`gettitle`](https://teratermproject.github.io/manual/5/en/macro/command/gettitle.html) | 仕様相当（プレースホルダ） | 1..1 | N | registry-placeholder | — |
| [`getttpos`](https://teratermproject.github.io/manual/5/en/macro/command/getttpos.html) | 仕様相当（プレースホルダ） | 9..9 | Y | registry-placeholder | — |
| [`kmtfinish`](https://teratermproject.github.io/manual/5/en/macro/command/kmtfinish.html) | 仕様相当（プレースホルダ） | 0..0 | Y | registry-placeholder | — |
| [`kmtget`](https://teratermproject.github.io/manual/5/en/macro/command/kmtget.html) | 仕様相当（プレースホルダ） | 1..1 | Y | registry-placeholder | — |
| [`kmtrecv`](https://teratermproject.github.io/manual/5/en/macro/command/kmtrecv.html) | 仕様相当（プレースホルダ） | 0..0 | Y | registry-placeholder | — |
| [`kmtsend`](https://teratermproject.github.io/manual/5/en/macro/command/kmtsend.html) | 仕様相当（プレースホルダ） | 1..1 | Y | registry-placeholder | — |
| [`loadkeymap`](https://teratermproject.github.io/manual/5/en/macro/command/loadkeymap.html) | 仕様相当（プレースホルダ） | 1..1 | N | registry-placeholder | — |
| [`logautoclosemode`](https://teratermproject.github.io/manual/5/en/macro/command/logautoclosemode.html) | 仕様相当（プレースホルダ） | 1..1 | N | registry-placeholder | — |
| [`logclose`](https://teratermproject.github.io/manual/5/en/macro/command/logclose.html) | 仕様相当（プレースホルダ） | 0..0 | N | registry-placeholder | — |
| [`loginfo`](https://teratermproject.github.io/manual/5/en/macro/command/loginfo.html) | 仕様相当（プレースホルダ） | 1..1 | Y | registry-placeholder | — |
| [`logopen`](https://teratermproject.github.io/manual/5/en/macro/command/logopen.html) | 仕様相当（プレースホルダ） | 3..7 | Y | registry-placeholder | — |
| [`logpause`](https://teratermproject.github.io/manual/5/en/macro/command/logpause.html) | 仕様相当（プレースホルダ） | 0..0 | N | registry-placeholder | — |
| [`logrotate`](https://teratermproject.github.io/manual/5/en/macro/command/logrotate.html) | 仕様相当（プレースホルダ） | 1..2 | N | registry-placeholder | — |
| [`logstart`](https://teratermproject.github.io/manual/5/en/macro/command/logstart.html) | 仕様相当（プレースホルダ） | 0..0 | N | registry-placeholder | — |
| [`logwrite`](https://teratermproject.github.io/manual/5/en/macro/command/logwrite.html) | 仕様相当（プレースホルダ） | 1..1 | N | registry-placeholder | — |
| [`quickvanrecv`](https://teratermproject.github.io/manual/5/en/macro/command/quickvanrecv.html) | 仕様相当（プレースホルダ） | 0..0 | Y | registry-placeholder | — |
| [`quickvansend`](https://teratermproject.github.io/manual/5/en/macro/command/quickvansend.html) | 仕様相当（プレースホルダ） | 1..1 | Y | registry-placeholder | — |
| [`recvln`](https://teratermproject.github.io/manual/5/en/macro/command/recvln.html) | 仕様相当（実装） | 0..0 | Y | dryrun-recv | — |
| [`recvfile`](https://teratermproject.github.io/manual/5/en/macro/command/recvfile.html) | 仕様相当（プレースホルダ） | 3..3 | Y | registry-placeholder | — |
| [`restoresetup`](https://teratermproject.github.io/manual/5/en/macro/command/restoresetup.html) | 仕様相当（プレースホルダ） | 1..1 | N | registry-placeholder | — |
| [`scprecv`](https://teratermproject.github.io/manual/5/en/macro/command/scprecv.html) | 仕様相当（プレースホルダ） | 1..2 | N | registry-placeholder | — |
| [`scpsend`](https://teratermproject.github.io/manual/5/en/macro/command/scpsend.html) | 仕様相当（プレースホルダ） | 1..2 | N | registry-placeholder | — |
| [`send`](https://teratermproject.github.io/manual/5/en/macro/command/send.html) | 意図的差分 | 0..∞ | N | send-recorded | 引数緩和: app min=0 < doc≈3（空引数許可など）; 公式 SYNOPSIS は data 必須相当だが、アプリは 0 引数（空送信）を許可 |
| [`sendbinary`](https://teratermproject.github.io/manual/5/en/macro/command/sendbinary.html) | 仕様相当（実装） | 0..∞ | N | send-recorded | 引数緩和: app min=0 < doc≈3（空引数許可など）; 引数 min=0（空許可） |
| [`sendbreak`](https://teratermproject.github.io/manual/5/en/macro/command/sendbreak.html) | 仕様相当（実装） | 0..0 | N | dryrun-flow | — |
| [`sendbroadcast`](https://teratermproject.github.io/manual/5/en/macro/command/sendbroadcast.html) | 仕様相当（実装） | 0..∞ | N | send-recorded | 引数緩和: app min=0 < doc≈3（空引数許可など）; 引数 min=0 |
| [`sendfile`](https://teratermproject.github.io/manual/5/en/macro/command/sendfile.html) | 不足 | 2..2 | N | registry-placeholder | 送信系だが sendEntries/ドライラン送信イベント未記録（send/sendln のみ対応）; ホスト送信に関与しうるが送信パネル未連携 |
| [`sendkcode`](https://teratermproject.github.io/manual/5/en/macro/command/sendkcode.html) | 不足 | 2..2 | N | registry-placeholder | 送信系だが sendEntries/ドライラン送信イベント未記録（send/sendln のみ対応）; ホスト送信に関与しうるが送信パネル未連携 |
| [`sendln`](https://teratermproject.github.io/manual/5/en/macro/command/sendln.html) | 意図的差分 | 0..∞ | N | send-recorded | 引数緩和: app min=0 < doc≈3（空引数許可など）; 同上（空 sendln 許可） |
| [`sendlnbroadcast`](https://teratermproject.github.io/manual/5/en/macro/command/sendlnbroadcast.html) | 仕様相当（実装） | 0..∞ | N | send-recorded | 引数緩和: app min=0 < doc≈3（空引数許可など）; 引数 min=0 |
| [`sendlnmulticast`](https://teratermproject.github.io/manual/5/en/macro/command/sendlnmulticast.html) | 仕様相当（実装） | 1..∞ | N | send-recorded | 引数緩和: app min=1 < doc≈4（空引数許可など） |
| [`sendtext`](https://teratermproject.github.io/manual/5/en/macro/command/sendtext.html) | 仕様相当（実装） | 0..∞ | N | send-recorded | 引数緩和: app min=0 < doc≈3（空引数許可など）; 引数 min=0 |
| [`sendmulticast`](https://teratermproject.github.io/manual/5/en/macro/command/sendmulticast.html) | 仕様相当（実装） | 1..∞ | N | send-recorded | 引数緩和: app min=1 < doc≈4（空引数許可など） |
| [`setbaud`](https://teratermproject.github.io/manual/5/en/macro/command/setbaud.html) | 仕様相当（プレースホルダ） | 1..1 | N | registry-placeholder | — |
| [`setdebug`](https://teratermproject.github.io/manual/5/en/macro/command/setdebug.html) | 仕様相当（プレースホルダ） | 1..1 | N | registry-placeholder | — |
| [`setdtr`](https://teratermproject.github.io/manual/5/en/macro/command/setdtr.html) | 仕様相当（プレースホルダ） | 1..1 | N | registry-placeholder | — |
| [`setecho`](https://teratermproject.github.io/manual/5/en/macro/command/setecho.html) | 仕様相当（プレースホルダ） | 1..1 | N | registry-placeholder | — |
| [`setflowctrl`](https://teratermproject.github.io/manual/5/en/macro/command/setflowctrl.html) | 仕様相当（プレースホルダ） | 1..1 | N | registry-placeholder | — |
| [`setmulticastname`](https://teratermproject.github.io/manual/5/en/macro/command/setmulticastname.html) | 仕様相当（プレースホルダ） | 1..1 | N | registry-placeholder | — |
| [`setrts`](https://teratermproject.github.io/manual/5/en/macro/command/setrts.html) | 仕様相当（プレースホルダ） | 1..1 | N | registry-placeholder | — |
| [`setserialdelaychar`](https://teratermproject.github.io/manual/5/en/macro/command/setserialdelaychar.html) | 仕様相当（プレースホルダ） | 1..1 | N | registry-placeholder | — |
| [`setserialdelayline`](https://teratermproject.github.io/manual/5/en/macro/command/setserialdelayline.html) | 仕様相当（プレースホルダ） | 1..1 | N | registry-placeholder | — |
| [`setspeed`](https://teratermproject.github.io/manual/5/en/macro/command/setspeed.html) | 仕様相当（プレースホルダ） | 1..1 | N | registry-placeholder | — |
| [`setsync`](https://teratermproject.github.io/manual/5/en/macro/command/setsync.html) | 仕様相当（プレースホルダ） | 1..1 | N | registry-placeholder | — |
| [`settitle`](https://teratermproject.github.io/manual/5/en/macro/command/settitle.html) | 仕様相当（プレースホルダ） | 1..1 | N | registry-placeholder | — |
| [`showtt`](https://teratermproject.github.io/manual/5/en/macro/command/showtt.html) | 仕様相当（プレースホルダ） | 1..1 | N | registry-placeholder | — |
| [`testlink`](https://teratermproject.github.io/manual/5/en/macro/command/testlink.html) | 仕様相当（プレースホルダ） | 0..0 | Y | registry-placeholder | — |
| [`unlink`](https://teratermproject.github.io/manual/5/en/macro/command/unlink.html) | 仕様相当（プレースホルダ） | 0..0 | N | registry-placeholder | — |
| [`wait`](https://teratermproject.github.io/manual/5/en/macro/command/wait.html) | 仕様相当（実装） | 1..10 | Y | dryrun-wait | — |
| [`wait4all`](https://teratermproject.github.io/manual/5/en/macro/command/wait4all.html) | 仕様相当（実装） | 1..10 | Y | dryrun-wait | — |
| [`waitevent`](https://teratermproject.github.io/manual/5/en/macro/command/waitevent.html) | 不足 | 1..1 | Y | registry-placeholder | 待機系だが WAIT_COMMANDS 専用シミュ外（汎用 effect / flow のみ） |
| [`waitln`](https://teratermproject.github.io/manual/5/en/macro/command/waitln.html) | 仕様相当（実装） | 1..10 | Y | dryrun-wait | — |
| [`waitn`](https://teratermproject.github.io/manual/5/en/macro/command/waitn.html) | 不足 | 1..1 | Y | registry-placeholder | 待機系だが WAIT_COMMANDS 専用シミュ外（汎用 effect / flow のみ） |
| [`waitrecv`](https://teratermproject.github.io/manual/5/en/macro/command/waitrecv.html) | 仕様相当（実装） | 3..3 | Y | dryrun-recv | — |
| [`waitregex`](https://teratermproject.github.io/manual/5/en/macro/command/waitregex.html) | 仕様相当（実装） | 1..10 | Y | dryrun-wait | — |
| [`xmodemrecv`](https://teratermproject.github.io/manual/5/en/macro/command/xmodemrecv.html) | 仕様相当（プレースホルダ） | 3..3 | Y | registry-placeholder | — |
| [`xmodemsend`](https://teratermproject.github.io/manual/5/en/macro/command/xmodemsend.html) | 仕様相当（プレースホルダ） | 2..2 | Y | registry-placeholder | — |
| [`ymodemrecv`](https://teratermproject.github.io/manual/5/en/macro/command/ymodemrecv.html) | 仕様相当（プレースホルダ） | 0..0 | Y | registry-placeholder | — |
| [`ymodemsend`](https://teratermproject.github.io/manual/5/en/macro/command/ymodemsend.html) | 仕様相当（プレースホルダ） | 1..1 | Y | registry-placeholder | — |
| [`zmodemrecv`](https://teratermproject.github.io/manual/5/en/macro/command/zmodemrecv.html) | 仕様相当（プレースホルダ） | 0..0 | Y | registry-placeholder | — |
| [`zmodemsend`](https://teratermproject.github.io/manual/5/en/macro/command/zmodemsend.html) | 仕様相当（プレースホルダ） | 2..2 | Y | registry-placeholder | — |

### Control

| コマンド | 判定 | 引数 | result | レイヤ | ギャップ / メモ |
|----------|------|------|--------|--------|----------------|
| [`break`](https://teratermproject.github.io/manual/5/en/macro/command/break.html) | 仕様相当（実装） | 0..0 | N | control | — |
| [`call`](https://teratermproject.github.io/manual/5/en/macro/command/call.html) | 仕様相当（実装） | 1..1 | N | control | — |
| [`continue`](https://teratermproject.github.io/manual/5/en/macro/command/continue.html) | 仕様相当（実装） | 0..0 | N | control | — |
| [`do`](https://teratermproject.github.io/manual/5/en/macro/command/doloop.html) | 仕様相当（実装） | 0..2 | N | control | — |
| [`loop`](https://teratermproject.github.io/manual/5/en/macro/command/doloop.html) | 仕様相当（実装） | 0..2 | N | control | — |
| [`end`](https://teratermproject.github.io/manual/5/en/macro/command/end.html) | 仕様相当（実装） | 0..0 | N | control | — |
| [`execcmnd`](https://teratermproject.github.io/manual/5/en/macro/command/execcmnd.html) | 仕様相当（実装） | 1..1 | N | control | — |
| [`exit`](https://teratermproject.github.io/manual/5/en/macro/command/exit.html) | 仕様相当（実装） | 0..0 | N | control | — |
| [`for`](https://teratermproject.github.io/manual/5/en/macro/command/fornext.html) | 仕様相当（実装） | 3..3 | N | control | 負数定数は公式 appendix どおり式単位消費（実装済） |
| [`next`](https://teratermproject.github.io/manual/5/en/macro/command/fornext.html) | 仕様相当（実装） | 0..0 | N | control | — |
| [`goto`](https://teratermproject.github.io/manual/5/en/macro/command/goto.html) | 仕様相当（実装） | 1..1 | N | control | — |
| [`if`](https://teratermproject.github.io/manual/5/en/macro/command/ifthenelseif.html) | 仕様相当（実装） | 1..1 | N | control | 引数仕様は条件式を 1 と数える（then 以降は別構文） |
| [`then`](https://teratermproject.github.io/manual/5/en/macro/command/ifthenelseif.html) | 構文要素 | — | N | keyword-only | if 構文の一部 |
| [`elseif`](https://teratermproject.github.io/manual/5/en/macro/command/ifthenelseif.html) | 仕様相当（実装） | 1..1 | N | control | 条件式を 1 引数として扱う |
| [`else`](https://teratermproject.github.io/manual/5/en/macro/command/ifthenelseif.html) | 仕様相当（実装） | 0..0 | N | control | — |
| [`endif`](https://teratermproject.github.io/manual/5/en/macro/command/ifthenelseif.html) | 仕様相当（実装） | 0..0 | N | control | — |
| [`include`](https://teratermproject.github.io/manual/5/en/macro/command/include.html) | 仕様相当（実装） | 1..1 | N | control | — |
| [`mpause`](https://teratermproject.github.io/manual/5/en/macro/command/mpause.html) | 仕様相当（実装） | 1..1 | N | control+dryrun-flow | — |
| [`pause`](https://teratermproject.github.io/manual/5/en/macro/command/pause.html) | 仕様相当（実装） | 1..1 | N | control+dryrun-flow | — |
| [`return`](https://teratermproject.github.io/manual/5/en/macro/command/return.html) | 仕様相当（実装） | 0..0 | N | control | — |
| [`until`](https://teratermproject.github.io/manual/5/en/macro/command/until.html) | 仕様相当（実装） | 1..1 | N | control | 条件式を 1 引数として扱う |
| [`enduntil`](https://teratermproject.github.io/manual/5/en/macro/command/until.html) | 仕様相当（実装） | 0..0 | N | control | — |
| [`while`](https://teratermproject.github.io/manual/5/en/macro/command/while.html) | 仕様相当（実装） | 1..1 | N | control | 条件式を 1 引数として扱う |
| [`endwhile`](https://teratermproject.github.io/manual/5/en/macro/command/while.html) | 仕様相当（実装） | 0..0 | N | control | — |

### String

| コマンド | 判定 | 引数 | result | レイヤ | ギャップ / メモ |
|----------|------|------|--------|--------|----------------|
| [`code2str`](https://teratermproject.github.io/manual/5/en/macro/command/code2str.html) | 仕様相当（実装） | 2..2 | N | static-eval | — |
| [`expandenv`](https://teratermproject.github.io/manual/5/en/macro/command/expandenv.html) | 仕様相当（プレースホルダ） | 1..2 | N | registry-placeholder | — |
| [`int2str`](https://teratermproject.github.io/manual/5/en/macro/command/int2str.html) | 仕様相当（実装） | 2..2 | N | static-eval | — |
| [`regexoption`](https://teratermproject.github.io/manual/5/en/macro/command/regexoption.html) | 仕様相当（プレースホルダ） | 1..∞ | N | registry-placeholder | — |
| [`sprintf`](https://teratermproject.github.io/manual/5/en/macro/command/sprintf.html) | 仕様相当（実装） | 1..∞ | Y | static-eval | — |
| [`sprintf2`](https://teratermproject.github.io/manual/5/en/macro/command/sprintf2.html) | 仕様相当（実装） | 2..∞ | Y | static-eval | — |
| [`str2code`](https://teratermproject.github.io/manual/5/en/macro/command/str2code.html) | 仕様相当（実装） | 2..2 | N | static-eval | — |
| [`str2int`](https://teratermproject.github.io/manual/5/en/macro/command/str2int.html) | 仕様相当（実装） | 2..2 | Y | static-eval | — |
| [`strcompare`](https://teratermproject.github.io/manual/5/en/macro/command/strcompare.html) | 仕様相当（実装） | 2..2 | Y | static-eval | — |
| [`strconcat`](https://teratermproject.github.io/manual/5/en/macro/command/strconcat.html) | 仕様相当（実装） | 2..2 | N | static-eval | — |
| [`strcopy`](https://teratermproject.github.io/manual/5/en/macro/command/strcopy.html) | 仕様相当（実装） | 4..4 | N | static-eval | — |
| [`strinsert`](https://teratermproject.github.io/manual/5/en/macro/command/strinsert.html) | 仕様相当（実装） | 3..3 | N | static-eval | — |
| [`strjoin`](https://teratermproject.github.io/manual/5/en/macro/command/strjoin.html) | 仕様相当（実装） | 2..3 | N | static-eval | — |
| [`strlen`](https://teratermproject.github.io/manual/5/en/macro/command/strlen.html) | 仕様相当（実装） | 1..1 | Y | static-eval | — |
| [`strmatch`](https://teratermproject.github.io/manual/5/en/macro/command/strmatch.html) | 不足 | 2..2 | Y | registry-placeholder | 決定的計算が可能だが staticCommandEval 未実装（引数既知でもプレースホルダ） |
| [`strremove`](https://teratermproject.github.io/manual/5/en/macro/command/strremove.html) | 仕様相当（実装） | 3..3 | N | static-eval | — |
| [`strreplace`](https://teratermproject.github.io/manual/5/en/macro/command/strreplace.html) | 仕様相当（実装） | 4..4 | Y | static-eval | — |
| [`strscan`](https://teratermproject.github.io/manual/5/en/macro/command/strscan.html) | 仕様相当（実装） | 2..2 | Y | static-eval | — |
| [`strspecial`](https://teratermproject.github.io/manual/5/en/macro/command/strspecial.html) | 仕様相当（実装） | 1..2 | N | static-eval | — |
| [`strsplit`](https://teratermproject.github.io/manual/5/en/macro/command/strsplit.html) | 仕様相当（実装） | 2..3 | Y | static-eval | — |
| [`strtrim`](https://teratermproject.github.io/manual/5/en/macro/command/strtrim.html) | 仕様相当（実装） | 2..2 | N | static-eval | — |
| [`tolower`](https://teratermproject.github.io/manual/5/en/macro/command/tolower.html) | 仕様相当（実装） | 2..2 | N | static-eval | — |
| [`toupper`](https://teratermproject.github.io/manual/5/en/macro/command/toupper.html) | 仕様相当（実装） | 2..2 | N | static-eval | — |

### File

| コマンド | 判定 | 引数 | result | レイヤ | ギャップ / メモ |
|----------|------|------|--------|--------|----------------|
| [`basename`](https://teratermproject.github.io/manual/5/en/macro/command/basename.html) | 仕様相当（実装） | 2..2 | N | static-eval | — |
| [`dirname`](https://teratermproject.github.io/manual/5/en/macro/command/dirname.html) | 仕様相当（実装） | 2..2 | N | static-eval | — |
| [`fileclose`](https://teratermproject.github.io/manual/5/en/macro/command/fileclose.html) | 仕様相当（プレースホルダ） | 1..1 | N | registry-placeholder | — |
| [`fileconcat`](https://teratermproject.github.io/manual/5/en/macro/command/fileconcat.html) | 仕様相当（プレースホルダ） | 2..2 | Y | registry-placeholder | — |
| [`filecopy`](https://teratermproject.github.io/manual/5/en/macro/command/filecopy.html) | 仕様相当（プレースホルダ） | 2..2 | Y | registry-placeholder | — |
| [`filecreate`](https://teratermproject.github.io/manual/5/en/macro/command/filecreate.html) | 仕様相当（プレースホルダ） | 2..2 | Y | registry-placeholder | — |
| [`filedelete`](https://teratermproject.github.io/manual/5/en/macro/command/filedelete.html) | 仕様相当（プレースホルダ） | 1..1 | Y | registry-placeholder | — |
| [`filelock`](https://teratermproject.github.io/manual/5/en/macro/command/filelock.html) | 仕様相当（プレースホルダ） | 1..2 | Y | registry-placeholder | — |
| [`filemarkptr`](https://teratermproject.github.io/manual/5/en/macro/command/filemarkptr.html) | 仕様相当（プレースホルダ） | 1..1 | N | registry-placeholder | — |
| [`fileopen`](https://teratermproject.github.io/manual/5/en/macro/command/fileopen.html) | 仕様相当（プレースホルダ） | 3..4 | N | registry-placeholder | — |
| [`filereadln`](https://teratermproject.github.io/manual/5/en/macro/command/filereadln.html) | 仕様相当（プレースホルダ） | 2..2 | Y | registry-placeholder | — |
| [`fileread`](https://teratermproject.github.io/manual/5/en/macro/command/fileread.html) | 仕様相当（プレースホルダ） | 3..3 | Y | registry-placeholder | — |
| [`filerename`](https://teratermproject.github.io/manual/5/en/macro/command/filerename.html) | 仕様相当（プレースホルダ） | 2..2 | Y | registry-placeholder | — |
| [`filesearch`](https://teratermproject.github.io/manual/5/en/macro/command/filesearch.html) | 仕様相当（プレースホルダ） | 1..1 | Y | registry-placeholder | — |
| [`fileseek`](https://teratermproject.github.io/manual/5/en/macro/command/fileseek.html) | 仕様相当（プレースホルダ） | 3..3 | N | registry-placeholder | — |
| [`fileseekback`](https://teratermproject.github.io/manual/5/en/macro/command/fileseekback.html) | 仕様相当（プレースホルダ） | 1..1 | N | registry-placeholder | — |
| [`filestat`](https://teratermproject.github.io/manual/5/en/macro/command/filestat.html) | 仕様相当（プレースホルダ） | 2..4 | Y | registry-placeholder | — |
| [`filestrseek`](https://teratermproject.github.io/manual/5/en/macro/command/filestrseek.html) | 仕様相当（プレースホルダ） | 2..2 | Y | registry-placeholder | — |
| [`filestrseek2`](https://teratermproject.github.io/manual/5/en/macro/command/filestrseek2.html) | 仕様相当（プレースホルダ） | 2..2 | Y | registry-placeholder | — |
| [`filetruncate`](https://teratermproject.github.io/manual/5/en/macro/command/filetruncate.html) | 仕様相当（プレースホルダ） | 2..2 | Y | registry-placeholder | — |
| [`fileunlock`](https://teratermproject.github.io/manual/5/en/macro/command/fileunlock.html) | 仕様相当（プレースホルダ） | 1..1 | Y | registry-placeholder | — |
| [`filewrite`](https://teratermproject.github.io/manual/5/en/macro/command/filewrite.html) | 仕様相当（プレースホルダ） | 2..2 | N | registry-placeholder | — |
| [`filewriteln`](https://teratermproject.github.io/manual/5/en/macro/command/filewriteln.html) | 仕様相当（プレースホルダ） | 2..2 | N | registry-placeholder | — |
| [`foldercreate`](https://teratermproject.github.io/manual/5/en/macro/command/foldercreate.html) | 仕様相当（プレースホルダ） | 1..1 | Y | registry-placeholder | — |
| [`folderdelete`](https://teratermproject.github.io/manual/5/en/macro/command/folderdelete.html) | 仕様相当（プレースホルダ） | 1..1 | Y | registry-placeholder | — |
| [`foldersearch`](https://teratermproject.github.io/manual/5/en/macro/command/foldersearch.html) | 仕様相当（プレースホルダ） | 1..1 | Y | registry-placeholder | — |
| [`getdir`](https://teratermproject.github.io/manual/5/en/macro/command/getdir.html) | 仕様相当（プレースホルダ） | 1..1 | N | registry-placeholder | — |
| [`getfileattr`](https://teratermproject.github.io/manual/5/en/macro/command/getfileattr.html) | 仕様相当（プレースホルダ） | 1..1 | Y | registry-placeholder | — |
| [`makepath`](https://teratermproject.github.io/manual/5/en/macro/command/makepath.html) | 仕様相当（実装） | 3..3 | N | static-eval | — |
| [`setdir`](https://teratermproject.github.io/manual/5/en/macro/command/setdir.html) | 仕様相当（プレースホルダ） | 1..1 | N | registry-placeholder | — |
| [`setfileattr`](https://teratermproject.github.io/manual/5/en/macro/command/setfileattr.html) | 仕様相当（プレースホルダ） | 2..2 | Y | registry-placeholder | — |
| [`findfirst`](https://teratermproject.github.io/manual/5/en/macro/command/findoperations.html) | 仕様相当（プレースホルダ） | 3..3 | Y | registry-placeholder | — |
| [`findnext`](https://teratermproject.github.io/manual/5/en/macro/command/findoperations.html) | 仕様相当（プレースホルダ） | 2..2 | Y | registry-placeholder | — |
| [`findclose`](https://teratermproject.github.io/manual/5/en/macro/command/findoperations.html) | 仕様相当（プレースホルダ） | 1..1 | N | registry-placeholder | result 非設定（findfirst/next のみ） |

### Password

| コマンド | 判定 | 引数 | result | レイヤ | ギャップ / メモ |
|----------|------|------|--------|--------|----------------|
| [`delpassword`](https://teratermproject.github.io/manual/5/en/macro/command/delpassword.html) | 仕様相当（プレースホルダ） | 2..2 | N | registry-placeholder | — |
| [`delpassword2`](https://teratermproject.github.io/manual/5/en/macro/command/delpassword2.html) | 仕様相当（プレースホルダ） | 2..2 | N | registry-placeholder | — |
| [`getpassword`](https://teratermproject.github.io/manual/5/en/macro/command/getpassword.html) | 仕様相当（プレースホルダ） | 3..3 | Y | registry-placeholder | — |
| [`getpassword2`](https://teratermproject.github.io/manual/5/en/macro/command/getpassword2.html) | 仕様相当（プレースホルダ） | 4..4 | Y | registry-placeholder | — |
| [`ispassword`](https://teratermproject.github.io/manual/5/en/macro/command/ispassword.html) | 仕様相当（プレースホルダ） | 2..2 | Y | registry-placeholder | — |
| [`ispassword2`](https://teratermproject.github.io/manual/5/en/macro/command/ispassword2.html) | 仕様相当（プレースホルダ） | 2..2 | Y | registry-placeholder | — |
| [`passwordbox`](https://teratermproject.github.io/manual/5/en/macro/command/passwordbox.html) | 仕様相当（実装） | 2..3 | N | dryrun-dialog | — |
| [`setpassword`](https://teratermproject.github.io/manual/5/en/macro/command/setpassword.html) | 仕様相当（プレースホルダ） | 3..3 | Y | registry-placeholder | — |
| [`setpassword2`](https://teratermproject.github.io/manual/5/en/macro/command/setpassword2.html) | 仕様相当（プレースホルダ） | 4..4 | Y | registry-placeholder | — |

### Miscellaneous

| コマンド | 判定 | 引数 | result | レイヤ | ギャップ / メモ |
|----------|------|------|--------|--------|----------------|
| [`beep`](https://teratermproject.github.io/manual/5/en/macro/command/beep.html) | 仕様相当（プレースホルダ） | 0..1 | N | registry-placeholder | — |
| [`bringupbox`](https://teratermproject.github.io/manual/5/en/macro/command/bringupbox.html) | 仕様相当（プレースホルダ） | 0..0 | N | registry-placeholder | — |
| [`closesbox`](https://teratermproject.github.io/manual/5/en/macro/command/closesbox.html) | 仕様相当（プレースホルダ） | 0..0 | N | registry-placeholder | — |
| [`clipb2var`](https://teratermproject.github.io/manual/5/en/macro/command/clipb2var.html) | 仕様相当（プレースホルダ） | 1..2 | Y | registry-placeholder | — |
| [`exec`](https://teratermproject.github.io/manual/5/en/macro/command/exec.html) | 仕様相当（プレースホルダ） | 1..4 | Y | registry-placeholder | — |
| [`dirnamebox`](https://teratermproject.github.io/manual/5/en/macro/command/dirnamebox.html) | 仕様相当（実装） | 1..2 | Y | dryrun-dialog | — |
| [`filenamebox`](https://teratermproject.github.io/manual/5/en/macro/command/filenamebox.html) | 仕様相当（実装） | 1..3 | Y | dryrun-dialog | — |
| [`getdate`](https://teratermproject.github.io/manual/5/en/macro/command/getdate.html) | 仕様相当（実装） | 1..3 | Y | dryrun-datetime | — |
| [`getenv`](https://teratermproject.github.io/manual/5/en/macro/command/getenv.html) | 仕様相当（プレースホルダ） | 2..2 | N | registry-placeholder | — |
| [`getipv4addr`](https://teratermproject.github.io/manual/5/en/macro/command/getipv4addr.html) | 仕様相当（プレースホルダ） | 2..2 | Y | registry-placeholder | — |
| [`getipv6addr`](https://teratermproject.github.io/manual/5/en/macro/command/getipv6addr.html) | 仕様相当（プレースホルダ） | 2..2 | Y | registry-placeholder | — |
| [`getspecialfolder`](https://teratermproject.github.io/manual/5/en/macro/command/getspecialfolder.html) | 仕様相当（プレースホルダ） | 2..2 | Y | registry-placeholder | — |
| [`gettime`](https://teratermproject.github.io/manual/5/en/macro/command/gettime.html) | 仕様相当（実装） | 1..3 | Y | dryrun-datetime | — |
| [`getttdir`](https://teratermproject.github.io/manual/5/en/macro/command/getttdir.html) | 仕様相当（プレースホルダ） | 1..1 | Y | registry-placeholder | — |
| [`getver`](https://teratermproject.github.io/manual/5/en/macro/command/getver.html) | 仕様相当（プレースホルダ） | 1..2 | Y | registry-placeholder | 比較引数なし時は result を変更しない（公式どおり META 注記） |
| [`ifdefined`](https://teratermproject.github.io/manual/5/en/macro/command/ifdefined.html) | 仕様相当（実装） | 1..1 | Y | static-eval | — |
| [`inputbox`](https://teratermproject.github.io/manual/5/en/macro/command/inputbox.html) | 仕様相当（実装） | 2..4 | N | dryrun-dialog | — |
| [`intdim`](https://teratermproject.github.io/manual/5/en/macro/command/intdim.html) | 仕様相当（プレースホルダ） | 2..2 | N | registry-placeholder | — |
| [`listbox`](https://teratermproject.github.io/manual/5/en/macro/command/listbox.html) | 仕様相当（実装） | 3..∞ | Y | dryrun-dialog | — |
| [`messagebox`](https://teratermproject.github.io/manual/5/en/macro/command/messagebox.html) | 仕様相当（実装） | 2..3 | N | dryrun-dialog | 公式は result 非設定。ドライランのみ UI 応答で result を更新し得る |
| [`random`](https://teratermproject.github.io/manual/5/en/macro/command/random.html) | 仕様相当（プレースホルダ） | 2..2 | N | registry-placeholder | — |
| [`rotateleft`](https://teratermproject.github.io/manual/5/en/macro/command/rotateleft.html) | 仕様相当（実装） | 3..3 | N | static-eval | — |
| [`rotateright`](https://teratermproject.github.io/manual/5/en/macro/command/rotateright.html) | 仕様相当（実装） | 3..3 | N | static-eval | — |
| [`setdate`](https://teratermproject.github.io/manual/5/en/macro/command/setdate.html) | 仕様相当（プレースホルダ） | 1..1 | N | registry-placeholder | — |
| [`setdlgpos`](https://teratermproject.github.io/manual/5/en/macro/command/setdlgpos.html) | 仕様相当（プレースホルダ） | 0..5 | N | registry-placeholder | — |
| [`setenv`](https://teratermproject.github.io/manual/5/en/macro/command/setenv.html) | 仕様相当（プレースホルダ） | 2..2 | N | registry-placeholder | — |
| [`setexitcode`](https://teratermproject.github.io/manual/5/en/macro/command/setexitcode.html) | 仕様相当（プレースホルダ） | 1..1 | N | registry-placeholder | — |
| [`settime`](https://teratermproject.github.io/manual/5/en/macro/command/settime.html) | 仕様相当（プレースホルダ） | 1..1 | N | registry-placeholder | — |
| [`show`](https://teratermproject.github.io/manual/5/en/macro/command/show.html) | 仕様相当（プレースホルダ） | 1..1 | N | registry-placeholder | — |
| [`statusbox`](https://teratermproject.github.io/manual/5/en/macro/command/statusbox.html) | 不足 | 2..3 | N | registry-placeholder | ダイアログ表示系だが dryRun の DIALOG_COMMANDS 外（専用UIなし）; ダイアログ系だがドライラン専用UIなし（closesbox と対） |
| [`strdim`](https://teratermproject.github.io/manual/5/en/macro/command/strdim.html) | 仕様相当（プレースホルダ） | 2..2 | N | registry-placeholder | — |
| [`uptime`](https://teratermproject.github.io/manual/5/en/macro/command/uptime.html) | 仕様相当（プレースホルダ） | 1..1 | N | registry-placeholder | — |
| [`var2clipb`](https://teratermproject.github.io/manual/5/en/macro/command/var2clipb.html) | 仕様相当（プレースホルダ） | 1..1 | Y | registry-placeholder | — |
| [`yesnobox`](https://teratermproject.github.io/manual/5/en/macro/command/yesnobox.html) | 仕様相当（実装） | 2..3 | Y | dryrun-dialog | — |
| [`checksum8`](https://teratermproject.github.io/manual/5/en/macro/command/checksum8.html) | 仕様相当（実装） | 2..2 | N | static-eval | 文字列版は result 非設定（公式）。静的評価あり |
| [`checksum8file`](https://teratermproject.github.io/manual/5/en/macro/command/checksum8.html) | 仕様相当（プレースホルダ） | 2..2 | Y | registry-placeholder | — |
| [`checksum16`](https://teratermproject.github.io/manual/5/en/macro/command/checksum16.html) | 仕様相当（実装） | 2..2 | N | static-eval | 文字列版は result 非設定 |
| [`checksum16file`](https://teratermproject.github.io/manual/5/en/macro/command/checksum16.html) | 仕様相当（プレースホルダ） | 2..2 | Y | registry-placeholder | — |
| [`checksum32`](https://teratermproject.github.io/manual/5/en/macro/command/checksum32.html) | 仕様相当（実装） | 2..2 | N | static-eval | 文字列版は result 非設定 |
| [`checksum32file`](https://teratermproject.github.io/manual/5/en/macro/command/checksum32.html) | 仕様相当（プレースホルダ） | 2..2 | Y | registry-placeholder | — |
| [`crc16`](https://teratermproject.github.io/manual/5/en/macro/command/crc16.html) | 仕様相当（実装） | 2..2 | N | static-eval | 文字列版は result 非設定 |
| [`crc16file`](https://teratermproject.github.io/manual/5/en/macro/command/crc16.html) | 仕様相当（プレースホルダ） | 2..2 | Y | registry-placeholder | — |
| [`crc32`](https://teratermproject.github.io/manual/5/en/macro/command/crc32.html) | 仕様相当（実装） | 2..2 | N | static-eval | 文字列版は result 非設定 |
| [`crc32file`](https://teratermproject.github.io/manual/5/en/macro/command/crc32.html) | 仕様相当（プレースホルダ） | 2..2 | Y | registry-placeholder | — |

## 7. 静的評価の本家一致について

`static-eval` 対象は別テストで部分検証済み:

- `test:ttl-expressions` / `test:ttl-formats` / `test:ttl-sprintf` / `test:ttl-datetime` / `test:result-hover` / regression
- `strlen` は UTF-8 バイト長（公式 Manual 5 のバイト志向と整合する実装）

本レポートは「そのコマンドに静的経路があるか」を主に見ており、全演算の本家ビット一致証明までは行っていない。不足に挙げた決定的コマンドは経路自体が無い。

## 8. 再生成

```bash
npx tsx scripts/audit-ttl-commands.ts          # キャッシュ更新
npx tsx scripts/audit-ttl-commands-final.ts    # レジストリ監査 md
npx tsx scripts/audit-ttl-semantics.ts         # 本レポート
```