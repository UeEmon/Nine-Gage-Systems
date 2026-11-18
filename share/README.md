# みんなのレイアウト（共有サイト）

SenroLab で作ったレイアウトを投稿・共有し、投稿どうしをボードの端の線路でつないで大きなレイアウトにできるサイトです。本体とは別のコンテナ（イメージ `ghcr.io/ueemon/nine-gage-share`）で動き、データも別（`SHARE_DATA_DIR/share.sqlite`）です。

## できること

- **一覧と検索**: 題名・説明・投稿者、メーカー、「つなげる端子があるものだけ」で絞り込めます。
- **投稿**: SenroLab の「パターンの保存」で書き出したファイル（.json）を選んで投稿します。ボードの大きさが決まっていないレイアウトは投稿できません。1人1日20件まで。
- **詳細**: 平面図・端子の一覧・つながる投稿。「ファイルに保存」したものは SenroLab の「パターンの保存」→「読み込む」で開けます。投稿した人と本体の管理者は、題名・説明の変更と削除ができます（線路そのものは変えられません。直したら投稿し直す）。
- **つなぐ**: 1枚目を選び、空いている端子（緑の丸）を押すと、つなげられる投稿と置き方の候補が出ます。選ぶと試し置きが薄く出て、「この置き方でつなぐ」で並びます。つないだ全体はファイルに保存でき、ログインしていれば「つないだレイアウト」として公開できます。

## 相互接続のしくみ（`src/lib/modules.ts`）

モジュールレイアウトと同じ考え方で、**ボードの端どうしを突き合わせ、端の線路を一直線にそろえて**つなぎます。

- **端子**: ボードの端に向かって外向きに終わっている線路の端（開放端）。線路の向きが端と直角（±2°）で、端までの距離（奥行き）が300mm以内のもの。端・端に沿った位置・奥行き・高さを持ちます。
- **置き方**: 新しいボードは90°単位でだけ回し、相手の端子と向かい合うように置きます。ボードの端が接し、線路が一直線になる位置です（`placeToConnect`）。
- **すき間**: 両方の奥行きの合計が線路のすき間になります。1.5mm以下ならそのままつながり、それより長ければ同じメーカーの直線（KATO は S248〜S29、TOMIX は S280〜S18.5）を少ない本数で組み合わせて埋めます（誤差1mm以内、4本まで。`fillGap`）。ちょうどの組み合わせがなければ、スライド線路・バリアブルレールで合わせるよう表示します。
- **検査**（`checkAssembly`）: ボードの重なり、向かい合っているのに線路の位置が合わない（複線の片方がずれるなど）、高さが違う、KATO と TOMIX の組み合わせ、隣のボードに突き当たるのに続く線路がない、を出します。候補（`findCandidates`）は、問題のない置き方・つながる線路の多い置き方・足す直線の少ない置き方の順に並べます。
- **合成**（`mergeAssembly`）: 各ボードの線路・パーツ・仮オブジェクトを置き方で回して1つのレイアウトにまとめ、すき間に直線を足します。ボードは全体を囲む長方形になります。運行計画と「再現してみた」の情報は引き継ぎません。

つないだレイアウトは投稿の ID と置き方だけを保存します。元の投稿が削除されると、その部分は欠けて表示されます。

## ログイン（SenroLab のアカウント）

共有サイトはパスワードを持たず、本体にログインを確かめてもらいます（`src/lib/shareLink.ts`）。

1. 共有サイトの `/auth/login` が乱数の state を Cookie（10分）に置き、本体の `/api/share/handoff?state=…` へ移る
2. 本体はログイン中のユーザーを確かめ（ログインしていなければログイン画面を挟む）、ユーザーID・名前・ロール・state・期限（60秒）に `SENROLAB_SHARE_SECRET` で署名した合図を付けて、`SENROLAB_SHARE_URL/auth/callback` へ戻す。戻り先は環境変数で固定
3. 共有サイトは署名・期限・state を確かめ、自分のログインの Cookie（7日。`SHARE_SESSION_SECRET` で署名）を出す

本体でユーザーを消したりパスワードを変えたりしても、共有サイトのログインは最長7日残ります。管理者（本体のロール `admin`）は、すべての投稿とつないだレイアウトを削除できます。

## 環境変数

| 変数 | どちら | 内容 |
|---|---|---|
| `SENROLAB_SHARE_URL` | 本体 | 共有サイトの公開URL（例 `https://share.example.jp`）。ないと本体の「みんなのレイアウト」とログインの受け渡しは404 |
| `SENROLAB_SHARE_SECRET` | 両方 | ログインの受け渡しの署名の鍵（32文字以上、同じ値） |
| `SENROLAB_URL` | 共有サイト | 本体の公開URL（ログインとリンクに使う） |
| `SHARE_SESSION_SECRET` | 共有サイト | 共有サイトのログインの Cookie の署名の鍵（32文字以上） |
| `SHARE_DATA_DIR` | 共有サイト | データの保存先（イメージでは `/data`） |

## 手元で動かす

```sh
npm ci
# 本体（3000）
SENROLAB_SHARE_URL=http://127.0.0.1:3100 SENROLAB_SHARE_SECRET=<32文字以上> npm run dev
# 共有サイト（3100）
npx next build share
cp -r share/.next/static share/.next/standalone/share/.next/static
cd share/.next/standalone && PORT=3100 SHARE_INSECURE_COOKIE=true SHARE_DATA_DIR=/tmp/share \
  SENROLAB_URL=http://127.0.0.1:3000 SENROLAB_SHARE_SECRET=<同じ値> SHARE_SESSION_SECRET=<32文字以上> node share/server.js
```

イメージは `docker build -f share/Dockerfile .`（リポジトリのルートで）。CI がテストのあと、main では `:main`、タグ `v*` では `:stable` を作ります。

## ファイル

| ファイル | 役割 |
|---|---|
| `src/lib/modules.ts`（本体側） | 端子・置き方・すき間の線路・検査・合成 |
| `src/lib/shareLink.ts`（本体側） | ログインの受け渡しの署名と確かめ |
| `src/app/api/share/handoff/route.ts`、`src/app/share/route.ts`（本体側） | 本体のログインの受け渡しと、「みんなのレイアウト」へのリンク |
| `share/src/lib/store.ts` | 投稿・つないだレイアウトの保存（SQLite） |
| `share/src/lib/validate.ts` | 入力の確かめと上限 |
| `share/src/lib/assembly.ts` | 投稿と置き方から全体を組み立てる・ファイルにする |
| `share/src/components/Builder.tsx` | つなぐ画面 |
| `share/src/components/LayoutSvg.tsx` | 平面図（本体の `TrackPiece`・`AccessoryShape` で描く） |
