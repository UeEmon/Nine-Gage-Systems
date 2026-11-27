// 運行計画から、各列車の着発時刻（時刻表）と、列車どうしが同じ線路を同時に使う所（支障）を求める。
//
// 列車は停車駅の番線から次の停車駅の番線へ、線路のつながりをたどったいちばん短い経路で走る。
// 向きはそのまま進み、「折り返し」の駅でだけ向きを変える。駅では番線の線路のまんなかに編成の中心が来るように止まる。
// 走る速さは一定（縮尺の最高速度）として時間を計算する（加減速は含めない目安）。

import { buildDriveGraph, makeSegment, nextOptions, scaleKmhToMmPerSec, trainLength, type DriveGraph, type Segment, type SegmentRef } from "../drive";
import type { Piece } from "../geometry";
import { getPart, type PartDef } from "../parts";
import { routeSamples } from "../shapes";
import type { OperationPlan, Train, TrainStop } from "./model";
import { carsFitting } from "./consist";
import { routeKey, trackIndex, type Station, type StationTrack, type TrackRoute } from "./stations";

export type StopEvent = {
  stationId: string;
  /** 実際に使った番線 */
  track: number;
  /** 着時刻（始発駅は null） */
  arr: number | null;
  /** 発時刻（終着駅は null） */
  dep: number | null;
  pass: boolean;
  /** 何周目か（0始まり） */
  lap: number;
};

/** 部品の経路を通った記録（列車の走行距離 s と時刻） */
export type Traversal = { uid: string; routeIndex: number; from: number; to: number };

/**
 * 列車の動き（運転席の映像や、ほかの列車を動かすのに使う）。
 * 列車は区間の並び（run）の上を走る。折り返すたびに新しい並びになる。
 */
export type MotionRun = {
  /** 走る区間の並び（進む向き） */
  refs: SegmentRef[];
  /** この並びを使い始める時刻（最初の並びは -Infinity） */
  startT: number;
  /** この並びを使い始めるときの走行距離 s */
  startS: number;
  /** そのときの先頭の位置（refs の先頭からの距離, mm） */
  frontAt: number;
};

export type TrainMotion = {
  /** 最高速度(mm/s) */
  speed: number;
  /** 編成の長さ(mm) */
  length: number;
  runs: MotionRun[];
  /** 止まる所（通過は含めない）。s は走行距離、arr 着・dep 発（終着は Infinity）。最初は始発駅 */
  stops: { s: number; arr: number; dep: number }[];
};

export type TrainSchedule = {
  trainId: string;
  events: StopEvent[];
  /** 列車の動き（始発駅に置けなかったときは null） */
  motion: TrainMotion | null;
  /** 部品ごとに列車がいる時間（先頭が入ってから最後尾が出るまで） */
  occupancy: Traversal[];
  errors: string[];
  warnings: string[];
};

export type Conflict = {
  trainA: string;
  trainB: string;
  /** 重なり始める時刻 */
  time: number;
  location: string;
};

export type ScheduleResult = { trains: TrainSchedule[]; conflicts: Conflict[] };

type Pos = { seg: Segment; offset: number };

const refKey = (r: SegmentRef) => `${r.uid}:${r.routeIndex}:${r.reverse ? 1 : 0}`;

class SegCache {
  private m = new Map<string, Segment>();
  constructor(readonly graph: DriveGraph) {}
  get(ref: SegmentRef): Segment {
    const k = refKey(ref);
    let s = this.m.get(k);
    if (!s) {
      // 再生側と同じサンプリングで距離を測る。曲線の距離差が停車位置に累積しないようにする。
      s = makeSegment(this.graph, ref);
      this.m.set(k, s);
    }
    return s;
  }
}

// ---- 経路どうしが交わるか（ポイントの直進側と分岐側は交わる。複線の上下線は交わらない） ----

const crossCache = new Map<string, boolean[][]>();
function routesCross(part: PartDef): boolean[][] {
  let m = crossCache.get(part.key);
  if (m) return m;
  const pts = part.routes.map((r) => routeSamples(r, 5));
  m = pts.map((a, i) =>
    pts.map((b, j) => i === j || a.some((p) => b.some((q) => Math.hypot(p.x - q.x, p.y - q.y) < 12))),
  );
  crossCache.set(part.key, m);
  return m;
}

// ---- 経路探索 ----

type Leg = {
  /** 出発位置から停止位置までにたどる区間（先頭は出発位置の区間） */
  path: Segment[];
  /** path[0] の中での出発位置 */
  startOffset: number;
  /** 出発位置から停止位置までの距離 */
  distance: number;
  /** 停止位置 */
  end: Pos;
  track: number;
  /** 番線の線路の長さ（編成がおさまるか） */
  trackLength: number;
};

/**
 * pos から、targets（番線ごとの部品 uid）のどれかの番線に入り、その番線のまんなか（編成の中心）まで走る最短の経路。
 * 出発位置がすでに目的の番線の中なら、一度そこを出てから戻ってくる経路を探す（エンドレスを一周するなど）。
 */
function findLeg(cache: SegCache, pos: Pos, targets: Map<number, Set<string>>, trainLen: number, station: Station): Leg | null {
  const trackOf = (route: TrackRoute) => {
    const key = routeKey(route);
    for (const [n, set] of targets) if (set.has(key)) return n;
    return null;
  };
  type Node = { seg: Segment; dist: number; left: boolean; prev: string | null };
  const startLeft = trackOf(pos.seg) === null;
  const nodes = new Map<string, Node>();
  const key = (s: Segment, left: boolean) => `${refKey(s)}|${left ? 1 : 0}`;
  const startKey = key(pos.seg, startLeft);
  nodes.set(startKey, { seg: pos.seg, dist: -pos.offset, left: startLeft, prev: null });
  const done = new Set<string>();
  let found: string | null = null;
  // 小さいグラフなので、配列から最小を選ぶ単純な Dijkstra
  for (;;) {
    let best: string | null = null;
    for (const [k, n] of nodes) if (!done.has(k) && (best === null || n.dist < nodes.get(best)!.dist)) best = k;
    if (best === null) break;
    done.add(best);
    const cur = nodes.get(best)!;
    if (best !== startKey && cur.left && trackOf(cur.seg) !== null) {
      found = best;
      break;
    }
    for (const ref of nextOptions(cache.graph, cur.seg)) {
      const seg = cache.get(ref);
      const left = cur.left || trackOf(seg) === null;
      const k = key(seg, left);
      const d = cur.dist + cur.seg.length;
      const old = nodes.get(k);
      if (!done.has(k) && (!old || d < old.dist)) nodes.set(k, { seg, dist: d, left, prev: best });
    }
  }
  if (found === null) return null;

  const path: Segment[] = [];
  for (let k: string | null = found; k !== null; k = nodes.get(k)!.prev) path.unshift(nodes.get(k)!.seg);
  const entry = nodes.get(found)!;
  const track = trackOf(entry.seg)!;
  const set = targets.get(track)!;

  // 番線の線路を、まっすぐ（直進側を優先して）端までたどる
  const run: Segment[] = [entry.seg];
  const seen = new Set([entry.seg.uid]);
  for (;;) {
    const next = nextOptions(cache.graph, run[run.length - 1])
      .map((r) => cache.get(r))
      .find((s) => set.has(routeKey(s)) && !seen.has(s.uid));
    if (!next) break;
    run.push(next);
    seen.add(next.uid);
  }
  const runLen = run.reduce((s, x) => s + x.length, 0);
  // 編成の中心を番線のまんなかに。編成のほうが長ければ先頭を番線の端に
  const center = station.tracks.find((t) => t.number === track)?.platformCenter ?? station;
  let centerIn = 0, acc = 0, nearest = Infinity;
  for (const seg of run) {
    const p = projectCenter(seg, center);
    if (p.distance < nearest) { nearest = p.distance; centerIn = acc + p.offset; }
    acc += seg.length;
  }
  const stopIn = Math.min(runLen, centerIn + trainLen / 2);
  let rest = stopIn;
  let end: Pos = { seg: run[run.length - 1], offset: run[run.length - 1].length };
  const full = [...path];
  for (let i = 0; i < run.length; i++) {
    if (i > 0) full.push(run[i]);
    if (rest <= run[i].length) {
      end = { seg: run[i], offset: rest };
      break;
    }
    rest -= run[i].length;
  }
  return {
    path: full,
    startOffset: pos.offset,
    distance: entry.dist + stopIn,
    end,
    track,
    trackLength: runLen,
  };
}

/** 番線のホーム中央を線路上の距離に投影する */
function projectCenter(seg: Segment, center: { x: number; y: number }): { offset: number; distance: number } {
  let best = { offset: 0, distance: Infinity };
  for (let i = 1; i < seg.points.length; i++) {
    const a = seg.points[i - 1], b = seg.points[i];
    const dx = b.x - a.x, dy = b.y - a.y;
    const f = Math.max(0, Math.min(1, ((center.x - a.x) * dx + (center.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
    const distance = Math.hypot(a.x + f * dx - center.x, a.y + f * dy - center.y);
    if (distance < best.distance) best = { distance, offset: seg.dist[i - 1] + f * (seg.dist[i] - seg.dist[i - 1]) };
  }
  return best;
}

function candidateTracks(station: Station, track: number | null): StationTrack[] {
  // 旅客ホームの自動選択で列車が引き込み線へ入らないようにする。
  return station.tracks.filter(t => track === null ? (!t.siding || !station.platforms.length) : t.number === track);
}

function originCandidates(cache: SegCache, station: Station, track: number | null, trainLen: number): { pos: Pos; track: number }[] {
  const out: { pos: Pos; track: number; d: number }[] = [];
  for (const t of candidateTracks(station, track)) {
    const routes = new Set(t.routes.map(routeKey));
    for (const { uid, routeIndex } of t.routes) {
      const piece = cache.graph.pieces.get(uid);
      if (!piece) continue;
      const part = getPart(piece.partId);
      // ポイントの上には置かない（ほかに部品がなければ置く）
      const penalty = part.category === "turnout" ? 10_000 : 0;
      for (const reverse of [false, true]) {
        const seg = cache.get({ uid, routeIndex, reverse });
        const center = projectCenter(seg, t.platformCenter ?? station);
        let front = seg, offset = center.offset + trainLen / 2;
        const seen = new Set([seg.uid]);
        while (offset > front.length) {
          const next = nextOptions(cache.graph, front).map((r) => cache.get(r)).find((s) => routes.has(routeKey(s)) && !seen.has(s.uid));
          if (!next) { offset = front.length; break; }
          offset -= front.length; front = next; seen.add(front.uid);
        }
        out.push({ pos: { seg: front, offset }, track: t.number, d: center.distance + penalty });
      }
    }
  }
  return out.filter((c) => c.d <= Math.min(...out.filter((a) => a.track === c.track).map((a) => a.d)) + 1e-6).sort((a, b) => a.d - b.d);
}

/**
 * 折り返し。区間の並び refs の front の位置に先頭がある編成（長さ len）の向きを変え、
 * 最後尾を新しい先頭にする。新しい並び（逆向き。いまの編成が乗っている区間を含む）と、その中の先頭の位置を返す。
 * 来た道が編成より短ければ（始発駅で折り返すなど）、線路のつながりをたどって足す
 */
function turnAround(cache: SegCache, refs: SegmentRef[], front: number, len: number): { refs: SegmentRef[]; frontAt: number; pos: Pos } {
  const segs = refs.map((r) => cache.get({ ...r, reverse: !r.reverse })).reverse();
  const total = segs.reduce((a, g) => a + g.length, 0);
  const want = total - front + len;
  let acc = 0;
  for (let guard = 0; guard < 200; guard++) {
    let i = 0;
    acc = 0;
    while (i < segs.length && acc + segs[i].length < want) acc += segs[i++].length;
    if (i < segs.length) {
      const kept = segs.slice(0, i + 1);
      return {
        refs: kept.map((g) => ({ uid: g.uid, routeIndex: g.routeIndex, reverse: g.reverse })),
        frontAt: want,
        pos: { seg: segs[i], offset: want - acc },
      };
    }
    const next = nextOptions(cache.graph, segs[segs.length - 1]);
    if (!next.length) break;
    segs.push(cache.get(next[0]));
  }
  // 行き止まり：つながりの端を先頭にする
  const lastSeg = segs[segs.length - 1];
  const sum = segs.reduce((a, g) => a + g.length, 0);
  return {
    refs: segs.map((g) => ({ uid: g.uid, routeIndex: g.routeIndex, reverse: g.reverse })),
    frontAt: sum,
    pos: { seg: lastSeg, offset: lastSeg.length },
  };
}

function targetsFor(station: Station, track: number | null): Map<number, Set<string>> {
  return new Map(candidateTracks(station, track).map(t => [t.number, new Set(t.routes.map(routeKey))]));
}

// ---- 1本の列車 ----

function scheduleTrain(
  cache: SegCache,
  train: Train,
  stations: Map<string, Station>,
  stationName: (id: string) => string,
): TrainSchedule {
  const result: TrainSchedule = { trainId: train.id, events: [], motion: null, occupancy: [], errors: [], warnings: [] };
  const stops: { stop: TrainStop; lap: number }[] = [];
  for (let lap = 0; lap < train.laps; lap++) for (const stop of train.stops) stops.push({ stop, lap });
  if (stops.length === 0) {
    result.errors.push("停車駅がありません");
    return result;
  }
  for (const { stop } of stops) {
    const st = stations.get(stop.stationId);
    if (!st) {
      result.errors.push("レイアウトにない駅が入っています（ホームを動かした・消した）。停車駅を選び直してください");
      return result;
    }
    if (stop.track !== null && !st.tracks.some((t) => t.number === stop.track)) {
      result.errors.push(`${stationName(st.id)}に${stop.track}番線はありません`);
      return result;
    }
  }

  const v = scaleKmhToMmPerSec(train.speedKmh);
  const len = trainLength(train.cars, train.carSize);
  const first = stops[0];
  const origin = stations.get(first.stop.stationId)!;
  const cands = originCandidates(cache, origin, first.stop.track, len);
  if (cands.length === 0) {
    result.errors.push(`${stationName(origin.id)}に列車を置ける線路がありません`);
    return result;
  }

  // 始発駅の位置と向き：2駅目への経路が短いほう
  let start = cands[0];
  if (stops.length > 1) {
    const next = stations.get(stops[1].stop.stationId)!;
    let bestD = Infinity;
    for (const c of cands) {
      const leg = findLeg(cache, c.pos, targetsFor(next, stops[1].stop.track), len, next);
      // ほぼ等距離なら候補順を維持し、微小な曲線の測長差で進行方向を反転させない。
      if (leg && leg.distance < bestD - 0.5) {
        bestD = leg.distance;
        start = c;
      }
    }
  }

  /** ホームより編成が長ければ知らせる。知らせたら true */
  const checkPlatform = (st: Station, track: number): boolean => {
    const stationTrack = st.tracks.find((x) => x.number === track);
    const pl = stationTrack?.platformLength;
    if (pl === undefined || pl + 1 >= len) return false;
    const w = `${stationName(st.id)} ${track}番線の${stationTrack?.siding ? "引き込み線" : "ホーム"}（約${Math.round(pl)}mm・${carsFitting(pl, train.carSize)}両まで）より編成（${train.cars}両・約${Math.round(len)}mm）が長く、はみ出します`;
    if (!result.warnings.includes(w)) result.warnings.push(w);
    return true;
  };
  checkPlatform(origin, start.track);

  let pos = start.pos;
  let t = train.departSec;
  let s = 0;
  // 走行距離 s での停車（着・発）。時刻を求めるのに使う
  const marks: { s: number; arr: number; dep: number }[] = [];
  const dwell0 = first.stop.dwellSec;
  marks.push({ s: 0, arr: t - dwell0, dep: t });
  result.events.push({ stationId: origin.id, track: start.track, arr: null, dep: t, pass: false, lap: 0 });
  const traversals: Traversal[] = [];
  let curFrom = -pos.offset;
  // 動き：今の並び。pos.seg はいつも並びの最後の区間
  const toRef = (g: Segment): SegmentRef => ({ uid: g.uid, routeIndex: g.routeIndex, reverse: g.reverse });
  let run: MotionRun = { refs: [toRef(pos.seg)], startT: -Infinity, startS: 0, frontAt: pos.offset };
  const runs: MotionRun[] = [run];
  /** 並びの中の先頭の位置（並びの最初からの距離） */
  const frontIn = (r: MotionRun) => r.refs.slice(0, -1).reduce((a, x) => a + cache.get(x).length, 0) + pos.offset;
  const stopsMotion: TrainMotion["stops"] = [{ s: 0, arr: t - dwell0, dep: t }];

  for (let i = 1; i < stops.length; i++) {
    const { stop, lap } = stops[i];
    const st = stations.get(stop.stationId)!;
    const leg = findLeg(cache, pos, targetsFor(st, stop.track), len, st);
    if (!leg) {
      const prev = stationName(stops[i - 1].stop.stationId);
      result.errors.push(
        `${prev}から${stationName(st.id)}${stop.track ? `の${stop.track}番線` : ""}へ行ける線路が見つかりません。` +
          `向きを変える必要があれば、${prev}で「折り返し」にしてください`,
      );
      break;
    }
    // 区間の通過を記録（path[0] は今いる区間。その始まりの走行距離は s - startOffset）
    let boundary = s - leg.startOffset;
    for (let k = 1; k < leg.path.length; k++) {
      boundary += leg.path[k - 1].length;
      traversals.push({ uid: leg.path[k - 1].uid, routeIndex: leg.path[k - 1].routeIndex, from: curFrom, to: boundary });
      curFrom = boundary;
    }
    if (!stop.pass && !checkPlatform(st, leg.track) && leg.trackLength + 1 < len) {
      const w = `${stationName(st.id)} ${leg.track}番線は編成（${train.cars}両・約${Math.round(len)}mm）より短い線路です（約${Math.round(leg.trackLength)}mm）`;
      if (!result.warnings.includes(w)) result.warnings.push(w);
    }
    for (let k = 1; k < leg.path.length; k++) run.refs.push(toRef(leg.path[k]));
    s += leg.distance;
    t += leg.distance / v;
    const isLast = i === stops.length - 1;
    const dwell = stop.pass ? 0 : stop.dwellSec;
    const arr = t;
    const dep = isLast ? null : t + dwell;
    marks.push({ s, arr, dep: dep ?? Infinity });
    if (!stop.pass) stopsMotion.push({ s, arr, dep: dep ?? Infinity });
    result.events.push({ stationId: st.id, track: leg.track, arr: stop.pass ? null : arr, dep: stop.pass ? arr : dep, pass: stop.pass, lap });
    t = dep ?? t;
    pos = leg.end;
    if (stop.turnback && !isLast) {
      // 向きを変える：最後尾が新しい先頭になって走り出す（ここまでの部品は、編成が離れるまで使用中のまま）
      traversals.push({ uid: pos.seg.uid, routeIndex: pos.seg.routeIndex, from: curFrom, to: s });
      const turned = turnAround(cache, run.refs, frontIn(run), len);
      pos = turned.pos;
      run = { refs: turned.refs, startT: t, startS: s, frontAt: turned.frontAt };
      runs.push(run);
      curFrom = s;
    }
  }
  result.motion = { speed: v, length: len, runs, stops: stopsMotion };
  // 最後の区間（停止位置のある部品）。終着後はそこに留まる
  traversals.push({ uid: pos.seg.uid, routeIndex: pos.seg.routeIndex, from: curFrom, to: s });

  // 走行距離 → 時刻。停車中の位置では、入るときは着時刻、出るときは発時刻を使う
  marks.sort((a, b) => a.s - b.s);
  const lastMark = marks[marks.length - 1];
  const timeAt = (x: number, leaving: boolean): number => {
    if (x <= marks[0].s) return leaving && x === marks[0].s ? marks[0].dep : marks[0].arr;
    for (let i = 1; i < marks.length; i++) {
      const a = marks[i - 1];
      const b = marks[i];
      if (x < b.s) return a.dep + (x - a.s) / v;
      if (x === b.s) return leaving ? b.dep : b.arr;
    }
    return lastMark.dep === Infinity ? Infinity : lastMark.dep + (x - lastMark.s) / v;
  };
  result.occupancy = traversals.map((tr) => {
    const from = timeAt(Math.max(tr.from, 0), false);
    // 最後尾が出る時刻。終着駅を越えて最後尾が残るなら、ずっと占有（留置）
    const tail = tr.to + len;
    const to = tail > lastMark.s ? (lastMark.dep === Infinity ? Infinity : timeAt(tail, true)) : timeAt(tail, true);
    return { uid: tr.uid, routeIndex: tr.routeIndex, from: tr.from <= 0 ? marks[0].arr : from, to };
  });
  return result;
}

// ---- 全体 ----

export function computeSchedule(pieces: Piece[], stations: Station[], plan: OperationPlan): ScheduleResult {
  const graph = buildDriveGraph(pieces);
  const cache = new SegCache(graph);
  const byId = new Map(stations.map((s) => [s.id, s]));
  const name = (id: string) => plan.stationNames[id] || byId.get(id)?.defaultName || "駅";
  const trains = plan.trains.map((tr) => scheduleTrain(cache, tr, byId, name));

  // 支障：同じ部品の交わる経路を、2本の列車が同じ時間に使う
  const tracks = trackIndex(stations);
  const where = (route: TrackRoute) => {
    const uid = route.uid;
    const t = tracks.get(routeKey(route));
    if (t) return `${name(t.station.id)} ${t.track}番線`;
    const p = graph.pieces.get(uid);
    const part = p ? getPart(p.partId) : null;
    if (part && part.routes.length > 1) return `駅間のポイント（${part.name}）`;
    return "駅間";
  };
  const conflicts: Conflict[] = [];
  const nameOf = new Map(plan.trains.map((t) => [t.id, t.name]));
  for (let i = 0; i < trains.length; i++) {
    for (let j = i + 1; j < trains.length; j++) {
      const seen = new Map<string, Conflict>();
      for (const a of trains[i].occupancy) {
        for (const b of trains[j].occupancy) {
          if (a.uid !== b.uid) continue;
          const piece = graph.pieces.get(a.uid);
          if (!piece) continue;
          if (!routesCross(getPart(piece.partId))[a.routeIndex]?.[b.routeIndex]) continue;
          if (!(a.from < b.to && b.from < a.to)) continue;
          const time = Math.max(a.from, b.from);
          const location = where(a);
          const k = location;
          const old = seen.get(k);
          if (!old || time < old.time) seen.set(k, { trainA: trains[i].trainId, trainB: trains[j].trainId, time, location });
        }
      }
      conflicts.push(...seen.values());
    }
  }
  conflicts.sort((a, b) => a.time - b.time || (nameOf.get(a.trainA) ?? "").localeCompare(nameOf.get(b.trainA) ?? ""));
  return { trains, conflicts };
}
