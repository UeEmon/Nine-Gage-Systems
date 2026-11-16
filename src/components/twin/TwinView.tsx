"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Elevation } from "@/lib/elevation";
import { localPaths, worldSamples, type Layout } from "@/lib/geometry";
import { detectStations, EMPTY_OPERATION, formatTime, kindLabel, normalizeOperation } from "@/lib/operation";
import { getPart } from "@/lib/parts";
import {
  applyTwinEvent,
  buildTwinMap,
  currentDelay,
  defaultSpeedStep,
  formatCommand,
  formatDelay,
  initialTwinState,
  occupiedPieces,
  SimulatedLayout,
  type TwinCommand,
  type TwinContext,
  type TwinState,
} from "@/lib/twin";

type Props = {
  layout: Layout;
  elevation?: Elevation;
  onClose: () => void;
};

const SPEEDS = [1, 5, 20] as const;

/**
 * デジタルツインの画面。実物のレイアウト（いまは模擬の実機）につなぎ、
 * センサー・ポイント・機関車の状態をレイアウト図に映して、アプリからポイントや列車を操作する。
 */
export function TwinView({ layout, elevation, onClose }: Props) {
  const plan = useMemo(() => normalizeOperation(layout.operation) ?? EMPTY_OPERATION, [layout.operation]);
  const accessories = useMemo(() => layout.accessories ?? [], [layout.accessories]);
  const stations = useMemo(() => detectStations(layout.pieces, accessories, elevation), [layout.pieces, accessories, elevation]);
  const map = useMemo(() => buildTwinMap(layout.pieces, stations, plan), [layout.pieces, stations, plan]);

  const [sim, setSim] = useState<SimulatedLayout | null>(null);
  const [twin, setTwin] = useState<TwinState>(initialTwinState);
  const [time, setTime] = useState(0);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(5);
  const [paused, setPaused] = useState(false);
  const [sent, setSent] = useState<string | null>(null);

  const stationName = (id: string) => plan.stationNames[id] || stations.find((s) => s.id === id)?.defaultName || "駅";
  const trainName = (id: string) => plan.trains.find((t) => t.id === id)?.name ?? "列車";
  const trackName = (stationId: string, track: number) => `${stationName(stationId)} ${track}番線`;

  const ctx: TwinContext | null = useMemo(
    () => (sim ? { map: sim.map, schedule: sim.schedule, trainName, trackName } : null),
    [sim, plan, stations],
  );

  // つなぐ・切る
  const connect = () => {
    const s = new SimulatedLayout(layout.pieces, stations, plan, { seed: Math.floor(Math.random() * 1e9), slowness: 0.15 });
    setTwin(initialTwinState());
    setTime(0);
    setPaused(false);
    setSim(s);
  };
  const disconnect = () => {
    sim?.close();
    setSim(null);
  };

  useEffect(() => {
    if (!sim || !ctx) return;
    const off = sim.subscribe((ev) => {
      const at = sim.time;
      setTwin((prev) => applyTwinEvent(prev, ev, at, ctx));
    });
    sim.advance(0);
    return off;
  }, [sim, ctx]);

  // 時計
  const speedRef = useRef(speed);
  speedRef.current = speed;
  useEffect(() => {
    if (!sim || paused) return;
    let last = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const dt = Math.min(0.25, (now - last) / 1000) * speedRef.current;
      last = now;
      sim.advance(dt);
      setTime(sim.time);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [sim, paused]);

  useEffect(() => () => sim?.close(), [sim]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const send = (cmd: TwinCommand) => {
    if (!sim) return;
    setSent(formatCommand(cmd));
    sim.send(cmd);
  };

  // レイアウト図
  const bounds = useMemo(() => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of layout.pieces)
      for (const q of worldSamples(p, 20)) {
        x0 = Math.min(x0, q.x);
        y0 = Math.min(y0, q.y);
        x1 = Math.max(x1, q.x);
        y1 = Math.max(y1, q.y);
      }
    if (!Number.isFinite(x0)) return { x: 0, y: 0, w: 100, h: 100 };
    const m = 60;
    return { x: x0 - m, y: y0 - m, w: x1 - x0 + 2 * m, h: y1 - y0 + 2 * m };
  }, [layout.pieces]);

  const occupied = useMemo(() => (ctx ? occupiedPieces(twin, ctx, time) : new Map<string, string>()), [twin, ctx, time]);
  const sensorOn = useMemo(() => {
    const on = new Set<string>();
    for (const s of map.sensors) if (twin.sensors[s.id]) for (const uid of s.pieces) on.add(uid);
    return on;
  }, [map.sensors, twin.sensors]);
  const turnoutByUid = useMemo(() => new Map(map.turnouts.map((t) => [t.uid, t])), [map.turnouts]);
  const colorOf = (trainId: string) => plan.trains.find((t) => t.id === trainId)?.color ?? "#888";

  const connected = !!sim;
  const powerOn = twin.power !== false;

  return (
    <div className="op twin" role="dialog" aria-label="デジタルツイン">
      <header className="op-head">
        <h2>デジタルツイン</h2>
        <span className="muted">{connected ? `${sim!.label}につながっています ・ ${formatTime(time)}` : "つながっていません"}</span>
        <button onClick={onClose}>閉じる</button>
      </header>

      <div className="op-body">
        <aside className="op-side">
          <section>
            <h3>実物のレイアウトとつなぐ</h3>
            <p className="muted twin-note">
              実物のレイアウトのセンサー・ポイント・機関車の状態をこの画面に映し、ここから操作します。
              いまは実物の代わりに、運行計画どおりに列車を走らせる「模擬の実機」につなげます（列車は実物のように少しずつ遅れます）。
            </p>
            {!connected ? (
              <button className="primary" onClick={connect} disabled={layout.pieces.length === 0}>
                模擬の実機につなぐ
              </button>
            ) : (
              <div className="twin-row">
                <button onClick={disconnect}>切断</button>
                <button onClick={() => setPaused((p) => !p)}>{paused ? "▶ 再開" : "⏸ 一時停止"}</button>
                <label className="twin-speed">
                  速さ
                  <select value={speed} onChange={(e) => setSpeed(Number(e.target.value) as (typeof SPEEDS)[number])}>
                    {SPEEDS.map((s) => (
                      <option key={s} value={s}>
                        {s}倍
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )}
          </section>

          {connected && (
            <section>
              <h3>電源</h3>
              <div className="twin-row">
                <span className={`twin-lamp${powerOn ? " on" : ""}`} aria-hidden />
                <span>{twin.power === null ? "不明" : powerOn ? "入" : "切"}</span>
                <button onClick={() => send({ type: "power", on: !powerOn })}>{powerOn ? "電源を切る" : "電源を入れる"}</button>
                <button className="danger" onClick={() => send({ type: "estop" })}>
                  非常停止
                </button>
              </div>
            </section>
          )}

          <section>
            <h3>列車</h3>
            {plan.trains.length === 0 ? (
              <p className="muted">「運行計画」で列車を作ると、ここで走らせて、ダイヤとの遅れを確かめられます。</p>
            ) : (
              <ul className="twin-list">
                {map.locos.map((l) => {
                  const t = plan.trains.find((x) => x.id === l.trainId)!;
                  const loco = twin.locos[l.cab];
                  const moving = !!loco && loco.speed > 0;
                  return (
                    <li key={l.cab}>
                      <span className="op-swatch" style={{ background: t.color }} />
                      <span className="twin-name">
                        {t.name}
                        <span className="muted">
                          {" "}
                          {kindLabel(t.kind)} ・ アドレス {l.cab}
                        </span>
                      </span>
                      {connected && (
                        <>
                          <span className={currentDelay(twin, t.id, time) > 2 ? "warn-text" : "muted"}>
                            {twin.delays[t.id] === undefined && twin.stoppedAt[t.id] === undefined ? "—" : formatDelay(currentDelay(twin, t.id, time))}
                          </span>
                          <button
                            className="mini"
                            onClick={() => send({ type: "throttle", cab: l.cab, speed: moving ? 0 : defaultSpeedStep(t.speedKmh), forward: true })}
                          >
                            {moving ? "止める" : "動かす"}
                          </button>
                        </>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section>
            <h3>ポイント</h3>
            {map.turnouts.length === 0 ? (
              <p className="muted">ポイントはありません。</p>
            ) : (
              <ul className="twin-list">
                {map.turnouts.map((t) => {
                  const thrown = twin.turnouts[t.id];
                  return (
                    <li key={t.id}>
                      <span className="twin-name">
                        {t.name} <span className="muted">{getPart(layout.pieces.find((p) => p.uid === t.uid)!.partId).name}</span>
                      </span>
                      <span>{thrown === undefined ? "—" : thrown ? "分岐" : "直進"}</span>
                      <button className="mini" disabled={!connected} onClick={() => send({ type: "turnout", id: t.id, thrown: !thrown })}>
                        切り替え
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section>
            <h3>在線センサー</h3>
            {map.sensors.length === 0 ? (
              <p className="muted">駅（ホーム）がないのでセンサーはありません。駅の番線ごとに1つ置く想定です。</p>
            ) : (
              <ul className="twin-list">
                {map.sensors.map((s) => (
                  <li key={s.id}>
                    <span className={`twin-lamp${twin.sensors[s.id] ? " on" : ""}`} aria-hidden />
                    <span className="twin-name">
                      {trackName(s.stationId, s.track)} <span className="muted">センサー {s.id}</span>
                    </span>
                    <span className="muted">{twin.sensors[s.id] ? "在線" : ""}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>

        <main className="op-main">
          <div className="twin-map">
            <svg viewBox={`${bounds.x} ${bounds.y} ${bounds.w} ${bounds.h}`} preserveAspectRatio="xMidYMid meet">
              {layout.pieces.map((p) => {
                const part = getPart(p.partId);
                const paths = localPaths(part);
                const flip = p.mirror ? " scale(1,-1)" : "";
                const tu = turnoutByUid.get(p.uid);
                const thrown = tu ? twin.turnouts[tu.id] : undefined;
                const train = occupied.get(p.uid);
                return (
                  <g key={p.uid} transform={`translate(${p.x} ${p.y}) rotate(${p.rot})${flip}`}>
                    {sensorOn.has(p.uid) && paths.map((d, i) => <path key={`s${i}`} d={d} className="twin-sensor" />)}
                    {paths.map((d, i) => {
                      const active = !tu || thrown === undefined || (i === 0) === !thrown;
                      return <path key={i} d={d} className={`twin-track${active ? "" : " off"}`} />;
                    })}
                    {train &&
                      paths.map((d, i) => {
                        const active = !tu || thrown === undefined || (i === 0) === !thrown;
                        return active ? <path key={`t${i}`} d={d} className="twin-train" style={{ stroke: colorOf(train) }} /> : null;
                      })}
                  </g>
                );
              })}
              {map.turnouts.map((t) => {
                const p = layout.pieces.find((x) => x.uid === t.uid)!;
                return (
                  <text
                    key={t.id}
                    x={p.x}
                    y={p.y - 24}
                    className={`twin-label${connected ? " can" : ""}`}
                    onClick={() => connected && send({ type: "turnout", id: t.id, thrown: !twin.turnouts[t.id] })}
                  >
                    {t.name}
                  </text>
                );
              })}
            </svg>
          </div>
          <p className="muted op-note">
            色のついた線路は、センサーの反応とダイヤから推定した列車の位置です。黄色く光る線路はセンサーが列車を検出している番線、薄い線はポイントで開通していない側です。
            図のポイント名（P1 など）を押すと切り替わります。
          </p>

          <section className="twin-log">
            <h3>実機とのやりとり</h3>
            {sent && (
              <p className="muted">
                最後に送ったコマンド: <code>{sent}</code>
              </p>
            )}
            {twin.log.length === 0 ? (
              <p className="muted">つなぐと、実機から届いた出来事がここに並びます。</p>
            ) : (
              <ul>
                {twin.log.slice(0, 60).map((e, i) => (
                  <li key={twin.log.length - i}>
                    <span className="twin-time">{formatTime(e.time)}</span>
                    <span>{e.text}</span>
                    <code>{e.raw}</code>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </main>
      </div>
    </div>
  );
}
