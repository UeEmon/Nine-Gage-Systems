import { PIER_SYSTEMS } from "../data/piers";
import { computeElevation, placePiers, samplesWithZ, STEP_TOLERANCE_MM, type Elevation, type Pier } from "./elevation";
import { getPart, localJoints, normDeg, type Joint, type Maker, type PartDef } from "./parts";
import { routeSamples, routeSvg } from "./shapes";
import type { Accessory } from "./accessories";
import type { ReplicaInfo, SimObject } from "./replica";
import type { OperationPlan } from "./operation/model";
import type { TwinSettings } from "./twin/mapping";

export type Piece = {
  uid: string;
  partId: string;
  /** true で右向き（曲線・ポイント） */
  mirror: boolean;
  /** ローカル原点（ジョイント0）のワールド座標と回転角 */
  x: number;
  y: number;
  rot: number;
  /** 高さ（地上の線路のレール面からの高さ, mm）。省略時は地上（0） */
  z?: number;
  /** true で勾配区間（前後の部品の高さの間を自動で上り下りする。z は使わない） */
  ramp?: boolean;
};

export type Board = { width: number; height: number };

export type Layout = {
  title: string;
  /** 使う線路のメーカー（古い保存データにはないので省略時は KATO） */
  maker?: Maker;
  description: string;
  board: Board;
  pieces: Piece[];
  /** 線路以外のパーツ（踏切・信号機・ホーム・駅舎・建物）。古い保存データにはない */
  accessories?: Accessory[];
  /** 運行計画（ダイヤ）。古い保存データにはない */
  operation?: OperationPlan;
  /** デジタルツインの番号の付け替えと接続先。古い保存データにはない */
  twin?: TwinSettings;
  /** シミュレーション上だけの仮オブジェクト（「再現してみた」で作った、実在の製品ではない物） */
  sims?: SimObject[];
  /** 「再現してみた」で再現した路線・駅と特徴 */
  replica?: ReplicaInfo;
};

export type WorldJoint = Joint & { pieceUid: string; index: number };

const rad = (d: number) => (d * Math.PI) / 180;

let uidCounter = 0;
export function newUid(): string {
  uidCounter += 1;
  return `p${Date.now().toString(36)}${uidCounter.toString(36)}`;
}

export function toWorld(piece: Pick<Piece, "x" | "y" | "rot">, p: { x: number; y: number }) {
  const c = Math.cos(rad(piece.rot));
  const s = Math.sin(rad(piece.rot));
  return { x: piece.x + p.x * c - p.y * s, y: piece.y + p.x * s + p.y * c };
}

export function worldJoints(piece: Piece): WorldJoint[] {
  const part = getPart(piece.partId);
  return localJoints(part, piece.mirror).map((j, index) => ({
    ...toWorld(piece, j),
    deg: normDeg(j.deg + piece.rot),
    pieceUid: piece.uid,
    index,
  }));
}

/**
 * 部品のジョイント jointIndex を target ジョイントに接続するように配置する。
 * target.deg は target 側の外向き方向。接続される側は逆向き（+180°）になる。
 */
export function placeAt(
  partId: string,
  mirror: boolean,
  jointIndex: number,
  target: Joint,
  uid: string = newUid(),
): Piece {
  const part = getPart(partId);
  const lj = localJoints(part, mirror)[jointIndex];
  if (!lj) throw new Error(`${partId} にジョイント${jointIndex}はありません`);
  const rot = normDeg(target.deg + 180 - lj.deg);
  const c = Math.cos(rad(rot));
  const s = Math.sin(rad(rot));
  return {
    uid,
    partId,
    mirror,
    rot,
    x: target.x - (lj.x * c - lj.y * s),
    y: target.y - (lj.x * s + lj.y * c),
  };
}

// ---- 中心線の描画・サンプリング ----

/** ローカル座標でのSVGパス（左向き基準。右向きは描画側で scale(1,-1)） */
export function localPaths(part: PartDef): string[] {
  return part.routes.map(routeSvg);
}

/** 中心線上の点（ローカル座標, 左向き基準） */
function localSamples(part: PartDef, step = 10): { x: number; y: number }[] {
  return part.routes.flatMap((r) => routeSamples(r, step));
}

export function worldSamples(piece: Piece, step = 10) {
  const part = getPart(piece.partId);
  return localSamples(part, step).map((p) => toWorld(piece, piece.mirror ? { x: p.x, y: -p.y } : p));
}

// ---- 解析 ----

export const JOIN_TOLERANCE_MM = 1.5;
export const JOIN_TOLERANCE_DEG = 2;
/** 中心線同士がこれより近いと重なり（線路幅 約25mm） */
export const OVERLAP_MM = 22;
/** 立体交差の高さの差の許容誤差（mm） */
const CLEARANCE_TOLERANCE_MM = 2;
/** 勾配の上限の許容誤差（%）。KATO の 248mm で 10mm 上がる勾配（4.03%）を4%として通す */
const GRADE_TOLERANCE_PCT = 0.1;
/** 橋脚の中心と下の線路の中心線がこれより近いと当たる（線路幅の半分＋橋脚の半分） */
const PIER_HIT_MM = 16;

export type Connection = { a: WorldJoint; b: WorldJoint };

export type Analysis = {
  connections: Connection[];
  elevation: Elevation;
  openJoints: WorldJoint[];
  /** 近いがつながっていないジョイントの組（ずれ） */
  nearMisses: { a: WorldJoint; b: WorldJoint; distance: number; angleDiff: number }[];
  outOfBoard: string[];
  overlaps: [string, string][];
  /** 重なりのうち、高さの差はあるが足りないもの（立体交差にするには高さの差 needed mm が必要） */
  lowClearance: { a: string; b: string; dz: number; needed: number }[];
  /** 高さの差が十分ある交差（立体交差） */
  crossings: { a: string; b: string; dz: number }[];
  /** つながっているのに高さが違う所（段差） */
  heightSteps: { a: WorldJoint; b: WorldJoint; dz: number }[];
  /** 勾配が上限を超える部品 */
  steepGrades: { uid: string; gradePct: number; maxPct: number }[];
  /** 高架を支える橋脚 */
  piers: Pier[];
  /** 下の線路に立ってしまう橋脚（橋脚の番号と、当たる部品） */
  pierHits: { pier: number; uid: string }[];
  /** 合う高さの橋脚がない所（橋脚の番号） */
  pierMisfits: number[];
  /** 終端（車止め以外の開放端）の数 */
  deadEnds: number;
  partCounts: Record<string, number>;
  totalLengthMm: number;
};

function angleDiff(a: number, b: number) {
  return Math.abs(normDeg(a - b));
}

/** ジョイントのつながりと、近いがつながっていない組を調べる */
export function findConnections(pieces: Piece[]) {
  const joints = pieces.flatMap(worldJoints);
  const used = new Set<string>();
  const key = (j: WorldJoint) => `${j.pieceUid}:${j.index}`;
  const connections: Connection[] = [];
  const nearMisses: Analysis["nearMisses"] = [];

  for (let i = 0; i < joints.length; i++) {
    for (let k = i + 1; k < joints.length; k++) {
      const a = joints[i];
      const b = joints[k];
      if (a.pieceUid === b.pieceUid) continue;
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (d > 60) continue;
      const ad = 180 - angleDiff(a.deg, b.deg); // 0 なら正対
      if (d <= JOIN_TOLERANCE_MM && ad <= JOIN_TOLERANCE_DEG && !used.has(key(a)) && !used.has(key(b))) {
        connections.push({ a, b });
        used.add(key(a));
        used.add(key(b));
      } else if (d <= 60 && ad <= 45) {
        nearMisses.push({ a, b, distance: d, angleDiff: ad });
      }
    }
  }

  const openJoints = joints.filter((j) => !used.has(key(j)));
  const filteredNear = nearMisses.filter((n) => !used.has(key(n.a)) && !used.has(key(n.b)));
  return { connections, openJoints, nearMisses: filteredNear };
}

/** 部品の高さと橋脚（部品リスト用に、解析全体をしないで求める） */
export function elevationOf(pieces: Piece[]): { elevation: Elevation; piers: Pier[] } {
  const elevation = computeElevation(pieces, findConnections(pieces).connections);
  return { elevation, piers: placePiers(pieces, elevation) };
}

export function analyze(layout: Pick<Layout, "board" | "pieces">): Analysis {
  const { connections, openJoints, nearMisses: filteredNear } = findConnections(layout.pieces);
  const elevation = computeElevation(layout.pieces, connections);

  // 隣接関係（2ホップ以内は重なり判定から除外）
  const adj = new Map<string, Set<string>>();
  for (const p of layout.pieces) adj.set(p.uid, new Set());
  for (const c of connections) {
    adj.get(c.a.pieceUid)!.add(c.b.pieceUid);
    adj.get(c.b.pieceUid)!.add(c.a.pieceUid);
  }
  const near = (a: string, b: string) => {
    const na = adj.get(a)!;
    if (na.has(b)) return true;
    for (const m of na) if (adj.get(m)!.has(b)) return true;
    return false;
  };

  const samples = new Map(layout.pieces.map((p) => [p.uid, samplesWithZ(p, elevation)]));
  const { width, height } = layout.board;
  const outOfBoard = layout.pieces
    .filter((p) => samples.get(p.uid)!.some((s) => s.x < 0 || s.y < 0 || s.x > width || s.y > height))
    .map((p) => p.uid);

  const overlaps: [string, string][] = [];
  const lowClearance: Analysis["lowClearance"] = [];
  const crossings: Analysis["crossings"] = [];
  for (let i = 0; i < layout.pieces.length; i++) {
    for (let k = i + 1; k < layout.pieces.length; k++) {
      const a = layout.pieces[i];
      const b = layout.pieces[k];
      if (near(a.uid, b.uid)) continue;
      const sa = samples.get(a.uid)!;
      const sb = samples.get(b.uid)!;
      // 平面で重なる点の組のうち、高さの差がいちばん小さいもの
      let minDz = Infinity;
      for (const p of sa) {
        for (const q of sb) {
          if (Math.abs(p.x - q.x) < OVERLAP_MM && Math.hypot(p.x - q.x, p.y - q.y) < OVERLAP_MM) {
            minDz = Math.min(minDz, Math.abs(p.z - q.z));
          }
        }
      }
      if (minDz === Infinity) continue;
      const needed = PIER_SYSTEMS[getPart(a.partId).maker].clearance;
      if (minDz >= needed - CLEARANCE_TOLERANCE_MM) {
        crossings.push({ a: a.uid, b: b.uid, dz: minDz });
        continue;
      }
      overlaps.push([a.uid, b.uid]);
      if (minDz >= 5) lowClearance.push({ a: a.uid, b: b.uid, dz: minDz, needed });
    }
  }

  const heightSteps: Analysis["heightSteps"] = [];
  for (const c of connections) {
    const za = elevation.joints.get(c.a.pieceUid)?.[c.a.index] ?? 0;
    const zb = elevation.joints.get(c.b.pieceUid)?.[c.b.index] ?? 0;
    if (Math.abs(za - zb) > STEP_TOLERANCE_MM) heightSteps.push({ a: c.a, b: c.b, dz: Math.abs(za - zb) });
  }

  const steepGrades: Analysis["steepGrades"] = [];
  for (const [uid, gradePct] of elevation.grades) {
    const piece = layout.pieces.find((p) => p.uid === uid)!;
    const maxPct = PIER_SYSTEMS[getPart(piece.partId).maker].maxGradePct;
    if (gradePct > maxPct + GRADE_TOLERANCE_PCT) steepGrades.push({ uid, gradePct, maxPct });
  }

  const piers = placePiers(layout.pieces, elevation);
  const pierHits: Analysis["pierHits"] = [];
  piers.forEach((pier, index) => {
    for (const p of layout.pieces) {
      if (pier.owners.includes(p.uid)) continue;
      const hit = samples.get(p.uid)!.some((s) => s.z < pier.z - 5 && Math.hypot(s.x - pier.x, s.y - pier.y) < PIER_HIT_MM);
      if (hit) pierHits.push({ pier: index, uid: p.uid });
    }
  });
  const pierMisfits = piers.flatMap((p, i) => (p.fit ? [] : [i]));

  const partCounts: Record<string, number> = {};
  let totalLengthMm = 0;
  for (const p of layout.pieces) {
    const part = getPart(p.partId);
    const label = part.handed ? `${part.id}${p.mirror ? "(右)" : "(左)"}` : part.id;
    partCounts[label] = (partCounts[label] ?? 0) + 1;
    if (!part.bumper) totalLengthMm += part.routeLength;
  }

  const deadEnds = openJoints.length;

  return {
    connections,
    elevation,
    openJoints,
    nearMisses: filteredNear,
    outOfBoard,
    overlaps,
    lowClearance,
    crossings,
    heightSteps,
    steepGrades,
    piers,
    pierHits,
    pierMisfits,
    deadEnds,
    partCounts,
    totalLengthMm,
  };
}
