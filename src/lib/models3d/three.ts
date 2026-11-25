// 読み込んだ 3D モデルを three.js の物体にする（走行の映像に置く・読み込んだときに寸法を測る）。

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { toCreasedNormals } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { parseModelFile, type ParsedModel } from "../rtm/model";
import { findFile } from "../rtm/pack";
import type { Model3d } from "./pack";
import type { PlacedModel } from "./placed";

/** 1つのモデルの三角形の上限（走行の映像が重くならないように） */
export const MAX_TRIANGLES = 400_000;

export type ModelKit = {
  id: string;
  /** モデルの寸法（モデルの単位。x=横, y=高さ, z=奥行き） */
  size: [number, number, number];
  /** 1つ分。底の中心が原点（横・奥行きは真ん中、高さは底が 0）。単位はモデルのまま */
  make(): THREE.Object3D;
  dispose(): void;
};

const dirOf = (p: string) => p.split("/").slice(0, -1).join("/");

async function loadTexture(data: Uint8Array, flipY: boolean): Promise<THREE.Texture | null> {
  if (typeof createImageBitmap === "undefined") return null;
  try {
    const bitmap = await createImageBitmap(new Blob([data as BlobPart]), flipY ? { imageOrientation: "flipY" } : undefined);
    const tex = new THREE.Texture(bitmap as unknown as HTMLImageElement);
    tex.flipY = false;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = 4;
    tex.needsUpdate = true;
    return tex;
  } catch {
    return null;
  }
}

function triangles(obj: THREE.Object3D): number {
  let n = 0;
  obj.traverse((o) => {
    const g = (o as THREE.Mesh).isMesh ? (o as THREE.Mesh).geometry : null;
    if (!g) return;
    n += (g.index ? g.index.count : (g.getAttribute("position")?.count ?? 0)) / 3;
  });
  return n;
}

/** glTF を読む。外部のファイル（.bin・テクスチャ）は、いっしょに読み込んだファイルから渡す */
async function loadGltf(model: Model3d, disposables: { dispose(): void }[]): Promise<THREE.Object3D> {
  const paths = Object.keys(model.files);
  const urls: string[] = [];
  const manager = new THREE.LoadingManager();
  manager.setURLModifier((url) => {
    if (/^(blob:|data:|https?:)/i.test(url)) return url;
    let u = url;
    try {
      u = decodeURIComponent(url);
    } catch {
      /* そのまま */
    }
    u = u.replace(/^\.\//, "");
    const dir = dirOf(model.main);
    const hit = findFile(paths, dir ? `${dir}/${u}` : u) ?? findFile(paths, u);
    if (!hit) return "data:,";
    const blob = URL.createObjectURL(new Blob([model.files[hit] as BlobPart]));
    urls.push(blob);
    return blob;
  });
  disposables.push({ dispose: () => urls.forEach((u) => URL.revokeObjectURL(u)) });
  const data = model.files[model.main];
  const input: ArrayBuffer | string = /\.glb$/i.test(model.main)
    ? (data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer)
    : new TextDecoder().decode(data);
  const gltf = await new Promise<{ scene: THREE.Object3D }>((resolve, reject) =>
    new GLTFLoader(manager).parse(input, "", resolve, (e) => reject(e instanceof Error ? e : new Error(String(e)))),
  );
  gltf.scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    disposables.push(mesh.geometry);
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      disposables.push(m);
      for (const v of Object.values(m)) if ((v as THREE.Texture)?.isTexture) disposables.push(v as THREE.Texture);
    }
  });
  return gltf.scene;
}

/** RTM の設置物・OBJ・Metasequoia を読む（RTM の車両と同じ読み方） */
async function loadMesh(model: Model3d, disposables: { dispose(): void }[]): Promise<THREE.Object3D> {
  const parsed: ParsedModel | null = await parseModelFile(model.main, model.files[model.main]);
  if (!parsed || parsed.parts.length === 0) throw new Error(`${model.name} のモデルに読める面がありません`);
  const group = new THREE.Group();
  const textures = new Map<string, Promise<THREE.Texture | null>>();
  const materials = new Map<string, THREE.MeshStandardMaterial>();
  const materialFor = (name: string) => {
    const tx =
      model.textures?.find((t) => t.material === name) ??
      (model.format === "obj" ? undefined : model.textures?.find((t) => t.material.toLowerCase() === "default") ?? model.textures?.[0]);
    const key = tx?.path ?? `color|${name}`;
    let mat = materials.get(key);
    if (mat) return mat;
    const kd = model.colors?.[name];
    mat = new THREE.MeshStandardMaterial({
      color: kd ? new THREE.Color(kd[0], kd[1], kd[2]) : 0xc8ccd2,
      roughness: 0.75,
      metalness: 0.02,
      side: THREE.DoubleSide,
      alphaTest: 0.1,
    });
    materials.set(key, mat);
    disposables.push(mat);
    const data = tx ? model.files[tx.path] : undefined;
    if (tx && data) {
      let p = textures.get(tx.path);
      if (!p) textures.set(tx.path, (p = loadTexture(data, false)));
      const m = mat;
      p.then((tex) => {
        if (!tex) return;
        disposables.push(tex);
        m.map = tex;
        m.color.set(0xffffff);
        m.needsUpdate = true;
      });
    }
    return mat;
  };
  for (const part of parsed.parts) {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(part.positions, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(part.uvs, 2));
    const creased = toCreasedNormals(g, Math.PI / 4);
    if (creased !== g) g.dispose();
    disposables.push(creased);
    const mesh = new THREE.Mesh(creased, materialFor(part.material));
    mesh.name = part.object;
    group.add(mesh);
  }
  return group;
}

function loadStl(model: Model3d, disposables: { dispose(): void }[]): THREE.Object3D {
  const data = model.files[model.main];
  const geometry = new STLLoader().parse(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer);
  geometry.rotateX(-Math.PI / 2); // STL の Z を高さにする
  geometry.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ color: 0xb9c0c8, roughness: 0.7, metalness: 0.05, side: THREE.DoubleSide });
  disposables.push(geometry, mat);
  return new THREE.Mesh(geometry, mat);
}

/** 読み込んだモデルから、映像に置く物体の型を作る（寸法も測る） */
export async function buildModelKit(model: Model3d): Promise<ModelKit> {
  const disposables: { dispose(): void }[] = [];
  const dispose = () => disposables.forEach((d) => d.dispose());
  try {
    const raw =
      model.format === "gltf" ? await loadGltf(model, disposables) : model.format === "stl" ? loadStl(model, disposables) : await loadMesh(model, disposables);
    if (triangles(raw) > MAX_TRIANGLES) throw new Error(`${model.name} は面が多すぎます（上限 ${MAX_TRIANGLES.toLocaleString()} 面）`);
    raw.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(raw);
    if (box.isEmpty()) throw new Error(`${model.name} のモデルに読める面がありません`);
    const s = box.getSize(new THREE.Vector3());
    if (!(s.x > 0 && s.y >= 0 && s.z > 0) || ![s.x, s.y, s.z].every(Number.isFinite)) throw new Error(`${model.name} のモデルの大きさがありません`);
    const c = box.getCenter(new THREE.Vector3());
    // 底の中心を原点にする
    const base = new THREE.Group();
    base.add(raw);
    raw.position.sub(new THREE.Vector3(c.x, box.min.y, c.z));
    return {
      id: model.id,
      size: [s.x, Math.max(s.y, 1e-6), s.z],
      make: () => base.clone(true),
      dispose,
    };
  } catch (e) {
    dispose();
    throw e;
  }
}

/**
 * 置いたモデル（PlacedModel）を映像に置く。座標は driveScene と同じ（x=ボードの X、z=ボードの Y、y=高さ、単位 mm）
 */
export function placeModel(kit: ModelKit, p: PlacedModel): THREE.Object3D {
  const obj = kit.make();
  const [sx, sy, sz] = kit.size;
  obj.scale.set(p.length / sx, p.height / sy, p.width / sz);
  const g = new THREE.Group();
  g.name = `model-${p.uid}`;
  g.add(obj);
  g.position.set(p.x, p.z ?? 0, p.y);
  g.rotation.y = (-p.rot * Math.PI) / 180;
  return g;
}

/**
 * レイアウトに置いたモデルを全部、映像に置く。この端末にないモデル・読めないモデルは飛ばして、名前を返す
 */
export async function buildPlacedModels(
  placed: PlacedModel[],
  models: Model3d[],
): Promise<{ group: THREE.Group; missing: string[]; dispose(): void }> {
  const group = new THREE.Group();
  group.name = "placed-models";
  const kits = new Map<string, ModelKit | null>();
  const missing = new Set<string>();
  for (const p of placed) {
    if (!kits.has(p.modelId)) {
      const m = models.find((x) => x.id === p.modelId);
      kits.set(p.modelId, m ? await buildModelKit(m).catch(() => null) : null);
    }
    const kit = kits.get(p.modelId);
    if (kit) group.add(placeModel(kit, p));
    else missing.add(p.name);
  }
  return {
    group,
    missing: [...missing],
    dispose: () => kits.forEach((k) => k?.dispose()),
  };
}
