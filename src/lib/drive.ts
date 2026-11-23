// 一人称視点（運転席）の走行のための、線路のつながりのグラフと走行位置の計算。
//
// 部品の経路（route）1本を「区間」とし、区間の両端のジョイントから、つながった相手の部品の区間へ進む。
// ポイント（分岐）の手前で進める区間が2本以上あるときは、選び方（直進・分岐・交互・おまかせ）で決める。
// 座標はレイアウトと同じ（x 右, y 下, mm）。z は地上の線路のレール面からの高さ(mm)。

import { computeElevation, type Elevation } from "./elevation";
import { findConnections, type Piece } from "./geometry";
import { getPart, normDeg, type PartDef } from "./parts";
import { routeEnd, routeSamples, type Route } from "./shapes";

const rad = (d: number) => (d * Math.PI) / 180;

export const VEHICLE_TYPES = [
  { value: "commuter", label: "通勤電車" },
  { value: "express", label: "特急車両" },
  { value: "shinkansen", label: "新幹線" },
  { value: "freight", label: "貨物列車" },
] as const;
export type VehicleType = (typeof VEHICLE_TYPES)[number]["value"];
export function defaultVehicleType(kind?: string): VehicleType {
  return kind === "freight" ? "freight" : kind === "express" ? "express" : "commuter";
}

export type DrivePoint = { x: number; y: number; z: number };

/** 区間（部品の経路1本を、決まった向きに走る） */
export type Segment = {
  uid: string;
  routeIndex: number;
  /** true で経路の終点から始点へ走る */
  reverse: boolean;
  points: DrivePoint[];
  /** points の先頭からの距離 */
  dist: number[];
  length: number;
  /** 出口のジョイント番号（車止めの先など、ジョイントがなければ null） */
  exitJoint: number | null;
  /** 入口から出口までの向きの変化（度, 正=右へ曲がる） */
  turnDeg: number;
};

export type SegmentRef = { uid: string; routeIndex: number; reverse: boolean };

/** 経路の両端のジョイント番号（なければ null） */
type RouteEnds = { start: number | null; end: number | null };

export type DriveGraph = {
  pieces: Map<string, Piece>;
  routeEnds: Map<string, RouteEnds[]>;
  /** "uid:ジョイント番号" → つながっている相手 */
  partner: Map<string, { uid: string; index: number }>;
  elevation: Elevation;
};

const jkey = (uid: string, index: number) => `${uid}:${index}`;

function matchJoint(part: PartDef, pose: { x: number; y: number; deg: number }): number | null {
  const i = part.joints.findIndex(
    (j) => Math.hypot(j.x - pose.x, j.y - pose.y) < 0.5 && Math.abs(normDeg(j.deg - pose.deg)) < 0.5,
  );
  return i < 0 ? null : i;
}

function endsOfRoutes(part: PartDef): RouteEnds[] {
  return part.routes.map((r) => ({
    start: matchJoint(part, { ...r.start, deg: r.start.deg + 180 }),
    end: matchJoint(part, routeEnd(r)),
  }));
}

export function buildDriveGraph(pieces: Piece[]): DriveGraph {
  const { connections } = findConnections(pieces);
  const partner = new Map<string, { uid: string; index: number }>();
  for (const c of connections) {
    partner.set(jkey(c.a.pieceUid, c.a.index), { uid: c.b.pieceUid, index: c.b.index });
    partner.set(jkey(c.b.pieceUid, c.b.index), { uid: c.a.pieceUid, index: c.a.index });
  }
  return {
    pieces: new Map(pieces.map((p) => [p.uid, p])),
    routeEnds: new Map(pieces.map((p) => [p.uid, endsOfRoutes(getPart(p.partId))])),
    partner,
    elevation: computeElevation(pieces, connections),
  };
}

function toWorld(piece: Piece, p: { x: number; y: number }) {
  const y = piece.mirror ? -p.y : p.y;
  const c = Math.cos(rad(piece.rot));
  const s = Math.sin(rad(piece.rot));
  return { x: piece.x + p.x * c - y * s, y: piece.y + p.x * s + y * c };
}

function routeTurn(route: Route): number {
  return route.moves.reduce((s, m) => s + (m.t === "A" ? (m.turn === "L" ? -m.deg : m.deg) : 0), 0);
}

/** 区間の形（中心線の点と高さ）を作る */
export function makeSegment(graph: DriveGraph, ref: SegmentRef, step = 4): Segment {
  const piece = graph.pieces.get(ref.uid)!;
  const part = getPart(piece.partId);
  const route = part.routes[ref.routeIndex];
  const ends = graph.routeEnds.get(ref.uid)![ref.routeIndex];
  const zs = graph.elevation.joints.get(ref.uid) ?? part.joints.map(() => piece.z ?? 0);
  const base = piece.z ?? 0;
  const zStart = ends.start !== null ? zs[ends.start] ?? base : (zs[0] ?? base);
  const zEnd = ends.end !== null ? zs[ends.end] ?? base : zStart;

  const local = routeSamples(route, step);
  const world = local.map((p) => toWorld(piece, p));
  const dist = [0];
  for (let i = 1; i < world.length; i++) {
    dist.push(dist[i - 1] + Math.hypot(world[i].x - world[i - 1].x, world[i].y - world[i - 1].y));
  }
  const length = dist[dist.length - 1] || 1;
  let points = world.map((p, i) => ({ ...p, z: zStart + ((zEnd - zStart) * dist[i]) / length }));
  let d = dist;
  if (ref.reverse) {
    points = points.slice().reverse();
    d = dist.map((v) => length - v).reverse();
  }
  // 鏡像の部品は左右が入れ替わる
  const turn = routeTurn(route) * (piece.mirror ? -1 : 1) * (ref.reverse ? -1 : 1);
  return {
    ...ref,
    points,
    dist: d,
    length,
    exitJoint: ref.reverse ? ends.start : ends.end,
    turnDeg: turn,
  };
}

/** 区間の出口の先に進める区間（直進に近い順） */
export function nextOptions(graph: DriveGraph, seg: Pick<Segment, "uid" | "exitJoint">): SegmentRef[] {
  if (seg.exitJoint === null) return [];
  const q = graph.partner.get(jkey(seg.uid, seg.exitJoint));
  if (!q) return [];
  const piece = graph.pieces.get(q.uid)!;
  const part = getPart(piece.partId);
  const out: { ref: SegmentRef; turn: number }[] = [];
  graph.routeEnds.get(q.uid)!.forEach((e, routeIndex) => {
    const turn = Math.abs(routeTurn(part.routes[routeIndex]));
    if (e.start === q.index) out.push({ ref: { uid: q.uid, routeIndex, reverse: false }, turn });
    else if (e.end === q.index) out.push({ ref: { uid: q.uid, routeIndex, reverse: true }, turn });
  });
  // 曲がりの小さい順。曲がりが同じ（S字の渡り線など）は経路の順
  out.sort((a, b) => a.turn - b.turn || a.ref.routeIndex - b.ref.routeIndex);
  return out.map((o) => o.ref);
}

export type SwitchPolicy = "straight" | "diverge" | "alternate" | "random";

export const SWITCH_POLICIES: { value: SwitchPolicy; label: string }[] = [
  { value: "straight", label: "直進" },
  { value: "diverge", label: "分岐" },
  { value: "alternate", label: "交互" },
  { value: "random", label: "おまかせ" },
];

/** 進路の選択肢の名前（直進・左へ分岐・右へ分岐） */
export function optionLabel(graph: DriveGraph, ref: SegmentRef, index: number): string {
  const t = makeSegment(graph, ref, 20).turnDeg;
  if (Math.abs(t) < 0.5) return index === 0 ? "直進" : "渡り";
  return t > 0 ? "右へ分岐" : "左へ分岐";
}

export type DrivePose = {
  x: number;
  y: number;
  z: number;
  /** 進行方向（度, レイアウトの角度と同じ） */
  heading: number;
  /** 勾配(%), 上りが正 */
  gradePct: number;
  /** 進行方向の曲がり具合（1/mm, 正=右カーブ） */
  curvature: number;
  uid: string;
};

/** 走行中の列車の位置。現在の区間から先の区間を順につないで持つ */
export class Drive {
  readonly graph: DriveGraph;
  segments: Segment[];
  /** segments[0] の先頭からの距離 */
  s = 0;
  /** 走った距離の合計(mm) */
  odometer = 0;
  policy: SwitchPolicy = "straight";
  /** 次のポイントだけ、選び方とは別に選ぶ進路（直進に近い順の番号） */
  nextOverride: number | null = null;
  /** 現在位置より後ろに残しておく線路の長さ（後ろの車両を線路に沿って置くため） */
  readonly keepBehind: number;
  private turnCount = new Map<string, number>();
  private rand: () => number;

  constructor(graph: DriveGraph, start: SegmentRef, rand: () => number = Math.random, keepBehind = 0) {
    this.graph = graph;
    this.segments = [makeSegment(graph, start)];
    this.rand = rand;
    this.keepBehind = keepBehind;
    this.fillBehind();
  }

  /** 後ろに keepBehind 分の線路がなければ、つながりを逆にたどって足す（行き止まりならそこまで） */
  private fillBehind() {
    for (let guard = 0; guard < 200 && this.s < this.keepBehind; guard++) {
      const first = this.segments[0];
      const back = makeSegment(this.graph, { uid: first.uid, routeIndex: first.routeIndex, reverse: !first.reverse }, 20);
      const options = nextOptions(this.graph, back);
      if (!options.length) return;
      const prev = makeSegment(this.graph, { ...options[0], reverse: !options[0].reverse });
      this.segments.unshift(prev);
      this.s += prev.length;
    }
  }

  /** 選び方でポイントの進路を決める */
  choose(options: SegmentRef[]): number {
    if (options.length <= 1) return 0;
    if (this.nextOverride !== null) {
      const c = Math.min(this.nextOverride, options.length - 1);
      this.nextOverride = null;
      return c;
    }
    switch (this.policy) {
      case "straight":
        return 0;
      case "diverge":
        return 1;
      case "random":
        return Math.floor(this.rand() * options.length);
      case "alternate": {
        const key = options[0].uid;
        const n = this.turnCount.get(key) ?? 0;
        this.turnCount.set(key, n + 1);
        return n % options.length;
      }
    }
  }

  private extend(): boolean {
    const last = this.segments[this.segments.length - 1];
    const options = nextOptions(this.graph, last);
    if (!options.length) return false;
    this.segments.push(makeSegment(this.graph, options[this.choose(options)]));
    return true;
  }

  /** 前方 ahead mm 分の区間を用意する（行き止まりならそこまで） */
  private ensureAhead(ahead: number) {
    for (;;) {
      const total = this.segments.reduce((a, g) => a + g.length, 0);
      if (total - this.s >= ahead) return;
      if (!this.extend()) return;
    }
  }

  /** choose と同じ選び方で、まだ決めていない先のポイントの進路を予想する（状態は変えない。おまかせは null） */
  private predict(options: SegmentRef[], first: boolean): number | null {
    if (options.length <= 1) return 0;
    if (first && this.nextOverride !== null) return Math.min(this.nextOverride, options.length - 1);
    switch (this.policy) {
      case "straight":
        return 0;
      case "diverge":
        return 1;
      case "random":
        return null;
      case "alternate":
        return (this.turnCount.get(options[0].uid) ?? 0) % options.length;
    }
  }

  /**
   * 前方に残っている線路の長さ（行き止まりまで。ahead より先は数えない）。
   * 決めていないポイントの先は予想でたどる（進路は決めない）
   */
  remaining(ahead = 2000): number {
    let total = this.segments.reduce((a, g) => a + g.length, 0) - this.s;
    let last: Pick<Segment, "uid" | "exitJoint"> = this.segments[this.segments.length - 1];
    let first = true;
    for (let guard = 0; guard < 500 && total < ahead; guard++) {
      const options = nextOptions(this.graph, last);
      if (!options.length) return total;
      const c = this.predict(options, first);
      if (options.length > 1) first = false;
      if (c === null) return ahead;
      const seg = makeSegment(this.graph, options[c], 20);
      total += seg.length;
      last = seg;
    }
    return Math.min(total, ahead);
  }

  /**
   * ds mm 進む。行き止まりに着いたら false（そこで止まる）。
   * lookAhead は進路を決めておく前方の距離（カメラの視線の先）。
   */
  advance(ds: number, lookAhead = 60): boolean {
    this.ensureAhead(ds + lookAhead);
    const total = this.segments.reduce((a, g) => a + g.length, 0);
    const move = Math.min(ds, total - this.s);
    this.s += move;
    this.odometer += move;
    while (this.segments.length > 1 && this.s - this.segments[0].length >= this.keepBehind) {
      this.s -= this.segments[0].length;
      this.segments.shift();
    }
    return move >= ds - 1e-9;
  }

  /** 進行方向を逆にする（行き止まりでの折り返し） */
  reverseDirection() {
    // 通ってきた線路を前にして、全体を逆向きにする
    const total = this.segments.reduce((a, g) => a + g.length, 0);
    this.segments = this.segments
      .slice()
      .reverse()
      .map((g) => makeSegment(this.graph, { uid: g.uid, routeIndex: g.routeIndex, reverse: !g.reverse }));
    this.s = Math.max(0, total - this.s);
    this.fillBehind();
  }

  /** 現在位置から offset mm 先の位置（負なら後ろ。用意した区間の外は、その端） */
  poseAt(offset = 0): DrivePose {
    this.ensureAhead(offset + 1);
    let d = this.s + offset;
    let i = 0;
    while (i < this.segments.length - 1 && d > this.segments[i].length) {
      d -= this.segments[i].length;
      i++;
    }
    const seg = this.segments[i];
    d = Math.max(0, Math.min(seg.length, d));
    const k = Math.max(1, seg.dist.findIndex((v) => v >= d));
    const a = seg.points[k - 1];
    const b = seg.points[k];
    const span = seg.dist[k] - seg.dist[k - 1] || 1;
    const t = (d - seg.dist[k - 1]) / span;
    return {
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
      z: a.z + (b.z - a.z) * t,
      heading: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI,
      gradePct: ((b.z - a.z) / span) * 100,
      curvature: rad(seg.turnDeg) / seg.length,
      uid: seg.uid,
    };
  }

  /**
   * 次に進路を選ぶポイント（前方 within mm 以内）。用意済みの区間の先を、選び方の通りにたどって探す。
   * distance はそのポイントまでの距離、options は進路の名前（直進に近い順）
   */
  nextSwitch(within = 3000): { uid: string; distance: number; options: string[] } | null {
    const done = this.segments.reduce((a, g) => a + g.length, 0) - this.s;
    let distance = done;
    let last: Pick<Segment, "uid" | "exitJoint"> = this.segments[this.segments.length - 1];
    for (let guard = 0; guard < 200 && distance < within; guard++) {
      const options = nextOptions(this.graph, last);
      if (!options.length) return null;
      if (options.length > 1) {
        return { uid: options[0].uid, distance, options: options.map((o, i) => optionLabel(this.graph, o, i)) };
      }
      const seg = makeSegment(this.graph, options[0], 20);
      distance += seg.length;
      last = seg;
    }
    return null;
  }
}

/** 走り始める区間（指定の部品、なければ最初の車止め以外の部品の route0） */
export function startRef(pieces: Piece[], uid?: string | null, reverse = false): SegmentRef | null {
  const piece = pieces.find((p) => p.uid === uid) ?? pieces.find((p) => !getPart(p.partId).bumper) ?? pieces[0];
  if (!piece) return null;
  const bumper = getPart(piece.partId).bumper;
  // 車止めは車止めに向かって走らないように逆向きから
  return { uid: piece.uid, routeIndex: 0, reverse: bumper ? !reverse : reverse };
}

/** 縮尺 1/150 の時速(km/h) → 模型の秒速(mm/s) */
export function scaleKmhToMmPerSec(kmh: number, scale = 150): number {
  return (kmh * 1_000_000) / 3600 / scale;
}

/**
 * Nゲージ（1/150）の20m級の車両の寸法(mm)。実物の 全長20m・車体幅2.9m・屋根の高さ約3.9m・台車中心間隔13.8m を 1/150 にしたもの
 * （KATO・TOMIX の20m級の車両はおよそ全長133〜135mm）。
 */
export const N_CAR = {
  length: 133,
  width: 19.3,
  /** レール面から屋根まで */
  height: 26,
  /** レール面から車体の床まで */
  floor: 4,
  /** 前後の台車の中心の間隔 */
  bogieCenters: 92,
  /** 連結した車両の間のすきま */
  gap: 3,
} as const;

export type CarPlacement = {
  /** 車体の中心（レール面の高さ） */
  x: number;
  y: number;
  z: number;
  /** 車体の向き（度, レイアウトの角度と同じ） */
  heading: number;
  /** 車体の前上がりの傾き（ラジアン） */
  pitch: number;
};

/**
 * 先頭の車両の前端を現在位置にして、cars 両の車体の置き方を求める。
 * 実物と同じく、車体は前後の台車の位置（線路の上）を結んだ向きに置く（曲線では車体の端が少し外へ出る）
 */
export function carPlacements(drive: { poseAt(offset?: number): DrivePose }, cars: number): CarPlacement[] {
  const { length, bogieCenters, gap } = N_CAR;
  const out: CarPlacement[] = [];
  for (let i = 0; i < cars; i++) {
    const front = -i * (length + gap);
    const a = drive.poseAt(front - (length - bogieCenters) / 2);
    const b = drive.poseAt(front - (length + bogieCenters) / 2);
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const flat = Math.hypot(dx, dy) || 1;
    out.push({
      x: (a.x + b.x) / 2,
      y: (a.y + b.y) / 2,
      z: (a.z + b.z) / 2,
      heading: (Math.atan2(dy, dx) * 180) / Math.PI,
      pitch: Math.atan2(a.z - b.z, flat),
    });
  }
  return out;
}

/** 列車の長さ(mm) */
export function trainLength(cars: number): number {
  return cars * N_CAR.length + (cars - 1) * N_CAR.gap;
}
