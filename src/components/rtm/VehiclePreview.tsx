"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import type { RtmVehicle } from "@/lib/rtm/pack";
import { buildVehicleKit, vehiclePreviewScene } from "@/lib/rtm/three";

const HEIGHT = 144;
type PreviewView = "front" | "side";
export type DrawVehiclePreview = (vehicle: RtmVehicle, reversed: boolean, view: PreviewView, canvas: HTMLCanvasElement, signal: AbortSignal) => Promise<void>;

/** 一覧の全サムネイルを、一つのレンダラーで順番に作る。 */
export function useDrawVehiclePreview(): DrawVehiclePreview {
  const renderer = useRef<THREE.WebGLRenderer | null | undefined>(undefined);
  const queue = useRef(Promise.resolve());

  useEffect(() => () => {
    renderer.current?.dispose();
    renderer.current = undefined;
  }, []);

  return useCallback((vehicle, reversed, view, canvas, signal) => {
    const draw = async () => {
      signal.throwIfAborted();
      if (renderer.current === undefined) {
        try {
          renderer.current = new THREE.WebGLRenderer({ alpha: true, antialias: true });
        } catch {
          renderer.current = null;
        }
      }
      const gl = renderer.current;
      const context = canvas.getContext("2d");
      if (!gl || gl.getContext().isContextLost() || !context) throw new Error("前面画像を描画できません");

      const kit = await buildVehicleKit(vehicle);
      try {
        signal.throwIfAborted();
        const model = kit.makeCar("front", reversed);
        const bounds = new THREE.Box3().setFromObject(model);
        if (bounds.isEmpty()) throw new Error("車両モデルが空です");
        const center = bounds.getCenter(new THREE.Vector3());
        const size = bounds.getSize(new THREE.Vector3());
        const side = view === "side";
        const aspect = canvas.width / canvas.height;
        const half = Math.max(size.y, (side ? size.x : size.z) / aspect, 1) * 0.58;
        const camera = new THREE.OrthographicCamera(-half * aspect, half * aspect, half, -half, 0.1, (side ? size.z : size.x) + 20);
        if (side) camera.position.set(center.x, center.y, bounds.min.z - 10);
        else camera.position.set(bounds.max.x + 10, center.y, center.z);
        camera.lookAt(center);
        const scene = vehiclePreviewScene(side ? [-150, 100, -200] : [200, 100, -100]);
        scene.add(model);
        await kit.texturesReady();
        signal.throwIfAborted();
        gl.setSize(canvas.width, canvas.height, false);
        gl.render(scene, camera);
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.drawImage(gl.domElement, 0, 0);
      } finally {
        kit.dispose();
      }
    };
    const job = queue.current.then(draw);
    queue.current = job.catch(() => {});
    return job;
  }, []);
}

export function VehiclePreview({ vehicle, reversed = false, view = "front", drawPreview }: {
  vehicle: RtmVehicle | undefined;
  reversed?: boolean;
  view?: PreviewView;
  drawPreview: DrawVehiclePreview;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "unavailable">("loading");

  useEffect(() => {
    const element = canvas.current;
    if (!element || !vehicle) return;
    const controller = new AbortController();
    const { signal } = controller;
    setStatus("loading");
    const draw = () => {
      void drawPreview(vehicle, reversed, view, element, signal).then(
        () => { if (!signal.aborted) setStatus("ready"); },
        () => { if (!signal.aborted) setStatus("unavailable"); },
      );
    };

    // 長い車両一覧では、スクロールで表示された行だけ描画する。
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      observer.disconnect();
      draw();
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      controller.abort();
    };
  }, [vehicle, reversed, view, drawPreview]);

  const side = view === "side";
  return (
    <div className={side ? "rtm-vehicle-side" : "rtm-vehicle-front"}>
      {vehicle && (
        <canvas
          ref={canvas}
          width={side ? 360 : HEIGHT}
          height={HEIGHT}
          role="img"
          aria-label={`${vehicle.name}の${side ? "側面" : "前面"}`}
          aria-hidden={status !== "ready"}
          className={status === "ready" ? undefined : "rtm-vehicle-front-pending"}
        />
      )}
      {(!vehicle || status === "unavailable") && <span>画像なし</span>}
    </div>
  );
}
