"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { encodeVideo, recordCanvas, recordingFormats } from "@/lib/videoRecording";
import { saveBlob } from "@/lib/download";
import { placePiers } from "@/lib/elevation";
import {
  buildDriveGraph,
  carPlacements,
  Drive,
  VEHICLE_TYPES,
  defaultVehicleType,
  type VehicleType,
  type ConsistSize,
  type RtmSlot,
  makeSegment,
  rtmVehicleId,
  rtmVehicleType,
  trainLength,
  scaleKmhToMmPerSec,
  startRef,
  SWITCH_POLICIES,
  type DriveGraph,
  type DrivePose,
  type SwitchPolicy,
} from "@/lib/drive";
import { bedStyle, buildScene, buildTrain } from "@/lib/driveScene";
import type { Layout } from "@/lib/geometry";
import { rtmFormationSize, leadVehicles, type RtmVehicle } from "@/lib/rtm/pack";
import { buildVehicleKit, type RtmKits, type VehicleKit } from "@/lib/rtm/three";
import { RtmVehiclesDialog, useRtmVehicles } from "./rtm/RtmVehicles";
import { listModels } from "@/lib/models3d/store";
import { buildPlacedModels } from "@/lib/models3d/three";
import { placedCorners } from "@/lib/models3d/placed";
import { getPart } from "@/lib/parts";
import {
  computeSchedule,
  detectStations,
  EMPTY_OPERATION,
  formatTime,
  kindLabel,
  normalizeOperation,
  trackLines,
  trainLine,
  TrainPlayback,
  type StopEvent,
  type Train,
} from "@/lib/operation";

type Props = {
  layout: Layout;
  /** 走り始める部品（選択中の部品）。なければ最初の部品 */
  startUid: string | null;
  /** 運行計画どおりに走らせて、この列車に乗る（運行計画の画面から開いたとき） */
  planTrainId?: string | null;
  /** RealTrainMod の車両を使える（プレミアムユーザー・プレミアムプラス・管理者） */
  rtmAllowed?: boolean;
  /** 読み込んだ RealTrainMod の設置物をレイアウトに置いたものを表示する（プレミアムユーザー・プレミアムプラス・管理者） */
  modelsAllowed?: boolean;
  onClose: () => void;
};

type ViewMode = "cab" | "chase" | "fixed";

const NO_RTM_VEHICLES: RtmVehicle[] = [];
const sameKits = (a: RtmKits | undefined, b: RtmKits | undefined) => a?.front === b?.front && a?.middle === b?.middle &&
  a?.sequence?.length === b?.sequence?.length && (a?.sequence?.every((s, i) =>
    s.kit === b?.sequence?.[i].kit && s.reversed === b?.sequence?.[i].reversed) ?? true);
/** free: 自分で運転する / plan: 運行計画どおりに全部の列車を走らせる */
type RunMode = "free" | "plan";

type PlanHud = {
  t: number;
  kmh: number;
  train: string;
  status: string;
};

/** 運行計画で走らせる列車 */
type PlanTrain = {
  train: Train;
  /** 走る路線（「再現してみた」で作ったレイアウトの路線名） */
  line?: string;
  events: StopEvent[];
  playback: TrainPlayback;
};

/** 時刻を進める速さ（倍） */
const RATES = [1, 2, 5, 10, 30];

type Hud = {
  kmh: number;
  z: number;
  grade: number;
  part: string;
  odometer: number;
  stopped: boolean;
  next: { distance: number; options: string[] } | null;
};

/** 運転席の目の高さ（レール面から, mm。1/150 で 約2.7m） */
const EYE_MM = 18;
/** 加速・減速（縮尺の km/h 毎秒） */
const ACCEL_KMH_PER_S = 40;
const MAX_KMH = 320;
/** 後ろから見るときの編成の両数 */
const CARS = 3;
/** 後ろから見るときのカメラの位置（最後尾から線路に沿って後ろへ, mm）と高さ */
const CHASE_BACK_MM = 160;
const CHASE_UP_MM = 110;

/** 作ったレイアウトの線路の上を、運転席の視点で走る3Dの映像 */
export function DriveView({ layout, startUid, planTrainId, rtmAllowed = false, modelsAllowed = false, onClose }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<HTMLCanvasElement>(null);
  const mapPositionRef = useRef<((fx: number, fy: number) => { x: number; y: number }) | null>(null);
  const driveRef = useRef<Drive | null>(null);
  const ctl = useRef({ playing: true, targetKmh: 80, kmh: 0, view: "cab" as ViewMode, yaw: 0, pitch: 0, t: 0, rate: 1, rideId: "" });
  const framing = useRef({ zoom: 1, x: 0, y: 0 });

  const graph = useMemo(() => buildDriveGraph(layout.pieces), [layout.pieces]);
  // 運行計画：時刻表を求めて、列車ごとに時刻 → 位置を用意する
  const op = useMemo(() => {
    const plan = normalizeOperation(layout.operation) ?? EMPTY_OPERATION;
    const stations = detectStations(layout.pieces, layout.accessories ?? [], graph.elevation);
    const result = computeSchedule(layout.pieces, stations, plan);
    const lines = trackLines(stations, { pieces: layout.pieces, replica: layout.replica });
    const trains: PlanTrain[] = plan.trains.flatMap((train) => {
      const sch = result.trains.find((x) => x.trainId === train.id);
      const line = trainLine(train, sch?.events, lines);
      return sch?.motion ? [{ train, ...(line ? { line } : {}), events: sch.events, playback: new TrainPlayback(graph, sch.motion) }] : [];
    });
    const startT = trains.length ? Math.max(0, Math.min(...trains.map((x) => x.playback.appearT))) : 0;
    const endT = trains.length ? Math.max(...trains.map((x) => x.playback.endT)) + 10 : 0;
    const stationName = (id: string) => plan.stationNames[id] || stations.find((x) => x.id === id)?.defaultName || "駅";
    return { trains, startT, endT, stationName };
  }, [layout.operation, layout.pieces, layout.accessories, layout.replica, graph]);

  const [mode, setMode] = useState<RunMode>(planTrainId && op.trains.length ? "plan" : "free");
  const [rideId, setRideId] = useState<string>(
    op.trains.find((x) => x.train.id === planTrainId)?.train.id ?? op.trains[0]?.train.id ?? "",
  );
  const [rate, setRate] = useState(1);
  const [planHud, setPlanHud] = useState<PlanHud | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const [formats] = useState(recordingFormats);
  const [mime, setMime] = useState(formats[0]?.mime ?? "");
  const [bitrate, setBitrate] = useState(8_000_000);
  const [videoStatus, setVideoStatus] = useState<"idle" | "recording" | "saving" | "encoding">("idle");
  const recording = videoStatus === "recording";
  const [lastRecording, setLastRecording] = useState<Blob | null>(null);
  const [videoMessage, setVideoMessage] = useState("");
  const encodingRef = useRef<AbortController | null>(null);
  useEffect(() => () => encodingRef.current?.abort(), []);
  const [playing, setPlaying] = useState(true);
  const [targetKmh, setTargetKmh] = useState(80);
  const [policy, setPolicy] = useState<SwitchPolicy>("straight");
  const [view, setView] = useState<ViewMode>("cab");
  const [vehicleType, setVehicleType] = useState<VehicleType>("commuter");
  const vehicleTypeRef = useRef(vehicleType);
  vehicleTypeRef.current = vehicleType;
  const loadedRtmVehicles = useRtmVehicles();
  // 使えないロールでは、ブラウザに残っている車両も使わない（組み込みの車両で表示する）
  const rtmVehicles = rtmAllowed ? loadedRtmVehicles : NO_RTM_VEHICLES;
  const rtmRef = useRef<RtmVehicle[]>([]);
  rtmRef.current = rtmVehicles ?? [];
  const [rtmOpen, setRtmOpen] = useState(false);
  const [modelNote, setModelNote] = useState("");
  const rtmOpenRef = useRef(rtmOpen);
  rtmOpenRef.current = rtmOpen;
  // 読み込んだ車両のモデルとテクスチャ（車両ごとに1つ作って使い回す）
  const kitsRef = useRef(new Map<string, { vehicle: RtmVehicle; kit: VehicleKit | null }>());
  const retiredKitsRef = useRef<VehicleKit[]>([]);
  /** 車両の型（まだ読み込み中・見つからないときは null。読み込みは始める） */
  const kitFor = (id: string): VehicleKit | null => {
    const vehicle = rtmRef.current.find((x) => x.id === id);
    const kits = kitsRef.current;
    let entry = kits.get(id);
    if (entry && entry.vehicle !== vehicle) {
      // 設定を変えた・消した車両は、映像の車両を作り直してから解放する
      if (entry.kit) retiredKitsRef.current.push(entry.kit);
      kits.delete(id);
      entry = undefined;
    }
    if (!vehicle) return null;
    if (!entry) {
      const e: { vehicle: RtmVehicle; kit: VehicleKit | null } = { vehicle, kit: null };
      kits.set(id, e);
      buildVehicleKit(vehicle)
        .then((kit) => {
          if (kits.get(id) === e) e.kit = kit;
          else kit.dispose();
        })
        .catch(() => {});
      entry = e;
    }
    return entry.kit;
  };
  /** 映像の車両が読み込んだ RealTrainMod の車両なら、その型（使えなければ undefined） */
  const rtmKitsFor = (type: VehicleType | undefined, planSequence?: RtmSlot[] | null): RtmKits | undefined => {
    const id = rtmVehicleId(type);
    const front = id ? kitFor(id) : null;
    if (!id || !front) return undefined;
    const lead = rtmRef.current.find(x => x.id === id);
    const formation = planSequence === undefined ? lead?.formation : planSequence;
    if (formation?.length) return { front, sequence: formation.map(slot => ({ kit: kitFor(slot.id) ?? front, reversed: slot.reversed })) };
    const middleId = lead?.middleId;
    const middle = middleId ? kitFor(middleId) ?? undefined : undefined;
    return { front, middle };
  };
  /** 読み込んだ RealTrainMod の車両の編成の長さ（組み込みの車両なら undefined） */
  const rtmSizeFor = (type: VehicleType | undefined): ConsistSize | undefined => {
    const id = rtmVehicleId(type);
    const v = id ? rtmRef.current.find((x) => x.id === id) : undefined;
    if (!v) return undefined;
    return rtmFormationSize(v, rtmRef.current, v.formation);
  };
  const rtmSizeForRef = useRef(rtmSizeFor);
  rtmSizeForRef.current = rtmSizeFor;
  const rtmKitsForRef = useRef(rtmKitsFor);
  rtmKitsForRef.current = rtmKitsFor;
  useEffect(() => {
    const kits = kitsRef.current;
    const retired = retiredKitsRef.current;
    return () => {
      for (const e of kits.values()) e.kit?.dispose();
      for (const k of retired.splice(0)) k.dispose();
      kits.clear();
    };
  }, []);
  // 選んでいた車両を消したら、組み込みの車両に戻す
  useEffect(() => {
    const id = rtmVehicleId(vehicleType);
    if (id && rtmVehicles && !rtmVehicles.some((v) => v.id === id)) setVehicleType("commuter");
  }, [rtmVehicles, vehicleType]);
  const [fixedPosition, setFixedPosition] = useState(() => ({
    x: layout.board.width / 2,
    y: -200,
    z: 200,
  }));
  const [positionInputs, setPositionInputs] = useState(() => ({
    x: String(fixedPosition.x), y: String(fixedPosition.y), z: String(fixedPosition.z),
  }));
  const fixedPositionRef = useRef(fixedPosition);
  fixedPositionRef.current = fixedPosition;
  const [override, setOverride] = useState<number | null>(null);
  const [hud, setHud] = useState<Hud | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [restart, setRestart] = useState(0);

  ctl.current.playing = playing;
  ctl.current.targetKmh = targetKmh;
  ctl.current.view = view;
  ctl.current.rate = rate;
  ctl.current.rideId = rideId;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const planMode = mode === "plan" && op.trains.length > 0;

  /** 運行計画の時刻を変える（スライダー） */
  const seek = (t: number) => {
    ctl.current.t = t;
    setPlanHud((h) => h && { ...h, t });
  };

  /** 指定地点ではカメラを置き、それ以外は運行計画の列車を選ぶ */
  const onMapClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = mapRef.current;
    if (!canvas) return;
    const r = canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const fx = (e.clientX - r.left) / r.width;
    const fy = (e.clientY - r.top) / r.height;
    if (view === "fixed") {
      const p = mapPositionRef.current?.(fx, fy);
      if (!p) return;
      const x = Math.round(p.x * 10) / 10;
      const y = Math.round(p.y * 10) / 10;
      setFixedPosition((prev) => ({ ...prev, x, y }));
      setPositionInputs((prev) => ({ ...prev, x: String(x), y: String(y) }));
      ctl.current.yaw = 0;
      ctl.current.pitch = 0;
      return;
    }
    if (!planMode) return;
    const id = canvas.dataset.hit ? hitTrain(canvas, fx, fy) : null;
    if (id) setRideId(id);
  };

  useEffect(() => {
    if (driveRef.current) driveRef.current.policy = policy;
  }, [policy]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const ref = startRef(layout.pieces, startUid);
    if (!ref) {
      setError("線路がありません。線路を置いてから走らせてください。");
      return;
    }
    const planMode = mode === "plan" && op.trains.length > 0;
    if (planMode && !(ctl.current.t >= op.startT && ctl.current.t <= op.endT)) ctl.current.t = op.startT;
    const drive = new Drive(graph, ref);
    drive.policy = policy;
    driveRef.current = drive;
    ctl.current.kmh = 0;
    setOverride(null);

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, logarithmicDepthBuffer: true });
    } catch {
      setError("この端末のブラウザでは3D表示（WebGL）が使えません。");
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.className = "drive-3d";
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const sky = new THREE.Color(0xbfd8ee);
    scene.background = sky;
    scene.fog = new THREE.Fog(sky, 600, Math.max(2500, Math.hypot(layout.board.width, layout.board.height) * 1.2));
    scene.add(new THREE.HemisphereLight(0xeaf4ff, 0x5b6b45, 1.6));
    const sun = new THREE.DirectionalLight(0xfff4e0, 1.6);
    sun.position.set(-800, 1500, -400);
    scene.add(sun);

    const piers = placePiers(layout.pieces, graph.elevation);
    const world = buildScene(graph, layout.pieces, piers, layout.board, layout.accessories ?? [], layout.sims ?? [], (normalizeOperation(layout.operation) ?? EMPTY_OPERATION).stationNames,
      modelsAllowed ? (layout.models ?? []).map(placedCorners) : [],
    );
    scene.add(world.group);
    // 読み込んだ RealTrainMod の設置物（この端末の IndexedDB にあるもの）を、読めたものから置く
    let placedModels: { group: THREE.Group; dispose(): void } | null = null;
    let sceneAlive = true;
    if (modelsAllowed && layout.models?.length) {
      const placed = layout.models;
      void listModels()
        .then((all) => buildPlacedModels(placed, all))
        .then((built) => {
          if (!sceneAlive) return built.dispose();
          placedModels = built;
          scene.add(built.group);
          if (built.missing.length) setModelNote(`この端末に読み込んでいない RTM の設置物は表示していません：${built.missing.join("、")}`);
        })
        .catch(() => setModelNote("RTM の設置物を表示できませんでした"));
    }
    let currentVehicleType = vehicleTypeRef.current;
    let currentRtm = rtmKitsForRef.current(currentVehicleType);
    let currentSize = currentRtm ? rtmSizeForRef.current(currentVehicleType) : undefined;
    let cars = currentRtm?.sequence?.length ?? CARS;
    drive.setHistoryLength(trainLength(cars, currentSize) + CHASE_BACK_MM + 20);
    let train = buildTrain(cars, 0x2f6fb5, currentVehicleType, currentRtm);
    scene.add(train.group);
    // 運行計画の列車（線の色で塗る）。読み込んだ RealTrainMod の車両がこの端末になければ列車種別に合わせる
    const planVehicle = (x: PlanTrain) => {
      const rtm = rtmKitsForRef.current(x.train.vehicleType, x.train.formation ?? null);
      const type = rtm || !rtmVehicleId(x.train.vehicleType) ? x.train.vehicleType ?? defaultVehicleType(x.train.kind) : defaultVehicleType(x.train.kind);
      return { type, rtm };
    };
    const planMeshes = planMode
      ? op.trains.map((x) => {
          const { type, rtm } = planVehicle(x);
          const mesh = { ...buildTrain(x.train.cars, parseInt(x.train.color.slice(1), 16), type, rtm), rtm };
          mesh.group.visible = false;
          scene.add(mesh.group);
          return mesh;
        })
      : [];
    const map = mapRef.current ? buildMinimap(graph, mapRef.current) : null;
    mapPositionRef.current = map?.toWorld ?? null;

    const camera = new THREE.PerspectiveCamera(62, 1, 1, 20000);
    let viewportWidth = 1;
    let viewportHeight = 1;
    const updateFraming = () => {
      const { zoom, x, y } = framing.current;
      camera.zoom = zoom;
      // 表示範囲をずらす。指定地点の物理的なカメラ位置や地図の印はその地点に保つ。
      camera.setViewOffset(viewportWidth, viewportHeight, x * viewportWidth, y * viewportHeight, viewportWidth, viewportHeight);
    };
    const resize = () => {
      viewportWidth = Math.max(1, mount.clientWidth);
      viewportHeight = Math.max(1, mount.clientHeight);
      renderer.setSize(viewportWidth, viewportHeight, false);
      updateFraming();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(mount);

    // ドラッグで見回す（ダブルクリックで正面に戻す）
    let dragging: { x: number; y: number } | null = null;
    const canvas = renderer.domElement;
    const onDown = (e: PointerEvent) => {
      dragging = { x: e.clientX, y: e.clientY };
      canvas.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      if (!dragging) return;
      ctl.current.yaw = Math.max(-2.6, Math.min(2.6, ctl.current.yaw - (e.clientX - dragging.x) * 0.005));
      ctl.current.pitch = Math.max(-0.9, Math.min(0.9, ctl.current.pitch - (e.clientY - dragging.y) * 0.004));
      dragging = { x: e.clientX, y: e.clientY };
    };
    const onUp = () => (dragging = null);
    const onDbl = () => {
      ctl.current.yaw = 0;
      ctl.current.pitch = 0;
      framing.current = { zoom: 1, x: 0, y: 0 };
      updateFraming();
    };
    const onWheel = (e: WheelEvent) => {
      if (e.deltaX === 0 && e.deltaY === 0) return;
      e.preventDefault();
      const scale = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : e.deltaMode === WheelEvent.DOM_DELTA_PAGE ? viewportHeight : 1;
      const dx = e.deltaX * scale;
      const dy = e.deltaY * scale;
      const frame = framing.current;
      const horizontal = Math.abs(dx) > Math.abs(dy);
      const zoomModifier = e.ctrlKey || e.metaKey;
      if (!zoomModifier && e.altKey) {
        frame.y = THREE.MathUtils.clamp(frame.y + (dy || dx) / viewportHeight, -0.85, 0.85);
      } else if (!zoomModifier && (e.shiftKey || horizontal)) {
        frame.x = THREE.MathUtils.clamp(frame.x + (dx || dy) / viewportWidth, -0.85, 0.85);
      } else {
        const delta = horizontal ? dx : dy;
        const factor = Math.exp(THREE.MathUtils.clamp(-delta * 0.002, -1, 1));
        frame.zoom = THREE.MathUtils.clamp(frame.zoom * factor, 0.5, 4);
      }
      updateFraming();
    };
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("dblclick", onDbl);
    canvas.addEventListener("wheel", onWheel, { passive: false });

    const v = (p: { x: number; y: number; z: number }, up = 0) => new THREE.Vector3(p.x, p.z + up, p.y);
    let roll = 0;
    let last = performance.now();
    let hudAt = 0;
    let raf = 0;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const c = ctl.current;
      if (!planMode) {
        const wantRtm = rtmKitsForRef.current(vehicleTypeRef.current);
        if (currentVehicleType !== vehicleTypeRef.current || !sameKits(currentRtm, wantRtm)) {
          scene.remove(train.group);
          train.dispose();
          currentVehicleType = vehicleTypeRef.current;
          currentRtm = wantRtm;
          currentSize = currentRtm ? rtmSizeForRef.current(currentVehicleType) : undefined;
          cars = currentRtm?.sequence?.length ?? CARS;
          drive.setHistoryLength(trainLength(cars, currentSize) + CHASE_BACK_MM + 20);
          train = buildTrain(cars, 0x2f6fb5, currentVehicleType, currentRtm);
          scene.add(train.group);
        }
      } else {
        // 読み込みが終わった（または設定を変えた）RealTrainMod の車両に差し替える
        op.trains.forEach((x, i) => {
          if (!rtmVehicleId(x.train.vehicleType)) return;
          const { type, rtm } = planVehicle(x);
          const old = planMeshes[i];
          if (sameKits(old.rtm, rtm)) return;
          scene.remove(old.group);
          old.dispose();
          const mesh = { ...buildTrain(x.train.cars, parseInt(x.train.color.slice(1), 16), type, rtm), rtm };
          mesh.group.visible = false;
          scene.add(mesh.group);
          planMeshes[i] = mesh;
        });
      }
      for (const k of retiredKitsRef.current.splice(0)) k.dispose();

      let pose: DrivePose;
      let ahead: DrivePose;
      let behind: DrivePose;
      let remaining = Infinity;
      let ride: PlanTrain | undefined;
      if (planMode) {
        // 運行計画の時刻を進め、全部の列車を時刻表どおりの位置に置く
        if (c.playing) c.t = Math.min(op.endT, c.t + dt * c.rate);
        ride = op.trains.find((x) => x.train.id === c.rideId) ?? op.trains[0];
        op.trains.forEach((x, i) => {
          const mesh = planMeshes[i];
          const st = x.playback.stateAt(c.t);
          mesh.group.visible = !st.hidden && !(x === ride && c.view === "cab");
          if (!mesh.group.visible) return;
          carPlacements(x.playback.at(c.t), x.train.cars, x.train.carSize).forEach((p, k) => {
            const car = mesh.cars[k];
            car.position.copy(v(p));
            car.rotation.set(0, -(p.heading * Math.PI) / 180, p.pitch, "YXZ");
          });
        });
        pose = ride.playback.poseAt(c.t, 0);
        ahead = ride.playback.poseAt(c.t, 45);
        behind = ride.playback.poseAt(c.t, -(ride.playback.length + CHASE_BACK_MM));
        train.group.visible = false;
      } else {
        // 速度: 目標へ近づける。行き止まりの手前では止まれる速さまで落とす
        remaining = drive.remaining(3000) - 30;
        // v² = 2as（mm と mm/s で計算して km/h に戻す）
        const brakeKmh = Math.sqrt(2 * scaleKmhToMmPerSec(ACCEL_KMH_PER_S) * Math.max(0, remaining)) / scaleKmhToMmPerSec(1);
        const goal = c.playing ? Math.min(c.targetKmh, brakeKmh) : 0;
        const stepKmh = ACCEL_KMH_PER_S * dt;
        c.kmh = c.kmh < goal ? Math.min(goal, c.kmh + stepKmh) : Math.max(goal, c.kmh - stepKmh * 1.5);
        if (remaining <= 0.5) c.kmh = 0;
        if (c.kmh > 0) drive.advance(Math.min(scaleKmhToMmPerSec(c.kmh) * dt, Math.max(0, remaining)), 80);
        pose = drive.poseAt(0);
        ahead = drive.poseAt(45);
        behind = drive.poseAt(-(trainLength(cars, currentSize) + CHASE_BACK_MM));

        // 車両は現在位置を先頭の前端にして、各車両を前後の台車の位置で線路に沿わせる
        train.group.visible = c.view !== "cab";
        if (c.view !== "cab") {
          carPlacements(drive, cars, currentSize).forEach((p, i) => {
            const car = train.cars[i];
            car.position.copy(v(p));
            car.rotation.set(0, -(p.heading * Math.PI) / 180, p.pitch, "YXZ");
          });
        }
      }

      const piece = graph.pieces.get(pose.uid);
      const cant = piece ? bedStyle(getPart(piece.partId).bed).cantDeg : 0;
      const targetRoll = cant && Math.abs(pose.curvature) > 1e-4 ? (Math.sign(pose.curvature) * cant * Math.PI) / 180 : 0;
      roll += (targetRoll - roll) * Math.min(1, dt * 3);

      if (c.view === "cab") {
        camera.position.copy(v(pose, EYE_MM));
        const look = v(ahead, EYE_MM - 2);
        // 見回し（進行方向を基準に左右・上下へ回す）
        const dir = look.clone().sub(camera.position).normalize();
        dir.applyAxisAngle(new THREE.Vector3(0, 1, 0), c.yaw);
        const side = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize();
        dir.applyAxisAngle(side, c.pitch);
        camera.up.set(0, 1, 0);
        camera.lookAt(camera.position.clone().add(dir));
        camera.rotateZ(roll);
      } else if (c.view === "fixed") {
        // レイアウトの X/Y は水平面、Z は高さ。位置は列車が動いても変えない。
        camera.position.copy(v(fixedPositionRef.current));
        const dir = v(pose, 10).sub(camera.position);
        if (dir.lengthSq() < 1e-8) dir.set(0, 0, 1);
        dir.normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), c.yaw);
        const side = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0));
        if (side.lengthSq() < 1e-8) side.set(1, 0, 0);
        dir.applyAxisAngle(side.normalize(), c.pitch);
        camera.up.set(0, 1, 0);
        camera.lookAt(camera.position.clone().add(dir));
      } else {
        // 線路に沿って編成の後ろの上から、先頭の車両を見る（ドラッグで回り込む）
        const target = v(pose, 10);
        const base = v(behind, CHASE_UP_MM + c.pitch * 150);
        const offset = base.sub(target).applyAxisAngle(new THREE.Vector3(0, 1, 0), c.yaw);
        camera.position.copy(target).add(offset);
        camera.up.set(0, 1, 0);
        camera.lookAt(target);
      }

      // レイアウトの見取り図に、列車の位置を出す
      if (map) {
        map.draw(
          planMode
            ? op.trains
                .filter((x) => !x.playback.stateAt(c.t).hidden)
                .map((x) => ({
                  id: x.train.id,
                  color: x.train.color,
                  points: bodyPoints((o) => x.playback.poseAt(c.t, o), x.playback.length),
                  ride: x === ride,
                }))
            : [{ id: "", color: "#2f6fb5", points: bodyPoints((o) => drive.poseAt(o), trainLength(cars, currentSize)), ride: true }],
          c.view === "fixed" ? fixedPositionRef.current : null,
        );
      }
      renderer.render(scene, camera);

      if (now - hudAt > 120 && planMode && ride) {
        hudAt = now;
        const st = ride.playback.stateAt(c.t);
        setPlanHud({
          t: c.t,
          kmh: st.kmh,
          train: `${ride.train.name}（${ride.line ? `${ride.line}・` : ""}${kindLabel(ride.train.kind)}・${ride.train.cars}両）`,
          status: planStatus(ride, c.t, st.hidden, st.stopped, op.stationName),
        });
        const part = piece ? getPart(piece.partId) : null;
        setHud({
          kmh: st.kmh,
          z: pose.z,
          grade: pose.gradePct,
          part: part ? `${part.name}（${part.id}）` : "",
          odometer: st.s,
          stopped: false,
          next: null,
        });
      } else if (now - hudAt > 120) {
        hudAt = now;
        const sw = drive.nextSwitch(2500);
        const part = piece ? getPart(piece.partId) : null;
        setHud({
          kmh: c.kmh,
          z: pose.z,
          grade: pose.gradePct,
          part: part ? `${part.name}（${part.id}）` : "",
          odometer: drive.odometer,
          stopped: remaining <= 1,
          next: sw ? { distance: sw.distance, options: sw.options } : null,
        });
        setOverride(drive.nextOverride);
      }
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      mapPositionRef.current = null;
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("dblclick", onDbl);
      canvas.removeEventListener("wheel", onWheel);
      if (recorderRef.current?.state === "recording") recorderRef.current.stop();
      world.dispose();
      sceneAlive = false;
      placedModels?.dispose();
      train.dispose();
      for (const m of planMeshes) m.dispose();
      renderer.dispose();
      canvas.remove();
      driveRef.current = null;
    };
    // policy は別の effect で反映する（変えても最初からにしない）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, graph, op, startUid, restart, mode]);

  const chooseNext = (i: number) => {
    const d = driveRef.current;
    if (!d) return;
    d.nextOverride = d.nextOverride === i ? null : i;
    setOverride(d.nextOverride);
  };

  const turnBack = () => {
    driveRef.current?.reverseDirection();
    ctl.current.kmh = 0;
    setPlaying(true);
  };

  const saveVideo = (blob: Blob, name: string) =>
    saveBlob(blob, `${layout.title || "レイアウト"}-${name}.${blob.type.startsWith("video/mp4") ? "mp4" : "webm"}`);

  const toggleRecord = async () => {
    const active = recorderRef.current;
    if (active) {
      if (active.state === "recording") {
        setVideoStatus("saving");
        active.stop();
      }
      return;
    }
    const canvas = mountRef.current?.querySelector<HTMLCanvasElement>("canvas.drive-3d");
    if (!canvas || !mime || encodingRef.current) return;
    setVideoMessage("");
    try {
      const { recorder, done } = recordCanvas(canvas, mime, bitrate);
      recorderRef.current = recorder;
      setVideoStatus("recording");
      const blob = await done;
      setLastRecording(blob);
      saveVideo(blob, "走行映像");
    } catch (err) {
      setVideoMessage(err instanceof Error ? err.message : "録画に失敗しました。");
    } finally {
      recorderRef.current = null;
      setVideoStatus("idle");
    }
  };

  const reencode = async () => {
    if (!lastRecording || !mime || encodingRef.current || recorderRef.current) return;
    const controller = new AbortController();
    encodingRef.current = controller;
    setVideoStatus("encoding");
    setVideoMessage("");
    try {
      const blob = await encodeVideo(lastRecording, mime, bitrate, controller.signal);
      if (!controller.signal.aborted) saveVideo(blob, "走行映像-変換");
    } catch (err) {
      if (!controller.signal.aborted) setVideoMessage(err instanceof Error ? err.message : "エンコードに失敗しました。");
    } finally {
      encodingRef.current = null;
      setVideoStatus("idle");
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.matches("input, select") || (e.key === " " && (e.target as HTMLElement)?.closest("button"))) return;
      // RealTrainMod の車両のダイアログを開いている間は、そちらだけを閉じる
      if (rtmOpenRef.current) {
        if (e.key === "Escape") setRtmOpen(false);
        return;
      }
      if (e.key === "Escape") onClose();
      else if (e.key === " ") {
        e.preventDefault();
        setPlaying((p) => !p);
      } else if (modeRef.current === "plan") {
        if (e.key === "ArrowUp") setRate((r) => RATES[Math.min(RATES.length - 1, RATES.indexOf(r) + 1)] ?? r);
        else if (e.key === "ArrowDown") setRate((r) => RATES[Math.max(0, RATES.indexOf(r) - 1)] ?? r);
        else return;
      } else if (e.key === "ArrowUp") setTargetKmh((k) => Math.min(MAX_KMH, k + 10));
      else if (e.key === "ArrowDown") setTargetKmh((k) => Math.max(0, k - 10));
      else if (/^[1-4]$/.test(e.key)) chooseNext(Number(e.key) - 1);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="drive" role="dialog" aria-label="運転席の視点で走る">
      <div className="drive-stage" ref={mountRef}>
        {error && <p className="drive-error">{error}</p>}
        {modelNote && (
          <p className="drive-model-note" onClick={() => setModelNote("")} title="クリックで閉じる">
            {modelNote}
          </p>
        )}
        {planMode && planHud && (
          <div className="drive-hud drive-plan-hud">
            <div className="speed">
              <b>{formatTime(planHud.t)}</b> {rate > 1 && <span className="muted">×{rate}</span>}
            </div>
            <div>{planHud.train}</div>
            <div>{planHud.status}</div>
            <div className="muted">{Math.round(planHud.kmh)} km/h</div>
            {recording && <div className="rec">● 録画中</div>}
          </div>
        )}
        <canvas
          ref={mapRef}
          className="drive-map"
          onClick={onMapClick}
          aria-label={view === "fixed" ? "カメラ位置を選ぶ見取り図" : "レイアウトの見取り図"}
          title={view === "fixed" ? "クリックでカメラの X・Y を設定（高さ Z は維持）。黄色の印がカメラ位置です" : planMode ? "レイアウトの見取り図。列車をクリックすると、その列車に乗り換えます" : "レイアウトの見取り図"}
        />
        {!planMode && hud && (
          <div className="drive-hud">
            <div className="speed">
              <b>{Math.round(hud.kmh)}</b> km/h
            </div>
            <div>
              高さ {hud.z.toFixed(0)}mm
              {Math.abs(hud.grade) > 0.2 && ` / ${hud.grade > 0 ? "上り" : "下り"} ${Math.abs(hud.grade).toFixed(1)}%`}
            </div>
            <div className="muted">{hud.part}</div>
            <div className="muted">走行 {(hud.odometer / 1000).toFixed(2)}m（実物換算 {((hud.odometer * 150) / 1_000_000).toFixed(2)}km）</div>
            {recording && <div className="rec">● 録画中</div>}
          </div>
        )}
        {!planMode && hud?.stopped && (
          <div className="drive-end">
            行き止まりです
            <button onClick={turnBack}>折り返す</button>
          </div>
        )}
      </div>
      <div className="drive-bar">
        <span className="seg" title="自分で運転するか、運行計画どおりに全部の列車を走らせるか">
          <button className={!planMode ? "on" : ""} onClick={() => setMode("free")}>
            自由に運転
          </button>
          <button
            className={planMode ? "on" : ""}
            onClick={() => setMode("plan")}
            disabled={op.trains.length === 0}
            title={op.trains.length === 0 ? "運行計画に列車がありません（運行計画の画面で列車を追加してください）" : undefined}
          >
            運行計画どおり
          </button>
        </span>
        {planMode ? (
          <>
            <button className="primary" onClick={() => setPlaying((p) => !p)} title="スペースキー">
              {playing ? "⏸ 一時停止" : "▶ 再生"}
            </button>
            <label className="drive-speed drive-clock" title="運転を始めてからの時刻">
              時刻
              <input
                type="range"
                min={op.startT}
                max={op.endT}
                step={1}
                value={Math.min(op.endT, Math.max(op.startT, planHud?.t ?? op.startT))}
                onChange={(e) => seek(Number(e.target.value))}
              />
              <span>{formatTime(planHud?.t ?? op.startT)}</span>
            </label>
            <span className="seg" title="時刻を進める速さ（↑↓キーでも変えられます）">
              {RATES.map((r) => (
                <button key={r} className={rate === r ? "on" : ""} onClick={() => setRate(r)}>
                  ×{r}
                </button>
              ))}
            </span>
            <label className="drive-ride">
              乗る列車
              <select value={rideId} onChange={(e) => setRideId(e.target.value)}>
                {op.trains.map((x) => (
                  <option key={x.train.id} value={x.train.id}>
                    {x.train.name}（{x.line ? `${x.line}・` : ""}
                    {kindLabel(x.train.kind)}）
                  </option>
                ))}
              </select>
            </label>
          </>
        ) : (
          <>
            <button className="primary" onClick={() => setPlaying((p) => !p)} title="スペースキー">
              {playing ? "⏸ 一時停止" : "▶ 走る"}
            </button>
            <label className="drive-speed" title="↑↓キーでも変えられます">
              速度
              <input type="range" min={0} max={MAX_KMH} step={5} value={targetKmh} onChange={(e) => setTargetKmh(Number(e.target.value))} />
              <span>{targetKmh} km/h</span>
            </label>
            <span className="seg" title="ポイントでどちらへ進むか">
              進路
              {SWITCH_POLICIES.map((p) => (
                <button key={p.value} className={policy === p.value ? "on" : ""} onClick={() => setPolicy(p.value)}>
                  {p.label}
                </button>
              ))}
            </span>
            <span className="seg drive-next" title="次のポイントだけ進路を選ぶ（数字キーでも選べます）">
              {hud?.next ? (
                <>
                  次のポイント（{(hud.next.distance / 10).toFixed(0)}cm先）
                  {hud.next.options.map((label, i) => (
                    <button key={i} className={override === i ? "on" : ""} onClick={() => chooseNext(i)}>
                      {label}
                    </button>
                  ))}
                </>
              ) : (
                <span className="muted">次のポイント: なし</span>
              )}
            </span>
          </>
        )}
        <span className="seg">
          <button className={view === "cab" ? "on" : ""} onClick={() => setView("cab")}>
            運転席
          </button>
          <button className={view === "chase" ? "on" : ""} onClick={() => setView("chase")}>
            後ろから
          </button>
          <button className={view === "fixed" ? "on" : ""} onClick={() => {
            ctl.current.yaw = 0;
            ctl.current.pitch = 0;
            setView("fixed");
          }}>
            指定地点
          </button>
        </span>
        {view === "fixed" && (
          <fieldset className="drive-position">
            <legend>カメラ位置（mm）</legend>
            <span>MAP をクリックして位置を選択（高さ Z はそのまま）</span>
            {(["x", "y", "z"] as const).map((axis) => (
              <label key={axis}>
                {axis.toUpperCase()}{axis === "z" ? "（高さ）" : ""}
                <input type="number" step="any" value={positionInputs[axis]}
                  aria-invalid={positionInputs[axis] === "" || !Number.isFinite(Number(positionInputs[axis]))}
                  onChange={(e) => {
                    const text = e.currentTarget.value;
                    setPositionInputs((p) => ({ ...p, [axis]: text }));
                    const value = e.currentTarget.valueAsNumber;
                    if (Number.isFinite(value)) setFixedPosition((p) => ({ ...p, [axis]: value }));
                  }} />
              </label>
            ))}
            <span className="muted">ボード左上が X=0・Y=0、右が +X、下が +Y。Z=0 は地上のレール面。列車を追って向きが変わります。空欄の間は直前の位置を使います。</span>
          </fieldset>
        )}
        {!planMode && <label>映像の車両
          <select value={vehicleType} onChange={(e) => setVehicleType(e.target.value as VehicleType)}>
            {VEHICLE_TYPES.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
            {rtmVehicles && rtmVehicles.length > 0 && (
              <optgroup label="読み込んだ車両（RealTrainMod）">
                {leadVehicles(rtmVehicles, rtmVehicleId(vehicleType)).map((v) => <option key={v.id} value={rtmVehicleType(v.id)}>{v.name}</option>)}
              </optgroup>
            )}
          </select>
        </label>}
        {rtmAllowed ? (
          <button onClick={() => setRtmOpen(true)} title="RealTrainMod の車両パックを読み込む">RTMの車両…</button>
        ) : (
          <button disabled title="RealTrainMod の車両は、プレミアムユーザー・プレミアムプラス・管理者が使えます">RTMの車両…</button>
        )}
        {!planMode && <button onClick={turnBack}>⇄ 逆向き</button>}
        <button
          onClick={() => {
            if (planMode) seek(op.startT);
            else setRestart((n) => n + 1);
          }}
        >
          最初から
        </button>
        {formats.length > 0 ? (
          <>
            <label>保存形式 <select value={mime} disabled={videoStatus !== "idle"} onChange={(e) => setMime(e.target.value)}>
              {formats.map(f => <option key={f.mime} value={f.mime}>{f.name}</option>)}
            </select></label>
            <label>画質 <select value={bitrate} disabled={videoStatus !== "idle"} onChange={(e) => setBitrate(Number(e.target.value))}>
              <option value={3_000_000}>軽量（3 Mbps）</option>
              <option value={8_000_000}>標準（8 Mbps）</option>
              <option value={16_000_000}>高画質（16 Mbps）</option>
            </select></label>
            <button onClick={toggleRecord} disabled={videoStatus === "saving" || videoStatus === "encoding"} className={recording ? "danger" : ""}>
              {recording ? "■ 録画を止めて保存" : videoStatus === "saving" ? "保存中…" : "● 録画"}
            </button>
            {lastRecording && (videoStatus === "encoding" ? (
              <button onClick={() => encodingRef.current?.abort()}>エンコード中… 中止</button>
            ) : (
              <button disabled={videoStatus !== "idle"} onClick={reencode} title="選択中の形式と画質で、録画の長さと同じ時間をかけて変換します">
                直前の録画を再エンコードして保存
              </button>
            ))}
          </>
        ) : <span>このブラウザでは走行映像を録画できません。</span>}
        {videoMessage && <span role="alert">{videoMessage}</span>}
        <span className="muted drive-help" title="Ctrl＋横ホイールでズーム。Shift＋ホイールで左右、Alt＋ホイールで上下にパン。ドラッグで見回し、ダブルクリックでリセット">
          ホイールでズーム・横ホイールでパン
        </span>
        <button className="drive-close" onClick={onClose}>
          閉じる
        </button>
      </div>
      {rtmOpen && rtmAllowed && (
        <RtmVehiclesDialog
          onClose={() => setRtmOpen(false)}
          onPick={planMode ? undefined : (id) => {
            setVehicleType(rtmVehicleType(id));
            setRtmOpen(false);
            if (view === "cab") setView("chase");
          }}
        />
      )}
    </div>
  );
}

/** 運行計画で乗っている列車の、いまの様子（停車中・次の駅） */
function planStatus(x: PlanTrain, t: number, hidden: boolean, stopped: boolean, stationName: (id: string) => string): string {
  const ev = x.events;
  const where = (e: StopEvent) => `${stationName(e.stationId)} ${e.track}番線`;
  if (hidden) return `${formatTime(x.playback.appearT)}に${ev[0] ? where(ev[0]) : "始発駅"}に入ります`;
  if (stopped) {
    // 止まっている駅：着いてから発つまで（始発駅は発時刻まで）
    const here = ev.find((e) => !e.pass && (e.arr ?? -Infinity) <= t + 0.5 && t <= (e.dep ?? Infinity));
    if (here) return here.dep === null ? `${where(here)}（終着）` : `${where(here)} 停車中（${formatTime(here.dep)}発）`;
    const last = ev[ev.length - 1];
    if (last && last.dep === null && (last.arr ?? 0) <= t) return `${where(last)}（終着）`;
  }
  const next = ev.find((e) => (e.pass ? e.dep! : e.arr ?? -Infinity) > t);
  if (!next) return "";
  return next.pass ? `次は ${stationName(next.stationId)} 通過（${formatTime(next.dep!)}）` : `次は ${where(next)}（${formatTime(next.arr!)}着）`;
}

/** 編成の上の点（先頭から最後尾まで） */
function bodyPoints(poseAt: (offset: number) => DrivePose, length: number): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  const n = Math.max(2, Math.ceil(length / 25));
  for (let i = 0; i <= n; i++) {
    const p = poseAt((-length * i) / n);
    out.push({ x: p.x, y: p.y });
  }
  return out;
}

type MapTrain = { id: string; color: string; points: { x: number; y: number }[]; ride: boolean };

/** 見取り図の幅（CSS px） */
const MAP_W = 240;

/** レイアウトを真上から見た小さな図。線路を一度だけ描いておき、毎回列車を重ねる */
function buildMinimap(graph: DriveGraph, canvas: HTMLCanvasElement) {
  const lines: { x: number; y: number }[][] = [];
  for (const [uid, piece] of graph.pieces) {
    getPart(piece.partId).routes.forEach((_, routeIndex) => {
      lines.push(makeSegment(graph, { uid, routeIndex, reverse: false }, 12).points);
    });
  }
  const all = lines.flat();
  if (!all.length) return null;
  const minX = Math.min(...all.map((p) => p.x));
  const maxX = Math.max(...all.map((p) => p.x));
  const minY = Math.min(...all.map((p) => p.y));
  const maxY = Math.max(...all.map((p) => p.y));
  const pad = 8;
  const scale = (MAP_W - pad * 2) / Math.max(1, maxX - minX, (maxY - minY) / 0.75);
  const w = MAP_W;
  const h = Math.round((maxY - minY) * scale + pad * 2);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const X = (x: number) => pad + (x - minX) * scale;
  const Y = (y: number) => pad + (y - minY) * scale;
  const base = document.createElement("canvas");
  base.width = canvas.width;
  base.height = canvas.height;
  const bctx = base.getContext("2d")!;
  bctx.scale(dpr, dpr);
  bctx.strokeStyle = "rgba(230, 236, 232, 0.75)";
  bctx.lineWidth = 1.5;
  bctx.lineCap = "round";
  for (const line of lines) {
    bctx.beginPath();
    line.forEach((p, i) => (i ? bctx.lineTo(X(p.x), Y(p.y)) : bctx.moveTo(X(p.x), Y(p.y))));
    bctx.stroke();
  }
  // クリックで列車を選ぶための、最後に描いた列車の位置（図の中の割合）
  let lastTrains: { id: string; pts: { x: number; y: number }[] }[] = [];
  hitTargets.set(canvas, (fx, fy) => {
    let best: { id: string; d: number } | null = null;
    for (const t of lastTrains) {
      for (const p of t.pts) {
        const d = Math.hypot(p.x - fx * w, p.y - fy * h);
        if (d < 14 && (!best || d < best.d)) best = { id: t.id, d };
      }
    }
    return best?.id ?? null;
  });
  canvas.dataset.hit = "1";
  return {
    // CSS で縮小された MAP でも、クリック位置の割合から mm に戻す。
    toWorld: (fx: number, fy: number) => ({ x: minX + (fx * w - pad) / scale, y: minY + (fy * h - pad) / scale }),
    draw(trains: MapTrain[], cameraPosition: { x: number; y: number } | null) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(base, 0, 0);
      ctx.scale(dpr, dpr);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      lastTrains = [];
      // 乗っている列車を最後に（いちばん上に）描く
      for (const t of [...trains].sort((a, b) => Number(a.ride) - Number(b.ride))) {
        const pts = t.points.map((p) => ({ x: X(p.x), y: Y(p.y) }));
        lastTrains.push({ id: t.id, pts });
        const path = () => {
          ctx.beginPath();
          pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
        };
        if (t.ride) {
          path();
          ctx.strokeStyle = "#ffffff";
          ctx.lineWidth = 8;
          ctx.stroke();
        }
        path();
        ctx.strokeStyle = t.color;
        ctx.lineWidth = 5;
        ctx.stroke();
        // 先頭
        ctx.beginPath();
        ctx.arc(pts[0].x, pts[0].y, t.ride ? 3.5 : 2.5, 0, Math.PI * 2);
        ctx.fillStyle = "#ffffff";
        ctx.fill();
      }
      if (cameraPosition) {
        // 数値指定で図の外にあるときは、端に印を寄せる。
        const x = Math.max(8, Math.min(w - 8, X(cameraPosition.x)));
        const y = Math.max(8, Math.min(h - 8, Y(cameraPosition.y)));
        ctx.beginPath();
        ctx.arc(x, y, 6, 0, Math.PI * 2);
        ctx.fillStyle = "#ffcf33";
        ctx.fill();
        ctx.strokeStyle = "#171717";
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x - 3, y);
        ctx.lineTo(x + 3, y);
        ctx.moveTo(x, y - 3);
        ctx.lineTo(x, y + 3);
        ctx.stroke();
      }
    },
  };
}

const hitTargets = new WeakMap<HTMLCanvasElement, (fx: number, fy: number) => string | null>();

/** 見取り図のクリック位置（図の中の割合）にいる列車 */
function hitTrain(canvas: HTMLCanvasElement, fx: number, fy: number): string | null {
  return hitTargets.get(canvas)?.(fx, fy) ?? null;
}
