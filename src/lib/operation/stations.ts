// レイアウトに置いたホーム（相対式・島式）から駅と番線を見つける。
//
// ホームの長さの範囲で、ホームの縁（ホームの中心から offset 離れた所）を通る線路を「そのホームの番線」とする。
// 島式ホームは両側が番線になる。近くのホームどうし・同じ線路を使うホームどうしは1つの駅にまとめる。

import { getAccessory, hasAccessory, trackPoints, type Accessory } from "../accessories";
import type { Elevation } from "../elevation";
import type { Piece } from "../geometry";
import { hasPart } from "../parts";

export type StationTrack = {
  /** 1始まりの番線 */
  number: number;
  /** この番線の線路の部品 uid */
  pieces: string[];
  /** この番線に面したホームの長さ(mm)。ホームを縦に並べたときは合計 */
  platformLength: number;
};

export type Station = {
  /** 駅のID（駅に含まれるホームの uid のうち最小のもの。ホームを置き直さない限り変わらない） */
  id: string;
  /** 自動でつける仮の名前（A駅, B駅…） */
  defaultName: string;
  /** ホームの uid */
  platforms: string[];
  tracks: StationTrack[];
  /** 駅の中心（ホームの中心の平均） */
  x: number;
  y: number;
};

/** ホームの縁と線路の中心線のずれの許容(mm) */
const EDGE_TOLERANCE_MM = 8;
/** ホームの端どうしがこの距離より近ければ同じ駅 */
const SAME_STATION_GAP_MM = 120;

const isPlatform = (a: Accessory) => {
  if (!hasAccessory(a.itemId)) return false;
  const k = getAccessory(a.itemId).kind;
  return k === "platform" || k === "island";
};

type Edge = { platform: string; pieces: Set<string>; side: number };

/** ホームの縁に沿う線路（側ごと） */
function platformEdges(a: Accessory, pieces: Piece[], elevation?: Elevation): Edge[] {
  const def = getAccessory(a.itemId);
  const offset = def.offset ?? def.width / 2;
  const r = (a.rot * Math.PI) / 180;
  const ux = Math.cos(r);
  const uy = Math.sin(r);
  const sides = new Map<number, Map<string, number>>();
  for (const piece of pieces) {
    if (!hasPart(piece.partId)) continue;
    for (const p of trackPoints(piece, elevation, 5)) {
      const dx = p.x - a.x;
      const dy = p.y - a.y;
      const u = dx * ux + dy * uy;
      const v = -dx * uy + dy * ux;
      if (Math.abs(u) > def.length / 2) continue;
      if (Math.abs(Math.abs(v) - offset) > EDGE_TOLERANCE_MM) continue;
      if (Math.abs((p.z ?? 0) - (a.z ?? 0)) > 5) continue;
      const side = Math.sign(v);
      const m = sides.get(side) ?? new Map<string, number>();
      m.set(piece.uid, (m.get(piece.uid) ?? 0) + 1);
      sides.set(side, m);
    }
  }
  const out: Edge[] = [];
  for (const [side, counts] of sides) {
    // 端がかすっただけの部品（2点未満）は数えない
    const ps = [...counts].filter(([, n]) => n >= 2).map(([uid]) => uid);
    if (ps.length) out.push({ platform: a.uid, pieces: new Set(ps), side });
  }
  // 相対式ホームは片側だけが番線（吸着した線路の側。なければ線路の多い側）
  if (def.kind === "platform" && out.length > 1) {
    const host = out.find((e) => a.host && e.pieces.has(a.host));
    return [host ?? out.slice().sort((x, y) => y.pieces.size - x.pieces.size)[0]];
  }
  return out;
}

class UnionFind {
  parent: number[];
  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
  }
  find(i: number): number {
    while (this.parent[i] !== i) i = this.parent[i] = this.parent[this.parent[i]];
    return i;
  }
  union(a: number, b: number) {
    this.parent[this.find(a)] = this.find(b);
  }
}

const intersects = (a: Set<string>, b: Set<string>) => [...a].some((x) => b.has(x));

/** A, B, …, Z, AA, AB … */
function letter(i: number): string {
  let s = "";
  let n = i;
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

/** elevation を渡すと、高架・勾配の線路の高さも見てホームと合わせる */
export function detectStations(pieces: Piece[], accessories: Accessory[], elevation?: Elevation): Station[] {
  const plats = accessories.filter(isPlatform);
  if (plats.length === 0) return [];
  const edges = plats.map((a) => platformEdges(a, pieces, elevation));

  // ホームを駅にまとめる
  const uf = new UnionFind(plats.length);
  for (let i = 0; i < plats.length; i++) {
    for (let j = i + 1; j < plats.length; j++) {
      const a = plats[i];
      const b = plats[j];
      const la = getAccessory(a.itemId).length;
      const lb = getAccessory(b.itemId).length;
      const near = Math.hypot(a.x - b.x, a.y - b.y) < (la + lb) / 2 + SAME_STATION_GAP_MM && Math.abs((a.z ?? 0) - (b.z ?? 0)) < 5;
      const share = edges[i].some((e) => edges[j].some((f) => intersects(e.pieces, f.pieces)));
      if (near || share) uf.union(i, j);
    }
  }
  const groups = new Map<number, number[]>();
  plats.forEach((_, i) => {
    const g = uf.find(i);
    groups.set(g, [...(groups.get(g) ?? []), i]);
  });

  const stations: Omit<Station, "defaultName">[] = [];
  for (const idx of groups.values()) {
    const members = idx.map((i) => plats[i]);
    const x = members.reduce((s, a) => s + a.x, 0) / members.length;
    const y = members.reduce((s, a) => s + a.y, 0) / members.length;
    // 同じ線路を使う縁を1つの番線にまとめる
    const all = idx.flatMap((i) => edges[i]);
    const tuf = new UnionFind(all.length);
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) if (intersects(all[i].pieces, all[j].pieces)) tuf.union(i, j);
    const trackSets = new Map<number, Set<string>>();
    const trackPlatforms = new Map<number, Set<string>>();
    all.forEach((e, i) => {
      const g = tuf.find(i);
      const s = trackSets.get(g) ?? new Set<string>();
      e.pieces.forEach((p) => s.add(p));
      trackSets.set(g, s);
      trackPlatforms.set(g, (trackPlatforms.get(g) ?? new Set<string>()).add(e.platform));
    });
    const platLength = new Map(members.map((a) => [a.uid, getAccessory(a.itemId).length]));
    // 番線は、最初のホームの向きに対して左（画面の上側）から順に
    const ref = members.slice().sort((a, b) => (a.uid < b.uid ? -1 : 1))[0];
    const r = (ref.rot * Math.PI) / 180;
    const byUid = new Map(pieces.map((p) => [p.uid, p]));
    const lateral = (set: Set<string>) => {
      const pts = [...set].flatMap((uid) => {
        const p = byUid.get(uid);
        return p ? trackPoints(p, undefined, 20) : [];
      });
      const v = pts.reduce((s, p) => s + (-(p.x - x) * Math.sin(r) + (p.y - y) * Math.cos(r)), 0) / (pts.length || 1);
      return v;
    };
    const tracks = [...trackSets]
      .map(([g, set]) => ({
        set,
        v: lateral(set),
        platformLength: [...(trackPlatforms.get(g) ?? [])].reduce((sum, uid) => sum + (platLength.get(uid) ?? 0), 0),
      }))
      .sort((a, b) => a.v - b.v)
      .map((t, i) => ({ number: i + 1, pieces: [...t.set].sort(), platformLength: t.platformLength }));
    stations.push({ id: ref.uid, platforms: members.map((a) => a.uid).sort(), tracks, x, y });
  }
  // 駅の並びは左上から（x、同じくらいなら y）
  stations.sort((a, b) => a.x - b.x || a.y - b.y);
  return stations.map((s, i) => ({ ...s, defaultName: `${letter(i)}駅` }));
}

/** 部品 uid → その部品を番線に含む駅と番線 */
export function trackIndex(stations: Station[]): Map<string, { station: Station; track: number }> {
  const m = new Map<string, { station: Station; track: number }>();
  for (const st of stations) for (const t of st.tracks) for (const uid of t.pieces) m.set(uid, { station: st, track: t.number });
  return m;
}
