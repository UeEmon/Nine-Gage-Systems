"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { placePiers } from "@/lib/elevation";
import { buildDriveGraph, Drive, scaleKmhToMmPerSec, startRef, SWITCH_POLICIES, type SwitchPolicy } from "@/lib/drive";
import { bedStyle, buildScene, buildTrain } from "@/lib/driveScene";
import type { Layout } from "@/lib/geometry";
import { getPart } from "@/lib/parts";

type Props = {
  layout: Layout;
  /** 走り始める部品（選択中の部品）。なければ最初の部品 */
  startUid: string | null;
  onClose: () => void;
};

type ViewMode = "cab" | "chase";

type Hud = {
  kmh: number;
  z: number;
  grade: number;
  part: string;
  odometer: number;
  stopped: boolean;
  next: { distance: number; options: string[] } | null;
  recording: boolean;
};

/** 運転席の目の高さ（レール面から, mm。1/150 で 約2.7m） */
const EYE_MM = 18;
/** 加速・減速（縮尺の km/h 毎秒） */
const ACCEL_KMH_PER_S = 40;
const MAX_KMH = 320;

/** 作ったレイアウトの線路の上を、運転席の視点で走る3Dの映像 */
export function DriveView({ layout, startUid, onClose }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const driveRef = useRef<Drive | null>(null);
  const ctl = useRef({ playing: true, targetKmh: 80, kmh: 0, view: "cab" as ViewMode, yaw: 0, pitch: 0 });
  const recorderRef = useRef<MediaRecorder | null>(null);
  const [playing, setPlaying] = useState(true);
  const [targetKmh, setTargetKmh] = useState(80);
  const [policy, setPolicy] = useState<SwitchPolicy>("straight");
  const [view, setView] = useState<ViewMode>("cab");
  const [override, setOverride] = useState<number | null>(null);
  const [hud, setHud] = useState<Hud | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [restart, setRestart] = useState(0);

  ctl.current.playing = playing;
  ctl.current.targetKmh = targetKmh;
  ctl.current.view = view;

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
    const graph = buildDriveGraph(layout.pieces);
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
    const world = buildScene(graph, layout.pieces, piers, layout.board);
    scene.add(world.group);
    const train = buildTrain();
    scene.add(train.group);

    const camera = new THREE.PerspectiveCamera(62, 1, 1, 20000);
    const resize = () => {
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / Math.max(1, h);
      camera.updateProjectionMatrix();
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
    };
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("dblclick", onDbl);

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

      // 速度: 目標へ近づける。行き止まりの手前では止まれる速さまで落とす
      const remaining = drive.remaining(3000) - 30;
      // v² = 2as（mm と mm/s で計算して km/h に戻す）
      const brakeKmh = Math.sqrt(2 * scaleKmhToMmPerSec(ACCEL_KMH_PER_S) * Math.max(0, remaining)) / scaleKmhToMmPerSec(1);
      const goal = c.playing ? Math.min(c.targetKmh, brakeKmh) : 0;
      const stepKmh = ACCEL_KMH_PER_S * dt;
      c.kmh = c.kmh < goal ? Math.min(goal, c.kmh + stepKmh) : Math.max(goal, c.kmh - stepKmh * 1.5);
      if (remaining <= 0.5) c.kmh = 0;
      if (c.kmh > 0) drive.advance(Math.min(scaleKmhToMmPerSec(c.kmh) * dt, Math.max(0, remaining)), 80);

      const pose = drive.poseAt(0);
      const ahead = drive.poseAt(45);
      const piece = graph.pieces.get(pose.uid);
      const cant = piece ? bedStyle(getPart(piece.partId).bed).cantDeg : 0;
      const targetRoll = cant && Math.abs(pose.curvature) > 1e-4 ? (Math.sign(pose.curvature) * cant * Math.PI) / 180 : 0;
      roll += (targetRoll - roll) * Math.min(1, dt * 3);

      // 車両は現在位置を先頭にして置く
      train.group.position.copy(v(pose));
      train.group.rotation.set(0, -(pose.heading * Math.PI) / 180, 0);
      train.group.visible = c.view === "chase";

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
      } else {
        const h = (pose.heading * Math.PI) / 180 + c.yaw;
        const dist = 260;
        camera.position.set(pose.x - Math.cos(h) * dist, pose.z + 120 + c.pitch * 150, pose.y - Math.sin(h) * dist);
        camera.up.set(0, 1, 0);
        camera.lookAt(v(ahead, 10));
      }
      renderer.render(scene, camera);

      if (now - hudAt > 120) {
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
          recording: recorderRef.current?.state === "recording",
        });
        setOverride(drive.nextOverride);
      }
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("dblclick", onDbl);
      if (recorderRef.current?.state === "recording") recorderRef.current.stop();
      world.dispose();
      train.dispose();
      renderer.dispose();
      canvas.remove();
      driveRef.current = null;
    };
    // policy は別の effect で反映する（変えても最初からにしない）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, startUid, restart]);

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

  const toggleRecord = () => {
    const rec = recorderRef.current;
    if (rec && rec.state === "recording") {
      rec.stop();
      return;
    }
    const canvas = mountRef.current?.querySelector("canvas");
    if (!canvas || typeof MediaRecorder === "undefined") {
      setError("このブラウザでは録画できません。");
      return;
    }
    const stream = canvas.captureStream(30);
    const type = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm", "video/mp4"].find((t) =>
      MediaRecorder.isTypeSupported(t),
    );
    const recorder = new MediaRecorder(stream, type ? { mimeType: type, videoBitsPerSecond: 8_000_000 } : undefined);
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: recorder.mimeType || "video/webm" });
      const ext = blob.type.includes("mp4") ? "mp4" : "webm";
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${layout.title || "レイアウト"}-運転席.${ext}`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        a.remove();
        URL.revokeObjectURL(a.href);
      }, 10_000);
    };
    recorder.start(500);
    recorderRef.current = recorder;
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;
      if (e.key === "Escape") onClose();
      else if (e.key === " ") {
        e.preventDefault();
        setPlaying((p) => !p);
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
        {hud && (
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
            {hud.recording && <div className="rec">● 録画中</div>}
          </div>
        )}
        {hud?.stopped && (
          <div className="drive-end">
            行き止まりです
            <button onClick={turnBack}>折り返す</button>
          </div>
        )}
      </div>
      <div className="drive-bar">
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
        <span className="seg">
          <button className={view === "cab" ? "on" : ""} onClick={() => setView("cab")}>
            運転席
          </button>
          <button className={view === "chase" ? "on" : ""} onClick={() => setView("chase")}>
            後ろから
          </button>
        </span>
        <button onClick={turnBack}>⇄ 逆向き</button>
        <button onClick={() => setRestart((n) => n + 1)}>最初から</button>
        <button onClick={toggleRecord} className={hud?.recording ? "danger" : ""}>
          {hud?.recording ? "■ 録画を止めて保存" : "● 録画"}
        </button>
        <span className="muted drive-help">ドラッグで見回し・ダブルクリックで正面</span>
        <button className="drive-close" onClick={onClose}>
          閉じる
        </button>
      </div>
    </div>
  );
}
