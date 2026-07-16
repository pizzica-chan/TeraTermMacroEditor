# システム変数 `result` 等の本家差分調査メモ

調査日: 2026-07-16  
基準: [Tera Term 公式マニュアル v5（英語）](https://teratermproject.github.io/manual/5/en/macro/command/)  
対象: 本エディタの静的解析（`evaluator.ts`）、ドライラン（`dryRun.ts`）、出力効果レジストリ（`commandOutputs.ts`）

## 目的

本家 Tera Term では多くのコマンドがシステム変数 `result`（および `matchstr` / `inputstr` 等）を更新する。  
エディタ側でその更新が漏れている・誤っているパターンを洗い出し、今後の実装優先度の参考にする。

## 実装の仕組み（現状）

| 経路 | 挙動 |
|------|------|
| `tryStaticResultCommand` / `applyStaticCommandEffects` | リテラル等が解決できるとき実値を計算（`strcompare` 等） |
| `applyCommandOutputEffects` | `commandOutputs.ts` の `setsResult` コマンドで **`result=0` プレースホルダ** |
| `dryRun.ts` の個別ハンドラ | `wait` 系・ダイアログ等を特別扱い |
| `FLOW_LOG_COMMANDS` | `connect` 等はログのみで **`result` 未更新** |

`evalConditionTokenValue` は `result` の `system-default` / `dialog-result` 起源を未確定扱い。  
`origin: 'literal'` で設定された `result` は静的 `if` 条件で利用可能。

---

## (A) 影響大：静的に計算できるのに `result` が正しく入らない

`strcompare` と同種。**`if result=...` の分岐に直結**する。

| コマンド | 本家の `result` | エディタ現状 |
|----------|-----------------|--------------|
| **strcompare** | -1 / 0 / 1 | **対応済**（`computeStrcompare`） |
| **strlen** | 文字列のバイト長（UTF-8） | **対応済**（`computeStrlen`） |
| **strlength** | `strlen` と同等と推定（公式 index には `strlen` のみ） | **対応済**（`strlen` と同じ経路） |
| **strscan** | 見つかれば 1-origin 位置、なければ 0 | **対応済**（`computeStrscan`） |
| **str2int** | 成功 1 / 失敗 0 | **対応済**（`tryStaticStr2intCommand`） |
| **ifdefined** | 0=未定義, 1=int, 3=str, 4=label, 5=int配列, 6=str配列 | **対応済**（`computeIfdefined` + `knownLabels`） |

実装: `src/ttl/staticCommandEval.ts` の `tryStaticResultCommand` / `tryStaticStr2intCommand`、  
`evaluator.ts` / `dryRun.ts` の `applyStaticCommandEffects`。  
`ifdefined` のラベル判定には `EvalOptions.knownLabels` を使用。

### 公式参照

- [strcompare](https://teratermproject.github.io/manual/5/en/macro/command/strcompare.html)
- [strlen](https://teratermproject.github.io/manual/5/en/macro/command/strlen.html)
- [strscan](https://teratermproject.github.io/manual/5/en/macro/command/strscan.html)
- [str2int](https://teratermproject.github.io/manual/5/en/macro/command/str2int.html)
- [ifdefined](https://teratermproject.github.io/manual/5/en/macro/command/ifdefined.html)

### 代表例

```ttl
strscan 'tera term' 'term'    ; result = 6
strlen basenum                ; result = バイト長
str2int val '123'             ; val=123, result=1
ifdefined data                ; result = 型コード
```

### `str2int` の注意（対応済）

`tryStaticStr2intCommand` で変数更新と `result`（成功 1 / 失敗 0）を同時に設定する。

---

## (B) `commandOutputs` に `setsResult` あり → 実値なしプレースホルダ

登録はあるが、ドライラン/静的評価では **`applyCommandOutputEffects` により `result=0` 固定**（意味は本家と不一致）。

### 文字列・ファイル・UI

| コマンド | 本家の `result`（概要） |
|----------|-------------------------|
| `strmatch` | 0=不一致, 1=一致位置（`matchstr` / `groupmatchstr*` も更新） |
| `getfileattr` | 属性値、失敗時 -1 |
| `filesearch`, `foldersearch` | 検索結果に応じた値 |
| `ispassword`, `ispassword2` | 1=存在, 0=なし |
| `findnext`, `findclose` | 検索系の成否 |
| `filereadln` | EOF で 1、通常 0 |
| `fileread`, `filecreate`, `filestat` | 成否・状態 |
| `checksum8file` 等 | ファイルオープン失敗時 -1 |
| `getipv4addr`, `getipv6addr`, `getttpos` | 成否・状態 |
| `getmodemstatus`, `getttdir`, `getspecialfolder`, `clipb2var`, `loginfo` | 各コマンド仕様に準拠 |
| `sprintf` | 0=成功, 1〜3=エラー種別（`inputstr` にも出力） |
| `listbox`, `filenamebox`, `dirnamebox` 等 | ダイアログ系は個別ハンドラあり（一部は実装済） |

### 通信・転送

| コマンド | 本家の `result`（概要） |
|----------|-------------------------|
| `kmtget`, `bplusrecv`, `xmodemrecv` | 成功 1 / 失敗 0 等 |

---

## (C) `commandOutputs` 未登録 → `result` が更新されない

| コマンド | 本家の `result` |
|----------|-----------------|
| **connect** / **cygconnect** | 0=未リンク, 1=リンクのみ, 2=接続済み |
| **testlink** | 同上 |
| **exec** | 起動成否・終了コード（第3引数 `wait` 依存） |

`connect` は `dryRun.ts` の `FLOW_LOG_COMMANDS` でログのみ。`result` は未設定。

```ts
// dryRun.ts
const FLOW_LOG_COMMANDS = new Set(['connect', 'disconnect', 'pause', 'mpause', 'flushrecv', 'sendbreak'])
```

### 公式参照

- [connect](https://teratermproject.github.io/manual/5/en/macro/command/connect.html)
- [testlink](https://teratermproject.github.io/manual/5/en/macro/command/testlink.html)
- [exec](https://teratermproject.github.io/manual/5/en/macro/command/exec.html)

---

## (D) 意図的簡略化（本家と異なるが設計上の差）

| コマンド | 本家 | エディタ |
|----------|------|----------|
| **wait** / **waitln** / **waitregex** / **wait4all** | 0=タイムアウト, 1〜n=パターン番号 | **常に `result=1`** |
| **strmatch** | 正規表現マッチ + `matchstr` 等 | `result=0`, `matchstr` 空 |
| ファイル I/O 全般 | 実ファイル操作 | 実行環境依存のプレースホルダ |

ドライランの `wait` 簡略化は `scripts/dry-run-test.ts` でも前提化されている。

### 公式参照

- [wait](https://teratermproject.github.io/manual/5/en/macro/command/wait.html)

---

## (E) `setsResult` 登録が本家仕様と合わない可能性

| コマンド | 備考 |
|----------|------|
| **str2code** | 公式に **`result` の記載なし**（出力変数のみ）。`setsResult: true` は過剰かも |
| **checksum8**（文字列版） | **`result` なし**（`checksum8file` のファイル失敗時のみ -1） |
| **inputbox** / **passwordbox** | **`inputstr` のみ**（`result` なし）→ エディタは正しい |

---

## 実装優先度の目安

1. ~~**strlen / strscan / str2int の `result`**~~ … **対応済（2026-07-16）**
2. ~~**ifdefined**~~ … **対応済（2026-07-16）**
3. ~~**strlength**~~ … **対応済（2026-07-16）**
4. **connect / testlink** … 接続マクロの分岐（ドライラン）
5. **wait の `result` 値** … 0 / 1..n の再現（ドライラン設計の見直しが必要）
6. **strmatch + matchstr** … 正規表現エンジンが必要で重い
7. ファイル I/O・転送系 … 実行環境依存が大きい

---

## 関連ファイル

| ファイル | 役割 |
|----------|------|
| `src/ttl/commandOutputs.ts` | コマンドごとの出力・`setsResult` 定義 |
| `src/ttl/staticCommandEval.ts` | 静的計算（`tryStaticResultCommand` 等） |
| `src/ttl/evaluator.ts` | 送信データ・静的環境の評価 |
| `src/ttl/dryRun.ts` | ドライラン実行 |
| `scripts/smoke-test.ts` | `strcompare` 等の回帰 |
| `scripts/dry-run-test.ts` | ドライラン回帰 |

---

## 変更履歴

| 日付 | 内容 |
|------|------|
| 2026-07-16 | 初版（調査メモ作成） |
| 2026-07-16 | `strcompare` を本家仕様に合わせて実装（`computeStrcompare` / テスト追加） |
| 2026-07-16 | (A) 全項目対応: `strlen`/`strlength`/`strscan`/`str2int`/`ifdefined` の静的 `result` 計算 |
