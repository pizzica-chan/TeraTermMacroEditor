# TTL Macro Editor

Tera Term マクロ（TTL）用のブラウザ完結型エディタです。シンタックスハイライト、静的解析、送信データのプレビュー、ドライラン、フロー図表示までを一つの画面で行えます。

## 機能

### エディタ

- **シンタックスハイライト** — TTL コマンド、キーワード、変数、文字列、コメントに対応
- **補完・リント** — コマンド・変数の補完、リアルタイム診断（未定義変数、型の不一致、到達不能コードなど）
- **変数ホバー** — カーソル位置の変数値を静的に表示
- **Undo / Redo** — Ctrl+Z / Ctrl+Y（CodeMirror 履歴）
- **マルチタブ** — 最大 10 タブ。Ctrl+1〜9、Ctrl+Tab で切り替え
- **ファイル操作** — 新規 / 開く / 保存（`.ttl`）。UTF-8 / Shift_JIS、LF / CRLF / CR に対応
- **外部変更の検知** — 保存済みファイルが外部で更新されたときに再読み込みを促す
- **ダーク / ライトテーマ**

### 静的解析・サイドパネル

サイドパネルは次の 5 タブで構成されます。

| タブ | 内容 |
|------|------|
| **前提** | `include` のタブリンク、未確定分岐（`if` / `elseif`）の True/False 仮定 |
| **送信データ** | `send` / `sendln` / `sendbreak` 等の送信内容を静的に列挙・コピー |
| **ドライラン** | マクロをエディタ内でステップ実行（ダイアログ・受信待機のシミュレーション） |
| **フロー** | 制御構造のフロー図（現在行・ドライラン位置と連動） |
| **変数** | 解析結果の変数一覧（定義行へジャンプ可能） |

- **分岐仮定** — `result` など実行時にしか決まらない条件について、True/False を指定して送信データや変数解析を絞り込める（静的な「仮定」であり、Tera Term 本体の実行結果ではない）
- **`include` 解決** — 別タブの TTL をリンクし、複数ファイルをまたいだ解析・ドライランに対応

### ドライラン

- F5 で開始、Shift+F5 で停止
- `messagebox` / `inputbox` / `yesnobox` 等のダイアログをブラウザ UI で再現
- 未確定分岐に到達したときは True/False を選択して続行可能
- 実行行のハイライト、ログのコピー

## 起動方法

### 開発サーバー

```bash
npm install
npm run dev
```

ブラウザで `http://localhost:5173` を開いてください。

### オフライン利用（ビルド済み `dist/`）

```bash
npm run build
```

ビルド後、`dist/index.html` をブラウザで直接開けます（`file://`）。配布物の検証:

```bash
npm run verify-dist-offline
```

### プレビュー / デプロイ（Cloudflare Workers）

```bash
npm run preview   # ローカルで Workers 相当の環境
npm run deploy    # Cloudflare へデプロイ
```

## ショートカット

| 操作 | キー |
|------|------|
| 新規 | Ctrl+N |
| 開く | Ctrl+O |
| 保存 | Ctrl+S |
| タブを閉じる | Ctrl+W |
| 行へ移動 | Ctrl+G |
| 元に戻す / やり直し | Ctrl+Z / Ctrl+Y |
| タブ切り替え | Ctrl+Tab / Ctrl+Shift+Tab |
| タブ 1〜9 | Ctrl+1 〜 Ctrl+9 |
| ドライラン開始 / 停止 | F5 / Shift+F5 |

## テスト

```bash
npm run test              # スモークテスト
npm run test:regression   # 回帰テスト
npm run test:all          # 主要テスト一式
```

個別実行: `test:dry-run`, `test:branch-assumptions`, `test:conditional-end`, `test:flowchart`, `test:history` など（`package.json` 参照）。

検証用サンプル TTL は `samples/` にあります。

## 技術スタック

- Vite + TypeScript
- CodeMirror 6（エディタ本体）
- React + @xyflow/react（フロー図）
- Cloudflare Workers（静的アセット配信）

## 補足

- 静的解析・ドライランは [Tera Term 公式マニュアル v5](https://teratermproject.github.io/manual/5/en/macro/) を参考にしていますが、実行時 Tera Term と意図的に異なる箇所があります（例: ドライラン中の `end` はマクロ全体を終了）。
- システム変数 `result` 等の扱いの監査メモ: `docs/system-variable-result-audit.md`
