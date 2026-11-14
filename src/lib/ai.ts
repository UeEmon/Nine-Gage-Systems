import { z } from "zod";
import type { Board } from "./geometry";
import { sanitizeSchema } from "./llm/json";
import type { ChatSession, SessionOptions } from "./llm/types";
import { PARTS } from "./parts";
import { evaluatePlan, LayoutPlanSchema, type LayoutPlan } from "./plan";

const MAX_ATTEMPTS = 4;

function catalogText(): string {
  return PARTS.map((p) => {
    const ends = p.joints
      .map((j, i) => `j${i}=(${j.x.toFixed(1)}, ${j.y.toFixed(1)}, 外向き${j.deg.toFixed(1)}°)`)
      .join(" ");
    return `- ${p.id}: ${p.description}。左向き(L)のローカル座標: ${ends}`;
  }).join("\n");
}

const EXAMPLE: LayoutPlan = {
  title: "待避線付きエンドレス",
  description: "R249の楕円に、外側へ#6ポイントで待避線を1本付けた例",
  start: { x: 300, y: 120, heading: 0 },
  segments: [
    {
      from: null,
      pieces: [
        { part: "TO6", dir: "L", enter: 0, exit: 1 },
        { part: "S248", dir: "L", enter: 0, exit: 1 },
        { part: "S124", dir: "L", enter: 0, exit: 1 },
        { part: "TO6", dir: "R", enter: 1, exit: 0 },
        ...Array(4).fill({ part: "R249-45", dir: "R", enter: 0, exit: 1 }),
        { part: "S186", dir: "L", enter: 0, exit: 1 },
        { part: "S248", dir: "L", enter: 0, exit: 1 },
        { part: "S186", dir: "L", enter: 0, exit: 1 },
        { part: "S124", dir: "L", enter: 0, exit: 1 },
        ...Array(4).fill({ part: "R249-45", dir: "R", enter: 0, exit: 1 }),
      ],
    },
    {
      from: { segment: 0, piece: 0, joint: 2 },
      pieces: [
        { part: "R718-15", dir: "R", enter: 0, exit: 1 },
        { part: "R718-15", dir: "R", enter: 0, exit: 1 },
      ],
    },
  ],
};

const SYSTEM = `あなたはNゲージ鉄道模型（軌間9mm）のレイアウト設計の専門家です。
利用者の要望とボードの大きさから、実際に組めて楽しく運転できる線路配置を設計します。

## 出力形式
座標ではなく「線路部品の並び」を出力します。位置はアプリが計算し、つながっていない端・ずれ・はみ出し・重なりがあれば指摘を返すので、そのときは直した計画全体を出し直してください。

- start: 区間0の最初の部品をつなぐ位置(mm)と進行方向(度)。
- segments: 区間の配列。区間0は from=null で start から始まり、部品を順に前の部品の出口へつなぎます。
- 区間1以降は from で既存の部品のジョイント（主にポイントの分岐側 j2）から伸ばします。from が指す区間は自分より前の番号にしてください。
- 各部品: part=部品ID, dir=L/R, enter=前の部品につなぐジョイント, exit=次へ進むジョイント。

## 座標と向き
- ボードの左上が(0,0)。xは右、yは下が正。単位はmm。
- 角度は +x(右) が0°、画面上で時計回りが正。90°=下、-90°=上、180°=左。
- dir=L は進行方向に向かって左へ曲がる（角度が減る）、dir=R は右へ曲がる（角度が増える）。
- 曲線・直線は常に enter=0, exit=1。曲がる向きは dir だけで決めます。
- ポイント(TO6)は j0=トング側, j1=直進側, j2=分岐側。
  - 分かれる向きに通るとき: enter=0, exit=1(直進) または 2(分岐)。dir は分岐側が進行方向の左右どちらに出るか。
  - 合流する向きに通るとき: enter=1(直進側から入る) または 2(分岐側から入る), exit=0。dir は j0 から見たときの分岐の左右で、進行方向から見ると逆になる点に注意。
- 行き止まりの線路は最後に BUMPER を置きます（BUMPER の exit は 0）。
- すべての端はどこかにつながるか、車止めで終わる必要があります。

## 部品カタログ（KATOユニトラック互換寸法）
ローカル座標は j0 を原点・進行方向を+xとしたときの各ジョイントの位置と外向きの角度です（L向き。R向きは y と角度の符号が逆）。
${catalogText()}

## 設計のコツ
- 同じ半径の45°曲線を8本で円になります。楕円は上下に直線を同じ長さずつ入れると閉じます。
- 円の直径はおよそ 2×R。R249の楕円は外側の線路中心で高さ約498mm、ボード端から線路中心まで25mm以上空けるとはみ出しません。
- #6ポイントの分岐の後に逆向きのR718-15を1本置くと、本線と平行（中心間隔約49mm）に戻ります。待避線の両端をこの形にすると、本線側には直線を約372mm（S248+S124）入れると長さが合います。
- 平行な複線は中心間隔33mm以上が目安です（重なり判定は22mm未満）。
- 線路の交差（平面交差・立体交差）は使わない計画にしてください。
- ボードからはみ出さないこと。曲線の外側にも余裕を取ること。

## 例（ボード1400×800mm）
${JSON.stringify(EXAMPLE)}

description には、どんな運転ができるか（周回、待避、行き違い、入換など）と工夫した点を日本語で2〜4文で書いてください。`;

export type ProposeInput = {
  board: Board;
  request: string;
};

export type ProposeResult = {
  plan: LayoutPlan;
  pieces: ReturnType<typeof evaluatePlan>["build"]["pieces"];
  attempts: number;
  remainingProblems: string | null;
  model: string;
};

export class ProposeError extends Error {}

/** 各プロバイダに渡すシステムプロンプトと出力スキーマ */
export function sessionOptions(): SessionOptions {
  return {
    system: SYSTEM,
    jsonSchema: sanitizeSchema(z.toJSONSchema(LayoutPlanSchema)) as Record<string, unknown>,
    schemaName: "layout_plan",
  };
}

/**
 * AIに部品の並びを出させ、アプリで組み立てて検査し、問題があればその内容を返して直させる。
 * どのプロバイダでも同じ流れで、会話の保持はセッション側が行う。
 */
export async function proposeLayout(
  input: ProposeInput,
  session: ChatSession,
  model: string,
): Promise<ProposeResult> {
  const { board, request } = input;
  let prompt = `ボードの大きさ: 幅${board.width}mm × 奥行${board.height}mm
要望: ${request.trim() || "ボードに収まる、楽しく運転できるレイアウト"}`;

  let best: { plan: LayoutPlan; result: ReturnType<typeof evaluatePlan>; score: number } | null = null;
  let attempts = 0;
  let lastText = "";

  for (; attempts < MAX_ATTEMPTS; ) {
    attempts++;
    const answer = await session.ask(prompt);
    lastText = answer.text;
    if (answer.refused) {
      throw new ProposeError("AIがこの依頼への回答を控えました。要望の書き方を変えてお試しください。");
    }

    const parsed = LayoutPlanSchema.safeParse(answer.json);
    if (!parsed.success) {
      prompt = answer.truncated
        ? "出力が長すぎて途中で切れました。部品の並びを簡潔にして、計画全体をJSONで出し直してください。"
        : `出力が指定のJSON形式に合いませんでした。形式を守って計画全体を出し直してください。\n${z.prettifyError(
            parsed.error,
          ).slice(0, 1500)}`;
      continue;
    }

    const plan = parsed.data;
    const result = evaluatePlan(plan, board);
    const score = result.problems ? result.problems.split("\n").length : 0;
    if (!best || score < best.score) best = { plan, result, score };
    if (!result.problems) break;
    prompt = `アプリで組み立てたところ、次の問題がありました。直した計画全体を出し直してください。\n${result.problems}`;
  }

  if (!best) {
    throw new ProposeError(
      `AIの出力をレイアウトとして読み取れませんでした（${model}）。より大きなモデルを選ぶと改善することがあります。${
        lastText ? `\n出力の先頭: ${lastText.slice(0, 200)}` : ""
      }`,
    );
  }
  return {
    plan: best.plan,
    pieces: best.result.build.pieces,
    attempts,
    remainingProblems: best.result.problems,
    model,
  };
}
