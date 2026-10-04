# Tappivra（タッピヴラ）— クリック体験デモ作成ツール

画面画像に押せる場所と案内文を設定し、相手がクリックして操作の流れを体験できる説明用デモを作る。
Windows 11 x64 エディター（Tauri 2 + React + TypeScript）と、iPhone/Android 向け閲覧専用 PWA。

- 仕様の根拠：`../briefs/026_Tappivra/`（納品資料。変更しない）
- 開発手順：`DEVELOPMENT.txt`
- 実装状況・依存バージョン：`IMPLEMENTATION_STATUS.txt`
- 試験結果（T01〜T36）：`TEST_REPORT.txt`
- Codex 独立監修への引き継ぎ：`CODEX_HANDOFF.txt`
- 購入者向け説明書：`release-docs/`

## 構成

| パス | 内容 |
|---|---|
| `src/domain/` | モデル型・Zod スキーマ・グラフ検査・書き出し前チェック・コマンド/Undo |
| `src/media/` | 形式判定（ヘッダーのみ）・Canvas 黒塗り焼き込み・再エンコード・sha256 |
| `src/export/` | 公開 DemoDocument 変換・単独 HTML・閲覧 ZIP・編集 ZIP・制限付き ZIP 読込 |
| `src/viewer/` | 共通閲覧ランタイム（DOM/CSS、React 非依存。HTML 用 IIFE エントリー） |
| `src/pwa/` | 閲覧 PWA（React の薄いシェル、IndexedDB 明示保存、Service Worker） |
| `src/editor/` | エディター画面 A〜F |
| `src/platform/` | 保存層（Tauri IPC / Web 開発用 mock） |
| `src-tauri/` | Rust：rusqlite ローカル DB、限定 IPC、保存ダイアログ、単一インスタンス |
| `build/` | Vite プラグイン（ランタイム IIFE 取り込み、PWA manifest/SW 生成） |
| `scripts/` | verify:release / package:release / THIRD_PARTY_NOTICES 生成 |
| `tests/` | Playwright E2E・テスト用フィクスチャ |
| `samples/` | アプリの実処理で生成した quickstart サンプル（npm run samples） |
| `public/brand/` | 納品ブランド素材（同一 bytes を実使用） |
