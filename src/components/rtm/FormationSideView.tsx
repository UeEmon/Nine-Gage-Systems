"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { N_CAR, type RtmSlot } from "@/lib/drive";
import { carSizeOf, type RtmVehicle } from "@/lib/rtm/pack";
import { buildVehicleKit, vehiclePreviewScene, type VehicleKit } from "@/lib/rtm/three";

const VIEW_HEIGHT = 76;
type KitLoad = Promise<VehicleKit | null>;

function disposeKit(load: KitLoad) {
  void load.then(kit => kit?.dispose());
}

export function FormationSideView({ slots, vehicles, disabled, onSwap }: {
  slots: RtmSlot[];
  vehicles: RtmVehicle[];
  disabled: boolean;
  onSwap: (first: number, second: number) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const renderer = useRef<THREE.WebGLRenderer | null>(null);
  const kits = useRef(new Map<RtmVehicle, KitLoad>());
  const [preview, setPreview] = useState<"loading" | "ready" | "unavailable">("loading");
  const [missing, setMissing] = useState<number[]>([]);
  const [selected, setSelected] = useState<RtmSlot | null>(null);
  const dragFrom = useRef<RtmSlot | null>(null);
  const selectedIndex = selected ? slots.indexOf(selected) : -1;

  const cars = useMemo(() => {
    const byId = new Map(vehicles.map(vehicle => [vehicle.id, vehicle]));
    let left = 0;
    return slots.map(slot => {
      const vehicle = byId.get(slot.id);
      const length = vehicle ? carSizeOf(vehicle).length : N_CAR.length;
      const width = Math.round(Math.min(420, Math.max(48, length + N_CAR.gap)));
      const center = left + width / 2;
      left += width;
      return { slot, vehicle, width, center };
    });
  }, [slots, vehicles]);
  const width = cars.reduce((sum, car) => sum + car.width, 0);

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    let gl: THREE.WebGLRenderer;
    try {
      gl = new THREE.WebGLRenderer({ canvas: element, alpha: true, antialias: true });
    } catch {
      setPreview("unavailable");
      return;
    }
    renderer.current = gl;
    const models = kits.current;
    const contextLost = () => {
      renderer.current = null;
      setPreview("unavailable");
    };
    element.addEventListener("webglcontextlost", contextLost);
    return () => {
      element.removeEventListener("webglcontextlost", contextLost);
      renderer.current = null;
      for (const load of models.values()) disposeKit(load);
      models.clear();
      gl.dispose();
    };
  }, []);

  useEffect(() => {
    const gl = renderer.current;
    if (!gl) return;
    const models = kits.current;
    const needed = new Set(cars.map(car => car.vehicle));
    for (const [vehicle, load] of models) {
      if (needed.has(vehicle)) continue;
      models.delete(vehicle);
      disposeKit(load);
    }

    const loads = cars.map(({ vehicle }) => {
      if (!vehicle) return null;
      let load = models.get(vehicle);
      if (!load) {
        load = buildVehicleKit(vehicle).catch(() => null);
        models.set(vehicle, load);
      }
      return load;
    });
    let active = true;
    setPreview("loading");
    const draw = async () => {
      const loaded = await Promise.all(loads);
      if (!active || renderer.current !== gl) return;
      const scene = vehiclePreviewScene([-150, 100, -200]);

      const bounds = new THREE.Box3();
      const unavailable: number[] = [];
      for (const [i, car] of cars.entries()) {
        const kit = loaded[i];
        if (!kit) {
          unavailable.push(i);
          continue;
        }
        const model = kit.makeCar("middle", car.slot.reversed);
        // カメラの右方向が -X なので、車両の前方（+X）が画面左を向く。
        model.position.x = width / 2 - car.center;
        bounds.expandByObject(model);
        scene.add(model);
      }
      await Promise.all([...new Set(loaded)].map(kit => kit?.texturesReady()));
      if (!active || renderer.current !== gl) return;

      const bottom = bounds.isEmpty() ? -4 : Math.min(-4, bounds.min.y - 4);
      const middleY = bottom + VIEW_HEIGHT / 2;
      const camera = new THREE.OrthographicCamera(-width / 2, width / 2, VIEW_HEIGHT / 2, -VIEW_HEIGHT / 2, 0.1, 2000);
      camera.position.set(0, middleY, -1000);
      camera.lookAt(0, middleY, 0);
      // 長い編成でも一枚の描画に収まるようピクセル比を抑える。
      gl.setPixelRatio(Math.min(window.devicePixelRatio, 2, gl.capabilities.maxTextureSize / width));
      gl.setSize(width, VIEW_HEIGHT, false);
      gl.render(scene, camera);
      setMissing(unavailable);
      setPreview("ready");
    };
    void draw().catch(() => {
      if (active && renderer.current === gl) setPreview("unavailable");
    });
    return () => { active = false; };
  }, [cars, width]);

  const swap = (from: number, to: number) => {
    if (from > 0 && to > 0 && from !== to) onSwap(from, to);
    setSelected(null);
  };

  return (
    <div className="rtm-side-view">
      {slots.length > 2 && <p className="hint">2両目以降はドラッグするか、入れ替える2両を順に選択します。</p>}
      <div className="rtm-side-scroll">
        <div className="rtm-side-strip" style={{ width }} role="group" aria-label="編成の側面">
          <canvas ref={canvas} aria-hidden="true" style={{ height: VIEW_HEIGHT, visibility: preview === "ready" ? "visible" : "hidden" }} />
          {cars.map(({ slot, vehicle, width: carWidth }, i) => {
            const name = vehicle?.name ?? "未読込の車両";
            const contents = (
              <>
                <span className="rtm-side-image" style={{ height: VIEW_HEIGHT }}>
                  {(preview === "unavailable" || (preview === "ready" && missing.includes(i))) && "画像なし"}
                </span>
                <span className="rtm-side-name"><span aria-hidden="true">{slot.reversed ? "→" : "←"} </span>{i === 0 ? "先頭" : `${i + 1}両目`}・{name}</span>
              </>
            );
            if (i === 0) {
              return <div key={i} className="rtm-side-car" style={{ width: carWidth }} title={`${name}（先頭固定）`}>{contents}</div>;
            }
            return (
              <button
                key={i}
                type="button"
                className="rtm-side-car"
                style={{ width: carWidth }}
                disabled={disabled || slots.length < 3}
                aria-pressed={selectedIndex === i}
                aria-label={`${i + 1}両目 ${name}${slot.reversed ? "（逆向き）" : ""}`}
                title={name}
                draggable={!disabled && slots.length > 2}
                onClick={() => selectedIndex > 0 ? swap(selectedIndex, i) : setSelected(slot)}
                onDragStart={e => {
                  dragFrom.current = slot;
                  e.dataTransfer.setData("text/plain", name);
                  e.dataTransfer.effectAllowed = "move";
                  setSelected(slot);
                }}
                onDragEnd={() => { dragFrom.current = null; setSelected(null); }}
                onDragOver={e => {
                  if (!dragFrom.current || dragFrom.current === slot) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                }}
                onDrop={e => {
                  e.preventDefault();
                  if (dragFrom.current) swap(slots.indexOf(dragFrom.current), i);
                  dragFrom.current = null;
                }}
              >
                {contents}
              </button>
            );
          })}
        </div>
      </div>
      {preview === "loading" && <p className="hint" role="status">側面を描画中…</p>}
    </div>
  );
}
