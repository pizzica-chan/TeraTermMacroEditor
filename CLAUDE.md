# プロジェクトルール

このファイルは `.cursor/rules/*.mdc`（Cursor用ルール）を Claude Code 用に変換したものです。
元の `.mdc` ファイルはそのまま残しています。Cursor 側のルールを更新した場合は、このファイルにも同じ内容を反映してください。

Claude Code には Cursor の `globs` のようなファイル単位の自動適用機構がないため、
本来 `alwaysApply: false` だったルールも含め、常時読み込まれる本ファイルに統合しています。
「対象ファイル」に挙げたファイルを編集・調査するときに特に注意してください。

---

## 1. AI用ルールの保守

`.cursor/rules/*.mdc` および本ファイルの内容を適用する際、次の問題がないか確認する。

- 現在の実装・テスト・仕様と矛盾している
- 古いファイル名、コマンド、設計を参照している
- 適用範囲が広すぎる、狭すぎる、または重複している
- 必須の不変条件や回帰テストが不足している
- 複数ルール間で指示が競合している

問題を見つけた場合は、不適切なルールをそのまま機械的に適用しない。
該当箇所、問題となる理由、具体的な修正案、影響範囲をユーザーへ簡潔に申し出る。

ユーザーがルール修正を明示的に依頼していない場合、提案だけを行い、承認前に変更しない。
安全性や正確性に関わる矛盾は、作業結果とあわせて必ず報告する。

---

## 2. 分岐仮定・変数仮定の整合性

**対象ファイル:**
`src/ttl/evaluator.ts`, `src/ttl/branchAssumptions.ts`, `src/ttl/variableAssumptions.ts`,
`src/ttl/includeRefs.ts`, `src/ttl/commandOutputs.ts`, `src/ttl/analysisLimitations.ts`,
`src/app/analysisCoordinator.ts`, `src/app/dryRunController.ts`, `src/main.ts`,
`src/editor/branchAssumptionDecorations.ts`, `src/editor/variableAssumptionDecorations.ts`,
`src/storage/sessionState.ts`, `src/storage/importedEnvParentKey.ts`,
`src/ui/sidePanel.ts`, `src/ui/tabManager.ts`,
`scripts/test-branch-assumptions.ts`, `scripts/test-variable-assumptions.ts`

未確定 if/elseif と未確定変数のユーザー仮定を静的評価へ一貫反映し、実行系へ混入させない。

`branchAssumptions` は「現在のソースの行番号（1-based）→ True/False」、
`variableAssumptions` は「`${行番号}:${変数名}` → 入力テキスト」であり、
いずれも送信データ・静的な変数環境・ホバー表示だけに適用する。

### 必須の不変条件（分岐仮定）

- True は then、False は後続 elseif/else を選択し、代入・include・send を同じ経路で評価する。
- elseif の True 指定はその分岐を選ぶ指定であり、先行条件が未選択でも選択経路を確定扱いにする。
- 仮定で選択経路が確定した場合、その経路上の `end` は `stopAll`。後続 send を残さない。
- else を確定経路にできるのは、先行する全 if/elseif がリテラルまたは仮定で False と確定した場合だけ。
- 未仮定の条件が一つでも残る経路では、従来の保守的評価を維持する。
- 行番号キーを include 先へ引き継がない。同じ Lx でも別ソース。リンク先自身の仮定だけを使う。

### 必須の不変条件（変数仮定）

- 仮定は `processLine` の後（その行で生まれた未確定値は次行以降へ反映）に適用する。
- 未確定変数の収集は仮定なし評価の beforeLine / afterLine を使う（UI リストは仮定後も残す）。
- リストは未確定の根源（getdate / getenv / inputbox / random 等）だけにする。代入・連結で伝播した派生変数は出さない（根源の仮定が親 env・送信・ホバーへ伝播する）。
- `strreplace` / `strinsert` / `strconcat` 等のインプレース変換も新しい根源にしない（dest の既存未確定 ID を継承する）。
- `sprintf2` / `strcopy` / `int2str` 等の出力専用 dest は上書き前の dest から継承しない（引数側の ID だけを継承する）。
- 原因変数の内容表示は導入行時点の hint だけを使う。後続のコピー・連結（`strconcat d '_x'`、別変数への前置／後付け、include 先での同名連結）は表示に使わない。仮定は従来どおり伝播する。
- `result` / `timeout` / `param` 等のシステム変数は仮定対象にしない。
- 整数仮定は TTL 整数として解釈できない入力を保存・適用しない。
- 行番号キーを include 先へ引き継がない。リンク先自身の仮定だけを使う。
- 親の include 経路で得た変数は親 env・送信データ・ホバーへ反映する。
- include 先タブを単独表示するときは、親の include 直前 env を初期値にする（親で代入した値が内容表示に載る）。
- 同じタブを複数の親が include しているときは、前提タブで親（include 行）を選ぶ。未選択・無効な選択は `allTabs` 順の先頭を使う。選択は子タブに保存し、閉じた親への参照は消す。閉じた親のあと、表示中の子は再解析する。選択した親は送信データ・ホバー・未確定変数/分岐に使う。
- 親候補は親評価で include 直前 env がある行だけにする（`if 0` や `goto` 飛ばしは出さない。未確定 if 内は投機 `beforeLine` があれば候補にする）。
- 相互 include のサイクルは `visiting` だけで止め、`importedEnvByTab` に undefined を書かない（候補収集と解決で state を共有するため）。
- 親キーは `${親タブID}:${include行}`。閉じた親やセッション復元では `parseImportedEnvParentKey`（末尾の `:` で親タブIDを切る）を使い、prefix の `startsWith` は使わない。
- ループ include の反復別タブにはその反復の直前 env を渡す。全反復共通タブは最終反復の env でよい。ループが途中で `stopAll` した場合は、止まる反復の直前 env を使う。
- ループ include のタブ紐づけはパスキーと `@loop:L行:値` の両方を `resolveIncludeBindingTabId` で解決する（リンク判定と `importedEnv` 取得で同じ関数を使う）。

### 共通の不変条件

- フロー図と `dryRun.ts` / `dryRunController.ts` には仮定を適用しない。実行時条件と静的な仮定を混同しない。
- エディタ表示には「仮定」であることを明記し、実行結果のように見せない。
- 未確定分岐・未確定変数の入力 UI と include リンク UI は「前提」タブにまとめる（送信データ・ドライラン・フロー・変数タブには出さない）。
- 前提タブと送信データタブでは未仮定の分岐とタブ未指定 include を警告する。未確定変数は警告しない（前提タブの入力 UI は残す）。
- フローとドライラン開始時はタブ未指定 include だけを警告し、分岐・変数仮定の選択状況は参照しない。
- 未使用変数・外部宣言の診断は全親を見る。選択した親は送信データ・ホバー・未確定変数/分岐に使う。

### 実装の要点（配線）

- `analysisCoordinator.ts` … `evaluateTTL` へ `branchAssumptions` / `variableAssumptions` / `importedEnv` を渡す経路、include 解決時のリンク先仮定、limitation 収集、到達可能な複数親の `importedEnvParentKey`、`resolveImportedEnvWithParentCandidates`
- `importedEnvParentKey.ts` … 親キーの生成・解析（タブ閉じとセッション復元で共有）
- `includeRefs.ts` … `isLoopIncludeCommonTab` / `loopIncludeIterationValuesForTab`（リンク判定と importedEnv で共有）
- `evaluator.ts` … 未確定根源 ID の継承（インプレース dest のみ）、ループ内 `beforeLine` は各反復で上書き、ループ include 直前 env（`beforeIncludeByLoopKey`）
- `commandOutputs.ts` … `INDEPENDENT_OUTPUT_COMMANDS` / `isInPlaceStringCommand`
- `dryRunController.ts` … スナップショット／ドライラン開始に静的仮定を混入させない（実行時プロンプトのみ）

### 変更時の横展開確認

ブロック if、単行 if、elseif、else、ネスト、include、`end`、True/False/クリア、inputbox/getenv/random、インプレース変換、`sprintf2` の dest 上書き、原因行の内容表示、ループ反復別 include タブ、ループ途中 `stopAll` を確認する。
特に制御フロー変更では、送信データだけでなく `beforeLine` と include 後の env も確認する。

```bash
npm run test:branch-assumptions
npm run test:variable-assumptions
npm run test:conditional-end
npm run test:regression
```

回帰ケースは `scripts/test-branch-assumptions.ts` と `scripts/test-variable-assumptions.ts` に追加する。

---

## 3. 未確定 if 内 end → 後続コードへの静的解析

**対象ファイル:**
`src/ttl/analyzer.ts`, `src/ttl/evaluator.ts`, `src/ttl/controlFlow.ts`, `src/ttl/branchAssumptions.ts`,
`src/app/analysisCoordinator.ts`, `src/ui/sidePanel.ts`, `src/main.ts`,
`scripts/test-conditional-end-static.ts`, `scripts/test-branch-assumptions.ts`, `scripts/regression-test.ts`

未確定 if 内 end の後（endif 以降）に到達不能警告・送信データが正しく出るよう analyzer/evaluator を保守する。

### 何を守るか（後続コード）

ユーザー TTL の **`endif` 以降の行** に対して、静的解析が次の両方で正しく動くこと。

1. **到達不能警告（analyzer）** … 未確定 `if` 内の `end` だけでは、後続行に「到達しません」を出さない
2. **送信データ（evaluator）** … 後続の `send` / `sendln` を収集リストに含める

### 代表例（必ず維持）

```ttl
yesnobox '' ''
if result <> 0 then
 end
endif

sendln 'after'    ; ← 到達不能警告なし、送信データに after が載る
```

```ttl
if 1 then
 end
endif
sendln 'after'    ; ← 到達不能警告あり、送信データに after は載らない
```

### 不変条件

| 条件 | analyzer（後続行） | evaluator（後続 send） |
|------|-------------------|------------------------|
| 変数条件の `if` 内 `end`（`result` 等） | 到達可能のまま | `endif` 以降を収集 |
| `if 1` / `while 1` 内 `end` | 到達不能 | 以降を収集しない |

- **dryRun.ts は対象外** … 実行時 `end` は常にマクロ終了（`stopAll`）

### 実装の要点（触るときはセットで確認）

**controlFlow.ts**
- `evalGuaranteedLiteralCondition` … リテラルだけで真と断定できる条件（analyzer / evaluator 共有）

**analyzer.ts**
- `guaranteedEntry` … リテラルだけ真と断定できる `if`/`while` のみ `true`
- `isConditionalTerminatorContext` … 未確定ブロックが残るとき `end` はブロック内だけ
- `closeBlock` … 未確定ブロック閉じで `fileUnreachable` をスナップショット復元

**evaluator.ts**
- `evalConditionTokenValue` … `system-default` / `dialog-result` は if 条件で未確定
- `blockTerminatorStack` + `isConditionalIfEndContext` … 未確定 `if` 内 `end` は `stopBlock`（`stopAll` にしない）
- `resolveIfCondition` … 静的評価できなければ `branchAssumptions`（行番号 1-based）を参照
- `EvaluateOptions.branchAssumptions` … UI でユーザーが選んだ True/False を渡す

**analysisCoordinator.ts / branchAssumptions.ts / UI**
- `collectIndeterminateIfBranches` … 各行直前 env で未確定の if/elseif を列挙
- サイドパネル「未確定分岐」で True/False/クリア → `tab.branchAssumptions` → 再評価
- include が未確定 if 内にあるとき、仮定 True で子ファイルの変数代入が親 env に反映される

### 変更後の必須テスト

```bash
npm run test:conditional-end
npm run test:branch-assumptions
npm run test:regression
```

ケース定義:
- `scripts/test-conditional-end-static.ts`（到達不能と送信データ）
- `scripts/test-branch-assumptions.ts`（include + 分岐仮定）

手動確認用 TTL: `samples/conditional-end-verify.ttl`（ファイル → 開く）

### やってはいけない変更

- `end` を無条件で `fileUnreachable = true` / `stopAll` に戻す
- `result` の既定値 `0` で `if result = 0` を静的に真とする
- dryRun の `end` を `stopBlock` に変える（実行セマンティクスが壊れる）

---

## 4. dist の Git 管理と push 手順

push 前に dist を最新ビルドしてコミットに含める。

このプロジェクトでは `dist/` をリポジトリに含め、`file://` でのオフライン利用を可能にする。

### push する前に必ず実施

1. `npm run build` を実行して `dist/` を最新化する
2. （推奨）`npm run verify-dist-offline` でオフライン配布物を検証する
3. `dist/` の変更があればコミットに含める
4. その後に push する

### コミット時の注意

- `src/` や設定ファイルを変更した場合は、対応する `dist/` の更新も同一コミット（または直後のコミット）に含める
- `dist/` だけが古い状態での push はしない

### ビルドコマンド

```bash
npm run build
npm run verify-dist-offline
```

---

## 5. Tera Term マクロ公式ドキュメントの参照

TTL の文法・構文・コマンド仕様は Tera Term 公式マニュアル v5 を確認する。

Tera Term マクロ（TTL）の**文法・構文・コマンド仕様・実行セマンティクス**を調べる・実装する・回答する際は、記憶や推測だけに頼らず、**Tera Term 公式マニュアル v5** を確認する。

### いつ確認するか

次のような場合は、作業前または回答前に公式ドキュメントを読む。

- コマンド名、引数の個数・型、意味、戻り値（`result` 等）
- 行形式（コマンド行・代入行・ラベル行）、式、演算子、優先順位
- 変数・配列・型、文字列リテラル、コメント、エンコーディング
- 制御構文（`if` / `while` / `for` / `do` / `goto` / `include` 等）の公式な挙動
- エディタの静的解析・ドライランと実際の Tera Term 実行の差分を説明するとき

### 参照先（公式・v5）

このプロジェクトの基準は **Manual 5（英語版）** とする。`src/ttl/commandArgs.ts` も同じ版を参照している。

| 内容 | URL |
|------|-----|
| MACRO 目次 | https://teratermproject.github.io/manual/5/en/macro/ |
| TTL 言語（構文） | https://teratermproject.github.io/manual/5/en/macro/syntax/index.html |
| コマンド一覧 | https://teratermproject.github.io/manual/5/en/macro/command/ |
| 個別コマンド | `https://teratermproject.github.io/manual/5/en/macro/command/<command>.html` |

構文の詳細は `syntax/` 配下（例: `lineformats.html`, `types.html`, `expressions.html`）も参照する。

### 確認の手順

1. 上記 URL を `WebFetch` や `WebSearch` で開き、該当ページを読む
2. 複数コマンドや制御構文が絡む場合は、関連コマンドの個別ページも読む
3. 公式と本リポジトリの実装が異なる場合は、その差分を明示する

### 優先順位

1. **Tera Term 公式マニュアル v5** … TTL の正しい仕様
2. **本プロジェクトの実装・テスト・`.cursor/rules/`** … エディタ固有の静的解析・UI の挙動
3. **`samples/` や会話履歴** … 補助的な例。公式と矛盾する場合は公式を優先

### 注意

- 古い TT4 情報や第三者サイトだけを根拠にしない
- 本エディタの静的解析（`analyzer.ts` / `evaluator.ts`）や `dryRun.ts` は、実行時 Tera Term と意図的に異なる箇所がある。仕様確認は公式、エディタ挙動はプロジェクト内ルール・テストを併せて確認する
