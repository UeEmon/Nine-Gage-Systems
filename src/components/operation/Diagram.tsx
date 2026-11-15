"use client";

import { formatTime, type Conflict, type Station, type Train, type TrainSchedule } from "@/lib/operation";

type Props = {
  stations: Station[];
  stationName: (id: string) => string;
  trains: Train[];
  schedules: TrainSchedule[];
  conflicts: Conflict[];
  selectedId: string | null;
  onSelect: (id: string) => void;
};

const LEFT = 84;
const TOP = 24;
const RIGHT = 16;
const BOTTOM = 28;
const ROW = 72;

/** ダイヤグラム（横軸が時刻、縦軸が駅。列車の動きを斜めの線で描く） */
export function Diagram({ stations, stationName, trains, schedules, conflicts, selectedId, onSelect }: Props) {
  // 駅の並び：列車がはじめに通る順。どの列車も通らない駅は後ろに
  const order: string[] = [];
  for (const s of schedules) for (const e of s.events) if (!order.includes(e.stationId)) order.push(e.stationId);
  for (const st of stations) if (!order.includes(st.id)) order.push(st.id);
  const rowOf = new Map(order.map((id, i) => [id, i]));

  const times = schedules.flatMap((s) => s.events.flatMap((e) => [e.arr, e.dep])).filter((t): t is number => t !== null && Number.isFinite(t));
  const t0 = times.length ? Math.floor(Math.min(...times) / 30) * 30 : 0;
  const t1 = times.length ? Math.ceil((Math.max(...times) + 1) / 30) * 30 : 120;
  const span = Math.max(60, t1 - t0);
  const width = Math.max(560, Math.min(2400, span * 4));
  const height = TOP + BOTTOM + Math.max(1, order.length - 1) * ROW;
  const x = (t: number) => LEFT + ((t - t0) / span) * (width - LEFT - RIGHT);
  const y = (id: string) => TOP + (rowOf.get(id) ?? 0) * ROW;
  const step = span <= 300 ? 30 : span <= 900 ? 60 : span <= 3600 ? 300 : 900;
  const ticks: number[] = [];
  for (let t = Math.ceil(t0 / step) * step; t <= t0 + span; t += step) ticks.push(t);

  return (
    <div className="op-diagram" role="img" aria-label="ダイヤグラム">
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={TOP - 8} y2={height - BOTTOM + 8} className="op-grid" />
            <text x={x(t)} y={height - 8} textAnchor="middle" className="op-axis">
              {formatTime(t)}
            </text>
          </g>
        ))}
        {order.map((id) => (
          <g key={id}>
            <line x1={LEFT} x2={width - RIGHT} y1={y(id)} y2={y(id)} className="op-station-line" />
            <text x={LEFT - 8} y={y(id) + 4} textAnchor="end" className="op-axis op-station-name">
              {stationName(id)}
            </text>
          </g>
        ))}
        {schedules.map((s) => {
          const train = trains.find((t) => t.id === s.trainId);
          if (!train || s.events.length === 0) return null;
          const pts: string[] = [];
          for (const e of s.events) {
            const yy = y(e.stationId);
            if (e.arr !== null) pts.push(`${x(e.arr)},${yy}`);
            if (e.dep !== null && Number.isFinite(e.dep)) pts.push(`${x(e.dep)},${yy}`);
          }
          const sel = train.id === selectedId;
          return (
            <g key={s.trainId} className={sel ? "op-train sel" : "op-train"} onClick={() => onSelect(train.id)}>
              <polyline
                points={pts.join(" ")}
                fill="none"
                stroke={train.color}
                strokeWidth={sel ? 3.5 : 2}
                strokeDasharray={train.kind === "deadhead" ? "6 4" : undefined}
              >
                <title>{train.name}</title>
              </polyline>
              {/* 太い透明の線でクリックしやすく */}
              <polyline points={pts.join(" ")} fill="none" stroke="transparent" strokeWidth={12} />
              {s.events[0] && s.events[0].dep !== null && (
                <text x={x(s.events[0].dep) + 3} y={y(s.events[0].stationId) - 5} className="op-train-label" fill={train.color}>
                  {train.name}
                </text>
              )}
            </g>
          );
        })}
        {conflicts.map((c, i) => {
          const at = Number.isFinite(c.time) ? x(c.time) : null;
          if (at === null) return null;
          return (
            <g key={i} className="op-conflict-mark">
              <line x1={at} x2={at} y1={TOP - 10} y2={height - BOTTOM + 10} />
              <text x={at} y={TOP - 12} textAnchor="middle">
                ⚠
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
