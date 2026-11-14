// 高架・立体交差のための高さの計算。
//
// 各部品は高さ z（地上の線路のレール面からの高さ, mm）を持つ。z を省くと地上（0）。
// ramp=true の部品（直線・曲線・複線・鉄橋）は勾配区間で、つながった勾配の部品の並びを1本の坂として、
// 前後の高さの決まった部品の間を長さに比例して上り下りさせる。
// 高さのある部品には、ジョイントごと（と長い部品の途中）に橋脚を立て、高さに合う橋脚の品番を選ぶ。

import { PIER_SYSTEMS, pierHeights } from "../data/piers";
import type { Connection, Piece } from "./geometry";
import { getPart, type Maker } from "./parts";
import { routeLength, routeSamples } from "./shapes";

/** これより低いところには橋脚を立てない（地上・勾配の上り始め） */
export const PIER_MIN_MM = 8;
/** つながったジョイントの高さの差がこれより大きいと段差 */
export const STEP_TOLERANCE_MM = 1;
/** 橋脚の高さの合わせ誤差（これより離れた高さしかないと「合う橋脚がない」） */
const PIER_FIT_MM = 2.6;

export type Elevation = {
  /** 部品 uid → ジョイントごとの高さ(mm) */
  joints: Map<string, number[]>;
  /** 勾配の部品 uid → 勾配(%)（上り下りの向きは問わない） */
  grades: Map<string, number>;
};

export function isRamp(piece: Piece): boolean {
  return Boolean(piece.ramp) && getPart(piece.partId).rampEnds !== null;
}

const jkey = (uid: string, index: number) => `${uid}:${index}`;

/** 部品の高さを、つながりをたどって決める */
export function computeElevation(pieces: Piece[], connections: Connection[]): Elevation {
  const byUid = new Map(pieces.map((p) => [p.uid, p]));
  const partner = new Map<string, { uid: string; index: number }>();
  for (const c of connections) {
    partner.set(jkey(c.a.pieceUid, c.a.index), { uid: c.b.pieceUid, index: c.b.index });
    partner.set(jkey(c.b.pieceUid, c.b.index), { uid: c.a.pieceUid, index: c.a.index });
  }

  const joints = new Map<string, number[]>();
  const grades = new Map<string, number>();
  for (const p of pieces) {
    if (!isRamp(p)) joints.set(p.uid, getPart(p.partId).joints.map(() => p.z ?? 0));
  }

  const endsOf = (p: Piece) => getPart(p.partId).rampEnds!;
  const endOf = (p: Piece, index: number) => endsOf(p).findIndex((e) => e.includes(index));
  /** 勾配の部品 p の端 e の先につながっている部品とジョイント */
  const across = (p: Piece, e: number) => {
    for (const j of endsOf(p)[e]) {
      const q = partner.get(jkey(p.uid, j));
      if (q) return q;
    }
    return null;
  };

  type Step = { piece: Piece; entry: number };
  const done = new Set<string>();

  for (const start of pieces) {
    if (!isRamp(start) || done.has(start.uid)) continue;
    const seen = new Set([start.uid]);

    // 片側へ勾配の部品をたどり、その先の高さの決まった部品の高さ（なければ null）を返す
    const walk = (fromEnd: number, steps: Step[], backward: boolean): number | null => {
      let cur = start;
      let via = fromEnd;
      for (;;) {
        const q = across(cur, via);
        if (!q) return null;
        const qp = byUid.get(q.uid)!;
        if (!isRamp(qp)) return joints.get(qp.uid)![q.index] ?? null;
        if (seen.has(qp.uid)) return null; // 勾配だけの輪
        const e = endOf(qp, q.index);
        if (e < 0) return null;
        seen.add(qp.uid);
        // 前から後ろへの並びにしたときの入口側の端
        steps.push({ piece: qp, entry: backward ? 1 - e : e });
        cur = qp;
        via = 1 - e;
      }
    };

    const back: Step[] = [];
    const fwd: Step[] = [];
    const zStartAnchor = walk(0, back, true);
    const zEndAnchor = walk(1, fwd, false);
    const chain: Step[] = [...back.reverse(), { piece: start, entry: 0 }, ...fwd];

    const zs = zStartAnchor ?? zEndAnchor ?? 0;
    const ze = zEndAnchor ?? zStartAnchor ?? 0;
    const lens = chain.map((s) => routeLength(getPart(s.piece.partId).routes[0]));
    const total = lens.reduce((a, b) => a + b, 0) || 1;
    let cum = 0;
    chain.forEach((s, i) => {
      const part = getPart(s.piece.partId);
      const zIn = zs + ((ze - zs) * cum) / total;
      cum += lens[i];
      const zOut = zs + ((ze - zs) * cum) / total;
      const zsByJoint = part.joints.map(() => zIn);
      for (const j of part.rampEnds![1 - s.entry]) zsByJoint[j] = zOut;
      for (const j of part.rampEnds![s.entry]) zsByJoint[j] = zIn;
      joints.set(s.piece.uid, zsByJoint);
      grades.set(s.piece.uid, (Math.abs(zOut - zIn) / (lens[i] || 1)) * 100);
      done.add(s.piece.uid);
    });
  }

  return { joints, grades };
}

/** 部品の高さの範囲 */
export function zRange(elev: Elevation, uid: string): { min: number; max: number } {
  const zs = elev.joints.get(uid) ?? [0];
  return { min: Math.min(...zs), max: Math.max(...zs) };
}

const rad = (d: number) => (d * Math.PI) / 180;
function toWorld(piece: Piece, p: { x: number; y: number }) {
  const y = piece.mirror ? -p.y : p.y;
  const c = Math.cos(rad(piece.rot));
  const s = Math.sin(rad(piece.rot));
  return { x: piece.x + p.x * c - y * s, y: piece.y + p.x * s + y * c };
}

/** 中心線上の点と、その点の高さ */
export function samplesWithZ(piece: Piece, elev: Elevation, step = 10): { x: number; y: number; z: number }[] {
  const part = getPart(piece.partId);
  const zs = elev.joints.get(piece.uid) ?? part.joints.map(() => piece.z ?? 0);
  const ramp = part.rampEnds && isRamp(piece) ? part.rampEnds : null;
  const zA = ramp ? zs[ramp[0][0]] : zs[0] ?? 0;
  const zB = ramp ? zs[ramp[1][0]] : zA;
  return part.routes.flatMap((r) => {
    const pts = routeSamples(r, step);
    return pts.map((p, i) => ({ ...toWorld(piece, p), z: ramp ? zA + ((zB - zA) * i) / Math.max(1, pts.length - 1) : zA }));
  });
}

// ---- 橋脚 ----

export type Pier = {
  x: number;
  y: number;
  /** 線路の高さ(mm) */
  z: number;
  /** 使う橋脚の高さ(mm)。合うものがなければいちばん近いもの */
  height: number;
  /** 高さに合う橋脚があるか */
  fit: boolean;
  double: boolean;
  maker: Maker;
  /** この橋脚が支える部品 */
  owners: string[];
};

/** 部品の route0（複線は2本の中間）の、長さの割合 f の位置 */
function pointAt(piece: Piece, f: number, double: boolean) {
  const part = getPart(piece.partId);
  const at = (routeIndex: number) => {
    const pts = routeSamples(part.routes[routeIndex], 4);
    return toWorld(piece, pts[Math.round(f * (pts.length - 1))]);
  };
  if (!double) return at(0);
  const a = at(0);
  const b = at(1);
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** 高さのある部品を支える橋脚の位置・高さ・種類 */
export function placePiers(pieces: Piece[], elev: Elevation): Pier[] {
  const piers: Pier[] = [];
  const add = (p: Omit<Pier, "height" | "fit">) => {
    if (p.z < PIER_MIN_MM) return;
    const same = piers.find((q) => Math.hypot(q.x - p.x, q.y - p.y) < 8);
    if (same) {
      same.double ||= p.double;
      same.z = Math.max(same.z, p.z);
      for (const o of p.owners) if (!same.owners.includes(o)) same.owners.push(o);
      return;
    }
    piers.push({ ...p, height: 0, fit: false });
  };

  for (const piece of pieces) {
    const part = getPart(piece.partId);
    const zs = elev.joints.get(piece.uid) ?? part.joints.map(() => piece.z ?? 0);
    if (Math.max(...zs) < PIER_MIN_MM || part.bumper) continue;
    const maker = part.maker;
    const ends = part.rampEnds;
    if (!ends) {
      // ポイント・交差: 各ジョイントの下に立てる
      const world = part.joints.map((j) => toWorld(piece, j));
      world.forEach((w, i) => add({ ...w, z: zs[i], double: false, maker, owners: [piece.uid] }));
      continue;
    }
    const double = ends[0].length === 2;
    const zA = zs[ends[0][0]];
    const zB = zs[ends[1][0]];
    const len = routeLength(part.routes[0]);
    const spans = Math.max(1, Math.ceil(len / PIER_SYSTEMS[maker].maxSpanMm - 1e-6));
    for (let k = 0; k <= spans; k++) {
      const f = k / spans;
      add({ ...pointAt(piece, f, double), z: zA + (zB - zA) * f, double, maker, owners: [piece.uid] });
    }
  }

  for (const p of piers) {
    const hs = pierHeights(p.maker, p.double);
    const best = hs.reduce((a, b) => (Math.abs(b - p.z) < Math.abs(a - p.z) ? b : a), hs[0]);
    p.height = best;
    p.fit = Math.abs(best - p.z) <= PIER_FIT_MM;
  }
  return piers;
}

/** 橋脚の在庫キー（"kato:pier:S:50" など） */
export function pierStockKey(p: Pick<Pier, "maker" | "double" | "height">): string {
  return `${p.maker}:pier:${p.double ? "D" : "S"}:${p.height}`;
}

export function isPierKey(stockKey: string): boolean {
  return stockKey.includes(":pier:");
}

/** "kato:pier:D:47.5" → { maker, double, height } */
export function parsePierKey(stockKey: string): { maker: Maker; double: boolean; height: number } | null {
  const m = stockKey.match(/^(kato|tomix):pier:([SD]):([\d.]+)$/);
  return m ? { maker: m[1] as Maker, double: m[2] === "D", height: Number(m[3]) } : null;
}
