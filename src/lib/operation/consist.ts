// 編成の長さ（両数）とホームの長さ。
//
// 列車が止まる番線のホームに編成が収まるかを見る。AIの提案は、止まる駅のうちいちばん短いホームに収まる両数にそろえる。

import { trainLength, type ConsistSize } from "../drive";
import { LIMITS, type OperationPlan } from "./model";
import type { ScheduleResult, TrainSchedule } from "./schedule";
import type { Station } from "./stations";

/** 長さ(mm)に収まる両数（size は車両の長さ。なければ20m級） */
export function carsFitting(lengthMm: number, size?: ConsistSize): number {
  let n = 0;
  while (n < 99 && trainLength(n + 1, size) <= lengthMm) n++;
  return n;
}

export type PlatformLimit = {
  /** 止まる全部の駅のホームに収まる両数（0 はどのホームにも1両も収まらない） */
  maxCars: number;
  /** いちばん短いホームの駅と番線 */
  stationId: string;
  track: number;
  platformLength: number;
};

/** 時刻表で止まる番線（通過は除く）のうち、いちばん短いホーム。止まる所がなければ null */
export function platformLimit(schedule: Pick<TrainSchedule, "events">, stations: Station[], size?: ConsistSize): PlatformLimit | null {
  const byId = new Map(stations.map((s) => [s.id, s]));
  let best: PlatformLimit | null = null;
  for (const e of schedule.events) {
    if (e.pass) continue;
    const t = byId.get(e.stationId)?.tracks.find((x) => x.number === e.track);
    if (!t) continue;
    if (!best || t.platformLength < best.platformLength) {
      best = { maxCars: carsFitting(t.platformLength, size), stationId: e.stationId, track: e.track, platformLength: t.platformLength };
    }
  }
  return best;
}

/** 止まる駅のホームより長い編成を、ホームに収まる両数まで短くする（1両より短くはしない）。変えた列車の id を返す */
export function fitCarsToPlatforms(plan: OperationPlan, result: ScheduleResult, stations: Station[]): { plan: OperationPlan; changed: string[] } {
  const changed: string[] = [];
  const trains = plan.trains.map((t) => {
    const sch = result.trains.find((s) => s.trainId === t.id);
    if (!sch || sch.errors.length) return t;
    const lim = platformLimit(sch, stations, t.carSize);
    if (!lim) return t;
    const cars = Math.max(LIMITS.cars.min, Math.min(t.cars, lim.maxCars));
    if (cars === t.cars) return t;
    changed.push(t.id);
    return { ...t, cars };
  });
  return { plan: changed.length ? { ...plan, trains } : plan, changed };
}
