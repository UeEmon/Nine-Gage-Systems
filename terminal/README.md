# ターミナル（レイアウトの共有）

SenroLab プラットフォームで作ったレイアウトを投稿・共有し、投稿どうしをボードの端の線路でつないで大きなレイアウトにできるサイトです。プラットフォームとは別のコンテナ（イメージ `ghcr.io/ueemon/nine-gage-terminal`）で動き、データも別（`TERMINAL_DATA_DIR/terminal.sqlite`）です。

## できること

- **一覧と検索**: 題名・説明・投稿者、メーカー、「つなげる端子があるものだけ」「運行計画があるものだけ」で絞り込めます。
- **投稿**: プラットフォームの「パターンの保存」で書き出したファイル（.json）を選んで投稿します。ボードの大きさが決まっていないレイアウトは投稿できません。1人1日20件まで。運行計画（列車・駅名）があれば一緒に投稿でき、投稿の画面で外すこともできます（列車200本、1列車の停車駅200駅まで）。
- **詳細**: 平面図・端子の一覧・つながる投稿。運行計画があれば駅・列車の一覧とダイヤグラムも出ます。「ファイルに保存」したものはプラットフォームの「パターンの保存」→「読み込む」で開けます。投稿した人とプラットフォームの管理者は、題名・説明の変更と削除ができます（線路そのものは変えられません。直したら投稿し直す）。
- **つなぐ**: 1枚目を選び、空いている端子（緑の丸）を押すと、つなげられる投稿と置き方の候補が出ます。選ぶと試し置きが薄く出て、「この置き方でつなぐ」で並びます。つないだ全体はファイルに保存でき、ログインしていれば「つないだレイアウト」として公開できます。

## 相互接続のしくみ（`src/lib/modules.ts`）

モジュールレイアウトと同じ考え方で、**ボードの端どうしを突き合わせ、端の線路を一直線にそろえて**つなぎます。

- **端子**: ボードの端に向かって外向きに終わっている線路の端（開放端）。線路の向きが端と直角（±2°）で、端までの距離（奥行き）が300mm以内のもの。端・端に沿った位置・奥行き・高さを持ちます。
- **置き方**: 新しいボードは90°単位でだけ回し、相手の端子と向かい合うように置きます。ボードの端が接し、線路が一直線になる位置です（`placeToConnect`）。
- **すき間**: 両方の奥行きの合計が線路のすき間になります。1.5mm以下ならそのままつながり、それより長ければ同じメーカーの直線（KATO は S248〜S29、TOMIX は S280〜S18.5）を少ない本数で組み合わせて埋めます（誤差1mm以内、4本まで。`fillGap`）。ちょうどの組み合わせがなければ、スライド線路・バリアブルレールで合わせるよう表示します。
- **検査**（`checkAssembly`）: ボードの重なり、向かい合っているのに線路の位置が合わない（複線の片方がずれるなど）、高さが違う、KATO と TOMIX の組み合わせ、隣のボードに突き当たるのに続く線路がない、を出します。候補（`findCandidates`）は、問題のない置き方・つながる線路の多い置き方・足す直線の少ない置き方の順に並べます。
- **合成**（`mergeAssembly`）: 各ボードの線路・パーツ・仮オブジェクトを置き方で回して1つのレイアウトにまとめ、すき間に直線を足します。ボードは全体を囲む長方形になります。運行計画は各ボードの駅名・列車をボードごとに引き継ぎます（ID に `m0_` などを付けて重ならないようにする）。「再現してみた」の情報は引き継ぎません。

つないだレイアウトは投稿の ID と置き方だけを保存します。元の投稿が削除されると、その部分は欠けて表示されます。

## ログイン（SenroLab のアカウント）

ターミナルはパスワードを持たず、プラットフォームにログインを確かめてもらいます（`src/lib/terminalLink.ts`）。

1. ターミナルの `/auth/login` が乱数の state を Cookie（10分）に置き、プラットフォームの `/api/terminal/handoff?state=…` へ移る
2. プラットフォームはログイン中のユーザーを確かめ（ログインしていなければログイン画面を挟む）、ユーザーID・名前・ロール・state・期限（60秒）に `SENROLAB_TERMINAL_SECRET` で署名した合図を付けて、`SENROLAB_TERMINAL_URL/auth/callback` へ戻す。戻り先は環境変数で固定
3. ターミナルは署名・期限・state を確かめ、自分のログインの Cookie（7日。`TERMINAL_SESSION_SECRET` で署名）を出す

プラットフォームでユーザーを消したりパスワードを変えたりしても、ターミナルのログインは最長7日残ります。管理者（プラットフォームのロール `admin`）は、すべての投稿とつないだレイアウトを削除できます。

## 環境変数

| 変数 | どちら | 内容 |
|---|---|---|
| `SENROLAB_TERMINAL_URL` | プラットフォーム | ターミナルの公開URL（例 `https://terminal.example.jp`）。ないとプラットフォームの「ターミナル」とログインの受け渡しは404 |
| `SENROLAB_TERMINAL_SECRET` | 両方 | ログインの受け渡しの署名の鍵（32文字以上、同じ値） |
| `SENROLAB_URL` | ターミナル | プラットフォームの公開URL（ログインとリンクに使う） |
| `TERMINAL_SESSION_SECRET` | ターミナル | ターミナルのログインの Cookie の署名の鍵（32文字以上） |
| `TERMINAL_DATA_DIR` | ターミナル | データの保存先（イメージでは `/data`） |

名称変更（2026-11-24）前の環境変数名（`SENROLAB_SHARE_URL`・`SENROLAB_SHARE_SECRET`・`SHARE_SESSION_SECRET`・`SHARE_DATA_DIR`・`SHARE_INSECURE_COOKIE`）も、新しい名前がないときに読みます。データの `share.sqlite` は、`terminal.sqlite` がなければ起動時に `terminal.sqlite` へ名前を変えます。

## 手元で動かす

```sh
npm ci
# プラットフォーム（3000）
SENROLAB_TERMINAL_URL=http://127.0.0.1:3100 SENROLAB_TERMINAL_SECRET=<32文字以上> npm run dev
# ターミナル（3100）
npx next build terminal
cp -r terminal/.next/static terminal/.next/standalone/terminal/.next/static
cd terminal/.next/standalone && PORT=3100 TERMINAL_INSECURE_COOKIE=true TERMINAL_DATA_DIR=/tmp/terminal \
  SENROLAB_URL=http://127.0.0.1:3000 SENROLAB_TERMINAL_SECRET=<同じ値> TERMINAL_SESSION_SECRET=<32文字以上> node terminal/server.js
```

イメージは `docker build -f terminal/Dockerfile .`（リポジトリのルートで）。CI がテストのあと、main では `:main`、タグ `v*` では `:stable` を作ります。

## ファイル

| ファイル | 役割 |
|---|---|
| `src/lib/modules.ts`（プラットフォーム側） | 端子・置き方・すき間の線路・検査・合成 |
| `src/lib/terminalLink.ts`（プラットフォーム側） | ログインの受け渡しの署名と確かめ |
| `src/app/api/terminal/handoff/route.ts`、`src/app/terminal/route.ts`（プラットフォーム側） | プラットフォームのログインの受け渡しと、「ターミナル」へのリンク |
| `terminal/src/lib/store.ts` | 投稿・つないだレイアウトの保存（SQLite） |
| `terminal/src/lib/validate.ts` | 入力の確かめと上限 |
| `terminal/src/lib/assembly.ts` | 投稿と置き方から全体を組み立てる・ファイルにする |
| `terminal/src/components/Builder.tsx` | つなぐ画面 |
| `terminal/src/components/LayoutSvg.tsx` | 平面図（プラットフォームの `TrackPiece`・`AccessoryShape` で描く） |
