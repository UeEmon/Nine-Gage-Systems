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

| 種類 | KATO ユニトラック | TOMIX ファイントラック |
|---|---|---|
| 直線 | S248〜S62、S64、端数(S45/S38/S33/S29)、スライド線路 | S280〜S70、S72.5、端数(S33/S18.5)、バリアブルV70 |
| 曲線 | R117〜R381（45°/30°/15°）、R481-15、R718-15、コンパクト曲線 | C243〜C391（45°/15°）、C541-15、C605-10、ミニ/スーパーミニ(C103/C140/C177) |
| ポイント | 6番・4番（左右）、Y字2番、コンパクトR150、複線片渡り4番、ダブルクロス | PL541-15・PL280-30・ミニPL140-30（左右）、Y字PY280-15、3方、カーブポイント、ダブルクロッシングPX280、ダブルスリップ |
| 交差 | 15°（左右）、90° | XL/XR140-15、X72.5-30、X37-90 |
| 複線 | 直線DS248〜DS62、曲線R414/R315/R480、アプローチ、間隔変換33→66 | 直線DS280/DS140/DS1120、曲線DC317/DC391/DC465 |
| 車止め | 車止め線路A〜D | エンドレールE |

- 出典: KATO [線路単品](https://unitrack.katomodels.com/products/line_single)、TOMIX [トミックスレール製品一覧](https://www.tomytec.co.jp/tomix/nyumon/tomixrail/raillineup.cgi)
- PC版・スラブ版・高架橋付・フィーダー付などは、形が同じなので同じ部品の「ほかの品番」として載せています。
- 公式の一覧ページに数値がない寸法（ポイントの直進長、交差の長さ、複線間隔、渡り線の曲線など）は、製品名と一般的な規格値で補い、部品ごとの `geometryNote` に「推定」と明記しています。TOMIXの規格表PDFは画像のみで数値を読み取れませんでした。
- 部品の形は `src/lib/shapes.ts` の「経路（直線と円弧の並び）」で表すので、ジョイントが3つ以上の部品（3方・交差・ダブルクロス・複線）も同じ仕組みで配置・接続判定できます。

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
| `src/lib/shapes.ts` | 部品の形（直線・円弧の経路）と、そこから求めるジョイント |
| `src/lib/parts.ts` | カタログから部品定義を生成 |
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
