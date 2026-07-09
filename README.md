# TTL Macro Editor

Tera Term マクロ（TTL）用のブラウザ完結型エディタです。

## 機能

- **シンタックスハイライト** — TTL コマンド、キーワード、変数、文字列、コメントに対応
- **Undo / Redo** — Ctrl+Z / Ctrl+Y（CodeMirror 履歴）
- **変数の静的解析** — 未定義変数、型の不一致、未使用変数、ブロック構造の検証
- **ファイル操作** — 新規 / 開く / 保存（`.ttl`）
- **ダーク / ライトテーマ**

## 起動方法

```bash
npm install
npm run dev
```

ブラウザで `http://localhost:5173` を開いてください。

## ビルド

```bash
npm run build
npm run preview
```

## 技術スタック

- Vite + TypeScript
- CodeMirror 6
