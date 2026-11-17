// 運行計画どおりに列車を動かす（運転席の映像・ほかの列車・レイアウトの見取り図で使う）。
//
// 時刻表（schedule.ts）の着発時刻はそのままに、駅間では加速・減速をつけて走らせる
// （ダイヤは一定の速さで計算しているので、加減速のぶん途中は少し速く走る）。

import { makeSegment, nextOptions, scaleKmhToMmPerSec, type DriveGraph, type DrivePose, type Segment } from "../drive";
import type { TrainMotion } from "./schedule";

/** 加速・減速（縮尺の km/h 毎秒）。模型らしくすばやく。加減速で遅れるぶんを取り戻す速さが、最高速度を大きく超えない程度 */
const ACCEL_KMH_PER_S = 80;
/** 並びの前後に足しておく線路の長さ（カメラの視線の先・編成の後ろ） */
const PAD_MM = 400;

type Chain = { segs: Segment[]; cum: number[]; total: number; startT: number; startS: number; frontAt: number };

export type PlaybackState = {
  /** まだ始発駅に現れていない */
  hidden: boolean;
  /** 走行距離(mm) */
  s: number;
  /** 速さ（縮尺の km/h） */
  kmh: number;
  /** 駅に止まっている */
  stopped: boolean;
};

/** 1本の列車の、時刻 → 位置 */
export class TrainPlayback {
  private chains: Chain[];
  private stops: TrainMotion["stops"];
  private accel: number;
  readonly length: number;
  readonly speed: number;

  constructor(graph: DriveGraph, motion: TrainMotion) {
    this.length = motion.length;
    this.speed = motion.speed;
    this.stops = motion.stops;
    this.accel = scaleKmhToMmPerSec(ACCEL_KMH_PER_S);
    this.chains = motion.runs.map((r) => {
      const segs = r.refs.map((ref) => makeSegment(graph, ref));
      let frontAt = r.frontAt;
      // 後ろ：編成とカメラのぶん。線路のつながりを逆にたどって足す
      for (let guard = 0; guard < 100 && frontAt < motion.length + PAD_MM; guard++) {
        const first = segs[0];
        const back = makeSegment(graph, { uid: first.uid, routeIndex: first.routeIndex, reverse: !first.reverse }, 20);
        const opts = nextOptions(graph, back);
        if (!opts.length) break;
        const prev = makeSegment(graph, { ...opts[0], reverse: !opts[0].reverse });
        segs.unshift(prev);
        frontAt += prev.length;
      }
      // 前：カメラの視線の先
      let ahead = segs.reduce((a, g) => a + g.length, 0) - frontAt;
      for (let guard = 0; guard < 100 && ahead < PAD_MM; guard++) {
        const opts = nextOptions(graph, segs[segs.length - 1]);
        if (!opts.length) break;
        const next = makeSegment(graph, opts[0]);
        segs.push(next);
        ahead += next.length;
      }
      const cum = [0];
      for (const g of segs) cum.push(cum[cum.length - 1] + g.length);
      return { segs, cum, total: cum[cum.length - 1], startT: r.startT, startS: r.startS, frontAt };
    });
  }

  /** 始発駅に現れる時刻 */
  get appearT(): number {
    return this.stops[0]?.arr ?? 0;
  }

  /** 終着駅に着く時刻 */
  get endT(): number {
    const last = this.stops[this.stops.length - 1];
    return last ? last.arr : 0;
  }

  /** 時刻 t の走行距離と速さ */
  stateAt(t: number): PlaybackState {
    const st = this.stops;
    if (!st.length || t < st[0].arr) return { hidden: true, s: 0, kmh: 0, stopped: true };
    for (let i = 0; i < st.length; i++) {
      const a = st[i];
      if (t <= a.dep) return { hidden: false, s: a.s, kmh: 0, stopped: true };
      const b = st[i + 1];
      if (!b) return { hidden: false, s: a.s, kmh: 0, stopped: true };
      if (t < b.arr) {
        const { s, v } = profile(b.s - a.s, b.arr - a.dep, t - a.dep, this.accel);
        return { hidden: false, s: a.s + s, kmh: v / scaleKmhToMmPerSec(1), stopped: false };
      }
    }
    const last = st[st.length - 1];
    return { hidden: false, s: last.s, kmh: 0, stopped: true };
  }

  private chainAt(t: number): Chain {
    let c = this.chains[0];
    for (const x of this.chains) if (x.startT <= t) c = x;
    return c;
  }

  /** 時刻 t に、先頭から offset mm 先（負なら後ろ）の線路の上の位置 */
  poseAt(t: number, offset = 0): DrivePose {
    const c = this.chainAt(t);
    const { s } = this.stateAt(t);
    return chainPose(c, c.frontAt + (s - c.startS) + offset);
  }

  /** 時刻 t に固定した、位置を返すもの（carPlacements に渡す） */
  at(t: number): { poseAt: (offset?: number) => DrivePose } {
    const c = this.chainAt(t);
    const front = c.frontAt + (this.stateAt(t).s - c.startS);
    return { poseAt: (offset = 0) => chainPose(c, front + offset) };
  }
}

/**
 * 距離 d を時間 T で走る（止まった所から出て、止まった所に着く）ときの、出てから tau 秒後の距離と速さ。
 * 加速 a で上げ、一定の速さで走り、a で止まる（台形）。時間内に着けない加速なら、加速を上げる（三角形）
 */
export function profile(d: number, T: number, tau: number, a: number): { s: number; v: number } {
  if (d <= 0 || T <= 0) return { s: Math.max(0, d), v: 0 };
  const x = Math.max(0, Math.min(T, tau));
  const acc = Math.max(a, (4 * d) / (T * T));
  const disc = Math.max(0, acc * acc * T * T - 4 * acc * d);
  const vp = (acc * T - Math.sqrt(disc)) / 2;
  const ta = vp / acc;
  if (x < ta) return { s: 0.5 * acc * x * x, v: acc * x };
  if (x <= T - ta) return { s: 0.5 * acc * ta * ta + vp * (x - ta), v: vp };
  const r = T - x;
  return { s: d - 0.5 * acc * r * r, v: acc * r };
}

function chainPose(c: Chain, dist: number): DrivePose {
  const d0 = Math.max(0, Math.min(c.total, dist));
  // 区間を二分探索
  let lo = 0;
  let hi = c.segs.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (c.cum[mid] <= d0) lo = mid;
    else hi = mid - 1;
  }
  const seg = c.segs[lo];
  const d = Math.max(0, Math.min(seg.length, d0 - c.cum[lo]));
  const k = Math.max(1, seg.dist.findIndex((v) => v >= d));
  const a = seg.points[k - 1];
  const b = seg.points[Math.min(k, seg.points.length - 1)];
  const span = seg.dist[k] - seg.dist[k - 1] || 1;
  const f = (d - seg.dist[k - 1]) / span;
  return {
    x: a.x + (b.x - a.x) * f,
    y: a.y + (b.y - a.y) * f,
    z: a.z + (b.z - a.z) * f,
    heading: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI,
    gradePct: ((b.z - a.z) / span) * 100,
    curvature: ((seg.turnDeg * Math.PI) / 180) / seg.length,
    uid: seg.uid,
  };
}
