// アプリのレイアウトと実機の番号の対応表。
//
// ・ポイント（分岐の部品）→ DCC-EX のポイント番号（1, 2, …）。経路0が直進（closed）、それ以外が分岐（thrown）
// ・駅の番線 → 在線センサーの番号（1, 2, …）。番線の線路に列車が乗るとセンサーが反応する
// ・運行計画の列車 → 機関車のアドレス（3, 4, …。DCC の新品の機関車は 3）
// 番号はレイアウトから自動で決め、実機の番号と違うものは利用者が付け替える（TwinSettings。レイアウトと一緒に保存）。

import type { Piece } from "../geometry";
import type { OperationPlan, Station } from "../operation";
import { getPart } from "../parts";
import { MAX_SPEED_STEP } from "./protocol";

export type TwinTurnout = { id: number; uid: string; name: string };
export type TwinSensor = { id: number; stationId: string; track: number; pieces: string[] };
export type TwinLoco = { cab: number; trainId: string };

/** 利用者が付け替えた番号と接続先（レイアウトと一緒に保存する） */
export type TwinSettings = {
  /** ポイントの部品 uid → DCC-EX のポイント番号 */
  turnouts?: Record<string, number>;
  /** "駅ID:番線" → センサー番号 */
  sensors?: Record<string, number>;
  /** 列車ID → 機関車アドレス */
  locos?: Record<string, number>;
  /** Wi‑Fi でつなぐときの WebSocket のアドレス */
  wsUrl?: string;
};

export const sensorKey = (stationId: string, track: number) => `${stationId}:${track}`;

/** 番号の範囲（DCC-EX のポイント・センサーの番号、DCC の長いアドレス） */
export const ID_RANGE = { min: 1, max: 32767 };
export const CAB_RANGE = { min: 1, max: 10239 };

export type TwinMap = {
  turnouts: TwinTurnout[];
  sensors: TwinSensor[];
  locos: TwinLoco[];
};

/** 列車の機関車アドレスの始まり */
export const FIRST_CAB = 3;

export function buildTwinMap(pieces: Piece[], stations: Station[], plan: OperationPlan, settings?: TwinSettings): TwinMap {
  const turnouts: TwinTurnout[] = [];
  for (const p of pieces) {
    const part = getPart(p.partId);
    if (part.category !== "turnout" || part.routes.length < 2) continue;
    const n = turnouts.length + 1;
    turnouts.push({ id: settings?.turnouts?.[p.uid] ?? n, uid: p.uid, name: `P${n}` });
  }
  const sensors: TwinSensor[] = [];
  for (const st of stations) {
    for (const t of st.tracks) {
      const id = settings?.sensors?.[sensorKey(st.id, t.number)] ?? sensors.length + 1;
      sensors.push({ id, stationId: st.id, track: t.number, pieces: t.pieces });
    }
  }
  const locos = plan.trains.map((t, i) => ({ cab: settings?.locos?.[t.id] ?? FIRST_CAB + i, trainId: t.id }));
  return { turnouts, sensors, locos };
}

/** 同じ番号が2つ以上に付いているもの（実機ではどちらか分からなくなる） */
export function duplicateIds(map: TwinMap): { turnouts: number[]; sensors: number[]; locos: number[] } {
  const dup = (ids: number[]) => [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
  return {
    turnouts: dup(map.turnouts.map((t) => t.id)),
    sensors: dup(map.sensors.map((s) => s.id)),
    locos: dup(map.locos.map((l) => l.cab)),
  };
}

/** 保存データを読み込める形にそろえる（壊れた値は捨てる） */
export function normalizeTwinSettings(v: unknown): TwinSettings | undefined {
  if (!v || typeof v !== "object") return undefined;
  const o = v as Record<string, unknown>;
  const ids = (x: unknown, r: { min: number; max: number }) => {
    const out: Record<string, number> = {};
    if (x && typeof x === "object")
      for (const [k, n] of Object.entries(x)) if (typeof n === "number" && Number.isInteger(n) && n >= r.min && n <= r.max) out[k] = n;
    return out;
  };
  const s: TwinSettings = {
    turnouts: ids(o.turnouts, ID_RANGE),
    sensors: ids(o.sensors, ID_RANGE),
    locos: ids(o.locos, CAB_RANGE),
  };
  if (typeof o.wsUrl === "string" && /^wss?:\/\//.test(o.wsUrl)) s.wsUrl = o.wsUrl.slice(0, 200);
  return s;
}

/** 列車の最高速度（縮尺の km/h）を DCC の速度段にする目安（160km/h で最高段） */
export function defaultSpeedStep(speedKmh: number): number {
  return Math.max(1, Math.min(MAX_SPEED_STEP, Math.round((speedKmh / 160) * MAX_SPEED_STEP)));
}
