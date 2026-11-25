// 読み込んだ RealTrainMod の車両を、走行の映像（three.js）の車両にする。
//
// 縮尺: 幅と高さは実物の 1/150。長さは、連結面の間（RTM の trainDistance の2倍）が
// SenroLab の1両分（N_CAR の全長 + 連結のすきま）になるように合わせる。
// こうすると、運行計画の「編成の長さ」やホームに収まる両数の計算と映像の車両がずれない。

import * as THREE from "three";
import { toCreasedNormals } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { N_CAR } from "../drive";
import { modelBounds, parseModelFile, type ParsedModel } from "./model";
import type { RtmModelSource, RtmTexture, RtmVehicle } from "./pack";

export type CarRole = "front" | "middle" | "rear" | "single";

export type VehicleKit = {
  id: string;
  /** 1両分。+X が前、原点は車体の中心のレール面の高さ（buildTrain の車両と同じ） */
  makeCar(role: CarRole): THREE.Group;
  dispose(): void;
};

/** 実物 1m → 模型の mm（1/150） */
export const MM_PER_M = 1000 / 150;

export type KitTransform = {
  /** 幅・高さの倍率（モデルの単位 → mm） */
  scale: number;
  /** 長さの倍率（モデルの単位 → mm） */
  lengthScale: number;
  /** モデルの y に足してレール面を 0 にする量（モデルの単位） */
  offsetY: number;
  /** モデルの単位 → m（ふつうは 1） */
  unit: number;
};

/** モデルの寸法から、模型の車両に合わせる倍率と高さを決める */
export function kitTransform(vehicle: Pick<RtmVehicle, "config">, body: ParsedModel, bogie: ParsedModel | null): KitTransform {
  const { trainDistance, bogiePos } = vehicle.config;
  const pitchM = trainDistance * 2;
  const b = modelBounds(body);
  // 単位が m でない（cm で書き出した obj など）ときは、車体の長さを trainDistance に合わせる
  let unit = 1;
  if (b) {
    const len = b.max[2] - b.min[2];
    if (len > 0 && (len / pitchM > 3 || len / pitchM < 1 / 3)) unit = (pitchM * 0.97) / len;
  }
  const scale = MM_PER_M * unit;
  const lengthScale = ((N_CAR.length + N_CAR.gap) / pitchM) * unit;
  let offsetY = 0;
  const bb = bogie ? modelBounds(bogie) : null;
  if (bb) {
    // 台車の車輪の下をレール面にする
    const bottom = (bogiePos[0]?.[1] ?? 0) / unit + bb.min[1];
    if (Math.abs(bottom * unit) < 1.5) offsetY = -bottom;
  } else if (b) {
    const bottom = b.min[1] * unit;
    if (bottom < -0.2 || bottom > 1.5) offsetY = (0.3 - bottom) / unit;
  }
  return { scale, lengthScale, offsetY, unit };
}

/** マテリアル名に合うテクスチャ（なければ default、それもなければ最初のもの） */
export function textureFor(src: RtmModelSource, material: string): RtmTexture | null {
  return (
    src.textures.find((t) => t.material === material) ??
    src.textures.find((t) => t.material.toLowerCase() === "default") ??
    src.textures[0] ??
    null
  );
}

/** 前照灯・尾灯のテクスチャを、車両の位置に合わせて選ぶ（先頭は前照灯、最後尾は尾灯、中間は消灯） */
export function lightTexturePath(files: Record<string, unknown>, path: string, role: CarRole): string {
  const digit = role === "rear" ? "2" : role === "middle" ? "0" : "1";
  const m = /^(.*?)(\.[^./]+)$/.exec(path);
  if (!m) return path;
  const stems = [m[1], m[1].replace(/[012]$/, "")];
  for (const stem of stems) {
    const p = `${stem}${digit}${m[2]}`;
    if (p in files) return p;
  }
  return path;
}

async function loadTexture(data: Uint8Array): Promise<THREE.Texture | null> {
  if (typeof createImageBitmap === "undefined") return null;
  try {
    const bitmap = await createImageBitmap(new Blob([data as BlobPart]));
    const tex = new THREE.Texture(bitmap as unknown as HTMLImageElement);
    // RTM の UV は画像の左上が原点。ImageBitmap は上下を反転せずに送られる
    tex.flipY = false;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    tex.needsUpdate = true;
    return tex;
  } catch {
    return null;
  }
}

function geometryOf(part: ParsedModel["parts"][number]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(part.positions, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(part.uvs, 2));
  // 角は立て、丸い屋根などはなめらかに見せる
  const creased = toCreasedNormals(g, Math.PI / 4);
  if (creased !== g) g.dispose();
  return creased;
}

/** 車両パックの車両から、映像に置く車両の型を作る（テクスチャは後から読み込まれて貼られる） */
export async function buildVehicleKit(vehicle: RtmVehicle): Promise<VehicleKit> {
  const { config, files } = vehicle;
  const load = async (src: RtmModelSource | null) => {
    if (!src) return null;
    const data = files[src.modelFile];
    return data ? parseModelFile(src.modelFile, data) : null;
  };
  const body = await load(config.body);
  if (!body || body.parts.length === 0) throw new Error(`${vehicle.name} の車体のモデルを読めませんでした`);
  const bogieFront = await load(config.bogies[0]);
  const bogieBack = config.bogies[1] === config.bogies[0] ? bogieFront : await load(config.bogies[1]);
  const t = kitTransform(vehicle, body, bogieFront ?? bogieBack);

  const disposables: { dispose(): void }[] = [];
  let disposed = false;
  const textures = new Map<string, Promise<THREE.Texture | null>>();
  const texture = (path: string) => {
    let p = textures.get(path);
    if (!p) {
      const data = files[path];
      p = data ? loadTexture(data) : Promise.resolve(null);
      p.then((tex) => {
        if (!tex) return;
        if (disposed) tex.dispose();
        else disposables.push(tex);
      });
      textures.set(path, p);
    }
    return p;
  };
  const materials = new Map<string, THREE.Material>();
  const materialFor = (tx: RtmTexture | null, role: CarRole): THREE.Material => {
    const light = !!tx && /light/i.test(tx.option);
    const path = tx ? (light ? lightTexturePath(files, tx.path, role) : tx.path) : "";
    const key = `${path}|${tx?.option ?? ""}`;
    let m = materials.get(key);
    if (m) return m;
    const alpha = !!tx && /alpha/i.test(tx.option);
    const mat: THREE.MeshBasicMaterial | THREE.MeshStandardMaterial = light
      ? new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, visible: false })
      : new THREE.MeshStandardMaterial({
          color: 0xb8bcc2,
          roughness: 0.55,
          metalness: 0.05,
          side: THREE.DoubleSide,
          ...(alpha ? { transparent: true, depthWrite: false } : { alphaTest: 0.1 }),
        });
    m = mat;
    materials.set(key, mat);
    disposables.push(mat);
    if (path) {
      texture(path).then((tex) => {
        if (!tex || disposed) return;
        mat.map = tex;
        mat.color.set(0xffffff);
        mat.visible = true;
        mat.needsUpdate = true;
      });
    }
    return mat;
  };
  const geometries = new Map<ParsedModel, THREE.BufferGeometry[]>();
  const geometriesOf = (model: ParsedModel) => {
    let gs = geometries.get(model);
    if (!gs) {
      gs = model.parts.map(geometryOf);
      disposables.push(...gs);
      geometries.set(model, gs);
    }
    return gs;
  };
  const meshes = (model: ParsedModel, src: RtmModelSource, role: CarRole, name: string) => {
    const g = new THREE.Group();
    g.name = name;
    geometriesOf(model).forEach((geo, i) => {
      const part = model.parts[i];
      const mesh = new THREE.Mesh(geo, materialFor(textureFor(src, part.material), role));
      mesh.name = part.object;
      g.add(mesh);
    });
    return g;
  };

  return {
    id: vehicle.id,
    makeCar(role) {
      const car = new THREE.Group();
      car.name = `rtm-${vehicle.id}`;
      // RTM のモデルは +Z が前・単位は m。+X が前・単位 mm の車両にする
      const turn = new THREE.Group();
      turn.rotation.y = (vehicle.flip ? -Math.PI / 2 : Math.PI / 2) + (role === "rear" ? Math.PI : 0);
      const model = new THREE.Group();
      model.scale.set(t.scale, t.scale, t.lengthScale);
      model.position.y = t.offsetY * t.scale;
      model.add(meshes(body, config.body, role, "rtm-body"));
      [bogieFront, bogieBack].forEach((bogie, i) => {
        const src = config.bogies[i];
        const pos = config.bogiePos[i];
        if (!bogie || !src || !pos) return;
        const b = meshes(bogie, src, role, "rtm-bogie");
        // 台車の形は縮めず、置く位置だけ車体の長さに合わせる
        b.position.set(pos[0] / t.unit, pos[1] / t.unit, pos[2] / t.unit);
        b.scale.z = t.scale / t.lengthScale;
        if (i === 1) b.rotation.y = Math.PI;
        model.add(b);
      });
      turn.add(model);
      car.add(turn);
      return car;
    },
    dispose() {
      disposed = true;
      for (const d of disposables) d.dispose();
    },
  };
}
