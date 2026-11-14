# Nine-Gage-Systems

AIと一緒にNゲージ鉄道模型の線路レイアウトを設計するWebアプリです。

## できること

- **メーカー選択**: KATO（ユニトラック）と TOMIX（ファイントラック）から選べます。パレット・AIの提案・部品リストがそのメーカーの線路になります。
- **線路エディタ**: 直線・曲線・ポイント・車止めを、選んだ端（赤い丸）につないでいきます。ドラッグで移動すると近くの端に吸着します。回転・左右反転・削除（キー: `R` / `F` / `Delete`）。
- **ボード設定**: 900×600、サブロク（1820×910）などのプリセットか任意のサイズ。はみ出した線路は赤く表示されます。
- **AIレイアウト提案**: 要望を日本語で書くと、AIが線路部品の並びを提案します。アプリ側で組み立てて「つながっていない端・ずれ・ボード外・重なり」を検査し、問題があればAIに直させます（最大4回）。
- **AIの切り替え**: Claude・OpenAI・Gemini・ローカルLLM（Ollama / LM Studio / vLLM など OpenAI 互換API）から選べます。モデル・APIキー・接続先URLは画面の「AI設定」かサーバーの環境変数で設定し、「一覧」ボタンで使えるモデルを取得できます。
- **確認結果と部品リスト**: 必要な線路を**メーカー品番**ごとに本数・箱数で表示します（ポイントは左右別）。線路延長も表示します。
- **保存**: ブラウザに自動保存。JSONファイルで保存・読み込みもできます。

## 線路カタログ

品番・製品名・寸法・入数は、各社公式サイトの製品一覧から抽出して `src/data/trackCatalog.ts` にまとめています（出典URLと取得日をファイルに記載）。

- KATO: [直線](https://unitrack.katomodels.com/products/line_single/straight_line) / [曲線](https://unitrack.katomodels.com/products/line_single/curve_line) / [分岐・交差](https://unitrack.katomodels.com/products/line_single/branch_cross) / [車止め](https://unitrack.katomodels.com/products/line_single/car_stop)
- TOMIX: [基本レール](https://www.tomytec.co.jp/tomix/nyumon/tomixrail/raillineup.cgi) / [ポイント](https://www.tomytec.co.jp/tomix/nyumon/tomixrail/raillineup.cgi?category=rail_point) / [特殊レール](https://www.tomytec.co.jp/tomix/nyumon/tomixrail/raillineup.cgi?category=rail_spc)

公式の一覧ページにポイントの直進長・分岐半径の数値がないものは、製品名と各社規格の一般的な値で補い、`geometryNote` に明記しています。Y字・3方・ダブルクロス・交差・コンパクト曲線・複線線路などは、まだ配置計算に対応していないため含めていません。新しい部品は `trackCatalog.ts` に1行足すとパレット・AI・部品リストに反映されます。

## 仕組み

AIに座標を直接計算させるとずれが出やすいため、AIには「どの部品をどの順につなぐか」だけを構造化出力（JSON）で出させ、座標はアプリが計算します。

```
要望 ──▶ AI (Claude / OpenAI / Gemini / ローカルLLM, 構造化出力) ──▶ 部品の並び
                ▲                                 │
                └── 問題点のフィードバック ◀── 幾何計算・検査 (src/lib/plan.ts, geometry.ts)
```

| ファイル | 役割 |
|---|---|
| `src/data/trackCatalog.ts` | KATO・TOMIXの品番・寸法（公式サイトから抽出） |
| `src/lib/parts.ts` | カタログから部品の形とジョイント（接続端）を生成 |
| `src/lib/bom.ts` | 品番ごとの必要本数・箱数の集計 |
| `src/lib/geometry.ts` | 配置計算、接続判定、はみ出し・重なり検査、部品集計 |
| `src/lib/plan.ts` | AIの出力スキーマと、部品の並び → 配置への変換 |
| `src/lib/ai.ts` | システムプロンプトと、検証・再試行ループ（プロバイダ共通） |
| `src/lib/llm/` | プロバイダごとの呼び出し（`anthropic.ts` / `openai.ts`（ローカルLLMも） / `gemini.ts`）と設定の解決 |
| `src/app/api/models/route.ts` | モデル一覧API |
| `src/app/api/propose/route.ts` | 提案API |
| `src/components/Editor.tsx` | エディタ画面 |

## 開発

```bash
npm install
cp .env.example .env.local   # 使うAIのAPIキーを設定（画面から入力してもよい）
npm run dev                  # http://localhost:3000
npm test                     # ジオメトリとAIループのテスト
npm run typecheck
```

## AIの設定

| プロバイダ | APIキー | モデル（既定） | 接続先URL |
|---|---|---|---|
| Claude | `ANTHROPIC_API_KEY` | `ANTHROPIC_MODEL`（claude-opus-5-5） | — |
| OpenAI | `OPENAI_API_KEY` | `OPENAI_MODEL`（gpt-5） | `OPENAI_BASE_URL`（任意） |
| Gemini | `GEMINI_API_KEY` | `GEMINI_MODEL`（gemini-2.5-pro） | — |
| ローカルLLM | `LOCAL_LLM_API_KEY`（任意） | `LOCAL_LLM_MODEL`（llama3.1） | `LOCAL_LLM_BASE_URL`（http://localhost:11434/v1） |

- 画面の入力が環境変数より優先されます。画面で入れたキーはそのブラウザの localStorage にだけ保存されます。
- 構造化出力（JSON Schema）に対応していないローカルLLMでは、自動で「JSONだけを出力」する指示に切り替えます。小さなモデルだと線路がうまく閉じないことがあるので、14B以上を目安にしてください。
- ローカルLLMのURLは、このアプリの**サーバーから見た**アドレスです。クラウドに置いた場合、手元PCのOllamaにはそのままでは届きません。
- 本番環境（`NODE_ENV=production`）では、画面から接続先URLを変えることは既定で禁止です（任意のURLへサーバーから通信させないため）。自分専用のサーバーなら `AI_ALLOW_CUSTOM_BASE_URL=true` で許可できます。

## デプロイ

`output: "standalone"` でビルドするので、Docker でそのまま動きます。

```bash
docker build -t nine-gage .
docker run -p 3000:3000 --env-file .env.local nine-gage
```

AI提案は1回に1〜3分かかることがあるため、リバースプロキシのタイムアウトは300秒程度にしてください。
