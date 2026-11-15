// 線路以外のパーツ（踏切・信号機・ホーム・駅舎・建物）の定義と、線路への吸着。
// 配置データは Layout.accessories に、線路（pieces）とは別に保存する。

import { ACCESSORY_CATALOG, type AccessoryEntry, type AccessoryKind, type AccessoryMount } from "../data/accessories";
import type { Elevation } from "./elevation";
import { toWorld, type Piece } from "./geometry";
import { getPart, MAKERS, normDeg, type Maker } from "./parts";
import { routeSamples } from "./shapes";

export type Accessory = {
  uid: string;
  /** "kato:CROSSING" のようなキー */
  itemId: string;
  /** 中心のワールド座標と向き（度。線路に沿った方向が0°） */
  x: number;
  y: number;
  rot: number;
  /** 置いた所の線路の高さ(mm)。省略時は地上 */
  z?: number;
  /** 線路に吸着している部品の uid */
  host?: string;
  /** 線路のどちら側か（ホーム・信号機の柱）。進行方向に向かって L=左, R=右 */
  side?: "L" | "R";
};

export type AccessoryDef = AccessoryEntry & { key: string; maker: Maker };

export const ACCESSORIES: AccessoryDef[] = MAKERS.flatMap((maker) =>
  ACCESSORY_CATALOG[maker].map((e) => ({ ...e, key: `${maker}:${e.id}`, maker })),
);
const byKey = new Map(ACCESSORIES.map((a) => [a.key, a]));

export function hasAccessory(key: string): boolean {
  return byKey.has(key);
}
export function getAccessory(key: string): AccessoryDef {
  const a = byKey.get(key);
  if (!a) throw new Error(`未知のパーツ: ${key}`);
  return a;
}
export function accessoriesFor(maker: Maker): AccessoryDef[] {
  return ACCESSORIES.filter((a) => a.maker === maker);
}
export function accessoryIdsFor(maker: Maker): [string, ...string[]] {
  return accessoriesFor(maker).map((a) => a.id) as [string, ...string[]];
}

/** 線路に吸着させるパーツか */
export const snapsToTrack = (mount: AccessoryMount) => mount !== "free";

// ---- 在庫・部品リストのキー ----

export function accessoryStockKey(def: Pick<AccessoryDef, "maker" | "code">): string {
  return `${def.maker}:acc:${def.code}`;
}
export function isAccessoryKey(stockKey: string): boolean {
  return stockKey.includes(":acc:");
}
export function accessoryOfStockKey(stockKey: string): AccessoryDef | undefined {
  const m = stockKey.match(/^(kato|tomix):acc:(.+)$/);
  return m ? ACCESSORIES.find((a) => a.maker === m[1] && a.code === m[2]) : undefined;
}

// ---- 線路への吸着 ----

export type TrackPoint = { x: number; y: number; z: number; deg: number; uid: string; route: number };

/** 部品の中心線上の点（ワールド座標）と進行方向。高さは解析結果から */
export function trackPoints(piece: Piece, elevation?: Elevation, step = 5): TrackPoint[] {
  const part = getPart(piece.partId);
  const zs = elevation?.joints.get(piece.uid) ?? part.joints.map(() => piece.z ?? 0);
  const ramp = piece.ramp && part.rampEnds ? part.rampEnds : null;
  const zA = ramp ? (zs[ramp[0][0]] ?? 0) : (zs[0] ?? piece.z ?? 0);
  const zB = ramp ? (zs[ramp[1][0]] ?? zA) : zA;
  const out: TrackPoint[] = [];
  for (const [route, r] of part.routes.entries()) {
    const pts = routeSamples(r, step).map((p) => toWorld(piece, piece.mirror ? { x: p.x, y: -p.y } : p));
    pts.forEach((p, i) => {
      const a = pts[Math.max(0, i - 1)];
      const b = pts[Math.min(pts.length - 1, i + 1)];
      const deg = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
      const t = pts.length > 1 ? i / (pts.length - 1) : 0;
      out.push({ x: p.x, y: p.y, z: zA + (zB - zA) * t, deg, uid: piece.uid, route });
    });
  }
  return out;
}

/** これより遠い線路には吸着しない(mm) */
export const ACC_SNAP_MM = 60;

/**
 * 点 (x, y) にいちばん近い線路の点に、パーツを合わせた位置を返す（近くに線路がなければ null）。
 * beside はクリックした側にずらし、onTrack・over は中心線に乗せる。
 */
export function snapAccessory(
  def: AccessoryDef,
  at: { x: number; y: number },
  pieces: Piece[],
  elevation?: Elevation,
  opts: { side?: "L" | "R"; only?: string; rot?: number } = {},
): Omit<Accessory, "uid" | "itemId"> | null {
  if (!snapsToTrack(def.mount)) return null;
  let best: { p: TrackPoint; d: number } | null = null;
  for (const piece of pieces) {
    if (opts.only && piece.uid !== opts.only) continue;
    if (getPart(piece.partId).bumper && def.mount === "onTrack") continue;
    const pts = trackPoints(piece, elevation);
    // 隣り合う点の間の線分に垂線を下ろして、いちばん近い点を求める
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      if (a.route !== b.route) continue;
      const vx = b.x - a.x;
      const vy = b.y - a.y;
      const len2 = vx * vx + vy * vy || 1;
      const t = Math.max(0, Math.min(1, ((at.x - a.x) * vx + (at.y - a.y) * vy) / len2));
      const p: TrackPoint = {
        x: a.x + vx * t,
        y: a.y + vy * t,
        z: a.z + (b.z - a.z) * t,
        deg: (Math.atan2(vy, vx) * 180) / Math.PI,
        uid: a.uid,
        route: a.route,
      };
      const d = Math.hypot(p.x - at.x, p.y - at.y);
      if (!best || d < best.d) best = { p, d };
    }
  }
  const limit = def.mount === "beside" ? ACC_SNAP_MM + (def.offset ?? 0) : ACC_SNAP_MM;
  if (!best || (!opts.only && best.d > limit)) return null;
  const { p } = best;
  // 向きは今の向きに近いほう（線路の向き か 逆向き）にそろえる
  let deg = p.deg;
  if (opts.rot !== undefined && Math.abs(normDeg(opts.rot - deg)) > 90) deg = normDeg(deg + 180);
  const r = (deg * Math.PI) / 180;
  // 左の法線（画面の y が下向きなので、進行方向の左は (sin, -cos)）
  const nx = Math.sin(r);
  const ny = -Math.cos(r);
  const cross = (at.x - p.x) * nx + (at.y - p.y) * ny;
  const side: "L" | "R" = opts.side ?? (cross >= 0 ? "L" : "R");
  const off = def.mount === "beside" ? (def.offset ?? 0) * (side === "L" ? 1 : -1) : 0;
  return {
    x: p.x + nx * off,
    y: p.y + ny * off,
    rot: normDeg(deg),
    ...(p.z ? { z: p.z } : {}),
    host: p.uid,
    side,
  };
}

/** 部品の中心線のまんなかにパーツを置く（AIの配置・選んだ線路への追加用） */
export function placeOnPiece(
  def: AccessoryDef,
  piece: Piece,
  elevation: Elevation | undefined,
  side: "L" | "R" = "L",
  uid: string,
): Accessory {
  const pts = trackPoints(piece, elevation);
  const mid = pts[Math.floor(pts.length / 2)] ?? { x: piece.x, y: piece.y, deg: piece.rot };
  if (!snapsToTrack(def.mount)) {
    // 建物は線路の横（左右）に、線路から離して置く
    const r = (mid.deg * Math.PI) / 180;
    const off = (def.width / 2 + 30) * (side === "L" ? 1 : -1);
    return { uid, itemId: def.key, x: mid.x + Math.sin(r) * off, y: mid.y - Math.cos(r) * off, rot: normDeg(mid.deg), side };
  }
  const s = snapAccessory(def, mid, [piece], elevation, { side, only: piece.uid })!;
  return { uid, itemId: def.key, ...s };
}

/** パーツの4隅（ワールド座標、平面図用） */
export function accessoryCorners(a: Pick<Accessory, "x" | "y" | "rot">, def: Pick<AccessoryDef, "length" | "width">) {
  const r = (a.rot * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  const hl = def.length / 2;
  const hw = def.width / 2;
  return [
    [-hl, -hw],
    [hl, -hw],
    [hl, hw],
    [-hl, hw],
  ].map(([u, v]) => ({ x: a.x + u * c - v * s, y: a.y + u * s + v * c }));
}

/** 置き方の説明（パレットの補足） */
export const MOUNT_HELP: Record<AccessoryMount, string> = {
  onTrack: "線路の上に吸着します",
  beside: "線路の横に吸着します（ドラッグした側）",
  over: "線路をまたぐように吸着します",
  free: "自由に置けます",
};

export const KIND_ORDER: AccessoryKind[] = ["crossing", "signal", "platform", "island", "bridgeStation", "station", "building"];

let accCounter = 0;
export function newAccessoryUid(): string {
  accCounter += 1;
  return `a${Date.now().toString(36)}${accCounter.toString(36)}`;
}
