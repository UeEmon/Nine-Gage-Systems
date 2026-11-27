"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { rtmVehicleId, rtmVehicleType, sameConsistSize, trainLength, VEHICLE_TYPES, type VehicleType } from "@/lib/drive";
import { rtmFormationSize, leadVehicles } from "@/lib/rtm/pack";
import { RtmVehiclesDialog, useRtmVehicles } from "../rtm/RtmVehicles";
import type { Elevation } from "@/lib/elevation";
import type { Layout } from "@/lib/geometry";
import {
  computeSchedule,
  detectStations,
  EMPTY_OPERATION,
  formatTime,
  kindLabel,
  layoutLines,
  LIMITS,
  newTrain,
  newTrainId,
  normalizeOperation,
  parseTime,
  platformLimit,
  stationLines,
  trackLines,
  TRAIN_KINDS,
  trainLine,
  type PlatformLimit,
  type OperationPlan,
  type Train,
  type TrainKind,
  type TrainStop,
} from "@/lib/operation";
import { operationFile, readOperationFile } from "@/lib/operation/file";
import { saveBlob } from "@/lib/download";
import { Diagram } from "./Diagram";

type Props = {
  layout: Layout;
  elevation?: Elevation;
  /** ログインしていて、AI提案を使える */
  canUseAi: boolean;
  /** RealTrainMod の車両を使える（プレミアムユーザー・プレミアムプラス・管理者） */
  rtmAllowed?: boolean;
  onChange: (plan: OperationPlan) => void;
  /** この列車の運転席で、運行計画どおりの走りを見る */
  onRide?: (trainId: string) => void;
  onClose: () => void;
};

/** 運行計画（ダイヤ）を立てる画面。駅はホームの配置から自動で見つける */
export function OperationView({ layout, elevation, canUseAi, rtmAllowed = false, onChange, onRide, onClose }: Props) {
  const plan = useMemo(() => normalizeOperation(layout.operation) ?? EMPTY_OPERATION, [layout.operation]);
  const accessories = useMemo(() => layout.accessories ?? [], [layout.accessories]);
  const stations = useMemo(() => detectStations(layout.pieces, accessories, elevation), [layout.pieces, accessories, elevation]);
  const result = useMemo(() => computeSchedule(layout.pieces, stations, plan), [layout.pieces, stations, plan]);
  // 「再現してみた」で作ったレイアウトの路線名
  const routeNames = useMemo(() => layoutLines({ pieces: layout.pieces, replica: layout.replica }), [layout.pieces, layout.replica]);
  const lines = useMemo(() => trackLines(stations, { pieces: layout.pieces, replica: layout.replica }), [stations, layout.pieces, layout.replica]);
  const lineOf = (t: Train) => trainLine(t, result.trains.find((s) => s.trainId === t.id)?.events, lines);
  const [selectedId, setSelectedId] = useState<string | null>(plan.trains[0]?.id ?? null);
  const selected = plan.trains.find((t) => t.id === selectedId) ?? null;
  const selectedSchedule = result.trains.find((s) => s.trainId === selectedId);

  const [aiRequest, setAiRequest] = useState("");
  const [ai, setAi] = useState<AiState>({ status: "idle" });

  const fileInput = useRef<HTMLInputElement>(null);
  const [readingFile, setReadingFile] = useState(false);
  const [fileMessage, setFileMessage] = useState("");

  const loadPlan = async (file: File) => {
    setReadingFile(true);
    setFileMessage("");
    try {
      const next = readOperationFile(await file.text());
      const stationIds = new Set(stations.map(s => s.id));
      const missing = new Set(next.trains.flatMap(t => t.stops.map(s => s.stationId)).filter(id => !stationIds.has(id)));
      const warning = missing.size ? `現在のレイアウトにない停車駅が${missing.size}駅あります。読み込み後に停車駅を選び直してください。` : "";
      if ((plan.trains.length || Object.keys(plan.stationNames).length || warning) &&
          !window.confirm(`${warning}「${file.name}」の運行計画に切り替えますか？`)) return;
      onChange(next);
      setSelectedId(next.trains[0]?.id ?? null);
      setAi({ status: "idle" });
      setFileMessage(`${file.name} を読み込みました。${warning}`);
    } catch (err) {
      setFileMessage(err instanceof SyntaxError ? "JSONを読み込めませんでした。" : err instanceof Error ? err.message : "ファイルを読み込めませんでした。");
    } finally {
      setReadingFile(false);
    }
  };

  const proposeWithAi = async () => {
    const before = plan;
    setAi({ status: "loading" });
    try {
      const res = await fetch("/api/operation/propose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          maker: layout.maker ?? "kato",
          pieces: layout.pieces,
          accessories,
          stationNames: plan.stationNames,
          ...(layout.replica ? { replica: { kind: layout.replica.kind, target: layout.replica.target, lines: layout.replica.lines } } : {}),
          request: aiRequest,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      const next = normalizeOperation(data.plan) ?? EMPTY_OPERATION;
      onChange({ ...next, stationNames: plan.stationNames });
      setSelectedId(next.trains[0]?.id ?? null);
      setAi({ status: "done", summary: data.summary ?? "", remaining: data.remainingProblems ?? null, before });
    } catch (err) {
      setAi({ status: "error", message: err instanceof Error ? err.message : String(err) });
    }
  };

  const stationName = (id: string) => plan.stationNames[id] || stations.find((s) => s.id === id)?.defaultName || "（なくなった駅）";
  const trainName = (id: string) => plan.trains.find((t) => t.id === id)?.name ?? "列車";

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const setTrains = (trains: Train[]) => onChange({ ...plan, trains });
  const updateTrain = (id: string, patch: Partial<Train>) => setTrains(plan.trains.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  const updateStop = (train: Train, i: number, patch: Partial<TrainStop>) =>
    updateTrain(train.id, { stops: train.stops.map((s, k) => (k === i ? { ...s, ...patch } : s)) });

  const addTrain = () => {
    const t = newTrain(plan.trains.length, stations.map((s) => s.id));
    setTrains([...plan.trains, t]);
    setSelectedId(t.id);
  };
  const copyTrain = (src: Train) => {
    const t: Train = { ...src, id: newTrainId(), name: `${src.name}（続行）`, departSec: src.departSec + 60, stops: src.stops.map((s) => ({ ...s })) };
    setTrains([...plan.trains, t]);
    setSelectedId(t.id);
  };
  const removeTrain = (id: string) => {
    const rest = plan.trains.filter((t) => t.id !== id);
    setTrains(rest);
    if (selectedId === id) setSelectedId(rest[0]?.id ?? null);
  };

  return (
    <div className="op" role="dialog" aria-label="運行計画">
      <header className="op-head">
        <h2>運行計画（ダイヤ）</h2>
        <span className="muted">
          {routeNames.length > 0 && `${routeNames.join("・")} ・ `}駅 {stations.length} ・ 列車 {plan.trains.length} 本
        </span>
        {onRide && (
          <button
            className="primary"
            onClick={() => selected && onRide(selected.id)}
            disabled={!selected || !selectedSchedule?.motion}
            title="全部の列車を運行計画どおりに走らせ、選んでいる列車の運転席から見ます"
          >
            ▶ {selected ? `${selected.name}の運転席で見る` : "運転席で見る"}
          </button>
        )}
        <button onClick={onClose}>閉じる</button>
      </header>

      <div className="op-body">
        <aside className="op-side">
          <section>
            <h3>運行計画ファイル</h3>
            <div className="row">
              <button onClick={() => saveBlob(new Blob([operationFile(plan)], { type: "application/json" }), `${layout.title || "レイアウト"}-運行計画.json`)}>計画を保存</button>
              <button disabled={readingFile || ai.status === "loading"} onClick={() => fileInput.current?.click()}>計画を読み込む</button>
              <input ref={fileInput} type="file" hidden accept=".json,application/json" onChange={(e) => {
                const file = e.currentTarget.files?.[0];
                e.currentTarget.value = "";
                if (file) void loadPlan(file);
              }} />
            </div>
            {fileMessage && <p className="hint" role="status">{fileMessage}</p>}
          </section>
          <section>
            <h3>駅</h3>
            {stations.length === 0 ? (
              <p className="muted">
                駅がありません。線路の横にホーム（相対式・島式）を置くと、そこが駅になります。島式ホームは両側が番線になります。
              </p>
            ) : (
              <ul className="op-stations">
                {stations.map((s) => (
                  <li key={s.id}>
                    <label className="op-station-name-field">
                      <span>{stationName(s.id)}</span>
                      <input
                        value={plan.stationNames[s.id] ?? ""}
                        placeholder={s.defaultName}
                        maxLength={40}
                        onChange={(e) => onChange({ ...plan, stationNames: { ...plan.stationNames, [s.id]: e.target.value } })}
                        aria-label={`${s.defaultName}の名前`}
                      />
                    </label>
                    <span className="muted op-station-details">
                      {s.tracks.map(t => `${t.number}番線${t.siding ? "（引き込み線）" : ""}`).join("・") || "番線なし"}
                      {stationLines(s.id, lines).length > 0 && ` ${stationLines(s.id, lines).join("・")}`}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="op-ai">
            <h3>AIに運行計画を提案してもらう</h3>
            {!canUseAi ? (
              <p className="muted">ログインすると、このレイアウトに合わせた運行計画をAIに作ってもらえます。</p>
            ) : (
              <>
                <textarea
                  rows={3}
                  value={aiRequest}
                  maxLength={2000}
                  placeholder="例: 普通2本と特急1本。B駅で特急が普通を追い越す"
                  onChange={(e) => setAiRequest(e.target.value)}
                />
                <button className="primary" onClick={proposeWithAi} disabled={stations.length === 0 || readingFile || ai.status === "loading"}>
                  {ai.status === "loading" ? "AIが考えています…" : plan.trains.length ? "AIに作り直してもらう（今の列車は置き換え）" : "AIに提案してもらう"}
                </button>
                {ai.status === "error" && <p className="error">{ai.message}</p>}
                {ai.status === "done" && (
                  <div className="op-ai-result">
                    {ai.summary && <p>{ai.summary}</p>}
                    {ai.remaining && (
                      <details className="warn-text">
                        <summary>直しきれなかった点があります</summary>
                        <pre>{ai.remaining}</pre>
                      </details>
                    )}
                    <button
                      onClick={() => {
                        onChange(ai.before);
                        setSelectedId(ai.before.trains[0]?.id ?? null);
                        setAi({ status: "idle" });
                      }}
                    >
                      提案の前に戻す
                    </button>
                  </div>
                )}
              </>
            )}
          </section>

          <section>
            <h3>列車</h3>
            <ul className="op-trains">
              {plan.trains.map((t) => {
                const sch = result.trains.find((s) => s.trainId === t.id);
                const bad = (sch?.errors.length ?? 0) > 0;
                const line = lineOf(t);
                return (
                  <li key={t.id}>
                    <button className={t.id === selectedId ? "on" : ""} onClick={() => setSelectedId(t.id)}>
                      <span className="op-swatch" style={{ background: t.color }} />
                      {t.name}
                      <span className="muted">
                        {" "}
                        {line && `${line} `}
                        {kindLabel(t.kind)} {t.cars}両 {formatTime(t.departSec)}発
                      </span>
                      {bad && <span className="error"> ⚠</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
            <button className="primary" onClick={addTrain} disabled={stations.length === 0}>
              ＋ 列車を追加
            </button>
          </section>

          {selected && (
            <TrainEditor
              key={selected.id}
              train={selected}
              routeNames={routeNames}
              autoLine={selectedSchedule ? trainLine({}, selectedSchedule.events, lines) : undefined}
              stations={stations.map((s) => ({ id: s.id, name: stationName(s.id), tracks: s.tracks }))}
              platform={selectedSchedule && !selectedSchedule.errors.length ? platformLimit(selectedSchedule, stations, selected.carSize) : null}
              stationName={stationName}
              onChange={(patch) => updateTrain(selected.id, patch)}
              onStop={(i, patch) => updateStop(selected, i, patch)}
              onCopy={() => copyTrain(selected)}
              onRemove={() => removeTrain(selected.id)}
              rtmAllowed={rtmAllowed}
            />
          )}
        </aside>

        <main className="op-main">
          {plan.trains.length === 0 ? (
            <p className="muted op-empty">
              列車を追加すると、ここにダイヤグラム（横が時刻、縦が駅）と時刻表が出ます。列車どうしが同じ線路を同時に使う所があれば知らせます。
            </p>
          ) : (
            <>
              <Diagram
                stations={stations}
                stationName={stationName}
                trains={plan.trains}
                schedules={result.trains}
                conflicts={result.conflicts}
                selectedId={selectedId}
                onSelect={setSelectedId}
              />
              <section className="op-check">
                {result.conflicts.length === 0 ? (
                  <p className="ok-text">✓ 列車どうしが同じ線路を同時に使う所はありません</p>
                ) : (
                  <ul>
                    {result.conflicts.slice(0, 30).map((c, i) => (
                      <li key={i} className="warn-text">
                        ⚠ {formatTime(c.time)}ごろ、{trainName(c.trainA)} と {trainName(c.trainB)} が {c.location} を同時に使います
                      </li>
                    ))}
                    {result.conflicts.length > 30 && <li className="muted">ほか {result.conflicts.length - 30} 件</li>}
                  </ul>
                )}
              </section>
              {selected && selectedSchedule && (
                <section className="op-timetable">
                  <h3>
                    <span className="op-swatch" style={{ background: selected.color }} />
                    {selected.name}（{lineOf(selected) ? `${lineOf(selected)}・` : ""}
                    {kindLabel(selected.kind)}・{selected.cars}両）の時刻表
                  </h3>
                  {selectedSchedule.errors.map((e) => (
                    <p key={e} className="error">
                      {e}
                    </p>
                  ))}
                  {selectedSchedule.warnings.map((w) => (
                    <p key={w} className="warn-text">
                      {w}
                    </p>
                  ))}
                  <table className="bom">
                    <thead>
                      <tr>
                        {selected.laps > 1 && <th>周</th>}
                        <th>駅</th>
                        <th>番線</th>
                        <th className="num">着</th>
                        <th className="num">発</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedSchedule.events.map((e, i) => (
                        <tr key={i}>
                          {selected.laps > 1 && <td>{e.lap + 1}</td>}
                          <td>{stationName(e.stationId)}</td>
                          <td>{e.track}番線</td>
                          <td className="num">{e.pass ? "レ" : e.arr === null ? "" : formatTime(e.arr)}</td>
                          <td className="num">{e.pass ? `${formatTime(e.dep!)} 通過` : e.dep === null ? "（終着）" : formatTime(e.dep)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
              )}
              <p className="muted op-note">
                時刻は運転を始めてからの経過時間です。各列車の最高速度（縮尺の km/h）で走ったときの模型の時間で、加減速は含めない目安です。
                終着駅に着いた列車は、その番線にとどまるものとして扱います。
              </p>
            </>
          )}
        </main>
      </div>
    </div>
  );
}

type AiState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "done"; summary: string; remaining: string | null; before: OperationPlan };

type StationOption = { id: string; name: string; tracks: { number: number; siding?: boolean }[] };

function TrainEditor({
  train,
  routeNames,
  autoLine,
  stations,
  platform,
  stationName,
  onChange,
  onStop,
  onCopy,
  onRemove,
  rtmAllowed,
}: {
  train: Train;
  /** レイアウトの路線（「再現してみた」で作ったとき） */
  routeNames: string[];
  /** 路線を「自動」にしたときの路線（使う番線から決めたもの） */
  autoLine: string | undefined;
  stations: StationOption[];
  /** 止まる駅のうち、いちばん短いホーム */
  platform: PlatformLimit | null;
  stationName: (id: string) => string;
  onChange: (patch: Partial<Train>) => void;
  onStop: (i: number, patch: Partial<TrainStop>) => void;
  onCopy: () => void;
  onRemove: () => void;
  rtmAllowed: boolean;
}) {
  const num = (v: string, r: { min: number; max: number }, int = true) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return r.min;
    return Math.min(r.max, Math.max(r.min, int ? Math.round(n) : n));
  };
  const moveStop = (i: number, d: number) => {
    const s = train.stops.slice();
    const j = i + d;
    if (j < 0 || j >= s.length) return;
    [s[i], s[j]] = [s[j], s[i]];
    onChange({ stops: s });
  };
  const rtmVehicles = useRtmVehicles();
  const [rtmOpen, setRtmOpen] = useState(false);
  const setVehicle = (vehicleType: VehicleType | undefined, vehicles = rtmVehicles) => {
    const id = rtmVehicleId(vehicleType);
    const lead = vehicles?.find(v => v.id === id);
    const formation = lead?.formation;
    const size = lead && vehicles ? rtmFormationSize(lead, vehicles, formation) : id ? train.carSize : undefined;
    onChange({ vehicleType, formation, carSize: size, ...(formation ? { cars: formation.length } : {}) });
  };
  // 保存した個別編成はダイヤに保持する。自動編成は従来どおり読み込み直した寸法に合わせる。
  useEffect(() => {
    if (!rtmAllowed || train.formation || !rtmVehicles) return;
    const lead = rtmVehicles.find(v => v.id === rtmVehicleId(train.vehicleType));
    if (!lead) return;
    const size = rtmFormationSize(lead, rtmVehicles);
    if (!sameConsistSize(size, train.carSize)) onChange({ carSize: size });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rtmVehicles, train.vehicleType, train.formation, rtmAllowed]);
  const setKind = (kind: TrainKind) => {
    const oldDefault = TRAIN_KINDS.find((k) => k.value === train.kind)?.color;
    const color = train.color === oldDefault ? TRAIN_KINDS.find((k) => k.value === kind)!.color : train.color;
    onChange({ kind, color });
  };

  return (
    <section className="op-editor">
      <h3>列車の設定</h3>
      <div className="op-form">
        <label>
          列車名
          <input value={train.name} maxLength={40} onChange={(e) => onChange({ name: e.target.value })} />
        </label>
        {(routeNames.length > 0 || train.line) && (
          <label title="運行計画やダイヤ、運転席に出す路線名。自動にすると、停車する番線の路線になります">
            路線
            <select value={train.line ?? ""} onChange={(e) => onChange({ line: e.target.value || undefined })}>
              <option value="">自動（{autoLine ?? "なし"}）</option>
              {train.line && !routeNames.includes(train.line) && <option value={train.line}>{train.line}</option>}
              {routeNames.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          種別
          <select value={train.kind} onChange={(e) => setKind(e.target.value as TrainKind)}>
            {TRAIN_KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          映像の車両
          <select value={train.vehicleType ?? ""} onChange={(e) => setVehicle((e.target.value || undefined) as VehicleType | undefined)}>
            <option value="">自動（列車種別に合わせる）</option>
            {VEHICLE_TYPES.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
            {((rtmAllowed && rtmVehicles && rtmVehicles.length > 0) || rtmVehicleId(train.vehicleType)) && (
              <optgroup label="読み込んだ車両（RealTrainMod）">
                {rtmAllowed && rtmVehicles && leadVehicles(rtmVehicles, rtmVehicleId(train.vehicleType)).map((v) => <option key={v.id} value={rtmVehicleType(v.id)}>{v.name}</option>)}
                {rtmVehicleId(train.vehicleType) && !(rtmAllowed && rtmVehicles?.some((v) => rtmVehicleType(v.id) === train.vehicleType)) && (
                  <option value={train.vehicleType}>
                    {rtmAllowed ? "この端末に読み込まれていない車両（列車種別に合わせて表示）" : "RealTrainMod の車両（プレミアムユーザー以上で表示。いまは列車種別に合わせて表示）"}
                  </option>
                )}
              </optgroup>
            )}
          </select>
        </label>
        {rtmAllowed ? (
          <button className="mini op-rtm-button" onClick={() => setRtmOpen(true)} title="RealTrainMod の車両パックを読み込んで、この列車の映像の車両にする">
            RTMの車両…
          </button>
        ) : (
          <button className="mini op-rtm-button" disabled title="RealTrainMod の車両は、プレミアムユーザー・プレミアムプラス・管理者が使えます">
            RTMの車両…
          </button>
        )}
        {rtmOpen && rtmAllowed && (
          <RtmVehiclesDialog
            onClose={() => setRtmOpen(false)}
            pickLabel="この列車に使う"
            onPick={(id, vehicles) => {
              setVehicle(rtmVehicleType(id), vehicles);
              setRtmOpen(false);
            }}
          />
        )}
        <label title={rtmVehicleId(train.vehicleType) ? "RealTrainMod の車両は車両パックの色のまま表示し、線の色はダイヤグラムと地図の印だけに使います" : undefined}>
          線の色{rtmVehicleId(train.vehicleType) && <span className="muted">（ダイヤグラムだけ）</span>}
          <input type="color" value={train.color} onChange={(e) => onChange({ color: e.target.value })} />
        </label>
        <div className="op-cars">
          <span className="op-cars-label">編成の長さ</span>
          <CarsInput value={train.cars} onChange={(cars) => onChange({ cars })} />
          <span className="muted">
            約{Math.round(trainLength(train.cars, train.carSize))}mm
            {train.carSize && `（1両 約${Math.round(train.carSize.end.length)}mm${train.carSize.middle ? `・中間車 約${Math.round(train.carSize.middle.length)}mm` : ""}）`}
          </span>
          {platform && (
            <span className={train.cars > platform.maxCars ? "warn-text op-cars-fit" : "muted op-cars-fit"}>
              {platform.maxCars > 0
                ? `止まる駅のホームに収まるのは${platform.maxCars}両まで（${stationName(platform.stationId)} ${platform.track}番線のホーム 約${Math.round(platform.platformLength)}mm）`
                : `${stationName(platform.stationId)} ${platform.track}番線のホーム（約${Math.round(platform.platformLength)}mm）は1両でもはみ出します`}
              {platform.maxCars > 0 && platform.maxCars !== train.cars && (
                <button className="mini" onClick={() => onChange({ cars: Math.max(LIMITS.cars.min, platform.maxCars) })}>
                  ホームに合わせて{platform.maxCars}両にする
                </button>
              )}
            </span>
          )}
        </div>
        <label>
          最高速度(km/h)
          <input
            type="number"
            min={LIMITS.speedKmh.min}
            max={LIMITS.speedKmh.max}
            step={5}
            value={train.speedKmh}
            onChange={(e) => onChange({ speedKmh: num(e.target.value, LIMITS.speedKmh) })}
          />
        </label>
        <label>
          始発駅を出る時刻
          <TimeInput value={train.departSec} onChange={(departSec) => onChange({ departSec })} />
        </label>
        <label title="エンドレスのレイアウトで、停車駅の並びを何回くり返すか">
          周回
          <input type="number" min={LIMITS.laps.min} max={LIMITS.laps.max} value={train.laps} onChange={(e) => onChange({ laps: num(e.target.value, LIMITS.laps) })} />
        </label>
      </div>

      <h4>停車駅</h4>
      <div className="op-stops-wrap">
      <table className="op-stops">
        <thead>
          <tr>
            <th>駅</th>
            <th>番線</th>
            <th title="停車時間（秒）。始発駅は発車前に止まっている時間">停車秒</th>
            <th>通過</th>
            <th title="この駅で向きを変えて次の駅へ">折返</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {train.stops.map((s, i) => {
            const st = stations.find((x) => x.id === s.stationId);
            return (
              <tr key={i}>
                <td>
                  <select value={s.stationId} onChange={(e) => onStop(i, { stationId: e.target.value, track: null })}>
                    {!st && <option value={s.stationId}>（なくなった駅）</option>}
                    {stations.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <select value={s.track ?? ""} onChange={(e) => onStop(i, { track: e.target.value ? Number(e.target.value) : null })}>
                    <option value="">自動</option>
                    {st?.tracks.map(t => (
                      <option key={t.number} value={t.number}>
                        {t.number}番線{t.siding ? "（引き込み線）" : ""}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <input
                    type="number"
                    min={0}
                    max={LIMITS.dwellSec.max}
                    value={s.dwellSec}
                    disabled={s.pass}
                    onChange={(e) => onStop(i, { dwellSec: num(e.target.value, LIMITS.dwellSec) })}
                  />
                </td>
                <td>
                  <input type="checkbox" checked={s.pass} disabled={i === 0} onChange={(e) => onStop(i, { pass: e.target.checked, ...(e.target.checked ? { turnback: false } : {}) })} />
                </td>
                <td>
                  <input type="checkbox" checked={!!s.turnback} disabled={s.pass} onChange={(e) => onStop(i, { turnback: e.target.checked })} />
                </td>
                <td className="op-stop-actions">
                  <button className="mini" onClick={() => moveStop(i, -1)} disabled={i === 0} aria-label="上へ">
                    ↑
                  </button>
                  <button className="mini" onClick={() => moveStop(i, 1)} disabled={i === train.stops.length - 1} aria-label="下へ">
                    ↓
                  </button>
                  <button className="mini danger" onClick={() => onChange({ stops: train.stops.filter((_, k) => k !== i) })} aria-label="消す">
                    ✕
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
      <button
        onClick={() => onChange({ stops: [...train.stops, { stationId: stations[0]?.id ?? "", track: null, pass: false, dwellSec: 20 }] })}
        disabled={stations.length === 0}
      >
        ＋ 駅を足す
      </button>
      <div className="op-editor-actions">
        <button onClick={onCopy} title="同じ停車駅で1分あとに出る列車を足す">
          続行の列車を足す
        </button>
        <button className="danger" onClick={onRemove}>
          この列車を消す
        </button>
      </div>
    </section>
  );
}

/** 両数。−／＋ で1両ずつ、数字でも入れられる（入力の途中は文字のまま持ち、読めたときだけ反映する） */
function CarsInput({ value, onChange }: { value: number; onChange: (cars: number) => void }) {
  const [text, setText] = useState(String(value));
  const [focused, setFocused] = useState(false);
  const shown = focused ? text : String(value);
  const { min, max } = LIMITS.cars;
  const set = (n: number) => onChange(Math.min(max, Math.max(min, n)));
  return (
    <span className="op-cars-input">
      <button className="mini" onClick={() => set(value - 1)} disabled={value <= min} aria-label="1両減らす">
        −
      </button>
      <input
        value={shown}
        inputMode="numeric"
        aria-label="両数"
        onFocus={() => {
          setText(String(value));
          setFocused(true);
        }}
        onBlur={() => setFocused(false)}
        onChange={(e) => {
          setText(e.target.value);
          const n = Number(e.target.value.trim());
          if (e.target.value.trim() && Number.isInteger(n) && n >= min && n <= max) onChange(n);
        }}
      />
      <span>両</span>
      <button className="mini" onClick={() => set(value + 1)} disabled={value >= max} aria-label="1両増やす">
        ＋
      </button>
    </span>
  );
}

/** "m:ss" で入れる時刻。入力の途中は文字のまま持ち、読めたときだけ反映する */
function TimeInput({ value, onChange }: { value: number; onChange: (sec: number) => void }) {
  const [text, setText] = useState(formatTime(value));
  const [focused, setFocused] = useState(false);
  const shown = focused ? text : formatTime(value);
  const bad = parseTime(shown) === null;
  return (
    <input
      value={shown}
      inputMode="numeric"
      placeholder="0:00"
      className={bad ? "bad" : undefined}
      onFocus={() => {
        setText(formatTime(value));
        setFocused(true);
      }}
      onBlur={() => setFocused(false)}
      onChange={(e) => {
        setText(e.target.value);
        const sec = parseTime(e.target.value);
        if (sec !== null) onChange(Math.min(LIMITS.departSec.max, sec));
      }}
    />
  );
}
