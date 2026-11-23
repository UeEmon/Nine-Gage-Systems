# 機能マップと担当

<!-- このファイルは .github/features.json から `npm run features` で作っています。直接編集しないでください。 -->

SenroLab のソースを機能ごとに分け、機能ごとに担当者を決めています。担当者は、その機能のファイルを変える PR のレビュー（承認）と、その機能の Issue を受け持ちます。

## しくみ

- **担当の決め方**: `.github/features.json` の `owners` に GitHub のユーザー名（`@name`）かチーム（`@org/team`）を書き、`npm run features` を実行してコミットします。
- **PR のレビュー**: 機能ごとの `CODEOWNERS` により、変更したファイルの担当者の承認が必要になります。ただしサーバー・API・CI など保護する場所（下の「保護する場所の担当」）は、機能の担当ではなく保護の担当者の承認が必要です。
- **最終承認**: 機能の担当の承認とは別に、すべての PR は統括管理責任者（@UeEmon）が最新のコミットを Approve しないとマージできません（チェック「最終承認」）。承認のあとにコミットを足したら、もう一度承認が要ります。統括管理責任者が自分で出した PR は、出したことを承認とみなします（GitHub では自分の PR を Approve できないため）。
- **PR のラベル**: 変更したファイルに合わせて `feature:機能ID` のラベルが自動で付きます。
- **Issue**: 「機能の追加・改善」「不具合の報告」のテンプレートで機能区分を選ぶと、ラベルが付き、その機能の担当者が割り当てられます。
- **新しいファイル**: 置いた場所がどの機能にも入っていないと、テスト（`npm test`）が失敗します。`.github/features.json` のその機能の `paths` に足してください。新しい機能を作るときは、機能を1件足し、ファイルはその機能のフォルダにまとめて置くと担当の設定が1行で済みます。

## 機能一覧

| 機能 | ラベル | 担当 | 内容 |
|---|---|---|---|
| 線路エディタ | `feature:editor` | @UeEmon | キャンバス・線路のつなぎ方と吸着・ボード設定・パレット・パターンの保存と読み込み |
| 線路カタログ・品番DB | `feature:catalog` | @UeEmon | KATO・TOMIX の線路の品番・寸法・道床・価格のデータと、品番データベース（/api/products） |
| 高架・立体交差 | `feature:elevation` | @UeEmon | 線路の高さ・勾配・橋脚の選定と検査、断面図 |
| 線路以外のパーツ | `feature:accessories` | @UeEmon | 踏切・信号機・ホーム・駅舎・建物などのストラクチャーのデータと置き方 |
| 部品リスト・所有パーツ | `feature:bom` | @UeEmon | 必要な品番・本数・箱数・費用の集計と、手持ちの所有パーツの登録 |
| 運転席視点（3D） | `feature:drive` | @UeEmon | レイアウトの上を走る3Dの運転席視点・後ろからの視点・録画 |
| 運行計画 | `feature:operation` | @UeEmon | 作ったレイアウトで列車の運行計画（ダイヤ・運用）を立てる機能 |
| デジタルツイン | `feature:twin` | @UeEmon | 実物のレイアウト（実機・模擬の実機）とつなぎ、列車の位置・ポイント・センサーの状態を映して、アプリから操作する機能 |
| AIレイアウト提案 | `feature:ai` | @UeEmon | AIへの指示と検査・修正のループ、AIプロバイダの切り替え、自分のAPIキー、利用量と料金 |
| アカウント・ログイン・ロール | `feature:auth` | @UeEmon | ユーザー登録とメール確認、ログイン、パスワード、ロール（管理者・プレミアム・一般） |
| 管理画面 | `feature:admin` | @UeEmon | 管理画面の枠とユーザー管理（AI設定・お知らせの管理画面はそれぞれの機能の担当） |
| お知らせ・リリースノート | `feature:notices` | @UeEmon | ベルの未読通知、更新履歴（/news）、管理者からのお知らせ、リリースノート |
| みんなのレイアウト（共有サイト） | `feature:share` | @UeEmon | レイアウトの投稿・共有と、投稿どうしをボードの端の線路でつなぐ仕組み（別コンテナの share/）、本体からのログインの受け渡し |
| 改善リクエスト | `feature:feedback` | @UeEmon | 利用者がアプリから送る改善リクエストと、GitHub の Issue への自動登録、管理画面の一覧 |
| 基盤・運用 | `feature:platform` | @UeEmon | データの保存（SQLite）・暗号化・バックアップ・死活確認、画面の共通部分とブランド、ビルド・CI・デプロイ、文書 |

保護する場所の担当: @UeEmon（`/.github/`、`/Dockerfile`、`/.dockerignore`、`/package.json`、`/package-lock.json`、`/next.config.ts`、`/src/lib/server/`、`/src/app/api/`、`/src/lib/llm/`、`/scripts/`、`/share/Dockerfile`、`/share/next.config.ts`、`/share/src/app/api/`、`/share/src/app/auth/`、`/share/src/lib/`）

## 機能ごとのファイル

### 線路エディタ（`feature:editor`）

- `/src/app/page.tsx`
- `/src/components/Editor.tsx`
- `/src/components/TrackPiece.tsx`
- `/src/components/PartIcon.tsx`
- `/src/components/PartDetail.tsx`
- `/src/components/LibraryPanel.tsx`
- `/src/components/useLocalState.ts`
- `/src/lib/geometry.ts`
- `/src/lib/shapes.ts`
- `/src/lib/patternFile.ts`
- `/tests/geometry.test.ts`

### 線路カタログ・品番DB（`feature:catalog`）

- `/src/data/trackCatalog.ts`
- `/src/data/prices.ts`
- `/src/lib/parts.ts`
- `/src/lib/productDb.ts`
- `/src/app/api/products/`
- `/tests/catalog.test.ts`
- `/tests/beds.test.ts`
- `/tests/productDb.test.ts`

### 高架・立体交差（`feature:elevation`）

- `/src/lib/elevation.ts`
- `/src/data/piers.ts`
- `/src/components/LevelProfile.tsx`
- `/tests/elevation.test.ts`
- `/tests/underground.test.ts`

### 線路以外のパーツ（`feature:accessories`）

- `/src/data/accessories.ts`
- `/src/lib/accessories.ts`
- `/src/components/AccessoryShape.tsx`
- `/tests/accessories.test.ts`

### 部品リスト・所有パーツ（`feature:bom`）

- `/src/lib/bom.ts`
- `/src/components/InventoryPanel.tsx`

### 運転席視点（3D）（`feature:drive`）

- `/src/lib/drive.ts`
- `/src/lib/driveScene.ts`
- `/src/components/DriveView.tsx`
- `/tests/drive.test.ts`

### 運行計画（`feature:operation`）

- `/src/lib/operation/`
- `/src/components/operation/`
- `/src/app/api/operation/`
- `/tests/operation*.test.ts`

### デジタルツイン（`feature:twin`）

- `/src/lib/twin/`
- `/src/components/twin/`
- `/tests/twin.test.ts`

### AIレイアウト提案（`feature:ai`）

- `/src/lib/ai.ts`
- `/src/lib/plan.ts`
- `/src/lib/replica.ts`
- `/src/lib/llm/`
- `/src/lib/server/aiSettings.ts`
- `/src/lib/server/aiUsage.ts`
- `/src/lib/server/ownAi.ts`
- `/src/lib/server/proposeCache.ts`
- `/src/lib/server/proposeJobs.ts`
- `/src/lib/server/aiLayouts.ts`
- `/src/lib/server/papercraft.ts`
- `/src/app/api/propose/`
- `/src/app/api/ai-layouts/`
- `/src/app/api/papercraft/`
- `/src/app/api/models/`
- `/src/app/api/ai-config/`
- `/src/app/api/account/ai/`
- `/src/app/api/admin/ai/`
- `/src/app/api/admin/ai-usage/`
- `/src/components/AiStatus.tsx`
- `/src/components/AiHistoryPanel.tsx`
- `/src/components/OwnAiForm.tsx`
- `/src/components/ModelSelect.tsx`
- `/src/app/guide/api-key/`
- `/src/components/AdminAiPanel.tsx`
- `/src/components/AdminAiUsagePanel.tsx`
- `/src/components/SimObjectShape.tsx`
- `/tests/ai.test.ts`
- `/tests/anthropicStream.test.ts`
- `/tests/cache.test.ts`
- `/tests/proposeJobs.test.ts`
- `/tests/aiLayouts.test.ts`
- `/tests/replica.test.ts`
- `/tests/papercraft.test.ts`

### アカウント・ログイン・ロール（`feature:auth`）

- `/src/lib/roles.ts`
- `/src/lib/server/auth.ts`
- `/src/lib/server/session.ts`
- `/src/lib/server/password.ts`
- `/src/lib/server/users.ts`
- `/src/lib/server/mailer.ts`
- `/src/app/api/auth/`
- `/src/app/login/`
- `/src/app/signup/`
- `/src/app/verify/`
- `/src/app/account/`
- `/src/components/LoginForm.tsx`
- `/src/components/SignupForm.tsx`
- `/src/components/VerifyForm.tsx`
- `/src/components/PasswordForm.tsx`
- `/src/components/UserMenu.tsx`
- `/tests/auth.test.ts`
- `/tests/roles.test.ts`

### 管理画面（`feature:admin`）

- `/src/app/admin/`
- `/src/app/api/admin/users/`
- `/src/components/AdminUsersPanel.tsx`

### お知らせ・リリースノート（`feature:notices`）

- `/src/data/releases.ts`
- `/src/lib/server/notices.ts`
- `/src/app/news/`
- `/src/app/api/notices/`
- `/src/app/api/admin/notices/`
- `/src/components/NoticeBell.tsx`
- `/src/components/NoticeList.tsx`
- `/src/components/AdminNoticesPanel.tsx`
- `/tests/notices.test.ts`

### みんなのレイアウト（共有サイト）（`feature:share`）

- `/share/`
- `/src/lib/modules.ts`
- `/src/lib/shareLink.ts`
- `/src/lib/server/share.ts`
- `/src/app/api/share/`
- `/src/app/share/`
- `/tests/modules.test.ts`
- `/tests/share.test.ts`

### 改善リクエスト（`feature:feedback`）

- `/src/lib/feedback.ts`
- `/src/lib/server/feedback.ts`
- `/src/app/feedback/`
- `/src/app/api/feedback/`
- `/src/app/api/admin/feedback/`
- `/src/components/FeedbackForm.tsx`
- `/src/components/AdminFeedbackPanel.tsx`
- `/tests/feedback.test.ts`

### 基盤・運用（`feature:platform`）

- `/src/lib/server/db.ts`
- `/src/lib/server/store.ts`
- `/src/lib/server/secretBox.ts`
- `/src/app/api/health/`
- `/src/app/layout.tsx`
- `/src/app/globals.css`
- `/src/app/favicon.ico`
- `/src/app/icon.svg`
- `/src/app/apple-icon.png`
- `/src/components/BrandLogo.tsx`
- `/scripts/`
- `/tests/backup.test.ts`
- `/tests/storeSecrets.test.ts`
- `/tests/features.test.ts`
- `/tests/fixtures.ts`
- `/.github/`
- `/docs/`
- `/Dockerfile`
- `/.dockerignore`
- `/.env.example`
- `/.gitignore`
- `/package.json`
- `/package-lock.json`
- `/next.config.ts`
- `/tsconfig.json`
- `/vitest.config.ts`
- `/README.md`
- `/AGENTS.md`
- `/CLAUDE.md`
