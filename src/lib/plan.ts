import { z } from "zod";
import { analyze, placeAt, worldJoints, type Analysis, type Board, type Piece } from "./geometry";
import { getPart, hasPart, partIdsFor, partKey, type Maker } from "./parts";

/**
 * AIが出力する「線路の並び」。座標ではなく部品の順番で表し、
 * 実際の位置はアプリ側で計算する（AIに座標計算をさせると誤差が出やすいため）。
 */
function planPieceSchema(partIds: [string, ...string[]] | null) {
  return z.object({
  part: (partIds ? z.enum(partIds) : z.string()).describe("部品ID"),
  dir: z.enum(["L", "R"]).describe("曲線・ポイントの向き（L=進行方向に向かって左, R=右）。直線・車止めはL"),
  enter: z
    .number()
    .int()
    .describe("前の部品につなぐ側のジョイント番号。通常0。ポイントに合流側から入るときは1(直進側)か2(分岐側)"),
  exit: z
    .number()
    .int()
    .describe("次の部品をつなぐ側のジョイント番号。通常1。ポイントの分岐側へ進むなら2、合流側から入ったときは0。車止めは0を入れる（次はない）"),
  });
}

function buildPlanSchema(partIds: [string, ...string[]] | null) {
  const PlanSegmentSchema = z.object({
  from: z
    .object({
      segment: z.number().int().describe("分岐元の区間番号（0始まり）"),
      piece: z.number().int().describe("その区間内の部品番号（0始まり）"),
      joint: z.number().int().describe("分岐元部品のジョイント番号（ポイントの分岐側なら通常2）"),
    })
    .nullable()
    .describe("null なら start から始める（区間0のみ）。それ以外は既存部品の空きジョイントから伸ばす"),
  pieces: z.array(planPieceSchema(partIds)),
});

  return z.object({
  title: z.string().describe("レイアウトの名前"),
  description: z.string().describe("レイアウトの説明（運転の楽しみ方、特徴）"),
  start: z.object({
    x: z.number().describe("区間0の最初の部品のジョイント0のx座標(mm)"),
    y: z.number().describe("同y座標(mm)"),
    heading: z.number().describe("進行方向(度)。0=右(+x), 90=下(+y), -90=上, 180=左"),
  }),
  segments: z.array(PlanSegmentSchema),
  });
}

/** 型と汎用の検証用（部品IDは文字列） */
export const LayoutPlanSchema = buildPlanSchema(null);
export type LayoutPlan = z.infer<typeof LayoutPlanSchema>;

const schemaCache = new Map<Maker, ReturnType<typeof buildPlanSchema>>();
/** AIへの出力指定用。部品IDをそのメーカーの部品だけに絞る */
export function planSchemaFor(maker: Maker) {
  let s = schemaCache.get(maker);
  if (!s) {
    s = buildPlanSchema(partIdsFor(maker));
    schemaCache.set(maker, s);
  }
  return s;
}

export type BuildResult = {
  pieces: Piece[];
  /** 区間ごとの部品uid（AIへのフィードバック用） */
  index: string[][];
  errors: string[];
};

export function buildFromPlan(plan: LayoutPlan, maker: Maker = "kato"): BuildResult {
  const pieces: Piece[] = [];
  const index: string[][] = [];
  const errors: string[] = [];
  const byUid = new Map<string, Piece>();

  plan.segments.forEach((seg, si) => {
    const uids: string[] = [];
    index.push(uids);
    let cursor: { x: number; y: number; deg: number } | null = null;

    if (seg.from === null) {
      if (si !== 0) {
        errors.push(`区間${si}: from が null なのは区間0だけです`);
        return;
      }
      // start は「直前の部品の出口」とみなす。外向き＝進行方向。
      cursor = { x: plan.start.x, y: plan.start.y, deg: plan.start.heading };
    } else {
      const src = index[seg.from.segment]?.[seg.from.piece];
      const srcPiece = src ? byUid.get(src) : undefined;
      if (!srcPiece) {
        errors.push(`区間${si}: 分岐元 区間${seg.from.segment}の部品${seg.from.piece} が存在しません（自分より前の区間を指定してください）`);
        return;
      }
      const j = worldJoints(srcPiece)[seg.from.joint];
      if (!j) {
        errors.push(`区間${si}: 分岐元部品(${srcPiece.partId})にジョイント${seg.from.joint}はありません`);
        return;
      }
      cursor = j;
    }

    seg.pieces.forEach((pp, pi) => {
      if (!cursor) return;
      const key = partKey(maker, pp.part);
      if (!hasPart(key)) {
        errors.push(`区間${si}の部品${pi}: 未知の部品 ${pp.part}`);
        cursor = null;
        return;
      }
      const part = getPart(key);
      const n = part.joints.length;
      if (pp.enter < 0 || pp.enter >= n) {
        errors.push(`区間${si}の部品${pi}(${pp.part}): enter=${pp.enter} は範囲外（0〜${n - 1}）`);
        cursor = null;
        return;
      }
      const piece = placeAt(key, pp.dir === "R", pp.enter, cursor, `s${si}p${pi}`);
      pieces.push(piece);
      uids.push(piece.uid);
      byUid.set(piece.uid, piece);
      if (part.bumper) {
        cursor = null;
        if (pi !== seg.pieces.length - 1) errors.push(`区間${si}: 車止めの後ろに部品は置けません`);
        return;
      }
      if (pp.exit < 0 || pp.exit >= n || pp.exit === pp.enter) {
        errors.push(`区間${si}の部品${pi}(${pp.part}): exit=${pp.exit} が不正です（enterと別の0〜${n - 1}）`);
        cursor = null;
        return;
      }
      cursor = worldJoints(piece)[pp.exit];
    });
  });

  return { pieces, index, errors };
}

/** AIに返すフィードバック文（問題がなければ null） */
export function describeProblems(build: BuildResult, analysis: Analysis, board: Board): string | null {
  const loc = (uid: string) => {
    for (let s = 0; s < build.index.length; s++) {
      const p = build.index[s].indexOf(uid);
      if (p >= 0) return `区間${s}の部品${p}`;
    }
    return uid;
  };
  const lines: string[] = [...build.errors];
  for (const j of analysis.openJoints) {
    lines.push(
      `つながっていない端: ${loc(j.pieceUid)} のジョイント${j.index} (x=${j.x.toFixed(1)}, y=${j.y.toFixed(1)}, 外向き${j.deg.toFixed(1)}°)。行き止まりにするなら車止め(BUMPER)を置く`,
    );
  }
  for (const n of analysis.nearMisses) {
    lines.push(
      `ずれ: ${loc(n.a.pieceUid)}のジョイント${n.a.index} と ${loc(n.b.pieceUid)}のジョイント${n.b.index} が ${n.distance.toFixed(1)}mm・角度${n.angleDiff.toFixed(1)}°ずれている`,
    );
  }
  for (const uid of analysis.outOfBoard) {
    lines.push(`ボード外: ${loc(uid)} がボード (0,0)〜(${board.width},${board.height}) からはみ出している`);
  }
  for (const [a, b] of analysis.overlaps) {
    lines.push(`重なり: ${loc(a)} と ${loc(b)} の線路が重なっている（線路中心の間隔は${22}mm以上必要）`);
  }
  return lines.length ? lines.join("\n") : null;
}

export function evaluatePlan(plan: LayoutPlan, board: Board, maker: Maker = "kato") {
  const build = buildFromPlan(plan, maker);
  const analysis = analyze({ board, pieces: build.pieces });
  return { build, analysis, problems: describeProblems(build, analysis, board) };
}
