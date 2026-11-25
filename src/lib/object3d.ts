// 「仮オブジェクト・3Dモデル」でアップロードした 3D モデル（STL・glTF の .glb・OBJ）。
// モデルの中身はレイアウトに base64 で保存する（共有したレイアウトでも同じモデルが見える）。

import * as THREE from "three";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { toCreasedNormals } from "three/addons/utils/BufferGeometryUtils.js";
import { decodeText, parseObj } from "./rtm/model";

/** 実物 1m → 模型の mm（1/150） */
const MM_PER_M = 1000 / 150;

export const MODEL_MAX_BYTES = 512 * 1024;
/** OBJ の .mtl（色だけ使う）の上限 */
export const MTL_MAX_BYTES = 64 * 1024;
export const MODEL_FORMATS = ["stl", "glb", "obj"] as const;
export type UploadedModelFormat = (typeof MODEL_FORMATS)[number];
export type UploadedModel = {
  format: UploadedModelFormat;
  /** ファイルの中身（base64） */
  data: string;
  /** OBJ のときの .mtl（テキスト。色だけ使う） */
  mtl?: string;
};

const isBase64 = (s: string, maxBytes: number) =>
  s.length > 0 && s.length <= Math.ceil(maxBytes / 3) * 4 && s.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(s);

export function isUploadedModel(v: unknown): v is UploadedModel {
  const m = v as UploadedModel;
  return (
    !!m &&
    (MODEL_FORMATS as readonly string[]).includes(m.format) &&
    typeof m.data === "string" &&
    isBase64(m.data, MODEL_MAX_BYTES) &&
    (m.mtl === undefined || (m.format === "obj" && typeof m.mtl === "string" && m.mtl.length <= MTL_MAX_BYTES))
  );
}

/** ファイル名から形式を決める（対応していなければ null） */
export function modelFormatOf(name: string): UploadedModelFormat | null {
  const ext = name.toLowerCase().split(".").pop();
  return ext === "stl" ? "stl" : ext === "glb" ? "glb" : ext === "obj" ? "obj" : null;
}

/** STL は外部ファイルを参照しない。割り当て前にサイズと面数を検査する。 */
export function parseStl(buffer: ArrayBuffer) {
  if (!buffer.byteLength || buffer.byteLength > MODEL_MAX_BYTES) throw new Error("STL は512KB以下にしてください。");
  const count = buffer.byteLength >= 84 ? new DataView(buffer).getUint32(80, true) : 0;
  const binary = 84 + count * 50 === buffer.byteLength;
  const text = binary ? "" : new TextDecoder().decode(buffer);
  if (!binary && !text.startsWith("solid")) throw new Error("STLのヘッダーまたはファイルサイズが不正です。");
  if (binary ? count > 20000 : (text.match(/\bvertex\b/g)?.length ?? 0) > 60000) {
    throw new Error("モデルの面数が多すぎます（上限20,000面）。");
  }
  const geometry = new STLLoader().parse(buffer);
  const pos = geometry.getAttribute("position");
  if (!pos || pos.count < 3 || pos.count % 3 || !Array.from(pos.array).every(Number.isFinite)) {
    geometry.dispose();
    throw new Error("有効な三角形を持つSTLを選んでください。");
  }
  geometry.rotateX(-Math.PI / 2); // STL の Z を高さにする
  geometry.computeBoundingBox();
  const b = geometry.boundingBox!;
  if (b.max.x - b.min.x <= 0 || b.max.y - b.min.y <= 0 || b.max.z - b.min.z <= 0) {
    geometry.dispose();
    throw new Error("長さ・幅・高さのある立体モデルを選んでください。");
  }
  geometry.translate(-(b.max.x + b.min.x) / 2, -b.min.y, -(b.max.z + b.min.z) / 2);
  geometry.computeBoundingBox();
  return geometry;
}

const bytesOf = (model: UploadedModel) => Uint8Array.from(atob(model.data), (c) => c.charCodeAt(0));

export function modelGeometry(model: UploadedModel) {
  if (!isUploadedModel(model) || model.format !== "stl") throw new Error("3Dモデルの保存データが不正です。");
  return parseStl(bytesOf(model).buffer);
}

/** .mtl の Kd（色） */
export function mtlColors(text: string): Record<string, [number, number, number]> {
  const out: Record<string, [number, number, number]> = {};
  let cur = "";
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("newmtl ")) cur = line.slice(7).trim();
    else if (cur && /^Kd\s/.test(line)) {
      const n = line.split(/\s+/).slice(1, 4).map(Number);
      if (n.length === 3 && n.every((x) => Number.isFinite(x) && x >= 0 && x <= 1)) out[cur] = [n[0], n[1], n[2]];
    }
  }
  return out;
}

/** 1つのモデルの三角形の上限 */
const MAX_TRIANGLES = 100_000;
const GREY = 0x9ea8b5;

export type ModelObject = {
  /** 底の中心が原点（横・奥行きは真ん中、高さは底が 0）。単位はモデルのまま */
  object: THREE.Object3D;
  /** 寸法（モデルの単位。x=横, y=高さ, z=奥行き） */
  size: [number, number, number];
  dispose(): void;
};

function triangles(obj: THREE.Object3D): number {
  let n = 0;
  obj.traverse((o) => {
    const g = (o as THREE.Mesh).isMesh ? (o as THREE.Mesh).geometry : null;
    if (g) n += (g.index ? g.index.count : (g.getAttribute("position")?.count ?? 0)) / 3;
  });
  return n;
}

async function loadGlb(bytes: Uint8Array, disposables: { dispose(): void }[]): Promise<THREE.Object3D> {
  const head = new TextDecoder().decode(bytes.subarray(0, Math.min(bytes.length, 200000)));
  if (head.includes("KHR_draco_mesh_compression") || head.includes("EXT_meshopt_compression")) {
    throw new Error("圧縮された glTF（Draco・meshopt）には対応していません。圧縮しないで書き出してください。");
  }
  if (new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, true) !== 0x46546c67) {
    throw new Error("glTF は1つのファイルにまとめた .glb を選んでください。");
  }
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const gltf = await new Promise<{ scene: THREE.Object3D }>((resolve, reject) =>
    new GLTFLoader().parse(buf, "", resolve, (e) => reject(e instanceof Error ? e : new Error(String(e)))),
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

function loadObj(bytes: Uint8Array, mtl: string | undefined, disposables: { dispose(): void }[]): THREE.Object3D {
  const parsed = parseObj(decodeText(bytes));
  const colors = mtl ? mtlColors(mtl) : {};
  const group = new THREE.Group();
  const mats = new Map<string, THREE.Material>();
  for (const part of parsed.parts) {
    let mat = mats.get(part.material);
    if (!mat) {
      const kd = colors[part.material];
      mat = new THREE.MeshStandardMaterial({ color: kd ? new THREE.Color(kd[0], kd[1], kd[2]) : GREY, roughness: 0.8, side: THREE.DoubleSide });
      mats.set(part.material, mat);
      disposables.push(mat);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(part.positions, 3));
    const creased = toCreasedNormals(g, Math.PI / 4);
    if (creased !== g) g.dispose();
    disposables.push(creased);
    group.add(new THREE.Mesh(creased, mat));
  }
  return group;
}

/** 保存したモデルを three.js の物体にする（どの形式でも、底の中心を原点にして寸法を返す） */
export async function loadModelObject(model: UploadedModel): Promise<ModelObject> {
  if (!isUploadedModel(model)) throw new Error("3Dモデルの保存データが不正です。");
  const disposables: { dispose(): void }[] = [];
  const dispose = () => disposables.forEach((d) => d.dispose());
  try {
    let raw: THREE.Object3D;
    if (model.format === "stl") {
      const g = parseStl(bytesOf(model).buffer);
      g.computeVertexNormals();
      const mat = new THREE.MeshStandardMaterial({ color: GREY, roughness: 0.8, side: THREE.DoubleSide });
      disposables.push(g, mat);
      raw = new THREE.Mesh(g, mat);
    } else if (model.format === "glb") raw = await loadGlb(bytesOf(model), disposables);
    else raw = loadObj(bytesOf(model), model.mtl, disposables);
    if (triangles(raw) > MAX_TRIANGLES) throw new Error(`モデルの面数が多すぎます（上限${MAX_TRIANGLES.toLocaleString()}面）。`);
    raw.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(raw);
    const s = box.getSize(new THREE.Vector3());
    if (box.isEmpty() || !(s.x > 0 && s.y > 0 && s.z > 0)) throw new Error("長さ・幅・高さのある立体モデルを選んでください。");
    const c = box.getCenter(new THREE.Vector3());
    raw.position.sub(new THREE.Vector3(c.x, box.min.y, c.z));
    const object = new THREE.Group();
    object.add(raw);
    return { object, size: [s.x, s.y, s.z], dispose };
  } catch (e) {
    dispose();
    throw e;
  }
}

/**
 * 置くときの大きさ(mm)。STL はいちばん長い辺を 100mm にする（今までどおり）。
 * glTF・OBJ は実物の m で作られていることが多いので 1/150 にし、小さすぎる・大きすぎるときは最長辺を 100mm にする
 */
export function initialSizeMm(format: UploadedModelFormat, [x, y, z]: [number, number, number]) {
  const longest = Math.max(x, y, z);
  let k = format === "stl" ? 100 / longest : MM_PER_M;
  if (format !== "stl" && !(longest * k >= 3 && longest * k <= 1500)) k = 100 / longest;
  const r = (v: number) => Math.max(0.1, Math.round(v * k * 10) / 10);
  return { length: r(x), height: r(y), width: r(z) };
}
