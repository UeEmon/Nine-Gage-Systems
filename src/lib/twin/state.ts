// アプリの側で持つ「実物のいまの状態」（デジタルツイン）。実機から届いた出来事だけから作る。
//
// 列車の位置は、駅の番線のセンサーが反応した時刻をダイヤと比べて遅れを求め、
// 「いまの時刻 − 遅れ」のダイヤの上の位置にいると推定する。機関車が止まっている間は遅れが増えていく。

import type { ScheduleResult } from "../operation";
import type { TwinMap } from "./mapping";
import { formatEvent, type TwinEvent } from "./protocol";

export type TwinLogEntry = { time: number; raw: string; text: string };

export type TwinState = {
  power: boolean | null;
  sensors: Record<number, boolean>;
  turnouts: Record<number, boolean>;
  locos: Record<number, { speed: number; forward: boolean }>;
  /** 列車ごとの遅れ(秒, 正 = 遅れ)。最後にセンサーで確かめた値 */
  delays: Record<string, number>;
  /** 列車ごとの、次に着くはずの停車（時刻表の何番目か） */
  nextStop: Record<string, number>;
  /** 列車が止まった時刻（機関車の速度0・電源断）。動き出したら遅れに足す */
  stoppedAt: Record<string, number>;
  /** 新しいものが先頭 */
  log: TwinLogEntry[];
};

const LOG_MAX = 200;
/** 着いた列車を見分けるときの時刻の余裕(秒) */
const ARRIVAL_TOLERANCE_SEC = 2;

export function initialTwinState(): TwinState {
  return { power: null, sensors: {}, turnouts: {}, locos: {}, delays: {}, nextStop: {}, stoppedAt: {}, log: [] };
}

export type TwinContext = {
  map: TwinMap;
  schedule: ScheduleResult;
  trainName: (trainId: string) => string;
  /** 「A駅 1番線」のような番線の名前 */
  trackName: (stationId: string, track: number) => string;
};

/** 出来事を1つ反映する（元の state は変えない） */
export function applyTwinEvent(state: TwinState, ev: TwinEvent, time: number, ctx: TwinContext): TwinState {
  const s: TwinState = {
    ...state,
    sensors: { ...state.sensors },
    turnouts: { ...state.turnouts },
    locos: { ...state.locos },
    delays: { ...state.delays },
    nextStop: { ...state.nextStop },
    stoppedAt: { ...state.stoppedAt },
  };
  let text = "";
  const trainOfCab = (cab: number) => ctx.map.locos.find((l) => l.cab === cab)?.trainId;
  const isMoving = (trainId: string) => {
    const cab = ctx.map.locos.find((l) => l.trainId === trainId)?.cab;
    const loco = cab === undefined ? undefined : s.locos[cab];
    return s.power !== false && (loco === undefined || loco.speed > 0);
  };
  const before = new Map(ctx.map.locos.map((l) => [l.trainId, isMoving(l.trainId)]));

  switch (ev.type) {
    case "power":
      s.power = ev.on;
      text = ev.on ? "線路の電源が入りました" : "線路の電源が切れました";
      break;
    case "turnout": {
      s.turnouts[ev.id] = ev.thrown;
      const t = ctx.map.turnouts.find((x) => x.id === ev.id);
      text = `ポイント ${t?.name ?? ev.id} が${ev.thrown ? "分岐" : "直進"}に切り替わりました`;
      break;
    }
    case "loco": {
      s.locos[ev.cab] = { speed: ev.speed, forward: ev.forward };
      const id = trainOfCab(ev.cab);
      const who = id ? ctx.trainName(id) : `機関車 ${ev.cab}`;
      text = ev.speed === 0 ? `${who} が止まりました` : `${who} の速度 ${ev.speed}`;
      break;
    }
    case "sensor": {
      s.sensors[ev.id] = ev.active;
      const sensor = ctx.map.sensors.find((x) => x.id === ev.id);
      const where = sensor ? ctx.trackName(sensor.stationId, sensor.track) : `センサー ${ev.id}`;
      text = `${where} ${ev.active ? "に列車が入りました" : "から列車が出ました"}`;
      if (ev.active && sensor) {
        const m = matchArrival(s, sensor.stationId, sensor.track, time, ctx);
        if (m) {
          s.delays[m.trainId] = m.delay;
          s.nextStop[m.trainId] = m.index + 1;
          delete s.stoppedAt[m.trainId];
          text = `${ctx.trainName(m.trainId)} が ${where} に着きました（${formatDelay(m.delay)}）`;
        }
      }
      break;
    }
  }

  // 止まった・動き出した列車の遅れ
  for (const l of ctx.map.locos) {
    const was = before.get(l.trainId)!;
    const now = isMoving(l.trainId);
    if (was && !now && s.stoppedAt[l.trainId] === undefined) s.stoppedAt[l.trainId] = time;
    if (!was && now && s.stoppedAt[l.trainId] !== undefined) {
      s.delays[l.trainId] = (s.delays[l.trainId] ?? 0) + (time - s.stoppedAt[l.trainId]);
      delete s.stoppedAt[l.trainId];
    }
  }

  s.log = [{ time, raw: formatEvent(ev), text }, ...state.log].slice(0, LOG_MAX);
  return s;
}

/** センサーが反応した番線に、いま着くはずの列車と、その遅れ */
function matchArrival(
  s: TwinState,
  stationId: string,
  track: number,
  time: number,
  ctx: TwinContext,
): { trainId: string; index: number; delay: number } | null {
  let best: { trainId: string; index: number; delay: number; score: number } | null = null;
  for (const sch of ctx.schedule.trains) {
    // 次に着くはずの停車だけを見る（始発駅（0番目）にははじめからいる）。駅の番線にはどれもセンサーがあるので飛ばさない
    const i = s.nextStop[sch.trainId] ?? 1;
    const e = sch.events[i];
    if (!e || e.stationId !== stationId || e.track !== track) continue;
    const at = e.arr ?? e.dep;
    if (at === null) continue;
    // センサーが反応するのは、列車の先頭が番線の線路に入ったとき（停車位置に着くより少し前）
    const sensorPieces = new Set(ctx.map.sensors.find((x) => x.stationId === stationId && x.track === track)?.pieces ?? []);
    let enter = at;
    for (const o of sch.occupancy) if (sensorPieces.has(o.uid) && o.from <= at && at < o.to && o.from < enter) enter = o.from;
    const delay = time - enter;
    const current = currentDelay(s, sch.trainId, time);
    // 前の駅を出る前には着けない（ほかの列車がその番線に入った・はじめから止まっていた、を取り違えない）
    const prevDep = sch.events[i - 1]?.dep;
    if (prevDep !== null && prevDep !== undefined && time < prevDep + current - ARRIVAL_TOLERANCE_SEC) continue;
    const score = Math.abs(delay - current);
    if (!best || score < best.score) best = { trainId: sch.trainId, index: i, delay, score };
  }
  return best;
}

/** いまの遅れ（止まっている列車は、止まってからの時間も足す） */
export function currentDelay(s: TwinState, trainId: string, time: number): number {
  const base = s.delays[trainId] ?? 0;
  const stopped = s.stoppedAt[trainId];
  return stopped === undefined ? base : base + (time - stopped);
}

/** 列車がいま、ダイヤの上のどの時刻の位置にいるか（推定） */
export function estimatedProgress(s: TwinState, trainId: string, time: number): number {
  return Math.max(0, time - currentDelay(s, trainId, time));
}

/** 推定位置で列車がいる部品（uid → 列車ID） */
export function occupiedPieces(s: TwinState, ctx: Pick<TwinContext, "schedule">, time: number): Map<string, string> {
  const out = new Map<string, string>();
  for (const sch of ctx.schedule.trains) {
    const p = estimatedProgress(s, sch.trainId, time);
    for (const o of sch.occupancy) if (o.from <= p && p < o.to) out.set(o.uid, sch.trainId);
  }
  return out;
}

export function formatDelay(sec: number): string {
  const r = Math.round(sec);
  if (Math.abs(r) <= 2) return "定時";
  return r > 0 ? `${r}秒遅れ` : `${-r}秒早い`;
}
