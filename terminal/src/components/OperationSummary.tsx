"use client";

import { useMemo, useState } from "react";
import { Diagram } from "../../../src/components/operation/Diagram";
import { elevationOf, type Layout } from "../../../src/lib/geometry";
import { computeSchedule, detectStations, formatTime, kindLabel } from "../../../src/lib/operation";

/** 運行計画（ダイヤ）の見せ方: 駅・列車の一覧とダイヤグラム。計算はプラットフォームと同じ（src/lib/operation） */
export function OperationSummary({ layout }: { layout: Layout }) {
  const plan = layout.operation;
  const stations = useMemo(() => detectStations(layout.pieces, layout.accessories ?? [], elevationOf(layout.pieces).elevation), [layout]);
  const result = useMemo(() => (plan ? computeSchedule(layout.pieces, stations, plan) : null), [layout, stations, plan]);
  const [selected, setSelected] = useState<string | null>(null);
  if (!plan || !plan.trains.length || !result) return null;

  const stationName = (id: string) => plan.stationNames[id] || stations.find((s) => s.id === id)?.defaultName || "（なくなった駅）";
  const byTrain = new Map(result.trains.map((s) => [s.trainId, s]));
  const end = Math.max(0, ...result.trains.flatMap((s) => s.events.flatMap((e) => [e.arr ?? 0, Number.isFinite(e.dep ?? 0) ? (e.dep ?? 0) : 0])));

  return (
    <div className="card operation-card">
      <h2>運行計画</h2>
      <p className="op-lead">
        駅 {stations.length}・列車 {plan.trains.length}本・運転時間 {formatTime(end)}
        {result.conflicts.length > 0 && <span className="problem">・ぶつかる所 {result.conflicts.length}か所</span>}
        。ファイルに保存してプラットフォームで開くと、運行計画の画面や運転席の映像で走らせられます。
      </p>
      {stations.length > 0 && (
        <p className="op-lead">
          駅:{" "}
          {stations.map((s, i) => (
            <span key={s.id}>
              {i > 0 && "、"}
              {stationName(s.id)}（{s.tracks.length}線）
            </span>
          ))}
        </p>
      )}
      <Diagram
        stations={stations}
        stationName={stationName}
        trains={plan.trains}
        schedules={result.trains}
        conflicts={result.conflicts}
        selectedId={selected}
        onSelect={(id) => setSelected((cur) => (cur === id ? null : id))}
      />
      <div className="table-wrap">
        <table className="op-table">
          <thead>
            <tr>
              <th>列車</th>
              <th>種別</th>
              <th>両数</th>
              <th>最高速度</th>
              <th>発車</th>
              <th>停車駅</th>
            </tr>
          </thead>
          <tbody>
            {plan.trains.map((t) => {
              const s = byTrain.get(t.id);
              const stops = (s?.events ?? []).filter((e) => !e.pass);
              return (
                <tr key={t.id} className={selected === t.id ? "on" : ""} onClick={() => setSelected((cur) => (cur === t.id ? null : t.id))}>
                  <td>
                    <span className="op-swatch" style={{ background: t.color }} />
                    {t.name}
                    {t.line && <small className="muted">（{t.line}）</small>}
                  </td>
                  <td>{kindLabel(t.kind)}</td>
                  <td>{t.cars}両</td>
                  <td>{t.speedKmh}km/h</td>
                  <td>{formatTime(t.departSec)}</td>
                  <td>
                    {stops.length
                      ? stops
                          .slice(0, 8)
                          .map((e) => stationName(e.stationId))
                          .join("→") + (stops.length > 8 ? "…" : "")
                      : t.stops.filter((x) => !x.pass).map((x) => stationName(x.stationId)).join("→")}
                    {t.laps > 1 && `（${t.laps}周）`}
                    {s?.errors.length ? <div className="problem">{s.errors[0]}</div> : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
