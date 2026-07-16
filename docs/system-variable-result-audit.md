# システム変数 `result` 等の本家差分調査メモ

調査日: 2026-07-16  
基準: [Tera Term 公式マニュアル v5（英語）](https://teratermproject.github.io/manual/5/en/macro/command/)  
対象: 本エディタの静的解析（`evaluator.ts`）、ドライラン（`dryRun.ts`）、出力効果レジストリ（`commandOutputs.ts`）

## 目的

本家 Tera Term では多くのコマンドがシステム変数 `result`（および `matchstr` / `inputstr` 等）を更新する。  
エディタ側でその更新が漏れている・誤っているパターンを洗い出し、今後の実装優先度の参考にする。

## エディタの基本方針：値と「静的に断定できるか」は別

本家 Tera Term ではコマンド実行後に `result` 等へ**実際の数値**が入る。  
本エディタの静的解析では、**数値そのもの**と**その値を静的 `if` 条件に使えるか**を分けて扱う。

### `ValueOrigin`（由来）による区別

`evaluator.ts` / `dryRun.ts` の変数環境では、スカラー値に `origin` を付ける。

| `origin` | 意味 | ホバー等の表示 | 静的 `if result=...` |
|----------|------|----------------|----------------------|
| `system-default` | システム変数の初期状態（未更新の `result` など） | `valueKind: system-default` | **未確定**（使わない） |
| `dialog-result` | 実行時依存の副作用（接続・ファイル I/O・未解決の `setsResult` 等） | `valueKind: runtime`、「実行時に決定」 | **未確定**（使わない） |
| `literal` | リテラルや既知の文字列から**静的に計算した確定値** | `valueKind: known`、数値をそのまま表示 | **確定**（使える） |
| `user-input` / `match-received` | 入力・受信文字列（主に `inputstr` / `matchstr`） | `valueKind: runtime` | 文字列条件は別経路 |

`evalConditionTokenValue` が境界を守る。`system-default` と `dialog-result` の整数は `if` 条件評価で **`undefined`（未確定）** として扱われ、  
**`result` の初期値 `0` で `if result = 0` を静的に真にしない**（`.cursor/rules/conditional-if-end-static.mdc` 参照）。

```ts
// evaluator.ts — 要約
if (v?.kind === 'int' && (v.origin === 'system-default' || v.origin === 'dialog-result')) {
  return undefined  // 静的 if では未確定
}
```

### 評価の流れ（コマンド実行時）

```
コマンド行を評価
  │
  ├─ applyStaticCommandEffects
  │     引数がリテラル / env 上の既知文字列なら実値を計算
  │     → result 等に origin: 'literal' で設定（静的確定）
  │
  ├─ （静的計算できなければ）applyCommandOutputEffects
  │     commandOutputs の setsResult 等
  │     → result=0 等のプレースホルダ + origin: 'dialog-result'（静的未確定）
  │
  └─ dryRun の個別ハンドラ（wait / yesnobox 等）
        ドライラン用のシミュレーション値
```

**ポイント:** 実行時依存コマンドで見える `result=0` は「本家でも 0 になる」という意味ではなく、  
**「ここでは静的に判断できない」という印（プレースホルダ + `dialog-result`）** である。  
ホバーでは数値 `0` ではなく「実行時に決定されます」系の表示になる。

### (A) 対応の位置づけ

(A) で直したのは「全部 `0` にする」ことではない。

- **静的に計算できる**（例: `strlen 'abc'`, `strcompare a b` で `a`/`b` が既知）  
  → 本家と同じ実値を入れ、`origin: 'literal'` とする  
- **静的に計算できない**（例: `strlen basenum` で `basenum` が実行時まで不明）  
  → 従来どおり `applyCommandOutputEffects` へ落ち、`dialog-result` のまま未確定

```ttl
strlen 'マクロ'          ; result = 9, origin: literal → if result = 9 は静的確定
strlen basenum           ; result = 0, origin: dialog-result → if result = ... は未確定
strmatch pattern text    ; result = 0, origin: dialog-result → 正規表現は実行時依存
```

## 実装の仕組み（経路一覧）

| 経路 | 挙動 |
|------|------|
| `tryStaticResultCommand` / `applyStaticCommandEffects` | 引数解決できれば実値を計算し **`origin: 'literal'`** |
| `applyCommandOutputEffects` | `setsResult` コマンドで **`result=0` + `origin: 'dialog-result'`**（静的未確定） |
| `dryRun.ts` の個別ハンドラ | `wait` 系・ダイアログ等を特別扱い（多くは `dialog-result` または簡略シミュレーション） |
| `FLOW_LOG_COMMANDS` | `connect` 等はログのみで **`result` 未更新**（`system-default` のまま） |

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
成功時は **`origin: 'literal'`**（静的確定）。引数未解決時は静的経路をスキップし、下流の `dialog-result` 扱いへ。  
`ifdefined` のラベル判定には `EvalOptions.knownLabels` を使用。

### 公式参照

- [strcompare](https://teratermproject.github.io/manual/5/en/macro/command/strcompare.html)
- [strlen](https://teratermproject.github.io/manual/5/en/macro/command/strlen.html)
- [strscan](https://teratermproject.github.io/manual/5/en/macro/command/strscan.html)
- [str2int](https://teratermproject.github.io/manual/5/en/macro/command/str2int.html)
- [ifdefined](https://teratermproject.github.io/manual/5/en/macro/command/ifdefined.html)

### 代表例

```ttl
strscan 'tera term' 'term'    ; 静的: result = 6 (literal)
strlen 'abc'                  ; 静的: result = 3 (literal)
strlen basenum                ; 未確定: basenum が不明なら dialog-result
str2int val '123'             ; 静的: val=123, result=1 (literal)
ifdefined data                ; 静的: result = 型コード (literal、env/ラベルが既知のとき)
```

### `str2int` の注意（対応済）

`tryStaticStr2intCommand` で変数更新と `result`（成功 1 / 失敗 0）を同時に設定する。

---

## (B) `commandOutputs` に `setsResult` あり → 実行時依存（静的未確定）

登録はあるが、引数や実行環境が解決できないときは **`applyCommandOutputEffects` により `result=0` + `origin: 'dialog-result'`**。  
数値 `0` はプレースホルダであり、**静的 `if` では未確定**（本家の実際の戻り値とは一致しない場合がある）。

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

## (C) `commandOutputs` 未登録 → `result` が更新されない（初期値のまま）

| コマンド | 本家の `result` | エディタ |
|----------|-----------------|----------|
| **connect** / **cygconnect** | 0=未リンク, 1=リンクのみ, 2=接続済み | 未更新 → **`system-default`（静的未確定）** |
| **testlink** | 同上 | 同上 |
| **exec** | 起動成否・終了コード（第3引数 `wait` 依存） | 未更新 → **`system-default`** |

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
| **wait** / **waitln** / **waitregex** / **wait4all** | 0=タイムアウト, 1〜n=パターン番号 | **`result=1` + `origin: 'literal'`**（常に成功想定の簡略シミュレーション） |
| **strmatch** | 正規表現マッチ + `matchstr` 等 | `result=0` + `dialog-result`, `matchstr` 空 |
| ファイル I/O 全般 | 実ファイル操作 | `dialog-result` プレースホルダ |

`wait` の `literal` 付与は「静的に判断可能」とみなす**意図的例外**。本家の 0 / 1..n は再現していない。

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
| `src/ttl/evaluator.ts` | 送信データ・静的環境の評価、`evalConditionTokenValue` |
| `.cursor/rules/conditional-if-end-static.mdc` | 未確定 `result` を静的 `if` に使わない不変条件 |
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
| 2026-07-16 | `ValueOrigin` と静的確定/未確定の方針を追記（`literal` vs `dialog-result`） |
