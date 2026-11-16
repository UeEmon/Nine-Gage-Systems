"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Elevation } from "@/lib/elevation";
import { localPaths, worldSamples, type Layout } from "@/lib/geometry";
import { computeSchedule, detectStations, EMPTY_OPERATION, formatTime, kindLabel, normalizeOperation } from "@/lib/operation";
import { getPart } from "@/lib/parts";
import {
  applyTwinEvent,
  buildTwinMap,
  CAB_RANGE,
  currentDelay,
  DccExConnection,
  defaultSpeedStep,
  duplicateIds,
  formatCommand,
  formatDelay,
  ID_RANGE,
  initialTwinState,
  normalizeTwinSettings,
  occupiedPieces,
  openSerialTransport,
  openWebSocketTransport,
  sensorKey,
  serialSupported,
  SimulatedLayout,
  type TwinCommand,
  type TwinConnection,
  type TwinContext,
  type TwinSettings,
  type TwinState,
} from "@/lib/twin";

type Props = {
  layout: Layout;
  elevation?: Elevation;
  /** 番号の付け替え・接続先を保存する */
  onChangeSettings: (settings: TwinSettings) => void;
  onClose: () => void;
};

const SPEEDS = [1, 5, 20] as const;
const DEFAULT_WS_URL = "ws://192.168.4.1:2560";

type Target = "sim" | "usb" | "wifi";
const TARGETS: { value: Target; label: string }[] = [
  { value: "sim", label: "模擬の実機" },
  { value: "usb", label: "DCC-EX（USB）" },
  { value: "wifi", label: "DCC-EX（Wi‑Fi）" },
];

type Conn =
  | { kind: "sim"; conn: SimulatedLayout }
  | { kind: "real"; conn: DccExConnection };

/**
 * デジタルツインの画面。実物のレイアウト（DCC-EX）か模擬の実機につなぎ、
 * センサー・ポイント・機関車の状態をレイアウト図に映して、アプリからポイントや列車を操作する。
 */
export function TwinView({ layout, elevation, onChangeSettings, onClose }: Props) {
  const plan = useMemo(() => normalizeOperation(layout.operation) ?? EMPTY_OPERATION, [layout.operation]);
  const settings = useMemo(() => normalizeTwinSettings(layout.twin) ?? {}, [layout.twin]);
  const accessories = useMemo(() => layout.accessories ?? [], [layout.accessories]);
  const stations = useMemo(() => detectStations(layout.pieces, accessories, elevation), [layout.pieces, accessories, elevation]);
  const map = useMemo(() => buildTwinMap(layout.pieces, stations, plan, settings), [layout.pieces, stations, plan, settings]);
  const schedule = useMemo(() => computeSchedule(layout.pieces, stations, plan), [layout.pieces, stations, plan]);
  const dups = useMemo(() => duplicateIds(map), [map]);

  const [target, setTarget] = useState<Target>("sim");
  const [wsUrl, setWsUrl] = useState(settings.wsUrl ?? DEFAULT_WS_URL);
  const [conn, setConn] = useState<Conn | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [twin, setTwin] = useState<TwinState>(initialTwinState);
  const [time, setTime] = useState(0);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(5);
  const [paused, setPaused] = useState(false);
  const [sent, setSent] = useState<string | null>(null);

  const stationName = (id: string) => plan.stationNames[id] || stations.find((s) => s.id === id)?.defaultName || "駅";
  const trainName = (id: string) => plan.trains.find((t) => t.id === id)?.name ?? "列車";
  const trackName = (stationId: string, track: number) => `${stationName(stationId)} ${track}番線`;

  // 模擬の実機は自分の対応表とダイヤで走るので、それに合わせる
  const ctx: TwinContext | null = useMemo(() => {
    if (!conn) return null;
    const src = conn.kind === "sim" ? { map: conn.conn.map, schedule: conn.conn.schedule } : { map, schedule };
    return { ...src, trainName, trackName };
  }, [conn, map, schedule, plan, stations]);

  // 時計の今の値（出来事を受け取った時刻に使う）
  const timeRef = useRef(0);
  /** 実物の時計の起点（performance.now の値） */
  const clockStart = useRef(0);
  const nowOf = (c: Conn) => (c.kind === "sim" ? c.conn.time : (performance.now() - clockStart.current) / 1000);

  // つなぐ・切る
  const start = (c: Conn) => {
    setTwin(initialTwinState());
    setTime(0);
    timeRef.current = 0;
    setPaused(false);
    setError(null);
    setConn(c);
  };
  const connect = async () => {
    setError(null);
    if (target === "sim") {
      start({ kind: "sim", conn: new SimulatedLayout(layout.pieces, stations, plan, { seed: Math.floor(Math.random() * 1e9), slowness: 0.15, settings }) });
      return;
    }
    setConnecting(true);
    try {
      const transport = target === "usb" ? await openSerialTransport() : await openWebSocketTransport(wsUrl.trim());
      if (target === "wifi" && wsUrl.trim() !== settings.wsUrl) onChangeSettings({ ...settings, wsUrl: wsUrl.trim() });
      const c = new DccExConnection(target === "usb" ? "DCC-EX（USB）" : "DCC-EX（Wi‑Fi）", transport);
      c.watchCabs(map.locos.map((l) => l.cab));
      clockStart.current = performance.now();
      start({ kind: "real", conn: c });
    } catch (err) {
      // ポートを選ばずに閉じたときは何も出さない
      if (!(err instanceof DOMException && err.name === "NotFoundError")) setError(err instanceof Error ? err.message : String(err));
    } finally {
      setConnecting(false);
    }
  };
  const disconnect = () => {
    conn?.conn.close();
    setConn(null);
  };

  useEffect(() => {
    if (!conn || !ctx) return;
    const off = conn.conn.subscribe((ev) => {
      const at = nowOf(conn);
      setTwin((prev) => applyTwinEvent(prev, ev, at, ctx));
    });
    let offClose = () => {};
    if (conn.kind === "sim") conn.conn.advance(0);
    else {
      offClose = conn.conn.onClose((reason) => {
        setError(reason);
        setConn(null);
      });
      conn.conn.sync();
    }
    return () => {
      off();
      offClose();
    };
  }, [conn, ctx]);

  // 時計。模擬の実機は速さを変えられる。実物は実際の時間
  const speedRef = useRef(speed);
  speedRef.current = speed;
  useEffect(() => {
    if (!conn || paused) return;
    let last = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      if (conn.kind === "sim") {
        conn.conn.advance(Math.min(0.25, (now - last) / 1000) * speedRef.current);
      }
      last = now;
      timeRef.current = nowOf(conn);
      setTime(timeRef.current);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [conn, paused]);

  useEffect(() => () => conn?.conn.close(), [conn]);

  /** 実物で運転を始めるとき、ダイヤの時計を0に戻す（センサー・ポイントの状態はそのまま） */
  const resetClock = () => {
    if (conn?.kind !== "real") return;
    clockStart.current = performance.now();
    setTwin((prev) => ({ ...prev, delays: {}, nextStop: {}, stoppedAt: {} }));
    setTime(0);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const send = (cmd: TwinCommand) => {
    if (!conn) return;
    setSent(formatCommand(cmd));
    (conn.conn as TwinConnection).send(cmd);
  };

  // 番号の付け替え
  const setId = (kind: "turnouts" | "sensors" | "locos", key: string, value: string) => {
    const r = kind === "locos" ? CAB_RANGE : ID_RANGE;
    const n = Number(value);
    const next = { ...(settings[kind] ?? {}) };
    if (value.trim() === "" || !Number.isInteger(n)) delete next[key];
    else next[key] = Math.min(r.max, Math.max(r.min, n));
    onChangeSettings({ ...settings, [kind]: next });
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

  const shownMap = ctx?.map ?? map;
  const occupied = useMemo(() => (ctx ? occupiedPieces(twin, ctx, time) : new Map<string, string>()), [twin, ctx, time]);
  const sensorOn = useMemo(() => {
    const on = new Set<string>();
    for (const s of shownMap.sensors) if (twin.sensors[s.id]) for (const uid of s.pieces) on.add(uid);
    return on;
  }, [shownMap.sensors, twin.sensors]);
  const turnoutByUid = useMemo(() => new Map(shownMap.turnouts.map((t) => [t.uid, t])), [shownMap.turnouts]);
  const colorOf = (trainId: string) => plan.trains.find((t) => t.id === trainId)?.color ?? "#888";

  const connected = !!conn;
  const isSim = conn?.kind === "sim";
  const powerOn = twin.power !== false;
  const httpsPage = typeof location !== "undefined" && location.protocol === "https:";

  const idInput = (kind: "turnouts" | "sensors" | "locos", key: string, value: number, label: string, bad: boolean) => (
    <input
      type="number"
      className={`twin-id${bad ? " bad" : ""}`}
      min={kind === "locos" ? CAB_RANGE.min : ID_RANGE.min}
      max={kind === "locos" ? CAB_RANGE.max : ID_RANGE.max}
      value={value}
      disabled={connected}
      title={connected ? "番号は切断してから変えられます" : bad ? "同じ番号がほかにもあります" : label}
      aria-label={label}
      onChange={(e) => setId(kind, key, e.target.value)}
    />
  );

  return (
    <div className="op twin" role="dialog" aria-label="デジタルツイン">
      <header className="op-head">
        <h2>デジタルツイン</h2>
        <span className="muted">{connected ? `${conn!.conn.label}につながっています ・ ${formatTime(time)}` : "つながっていません"}</span>
        <button onClick={onClose}>閉じる</button>
      </header>

      <div className="op-body">
        <aside className="op-side">
          <section>
            <h3>実物のレイアウトとつなぐ</h3>
            <p className="muted twin-note">
              DCC-EX のコマンドステーションにつなぐと、実物のセンサー・ポイント・機関車の状態をこの画面に映し、ここから操作できます。
              「模擬の実機」は、実物の代わりに運行計画どおりに列車を走らせて試せます（列車は実物のように少しずつ遅れます）。
            </p>
            {!connected ? (
              <>
                <div className="twin-targets" role="radiogroup" aria-label="つなぐ先">
                  {TARGETS.map((t) => (
                    <label key={t.value}>
                      <input type="radio" name="twin-target" checked={target === t.value} onChange={() => setTarget(t.value)} />
                      {t.label}
                    </label>
                  ))}
                </div>
                {target === "usb" && !serialSupported() && (
                  <p className="warn-text twin-note">このブラウザは USB 接続に対応していません。パソコンの Chrome か Edge で開いてください。</p>
                )}
                {target === "usb" && serialSupported() && (
                  <p className="muted twin-note">DCC-EX を USB ケーブルでつなぎ、ボタンを押して出てくる一覧からポートを選んでください。</p>
                )}
                {target === "wifi" && (
                  <>
                    <label className="twin-ws">
                      アドレス
                      <input value={wsUrl} onChange={(e) => setWsUrl(e.target.value)} placeholder={DEFAULT_WS_URL} spellCheck={false} />
                    </label>
                    <p className="muted twin-note">
                      DCC-EX の Wi‑Fi に、このパソコンをつないでから押してください（DCC-EX が親機のときは ws://192.168.4.1:2560）。
                      {httpsPage && " このページは https なので、ブラウザが ws:// へのつなぎを止めることがあります。そのときは USB でつないでください。"}
                    </p>
                  </>
                )}
                <button
                  className="primary"
                  onClick={connect}
                  disabled={layout.pieces.length === 0 || connecting || (target === "usb" && !serialSupported()) || (target === "wifi" && !/^wss?:\/\/./.test(wsUrl.trim()))}
                >
                  {connecting ? "つないでいます…" : target === "sim" ? "模擬の実機につなぐ" : "DCC-EX につなぐ"}
                </button>
                {error && <p className="error">{error}</p>}
              </>
            ) : (
              <>
                <div className="twin-row">
                  <button onClick={disconnect}>切断</button>
                  {isSim ? (
                    <>
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
                    </>
                  ) : (
                    <>
                      <button onClick={resetClock} title="列車を始発駅に置いて運転を始めるときに押すと、ダイヤとの遅れをここから数えます">
                        ダイヤの時計を0に
                      </button>
                      <button onClick={() => conn?.kind === "real" && conn.conn.sync()} title="センサー・ポイント・電源の状態を問い合わせ直します">
                        状態を取り直す
                      </button>
                    </>
                  )}
                </div>
                {!isSim && (
                  <p className="muted twin-note">
                    列車を運行計画の始発駅に置き、「ダイヤの時計を0に」を押してから走らせると、駅のセンサーが反応するたびにダイヤとの遅れが分かります。
                  </p>
                )}
                {error && <p className="error">{error}</p>}
              </>
            )}
          </section>

          {connected && (
            <section>
              <h3>電源</h3>
              <div className="twin-row">
                <span className={`twin-lamp${twin.power ? " on" : ""}`} aria-hidden />
                <span>{twin.power === null ? "不明" : powerOn ? "入" : "切"}</span>
                <button onClick={() => send({ type: "power", on: !twin.power })}>{twin.power ? "電源を切る" : "電源を入れる"}</button>
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
                {shownMap.locos.map((l) => {
                  const t = plan.trains.find((x) => x.id === l.trainId)!;
                  const loco = twin.locos[l.cab];
                  const moving = !!loco && loco.speed > 0;
                  return (
                    <li key={l.trainId}>
                      <span className="op-swatch" style={{ background: t.color }} />
                      <span className="twin-name">
                        {t.name}
                        <span className="muted"> {kindLabel(t.kind)}</span>
                      </span>
                      <span className="muted twin-id-label">アドレス</span>
                      {idInput("locos", t.id, l.cab, `${t.name}の機関車アドレス`, dups.locos.includes(l.cab))}
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
            {shownMap.turnouts.length === 0 ? (
              <p className="muted">ポイントはありません。</p>
            ) : (
              <ul className="twin-list">
                {shownMap.turnouts.map((t) => {
                  const thrown = twin.turnouts[t.id];
                  return (
                    <li key={t.uid}>
                      <span className="twin-name">
                        {t.name} <span className="muted">{getPart(layout.pieces.find((p) => p.uid === t.uid)!.partId).name}</span>
                      </span>
                      <span className="muted twin-id-label">番号</span>
                      {idInput("turnouts", t.uid, t.id, `${t.name}の DCC-EX のポイント番号`, dups.turnouts.includes(t.id))}
                      {connected && (
                        <>
                          <span>{thrown === undefined ? "—" : thrown ? "分岐" : "直進"}</span>
                          <button className="mini" onClick={() => send({ type: "turnout", id: t.id, thrown: !thrown })}>
                            切り替え
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
            <h3>在線センサー</h3>
            {shownMap.sensors.length === 0 ? (
              <p className="muted">駅（ホーム）がないのでセンサーはありません。駅の番線ごとに1つ置く想定です。</p>
            ) : (
              <ul className="twin-list">
                {shownMap.sensors.map((s) => (
                  <li key={sensorKey(s.stationId, s.track)}>
                    <span className={`twin-lamp${twin.sensors[s.id] ? " on" : ""}`} aria-hidden />
                    <span className="twin-name">{trackName(s.stationId, s.track)}</span>
                    <span className="muted twin-id-label">番号</span>
                    {idInput("sensors", sensorKey(s.stationId, s.track), s.id, `${trackName(s.stationId, s.track)}のセンサー番号`, dups.sensors.includes(s.id))}
                  </li>
                ))}
              </ul>
            )}
            {(dups.turnouts.length > 0 || dups.sensors.length > 0 || dups.locos.length > 0) && (
              <p className="warn-text twin-note">同じ番号が2つ以上に付いています（赤い枠）。実物ではどちらか分からなくなるので、DCC-EX の番号に合わせて付け替えてください。</p>
            )}
            <p className="muted twin-note">番号は DCC-EX に登録したポイント（&lt;T&gt;）・センサー（&lt;S&gt;）の番号と、機関車の DCC アドレスに合わせます。レイアウトと一緒に保存されます。</p>
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
              {shownMap.turnouts.map((t) => {
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
