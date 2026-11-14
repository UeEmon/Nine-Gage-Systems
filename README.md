# Nine-Gage-Systems

AIと一緒にNゲージ鉄道模型の線路レイアウトを設計するWebアプリです。

## できること

- **線路エディタ**: 直線・曲線（R216〜R718）・#6ポイント・車止めを、選んだ端（赤い丸）につないでいきます。ドラッグで移動すると近くの端に吸着します。回転・左右反転・削除（キー: `R` / `F` / `Delete`）。
- **ボード設定**: 900×600、サブロク（1820×910）などのプリセットか任意のサイズ。はみ出した線路は赤く表示されます。
- **AIレイアウト提案**: 要望を日本語で書くと、Claude が線路部品の並びを提案します。アプリ側で組み立てて「つながっていない端・ずれ・ボード外・重なり」を検査し、問題があれば Claude に直させます（最大4回）。
- **確認結果と部品リスト**: 必要な線路の種類と本数、線路延長を表示します。
- **保存**: ブラウザに自動保存。JSONファイルで保存・読み込みもできます。

線路の寸法は KATO ユニトラック互換の一般的な規格です（`src/lib/parts.ts`）。

## 仕組み

AIに座標を直接計算させるとずれが出やすいため、AIには「どの部品をどの順につなぐか」だけを構造化出力（JSON）で出させ、座標はアプリが計算します。

```
要望 ──▶ Claude (claude-opus-5-5, 構造化出力) ──▶ 部品の並び
                ▲                                 │
                └── 問題点のフィードバック ◀── 幾何計算・検査 (src/lib/plan.ts, geometry.ts)
```

| ファイル | 役割 |
|---|---|
| `src/lib/parts.ts` | 部品カタログとジョイント（接続端）の定義 |
| `src/lib/geometry.ts` | 配置計算、接続判定、はみ出し・重なり検査、部品集計 |
| `src/lib/plan.ts` | AIの出力スキーマと、部品の並び → 配置への変換 |
| `src/lib/ai.ts` | Claude API 呼び出しと検証・再試行ループ |
| `src/app/api/propose/route.ts` | 提案API |
| `src/components/Editor.tsx` | エディタ画面 |

## 開発

```bash
npm install
cp .env.example .env.local   # ANTHROPIC_API_KEY を設定
npm run dev                  # http://localhost:3000
npm test                     # ジオメトリとAIループのテスト
npm run typecheck
```

## デプロイ

`output: "standalone"` でビルドするので、Docker でそのまま動きます。

```bash
docker build -t nine-gage .
docker run -p 3000:3000 -e ANTHROPIC_API_KEY=sk-ant-... nine-gage
```

AI提案は1回に1〜3分かかることがあるため、リバースプロキシのタイムアウトは300秒程度にしてください。
