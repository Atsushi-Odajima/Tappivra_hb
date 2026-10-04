026_Tappivra — Claude Code実装引き渡しセット
版 1.0 / 2026-10-04

このZIPは「企画・調査・実装指示・ブランド素材」です。
アプリのソースコードや実行ファイルはまだありません。画像はUIの設計見本です。

【Claude Codeに渡す方法】
1. ZIPを展開する。
2. このフォルダをClaude Codeから読める場所へ置く。
   例：C:\work\briefs\026_Tappivra
3. 既存商品とは別の実装先を用意する。
   例：C:\work\026-tappivra-app
4. Claude Codeへ次の指示を渡す。

--- そのまま渡す指示 ---
この資料フォルダのREADME.txtを読み、01_claude_code_prompt.txtの仕様に従ってTappivraを実装してください。
03_brand_and_ui_spec.txtとassets内の画像・ロゴ・アイコンを参照し、実際のUIとアセットへ適用してください。
02_market_and_name_research.txtの仮説・未確認事項を事実として扱わないでください。
samplesは架空のテスト入力として使用し、04_acceptance_and_codex_review.txtのT01〜T36で検証してください。
別商品を変更せず、独立した026-tappivra-appフォルダに実装します。
実行していない試験は未検証と記録し、最後にCODEX_HANDOFF.txtと販売前の残条件を提出してください。
--- 指示終わり ---

【読む順序】
00_product_summary.txt        商品の対象・操作・成果・価格仮説
01_claude_code_prompt.txt     完全版の実装指示、保存/配布/安全性/ビルド
03_brand_and_ui_spec.txt      色、文字、余白、部品、画面、レスポンシブ指定
04_acceptance_and_codex_review.txt  T01〜T36、Codex独立監修
02_market_and_name_research.txt    3競合、参照URL、名称照合、事実/仮説
05_asset_rights_and_limits.txt     素材の出所と未確認事項
06_package_validation.txt          今回のZIP・素材の検査結果

【ブランド素材】
assets/brand_board.png         全体像。今回の白黒＋青の正本。
assets/ui_editor.png           Windowsエディターの静的画面設計。
assets/ui_mobile.png           iPhone向け閲覧PWAの静的画面設計。
assets/logo_horizontal.png     透過横長ロゴ。
assets/logo_horizontal.svg     同ロゴのアウトラインベクター。
assets/logo_horizontal_dark.png / .svg  暗背景用。
assets/logo_mark.png / .svg    独立マーク。
assets/pwa_icon_192.png        PWA any用、192×192。
assets/pwa_icon_512.png        PWA any用、512×512。
assets/pwa_maskable_512.png    PWA maskable用、512×512。
assets/apple_touch_icon.png   iOS用、180×180。
assets/favicon_32.png         ブラウザー用、32×32。
assets/design_tokens.json     色・寸法の実装補助。
assets/typeface_license_notices.txt  書体の権利表示。フォント本体は非同梱。

【サンプル】
samples/sample_project_spec.json  画像とクリック先のテスト仕様。
samples/screen_01.png〜screen_05.png  架空サンプル画面。
上記JSONはTappivraの動作確認済み編集ファイルではない。
Claude Codeが実装後にUUID・画像確認処理・公開変換を通して、本物の編集/閲覧サンプルへ変換する。
画面データをブランドボード画像から切り抜いて使う必要はない。

【重要】
編集はWindows 11 x64。iPhone/Androidは閲覧用で、スマホ編集は対象外。
AI API・アプリ登録・購入者サーバーを必須にしない。
画像内のボタンを背景として貼り付けて「実装済み」にしない。
PWAは販売者が検証後に静的HTTPS配備する。今回公開済みのURLはない。
商標は未確認。名称を法的に使用可能と保証しない。
有料契約、証明書購入、アカウント登録、外部公開、実顧客への送信は行わない。

【検証範囲】
今回確認したのはTXTの読込、必要ファイル、画像、透過、SVG、ZIP解凍と同一性。
アプリの動作試験・実機試験・ビルドは未実施であり、Claude Codeの担当工程。
checksums.sha256に同梱ファイルのSHA-256を記録する（自分自身は除く）。

[README終了：Tappivra / 1.0]
