// 読み込んだ RealTrainMod の車両を、走行の映像（three.js）の車両にする。
//
// 縮尺は実物の 1/150。車両の長さは車両ごとに違うので、運行計画の「編成の長さ」やホームに収まる両数も
// その車両の長さ（pack.ts の carSizeOf）で計算し、映像の車両の置き方（carPlacements）と合わせる。

import * as THREE from "three";
import { toCreasedNormals } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { modelBounds, parseModelFile, type ParsedModel } from "./model";
import { MM_PER_M, type RtmModelSource, type RtmTexture, type RtmVehicle } from "./pack";

export { MM_PER_M };

export type CarRole = "front" | "middle" | "rear" | "single";

export type VehicleKit = {
  id: string;
  /** 1両分。+X が前、原点は車体の中心のレール面の高さ（buildTrain の車両と同じ） */
  makeCar(role: CarRole, reversed?: boolean): THREE.Group;
  /** makeCar で使い始めたテクスチャを待つ（静止画の描画用） */
  texturesReady(): Promise<void>;
  dispose(): void;
};

/** 車両パックのモデルをプレビュー用の照明で照らす */
export function vehiclePreviewScene(lightPosition: [number, number, number]): THREE.Scene {
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0xd7dbe3, 2.4));
  const keyLight = new THREE.DirectionalLight(0xffffff, 2);
  keyLight.position.set(...lightPosition);
  scene.add(keyLight);
  return scene;
}

/**
 * 台車の幅の倍率。RTM の台車は実物の線路幅（1067mm）に合わせて作られているが、Nゲージの線路は 9mm
 * （1067mm の 1/150 = 7.1mm より広い）。製品のNゲージと同じく、車体は 1/150 のまま台車の幅だけ広げて、
 * 車輪がレールの上に乗るようにする
 */
export const BOGIE_GAUGE_FIT = 9 / (1.067 * MM_PER_M);

/** RTM の車両の、台車の上面（y=0）からレール面までの深さ(m) */
const RTM_RAIL_DEPTH_M = 1.04;


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
  // 長さも実物の 1/150（編成の長さは carSizeOf で車両ごとに計算する）
  const lengthScale = scale;
  let offsetY = 0;
  const bb = bogie ? modelBounds(bogie) : null;
  if (bb) {
    // 台車の車輪の下をレール面にする
    const bottom = (bogiePos[0]?.[1] ?? 0) / unit + bb.min[1];
    if (Math.abs(bottom * unit) < 1.5) offsetY = -bottom;
  } else {
    // 台車がないときは RTM の標準（台車の上面が y=0、レール面は約 1.04m 下）とする
    offsetY = RTM_RAIL_DEPTH_M / unit;
    if (b && (b.min[1] * unit < -2.5 || b.min[1] * unit > 1)) offsetY = (0.3 - b.min[1] * unit) / unit;
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

/** 前照灯・尾灯のテクスチャ（[消灯, 前照灯, 尾灯]）のどれを使うか。先頭は前照灯、最後尾は尾灯、中間は消灯 */
export function lightIndex(role: CarRole): number {
  return role === "rear" ? 2 : role === "middle" ? 0 : 1;
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
    tex.addEventListener("dispose", () => bitmap.close());
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
  const withTexture = (mat: THREE.MeshStandardMaterial | THREE.MeshBasicMaterial, path: string | null | undefined, showWhenLoaded: boolean) => {
    if (!path) return;
    texture(path).then((tex) => {
      if (!tex || disposed) return;
      mat.map = tex;
      mat.color.set(0xffffff);
      if (showWhenLoaded) mat.visible = true;
      mat.needsUpdate = true;
    });
  };
  /** 車体の色（RTM と同じく、透明な所は描かない。AlphaBlend も RTM ではまず不透明に描くので同じ扱い） */
  const materialFor = (tx: RtmTexture | null): THREE.Material => {
    const key = `body|${tx?.path ?? ""}`;
    let m = materials.get(key);
    if (!m) {
      const mat = new THREE.MeshStandardMaterial({ color: 0xb8bcc2, roughness: 0.55, metalness: 0.05, side: THREE.DoubleSide, alphaTest: 0.1 });
      withTexture(mat, tx?.path, false);
      materials.set(key, (m = mat));
      disposables.push(mat);
    }
    return m;
  };
  /** 前照灯・尾灯（Light）のテクスチャを、明るさに関係なく光らせて車体に重ねる */
  const lightMaterialFor = (tx: RtmTexture | null, role: CarRole): THREE.Material | null => {
    const lights = tx?.lights;
    if (!lights) return null;
    const path = lights[lightIndex(role)] ?? lights[0];
    if (!path) return null;
    const key = `light|${path}`;
    let m = materials.get(key);
    if (!m) {
      const mat = new THREE.MeshBasicMaterial({
        side: THREE.DoubleSide, alphaTest: 0.1, visible: false,
        polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
      });
      withTexture(mat, path, true);
      materials.set(key, (m = mat));
      disposables.push(mat);
    }
    return m;
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
      const tx = textureFor(src, part.material);
      const mesh = new THREE.Mesh(geo, materialFor(tx));
      mesh.name = part.object;
      g.add(mesh);
      const light = lightMaterialFor(tx, role);
      if (light) {
        const lit = new THREE.Mesh(geo, light);
        lit.name = `${part.object}-light`;
        g.add(lit);
      }
    });
    return g;
  };
  // 台車のモデルがパックにないとき（ほかのパックの台車を使う車両）の簡易な台車
  const simpleBogieGeo = new THREE.BoxGeometry(2.2, 0.9, 2.8);
  const simpleBogieMat = new THREE.MeshStandardMaterial({ color: 0x30343a, roughness: 0.7 });
  disposables.push(simpleBogieGeo, simpleBogieMat);

  return {
    id: vehicle.id,
    async texturesReady() {
      await Promise.all(textures.values());
    },
    makeCar(role, reversed = role === "rear") {
      const car = new THREE.Group();
      car.name = `rtm-${vehicle.id}`;
      // RTM のモデルは +Z が前・単位は m。+X が前・単位 mm の車両にする
      const turn = new THREE.Group();
      turn.rotation.y = (vehicle.flip ? -Math.PI / 2 : Math.PI / 2) + (reversed ? Math.PI : 0);
      const model = new THREE.Group();
      model.scale.set(t.scale, t.scale, t.lengthScale);
      model.position.y = t.offsetY * t.scale;
      model.add(meshes(body, config.body, role, "rtm-body"));
      [bogieFront, bogieBack].forEach((bogie, i) => {
        const src = config.bogies[i];
        const pos = config.bogiePos[i];
        if (!pos) return;
        if (!bogie || !src) {
          const simple = new THREE.Mesh(simpleBogieGeo, simpleBogieMat);
          simple.name = "rtm-simple-bogie";
          simple.position.set(pos[0] / t.unit, (pos[1] - RTM_RAIL_DEPTH_M + 0.45) / t.unit, pos[2] / t.unit);
          simple.scale.set(BOGIE_GAUGE_FIT / t.unit, 1 / t.unit, t.scale / t.lengthScale / t.unit);
          model.add(simple);
          return;
        }
        const b = meshes(bogie, src, role, "rtm-bogie");
        // 台車の形は縮めず、置く位置だけ車体の長さに合わせる
        b.position.set(pos[0] / t.unit, pos[1] / t.unit, pos[2] / t.unit);
        b.scale.z = t.scale / t.lengthScale;
        b.scale.x = BOGIE_GAUGE_FIT;
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

export type RtmKits = { front: VehicleKit; middle?: VehicleKit; sequence?: { kit: VehicleKit; reversed: boolean }[] };
