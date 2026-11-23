import { STLLoader } from "three/addons/loaders/STLLoader.js";

export const MODEL_MAX_BYTES = 256 * 1024;
export type UploadedModel = { format: "stl"; data: string };

export function isUploadedModel(v: unknown): v is UploadedModel {
  const m = v as UploadedModel;
  return !!m && m.format === "stl" && typeof m.data === "string" && m.data.length > 0 &&
    m.data.length <= Math.ceil(MODEL_MAX_BYTES / 3) * 4 && m.data.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(m.data);
}

/** STL は外部ファイルを参照しない。割り当て前にサイズと面数を検査する。 */
export function parseStl(buffer: ArrayBuffer) {
  if (!buffer.byteLength || buffer.byteLength > MODEL_MAX_BYTES) throw new Error("STL は256KB以下にしてください。");
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

export function modelGeometry(model: UploadedModel) {
  if (!isUploadedModel(model)) throw new Error("3Dモデルの保存データが不正です。");
  const bytes = Uint8Array.from(atob(model.data), (c) => c.charCodeAt(0));
  return parseStl(bytes.buffer);
}
