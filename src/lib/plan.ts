import { z } from "zod";
import { analyze, findConnections, placeAt, worldJoints, type Analysis, type Board, type Piece } from "./geometry";
import { getPart, hasPart, partIdsFor, partKey, type Maker } from "./parts";
import { accessoryIdsFor, getAccessory, hasAccessory, placeOnPiece, type Accessory } from "./accessories";
import { computeElevation } from "./elevation";
import { PlanReplicaSchema, placeSimOnPiece, type PlanReplica, type SimObject } from "./replica";

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
  height: z
    .number()
    .nullable()
    .default(0)
    .describe("線路面の高さ(mm)。0=地上、高架は標準の高さ。null=勾配区間（前後の部品の高さの間を自動で上り下りする）"),
  });
}

function planAccessorySchema(ids: [string, ...string[]] | null) {
  return z.object({
    item: (ids ? z.enum(ids) : z.string()).describe("線路以外のパーツのID（踏切・信号機・ホーム・駅舎・建物）"),
    segment: z.number().int().describe("置く線路の区間番号（0始まり）"),
    piece: z.number().int().describe("その区間内の部品番号（0始まり）。その部品の中央に置く"),
    side: z.enum(["L", "R"]).describe("進行方向に向かって線路のどちら側か（ホーム・駅舎・建物）。踏切・信号機・橋上駅舎はL"),
  });
}

function buildPlanSchema(partIds: [string, ...string[]] | null, accIds: [string, ...string[]] | null = null) {
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
  accessories: z
    .array(planAccessorySchema(accIds))
    .default([])
    .describe("線路以外のパーツ。要望に駅・踏切などがなければ空の配列"),
  });
}

/** 型と汎用の検証用（部品IDは文字列） */
export const LayoutPlanSchema = buildPlanSchema(null);
/**
 * height は省略できる（省略時は地上）。AIの出力は省略しない形（JSON Schema では必須）で受け取る。
 * replica は「再現してみた」のときだけ（製品にない物を仮オブジェクトとして置く）
 */
export type LayoutPlan = z.input<typeof LayoutPlanSchema> & { replica?: PlanReplica };

/** 「再現してみた」用。replica（再現の内容と仮オブジェクト）を必須にする */
function buildReplicaPlanSchema(partIds: [string, ...string[]], accIds: [string, ...string[]]) {
  return buildPlanSchema(partIds, accIds).extend({ replica: PlanReplicaSchema });
}

type AnyPlanSchema = ReturnType<typeof buildPlanSchema> | ReturnType<typeof buildReplicaPlanSchema>;
const schemaCache = new Map<string, AnyPlanSchema>();
/** AIへの出力指定用。部品IDをそのメーカーの部品だけに絞る。replica=true なら「再現してみた」用 */
export function planSchemaFor(maker: Maker, replica = false): AnyPlanSchema {
  const key = `${maker}:${replica ? "replica" : "plan"}`;
  let s = schemaCache.get(key);
  if (!s) {
    s = replica
      ? buildReplicaPlanSchema(partIdsFor(maker), accessoryIdsFor(maker))
      : buildPlanSchema(partIdsFor(maker), accessoryIdsFor(maker));
    schemaCache.set(key, s);
  }
  return s;
}

export type BuildResult = {
  pieces: Piece[];
  accessories: Accessory[];
  /** シミュレーション上だけの仮オブジェクト（「再現してみた」のとき） */
  sims: SimObject[];
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
      const placed = placeAt(key, pp.dir === "R", pp.enter, cursor, `s${si}p${pi}`);
      const h = pp.height === undefined ? 0 : pp.height;
      const piece: Piece = h === null ? { ...placed, ramp: true } : h ? { ...placed, z: h } : placed;
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

  // 線路以外のパーツは、指定した部品の中央に置く
  const accessories: Accessory[] = [];
  const planAcc = plan.accessories ?? [];
  const planSims = plan.replica?.objects ?? [];
  const elevation =
    planAcc.length || planSims.length ? computeElevation(pieces, findConnections(pieces).connections) : undefined;
  if (planAcc.length) {
    planAcc.forEach((pa, i) => {
      const key = partKey(maker, pa.item);
      if (!hasAccessory(key)) {
        errors.push(`パーツ${i}: 未知のパーツ ${pa.item}`);
        return;
      }
      const uid = index[pa.segment]?.[pa.piece];
      const host = uid ? byUid.get(uid) : undefined;
      if (!host) {
        errors.push(`パーツ${i}(${pa.item}): 区間${pa.segment}の部品${pa.piece} がありません`);
        return;
      }
      const def = getAccessory(key);
      const part = getPart(host.partId);
      if (def.mount === "onTrack" && (part.category === "turnout" || part.category === "crossing" || part.bumper)) {
        errors.push(`パーツ${i}(${pa.item}): ${def.label}はポイント・交差・車止めの上には置けない。直線の上に置く`);
        return;
      }
      if (def.replaces && part.id !== def.replaces) {
        errors.push(`パーツ${i}(${pa.item}): ${def.label}は${def.replaces}の代わりに置く部品なので、${def.replaces}の上に置く`);
      }
      accessories.push(placeOnPiece(def, host, elevation, pa.side, `acc${i}`));
    });
  }

  // 製品にない物は、指定した部品の中央に仮オブジェクトとして置く
  const sims: SimObject[] = [];
  planSims.forEach((o, i) => {
    const uid = index[o.segment]?.[o.piece];
    const host = uid ? byUid.get(uid) : undefined;
    if (!host) {
      errors.push(`仮オブジェクト${i}(${o.name}): 区間${o.segment}の部品${o.piece} がありません`);
      return;
    }
    sims.push(placeSimOnPiece(o, host, elevation, `sim${i}`));
  });

  return { pieces, accessories, sims, index, errors };
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
  const low = new Map(analysis.lowClearance.map((l) => [`${l.a}|${l.b}`, l]));
  for (const [a, b] of analysis.overlaps) {
    const l = low.get(`${a}|${b}`);
    lines.push(
      l
        ? `高さ不足: ${loc(a)} と ${loc(b)} が交差しているが高さの差が${l.dz.toFixed(0)}mmしかない（立体交差には${l.needed}mm以上必要。勾配区間を長くするか交差の位置をずらす）`
        : `重なり: ${loc(a)} と ${loc(b)} の線路が重なっている（線路中心の間隔は${22}mm以上必要。立体交差にするなら高さの差をつける）`,
    );
  }
  for (const s of analysis.heightSteps) {
    lines.push(
      `段差: ${loc(s.a.pieceUid)} と ${loc(s.b.pieceUid)} のつなぎ目で高さが${s.dz.toFixed(0)}mm違う。間に勾配区間（height=null）を入れる`,
    );
  }
  for (const g of analysis.steepGrades) {
    lines.push(`急勾配: ${loc(g.uid)} の勾配が${g.gradePct.toFixed(1)}%（上限${g.maxPct}%）。勾配区間を長くする`);
  }
  for (const h of analysis.pierHits) {
    const p = analysis.piers[h.pier];
    lines.push(
      `橋脚の干渉: 高さ${p.z.toFixed(0)}mmの線路を支える橋脚 (x=${p.x.toFixed(0)}, y=${p.y.toFixed(0)}) が下の ${loc(h.uid)} に当たる。上の線路のつなぎ目を下の線路の真上からずらす`,
    );
  }
  for (const i of analysis.pierMisfits) {
    const p = analysis.piers[i];
    lines.push(`橋脚なし: 高さ${p.z.toFixed(1)}mmに合う橋脚がない (x=${p.x.toFixed(0)}, y=${p.y.toFixed(0)})。高架は標準の高さにそろえる`);
  }
  return lines.length ? lines.join("\n") : null;
}

export function evaluatePlan(plan: LayoutPlan, board: Board, maker: Maker = "kato") {
  const build = buildFromPlan(plan, maker);
  const analysis = analyze({ board, pieces: build.pieces });
  return { build, analysis, problems: describeProblems(build, analysis, board) };
}
