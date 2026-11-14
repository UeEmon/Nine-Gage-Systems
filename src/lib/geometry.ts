import { getPart, localJoints, normDeg, type Joint, type Maker, type PartDef } from "./parts";
import { routeSamples, routeSvg } from "./shapes";

export type Piece = {
  uid: string;
  partId: string;
  /** true で右向き（曲線・ポイント） */
  mirror: boolean;
  /** ローカル原点（ジョイント0）のワールド座標と回転角 */
  x: number;
  y: number;
  rot: number;
};

export type Board = { width: number; height: number };

export type Layout = {
  title: string;
  /** 使う線路のメーカー（古い保存データにはないので省略時は KATO） */
  maker?: Maker;
  description: string;
  board: Board;
  pieces: Piece[];
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

export type Connection = { a: WorldJoint; b: WorldJoint };

export type Analysis = {
  connections: Connection[];
  openJoints: WorldJoint[];
  /** 近いがつながっていないジョイントの組（ずれ） */
  nearMisses: { a: WorldJoint; b: WorldJoint; distance: number; angleDiff: number }[];
  outOfBoard: string[];
  overlaps: [string, string][];
  /** 終端（車止め以外の開放端）の数 */
  deadEnds: number;
  partCounts: Record<string, number>;
  totalLengthMm: number;
};

function angleDiff(a: number, b: number) {
  return Math.abs(normDeg(a - b));
}

export function analyze(layout: Pick<Layout, "board" | "pieces">): Analysis {
  const joints = layout.pieces.flatMap(worldJoints);
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

  const samples = new Map(layout.pieces.map((p) => [p.uid, worldSamples(p)]));
  const { width, height } = layout.board;
  const outOfBoard = layout.pieces
    .filter((p) => samples.get(p.uid)!.some((s) => s.x < 0 || s.y < 0 || s.x > width || s.y > height))
    .map((p) => p.uid);

  const overlaps: [string, string][] = [];
  for (let i = 0; i < layout.pieces.length; i++) {
    for (let k = i + 1; k < layout.pieces.length; k++) {
      const a = layout.pieces[i];
      const b = layout.pieces[k];
      if (near(a.uid, b.uid)) continue;
      const sa = samples.get(a.uid)!;
      const sb = samples.get(b.uid)!;
      let hit = false;
      for (const p of sa) {
        for (const q of sb) {
          if (Math.abs(p.x - q.x) < OVERLAP_MM && Math.hypot(p.x - q.x, p.y - q.y) < OVERLAP_MM) {
            hit = true;
            break;
          }
        }
        if (hit) break;
      }
      if (hit) overlaps.push([a.uid, b.uid]);
    }
  }

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
    openJoints,
    nearMisses: filteredNear,
    outOfBoard,
    overlaps,
    deadEnds,
    partCounts,
    totalLengthMm,
  };
}
