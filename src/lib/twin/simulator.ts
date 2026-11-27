// 模擬の実機。実物のレイアウトの代わりに、運行計画どおりに列車を走らせて、実機と同じ出来事（センサー・ポイント・機関車）を出す。
//
// 実物と同じく、列車はダイヤどおりには走らない：列車ごとに少し遅い（最大 slowness の割合）。
// 機関車を止めたり非常停止したりすると、その間は列車が進まない。ほかの列車がいる駅の番線には入らず、手前で待つ。
// 列車が通るポイントは、近づくと運行計画の進路に自動で切り替える（自動進路）。

import type { Piece } from "../geometry";
import { routeKey, computeSchedule, type OperationPlan, type ScheduleResult, type Station } from "../operation";
import { buildTwinMap, defaultSpeedStep, type TwinMap } from "./mapping";
import { MAX_SPEED_STEP, type TwinCommand, type TwinConnection, type TwinEvent } from "./protocol";

export type SimulatorOptions = {
  /** 乱数の種（同じ種なら同じ遅れ方） */
  seed?: number;
  /** 列車ごとの遅さの上限（0.15 = ダイヤより最大15%遅い）。0 でダイヤどおり */
  slowness?: number;
};

/** ポイントを列車の何秒前に切り替えるか */
const ROUTE_AHEAD_SEC = 3;

type SimTrain = {
  trainId: string;
  cab: number;
  departSec: number;
  /** ダイヤの上での時刻（この列車がダイヤのどこまで進んだか） */
  progress: number;
  /** 走っているときの、ダイヤに対する進み方（1 = ダイヤどおり） */
  rate: number;
  speed: number;
  forward: boolean;
};

export class SimulatedLayout implements TwinConnection {
  readonly label = "模擬の実機";
  readonly map: TwinMap;
  readonly schedule: ScheduleResult;
  /** 運転を始めてからの時間(秒) */
  time = 0;
  private trains: SimTrain[];
  private power = true;
  private turnouts = new Map<number, boolean>();
  private sensors = new Map<number, boolean>();
  private listeners = new Set<(ev: TwinEvent) => void>();
  private turnoutByUid: Map<string, number>;
  private sensorByRoute = new Map<string, number>();
  private started = false;

  constructor(pieces: Piece[], stations: Station[], plan: OperationPlan, opts: SimulatorOptions = {}) {
    this.map = buildTwinMap(pieces, stations, plan);
    this.schedule = computeSchedule(pieces, stations, plan);
    const rand = mulberry32(opts.seed ?? 1);
    const slowness = Math.max(0, opts.slowness ?? 0.15);
    this.trains = plan.trains.map((t, i) => ({
      trainId: t.id,
      cab: this.map.locos[i].cab,
      departSec: t.departSec,
      progress: 0,
      rate: 1 / (1 + rand() * slowness),
      speed: defaultSpeedStep(t.speedKmh),
      forward: true,
    }));
    this.turnoutByUid = new Map(this.map.turnouts.map((t) => [t.uid, t.id]));
    for (const s of this.map.sensors) for (const route of s.routes) this.sensorByRoute.set(routeKey(route), s.id);
  }

  subscribe(listener: (ev: TwinEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  close(): void {
    this.listeners.clear();
  }

  send(cmd: TwinCommand): void {
    switch (cmd.type) {
      case "turnout":
        this.setTurnout(cmd.id, cmd.thrown);
        break;
      case "throttle": {
        const t = this.trains.find((x) => x.cab === cmd.cab);
        if (!t) break;
        t.speed = Math.max(0, Math.min(MAX_SPEED_STEP, Math.round(cmd.speed)));
        t.forward = cmd.forward;
        this.emit({ type: "loco", cab: t.cab, speed: t.speed, forward: t.forward });
        break;
      }
      case "estop":
        for (const t of this.trains) {
          t.speed = 0;
          this.emit({ type: "loco", cab: t.cab, speed: 0, forward: t.forward });
        }
        break;
      case "power":
        this.power = cmd.on;
        this.emit({ type: "power", on: cmd.on });
        break;
    }
  }

  /** 時間を dt 秒進める。最初の呼び出しで、いまの状態（電源・ポイント・機関車・センサー）をすべて知らせる */
  advance(dt: number): void {
    if (!this.started) {
      this.started = true;
      this.emit({ type: "power", on: this.power });
      for (const t of this.map.turnouts) this.setTurnout(t.id, false);
      for (const t of this.trains) this.emit({ type: "loco", cab: t.cab, speed: t.speed, forward: t.forward });
    }
    this.time += dt;
    for (const [i, t] of this.trains.entries()) {
      const before = t.progress;
      // 発車前は時計どおり（発車時刻は守る）。走り出してからは列車ごとに少し遅い
      const moving = this.power && t.speed > 0;
      if (!moving) continue;
      if (t.progress < t.departSec) {
        const toDepart = t.departSec - t.progress;
        t.progress += Math.min(dt, toDepart) + Math.max(0, dt - toDepart) * t.rate;
      } else {
        t.progress += dt * t.rate;
      }
      t.progress = this.holdBeforeOccupiedTrack(i, before, t.progress);
    }
    this.update();
  }

  /** 列車ごとの、ダイヤの上での位置（テストと画面の「実物」表示に使う） */
  progressOf(trainId: string): number | undefined {
    return this.trains.find((t) => t.trainId === trainId)?.progress;
  }

  /**
   * ほかの列車がいる駅の番線には入らず、手前で待つ（列車どうしがぶつからないように）。
   * before から after へ進む間に番線の線路へ入るなら、その番線が空いていなければ入る直前で止める。
   */
  private holdBeforeOccupiedTrack(index: number, before: number, after: number): number {
    const sch = this.schedule.trains[index];
    if (!sch) return after;
    let limit = after;
    for (const o of sch.occupancy) {
      if (!(before < o.from && o.from <= limit)) continue;
      const sensor = this.sensorByRoute.get(routeKey(o));
      if (sensor === undefined) continue;
      const taken = this.schedule.trains.some((other, j) => {
        if (j === index) return false;
        const p = this.trains[j].progress;
        return other.occupancy.some((q) => this.sensorByRoute.get(routeKey(q)) === sensor && q.from <= p && p < q.to);
      });
      if (taken) limit = Math.max(before, o.from - 1e-6);
    }
    return limit;
  }

  private update(): void {
    const occupied = new Set<number>();
    const want = new Map<number, boolean>();
    this.schedule.trains.forEach((sch, i) => {
      const p = this.trains[i]?.progress ?? 0;
      for (const o of sch.occupancy) {
        const sensor = this.sensorByRoute.get(routeKey(o));
        if (sensor !== undefined && o.from <= p && p < o.to) occupied.add(sensor);
        const turnout = this.turnoutByUid.get(o.uid);
        if (turnout !== undefined && o.from - ROUTE_AHEAD_SEC <= p && p < o.to) want.set(turnout, o.routeIndex > 0);
      }
    });
    for (const [id, thrown] of want) this.setTurnout(id, thrown);
    for (const s of this.map.sensors) {
      const active = occupied.has(s.id);
      if (this.sensors.get(s.id) !== active) {
        this.sensors.set(s.id, active);
        this.emit({ type: "sensor", id: s.id, active });
      }
    }
  }

  private setTurnout(id: number, thrown: boolean): void {
    if (!this.turnoutByUid.size || !this.map.turnouts.some((t) => t.id === id)) return;
    if (this.turnouts.get(id) === thrown) return;
    this.turnouts.set(id, thrown);
    this.emit({ type: "turnout", id, thrown });
  }

  private emit(ev: TwinEvent): void {
    for (const l of this.listeners) l(ev);
  }
}

/** 種つきの小さな乱数 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
