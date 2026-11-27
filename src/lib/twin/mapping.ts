// アプリのレイアウトと実機の番号の対応表。
//
// ・ポイント（分岐の部品）→ DCC-EX のポイント番号（1, 2, …）。経路0が直進（closed）、それ以外が分岐（thrown）
// ・駅の番線 → 在線センサーの番号（1, 2, …）。番線の線路に列車が乗るとセンサーが反応する
// ・運行計画の列車 → 機関車のアドレス（3, 4, …。DCC の新品の機関車は 3）
// いまはレイアウトから自動で決める。実機につなぐ段階で、利用者が番号を付け替えられるようにする。

import type { Piece } from "../geometry";
import type { OperationPlan, Station, TrackRoute } from "../operation";
import { getPart } from "../parts";
import { MAX_SPEED_STEP } from "./protocol";

export type TwinTurnout = { id: number; uid: string; name: string };
export type TwinSensor = { id: number; stationId: string; track: number; pieces: string[]; routes: TrackRoute[] };
export type TwinLoco = { cab: number; trainId: string };

export type TwinMap = {
  turnouts: TwinTurnout[];
  sensors: TwinSensor[];
  locos: TwinLoco[];
};

/** 列車の機関車アドレスの始まり */
export const FIRST_CAB = 3;

export function buildTwinMap(pieces: Piece[], stations: Station[], plan: OperationPlan): TwinMap {
  const turnouts: TwinTurnout[] = [];
  for (const p of pieces) {
    const part = getPart(p.partId);
    if (part.category !== "turnout" || part.routes.length < 2) continue;
    const id = turnouts.length + 1;
    turnouts.push({ id, uid: p.uid, name: `P${id}` });
  }
  const sensors: TwinSensor[] = [];
  for (const st of stations) {
    for (const t of st.tracks) sensors.push({ id: sensors.length + 1, stationId: st.id, track: t.number, pieces: t.pieces, routes: t.routes });
  }
  const locos = plan.trains.map((t, i) => ({ cab: FIRST_CAB + i, trainId: t.id }));
  return { turnouts, sensors, locos };
}

/** 列車の最高速度（縮尺の km/h）を DCC の速度段にする目安（160km/h で最高段） */
export function defaultSpeedStep(speedKmh: number): number {
  return Math.max(1, Math.min(MAX_SPEED_STEP, Math.round((speedKmh / 160) * MAX_SPEED_STEP)));
}
