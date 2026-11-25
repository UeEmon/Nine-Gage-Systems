// RealTrainMod の車両モデル（Metasequoia の .mqo / .mqoz と .obj）を読む。
//
// 出力は三角形のリスト。座標は RTM と同じ（単位 m、Y が上、+Z が車両の前）。
// UV は画像の左上を (0,0) とする向き（Minecraft と同じ。テクスチャは上下を反転せずに貼る）。

import { readZip } from "./zip";

export type ModelPart = {
  /** オブジェクト（グループ）の名前 */
  object: string;
  /** マテリアルの名前（車両パックの json の textures の1つ目と対応する） */
  material: string;
  /** 三角形の頂点（x,y,z の並び） */
  positions: number[];
  /** 頂点ごとの UV（u,v の並び） */
  uvs: number[];
};

export type ParsedModel = { parts: ModelPart[] };

/** モデルの範囲（m） */
export function modelBounds(model: ParsedModel): { min: [number, number, number]; max: [number, number, number] } | null {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const p of model.parts) {
    for (let i = 0; i < p.positions.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        const v = p.positions[i + k];
        if (v < min[k]) min[k] = v;
        if (v > max[k]) max[k] = v;
      }
    }
  }
  return Number.isFinite(min[0]) ? { min, max } : null;
}

/** テキストファイルのバイト列を文字列に（UTF-8 でなければ Shift_JIS） */
export function decodeText(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^﻿/, "");
  } catch {
    return new TextDecoder("shift_jis").decode(bytes);
  }
}

/** オブジェクトとマテリアルの組ごとに三角形をまとめる */
function collector() {
  const parts = new Map<string, ModelPart>();
  return {
    part(object: string, material: string): ModelPart {
      const key = `${object}\u0000${material}`;
      let p = parts.get(key);
      if (!p) {
        p = { object, material, positions: [], uvs: [] };
        parts.set(key, p);
      }
      return p;
    },
    result(): ParsedModel {
      return { parts: [...parts.values()].filter((p) => p.positions.length > 0) };
    },
  };
}

const inParens = (line: string, key: string): string[] | null => {
  const m = new RegExp(`(?:^|\\s)${key}\\(([^)]*)\\)`).exec(line);
  return m ? m[1].trim().split(/\s+/).filter(Boolean) : null;
};

/**
 * Metasequoia（.mqo）を読む。座標は cm なので m に直す（RTM と同じ）。
 * 左右対称（ミラー）のオブジェクトは、反対側の面も作る
 */
export function parseMqo(text: string): ParsedModel {
  const out = collector();
  const lines = text.split(/\r?\n/);
  const materials: string[] = [];
  let i = 0;
  const next = () => lines[i++]?.trim() ?? "";
  while (i < lines.length) {
    const line = next();
    if (/^Material\s+\d+\s*\{/.test(line)) {
      while (i < lines.length) {
        const l = next();
        if (l.startsWith("}")) break;
        const m = /^"([^"]*)"/.exec(l);
        if (m) materials.push(m[1]);
      }
    } else if (/^Object\s+"/.test(line)) {
      const name = /^Object\s+"([^"]*)"/.exec(line)?.[1] ?? "Default";
      let mirrorAxis = 0;
      let mirror = false;
      let verts: number[][] = [];
      // オブジェクトの中のチャンク（vertex, face など）を読む
      let depth = 1;
      while (i < lines.length && depth > 0) {
        const l = next();
        if (/^mirror\s+/.test(l)) mirror = Number(l.split(/\s+/)[1]) > 0;
        else if (/^mirror_axis\s+/.test(l)) mirrorAxis = Number(l.split(/\s+/)[1]) || 0;
        else if (/^vertex\s+\d+\s*\{/.test(l)) {
          verts = [];
          while (i < lines.length) {
            const v = next();
            if (v.startsWith("}")) break;
            const n = v.split(/\s+/).map(Number);
            if (n.length >= 3 && n.every(Number.isFinite)) verts.push([n[0] * 0.01, n[1] * 0.01, n[2] * 0.01]);
          }
        } else if (/^face\s+\d+\s*\{/.test(l)) {
          // RTM は mirror_axis の行があれば反転する。軸は 1=X, 2=Y, 4=Z（組み合わせも反転する）
          const axes = mirror || mirrorAxis ? [1, 2, 4].filter((a) => (mirrorAxis || 1) & a) : [];
          while (i < lines.length) {
            const f = next();
            if (f.startsWith("}")) break;
            const n = Number(f.split(/\s+/)[0]);
            const idx = inParens(f, "V")?.map(Number);
            if (!idx || n < 3 || idx.length < n || idx.some((x) => !(x >= 0 && x < verts.length))) continue;
            const mi = Number(inParens(f, "M")?.[0] ?? 0);
            const uv = inParens(f, "UV")?.map(Number) ?? [];
            const part = out.part(name, materials[mi] ?? "");
            const emit = (sign: [number, number, number], reverse: boolean) => {
              // メタセコイアは時計回りなので逆順に、扇形に三角形へ分ける
              const order = Array.from({ length: n }, (_, k) => k).reverse();
              if (reverse) order.reverse();
              for (let t = 1; t < n - 1; t++) {
                for (const k of [order[0], order[t], order[t + 1]]) {
                  const v = verts[idx[k]];
                  part.positions.push(v[0] * sign[0], v[1] * sign[1], v[2] * sign[2]);
                  part.uvs.push(uv[k * 2] ?? 0, uv[k * 2 + 1] ?? 0);
                }
              }
            };
            emit([1, 1, 1], false);
            let flips = 0;
            const sign: [number, number, number] = [1, 1, 1];
            for (const a of axes) {
              sign[a === 1 ? 0 : a === 2 ? 1 : 2] = -1;
              flips++;
            }
            if (flips > 0) emit(sign, flips % 2 === 1);
          }
        } else if (/\{\s*$/.test(l)) {
          // 読まないチャンク（vertexattr など）は飛ばす
          let d = 1;
          while (i < lines.length && d > 0) {
            const s = next();
            if (/\{\s*$/.test(s)) d++;
            else if (s.startsWith("}")) d--;
          }
        } else if (l.startsWith("}")) depth--;
      }
    }
  }
  return out.result();
}

/** Wavefront OBJ を読む。座標は m のまま。UV の v は上下を反転する（RTM と同じ） */
export function parseObj(text: string): ParsedModel {
  const out = collector();
  const v: number[][] = [];
  const vt: number[][] = [];
  let object = "Default";
  let material = "";
  const index = (s: string, len: number) => {
    const n = Number(s);
    return n < 0 ? len + n : n - 1;
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("v ")) v.push(line.slice(2).trim().split(/\s+/).map(Number));
    else if (line.startsWith("vt ")) {
      const t = line.slice(3).trim().split(/\s+/).map(Number);
      vt.push([t[0] || 0, 1 - (t[1] || 0)]);
    } else if (line.startsWith("usemtl ")) material = line.slice(7).trim();
    else if (line.startsWith("o ") || line.startsWith("g ")) object = line.slice(2).trim() || "Default";
    else if (line.startsWith("f ")) {
      const corners = line.slice(2).trim().split(/\s+/).map((c) => {
        const [a, b] = c.split("/");
        return { p: v[index(a, v.length)], t: b ? vt[index(b, vt.length)] : undefined };
      });
      if (corners.length < 3 || corners.some((c) => !c.p || c.p.length < 3)) continue;
      const part = out.part(object, material);
      for (let k = 1; k < corners.length - 1; k++) {
        for (const c of [corners[0], corners[k], corners[k + 1]]) {
          part.positions.push(c.p[0], c.p[1], c.p[2]);
          part.uvs.push(c.t?.[0] ?? 0, c.t?.[1] ?? 0);
        }
      }
    }
  }
  return out.result();
}

/** ファイル名の拡張子で形式を選んで読む。暗号化された形式（.npm）や未対応の形式は null */
export async function parseModelFile(name: string, data: Uint8Array): Promise<ParsedModel | null> {
  const ext = name.toLowerCase().split(".").pop();
  if (ext === "mqo") return parseMqo(decodeText(data));
  if (ext === "obj") return parseObj(decodeText(data));
  if (ext === "mqoz") {
    const [inner] = await readZip(data, (p) => p.toLowerCase().endsWith(".mqo"));
    return inner ? parseMqo(decodeText(inner.data)) : null;
  }
  return null;
}

export const SUPPORTED_MODEL = /\.(mqo|mqoz|obj)$/i;
