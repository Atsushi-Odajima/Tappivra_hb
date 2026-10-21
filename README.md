# Tappivra — クリックして試せる説明用デモを作る

画面画像に押せる場所・案内文・遷移先を設定し、操作の流れを体験できる閲覧用デモを作るツールです。

実装ブランチ：`claude/tappivra-026-implementation`。アプリ本体は `026-tappivra-app/`。

## できること

- 画面・ホットスポット・案内・遷移の編集とグラフ検査
- 黒塗りの焼き込み、単独HTML・閲覧ZIP・編集ZIPの入出力
- 共通閲覧ランタイム、PWA閲覧、Tauri / SQLiteによるWindows保存層

## 現在の範囲・制限

- npm run devはブラウザ用の開発mock保存層です。Windowsネイティブの確認にはRust・Tauri・WebView2等が必要です。
- Windows実機・モバイル実機・署名・PWA実配備は未完了です。Rust依存物のライセンス全文同梱等も配布前の残項目です。

## 実装の見どころ

**構成：** Tauri / Rust / SQLite、React / TypeScript / Vite、PWA。

- [026-tappivra-app/src](./026-tappivra-app/src)
- [026-tappivra-app/src-tauri](./026-tappivra-app/src-tauri)
- [026-tappivra-app/tests](./026-tappivra-app/tests)

## ローカルで試す

Web開発はNode.js 20.19以上。Windows版は開発手順に沿ってRust / Tauriの環境を別途準備します。

実装ブランチを取得し、次のディレクトリで作業します。

```sh
git clone --branch claude/tappivra-026-implementation https://github.com/Atsushi-Odajima/Tappivra_hb.git
cd Tappivra_hb/026-tappivra-app
npm install
npm run dev
```

環境設定・初期化の詳細：[セットアップ手順](./026-tappivra-app/DEVELOPMENT.txt)。

## 検証方法

`026-tappivra-app/` の `package.json` に定義された主な確認コマンドです。DB・ブラウザ・外部ツールを要するものは、開発手順の事前設定が必要です。

```sh
npm run typecheck
npm run lint
npm run test
npm run test:e2e
npm run build
```

試験の実施環境・結果・未実施項目は、下記の記録を参照してください。画面エミュレーションと実機確認、モックと外部サービスでの確認を区別しています。

## 資料

- [026-tappivra-app/DEVELOPMENT.txt](./026-tappivra-app/DEVELOPMENT.txt)
- [026-tappivra-app/CODEX_HANDOFF.txt](./026-tappivra-app/CODEX_HANDOFF.txt)
- [026-tappivra-app/README.md](./026-tappivra-app/README.md)
- [026-tappivra-app/TEST_REPORT.txt](./026-tappivra-app/TEST_REPORT.txt)

## 制作・利用条件

制作・管理：**Atsushi Odajima**。実装・資料作成にはAI支援を利用しています。
ソース・同梱ライブラリ・フォント・モデル等の利用条件は、各ライセンスと第三者表記を参照してください。リポジトリの閲覧可能性と、再配布・商用利用の許諾は別です。
