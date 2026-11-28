"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import type { RtmVehicle } from "@/lib/rtm/pack";
import { buildVehicleKit, vehiclePreviewScene } from "@/lib/rtm/three";

const SIZE = 144;
type DrawFront = (vehicle: RtmVehicle, canvas: HTMLCanvasElement, signal: AbortSignal) => Promise<void>;

/** 一覧の全サムネイルを、一つのレンダラーで順番に作る。 */
export function useDrawVehicleFront(): DrawFront {
  const renderer = useRef<THREE.WebGLRenderer | null | undefined>(undefined);
  const queue = useRef(Promise.resolve());

  useEffect(() => () => {
    renderer.current?.dispose();
    renderer.current = undefined;
  }, []);

  return useCallback((vehicle, canvas, signal) => {
    const draw = async () => {
      signal.throwIfAborted();
      if (renderer.current === undefined) {
        try {
          renderer.current = new THREE.WebGLRenderer({ alpha: true, antialias: true });
          renderer.current.setSize(SIZE, SIZE, false);
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
        const model = kit.makeCar("front", vehicle.formation?.[0]?.reversed);
        const bounds = new THREE.Box3().setFromObject(model);
        if (bounds.isEmpty()) throw new Error("車両モデルが空です");
        const center = bounds.getCenter(new THREE.Vector3());
        const size = bounds.getSize(new THREE.Vector3());
        const half = Math.max(size.y, size.z, 1) * 0.58;
        const camera = new THREE.OrthographicCamera(-half, half, half, -half, 0.1, size.x + 20);
        camera.position.set(bounds.max.x + 10, center.y, center.z);
        camera.lookAt(center);
        const scene = vehiclePreviewScene([200, 100, -100]);
        scene.add(model);
        await kit.texturesReady();
        signal.throwIfAborted();
        gl.render(scene, camera);
        context.clearRect(0, 0, SIZE, SIZE);
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

export function VehicleFrontPreview({ vehicle, drawFront }: { vehicle: RtmVehicle; drawFront: DrawFront }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "unavailable">("loading");

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const controller = new AbortController();
    const { signal } = controller;
    setStatus("loading");
    const draw = () => {
      void drawFront(vehicle, element, signal).then(
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
  }, [vehicle, drawFront]);

  return (
    <div className="rtm-vehicle-front">
      <canvas
        ref={canvas}
        width={SIZE}
        height={SIZE}
        role="img"
        aria-label={`${vehicle.name}の前面`}
        aria-hidden={status !== "ready"}
        className={status === "ready" ? undefined : "rtm-vehicle-front-pending"}
      />
      {status === "unavailable" && <span>画像なし</span>}
    </div>
  );
}
