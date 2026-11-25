// RealTrainMod の車両以外の 3D モデル（建物・設備などの置物）を、選んだファイルから取り出す。
//
// 対応する形式：
// - RealTrainMod の設置物パック（ModelOrnament・ModelMachine・ModelSignal・ModelContainer などの json と .mqo / .mqoz / .obj）
// - glTF（.glb / .gltf と、.gltf が参照する .bin・テクスチャ）
// - Wavefront OBJ（.obj と .mtl・テクスチャ）、Metasequoia（.mqo / .mqoz）、STL
//
// モデルは作者ごとに利用条件が違うので、SenroLab には同梱しない。ブラウザの中だけで読み、IndexedDB に保存する（サーバーには送らない）。
// レイアウトに保存するのは、置いた位置・向き・大きさとモデルの ID だけ（PlacedModel）。

import { decodeText, SUPPORTED_MODEL } from "../rtm/model";
import { findFile, MM_PER_M, parseLenientJson, parseTrainConfig, type RtmTexture } from "../rtm/pack";
import { readZip, type ZipEntry } from "../rtm/zip";

export type ModelFormat = "rtm" | "gltf" | "obj" | "mqo" | "stl";

export const FORMAT_LABELS: Record<ModelFormat, string> = {
  rtm: "RealTrainMod の設置物",
  gltf: "glTF",
  obj: "OBJ",
  mqo: "Metasequoia",
  stl: "STL",
};

/** 読み込んだ 3D モデル。ブラウザ（IndexedDB）に保存する */
export type Model3d = {
  /** 形式・ファイル・名前から決まる ID（同じファイルを別の端末で読んでも同じになる） */
  id: string;
  name: string;
  /** 読み込んだファイルの名前 */
  source: string;
  format: ModelFormat;
  /** モデル本体のファイル（files の中のパス） */
  main: string;
  /** マテリアル名 → テクスチャ（RTM の json・OBJ の .mtl から） */
  textures?: RtmTexture[];
  /** マテリアル名 → 色（OBJ の .mtl の Kd。0〜1） */
  colors?: Record<string, [number, number, number]>;
  /** RTM の設置物の種類（ornamentType・machineType など。表示だけに使う） */
  kind?: string;
  /** このモデルで使うファイル（パス → 中身） */
  files: Record<string, Uint8Array>;
  /** モデルの寸法（モデルの単位。x=横, y=高さ, z=奥行き）。読み込んだときに測る */
  size?: [number, number, number];
  addedAt: number;
};

/**
 * モデルの1単位が模型（レイアウト）で何 mm になるか。
 * RTM・glTF・OBJ・Metasequoia は実物の m で作られているので 1/150 にする。STL は 3D プリント用に模型の mm で作られていることが多い
 */
export function unitMm(format: ModelFormat): number {
  return format === "stl" ? 1 : MM_PER_M;
}

/** 置くときの大きさ（mm）。縮尺どおりだと小さすぎる・大きすぎるときは、いちばん長い辺を 100mm にする */
export function defaultSizeMm(m: Pick<Model3d, "format" | "size">): { length: number; width: number; height: number } {
  const [x, y, z] = m.size ?? [1, 1, 1];
  let k = unitMm(m.format);
  const longest = Math.max(x, y, z) * k;
  if (!(longest >= 3 && longest <= 1500)) k = 100 / Math.max(x, y, z, 1e-9);
  const r = (v: number) => Math.max(0.1, Math.round(v * k * 10) / 10);
  return { length: r(x), height: r(y), width: r(z) };
}

/** 名前とファイルから ID を作る（FNV-1a） */
export function modelId(format: ModelFormat, main: string, name: string): string {
  let h = 0x811c9dc5;
  for (const c of new TextEncoder().encode(`${format}|${main}|${name}`)) {
    h ^= c;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `m${h.toString(36)}`;
}

export type ModelPackResult = { models: Model3d[]; problems: string[] };

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const isJson = (p: string) => /\.json$/i.test(p);
const isArchive = (p: string) => /\.(zip|jar)$/i.test(p);
const isMacJunk = (p: string) => /(^|\/)__MACOSX\//.test(p) || /(^|\/)\._[^/]*$/.test(p) || /(^|\/)\.DS_Store$/.test(p);
/** モデル本体の拡張子 */
const MAIN_MODEL = /\.(glb|gltf|obj|mqo|mqoz|stl)$/i;
const wantedEntry = (p: string) =>
  !isMacJunk(p) && (isJson(p) || MAIN_MODEL.test(p) || /\.(bin|mtl|png|jpe?g|webp|npm|ngto)$/i.test(p));
const baseName = (p: string) => p.split("/").pop()!.replace(/\.[^.]+$/, "");
const dirOf = (p: string) => p.split("/").slice(0, -1).join("/");

/** 1つのモデルのファイルの合計の上限 */
export const MODEL_FILES_MAX_BYTES = 60 * 1024 * 1024;

// ---- RealTrainMod の設置物 ----

/** 車両・レール・架線はここでは読まない（車両は「RTMの車両」、レールと架線は線路の形に沿って伸ばす物なので） */
const NOT_OBJECT_KEYS = ["trainName", "railName", "wireName"];
const NAME_KEYS = ["name", "ornamentName", "machineName", "signalName", "containerName", "npcName", "modelName"];
const TYPE_KEYS = ["ornamentType", "machineType", "signalType", "containerType", "type"];

export type RtmObjectConfig = { name: string; kind?: string; modelFile: string; textures: RtmTexture[] };

function sourceOf(v: unknown): { modelFile: string; textures: RtmTexture[] } | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const modelFile = str(o.modelFile);
  if (!modelFile) return null;
  const textures = (Array.isArray(o.textures) ? o.textures : [])
    .filter((t): t is unknown[] => Array.isArray(t) && t.length >= 2 && typeof t[1] === "string")
    .map((t) => ({ material: str(t[0]) || "default", path: str(t[1]), option: str(t[2]) }));
  return { modelFile, textures };
}

/** RTM の設置物の json（ModelOrnament・ModelMachine など）を読む。設置物でなければ null */
export function parseRtmObjectConfig(json: unknown): RtmObjectConfig | null {
  if (!json || typeof json !== "object" || Array.isArray(json)) return null;
  const o = json as Record<string, unknown>;
  if (NOT_OBJECT_KEYS.some((k) => k in o)) return null;
  const name = NAME_KEYS.map((k) => str(o[k])).find(Boolean);
  if (!name) return null;
  // model・model2 のほか、signalModel2 のような「〜Model」の中のモデルも探す
  const keys = ["model", "model2", ...Object.keys(o).filter((k) => /model\d*$/i.test(k) && k !== "model" && k !== "model2")];
  let src: { modelFile: string; textures: RtmTexture[] } | null = null;
  for (const k of keys) {
    src = sourceOf(o[k]);
    if (src) break;
    // 古い書き方：xxxModel にファイル名、xxxTexture にテクスチャ
    const file = str(o[k]);
    if (file && SUPPORTED_MODEL.test(file)) {
      const tex = str(o[k.replace(/Model\d*$/i, "Texture")]);
      src = { modelFile: file, textures: tex ? [{ material: "default", path: tex, option: "" }] : [] };
      break;
    }
  }
  if (!src) return null;
  const kind = TYPE_KEYS.map((k) => str(o[k])).find(Boolean);
  return { name: name.slice(0, 80), ...(kind ? { kind: kind.slice(0, 40) } : {}), ...src };
}

// ---- OBJ の .mtl ----

/** .mtl からマテリアルの色（Kd）とテクスチャ（map_Kd）を読む */
export function parseMtl(text: string): { colors: Record<string, [number, number, number]>; maps: Record<string, string> } {
  const colors: Record<string, [number, number, number]> = {};
  const maps: Record<string, string> = {};
  let cur = "";
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("newmtl ")) cur = line.slice(7).trim();
    else if (cur && /^Kd\s/.test(line)) {
      const n = line.split(/\s+/).slice(1, 4).map(Number);
      if (n.length === 3 && n.every(Number.isFinite)) colors[cur] = [n[0], n[1], n[2]];
    } else if (cur && /^map_Kd\s/i.test(line)) {
      // オプション（-s 1 1 1 など）を飛ばして、最後のファイル名を取る
      const parts = line.split(/\s+/).slice(1);
      const file = parts.filter((p, i) => !p.startsWith("-") && !(i > 0 && parts[i - 1].startsWith("-") && /^[-\d.]+$/.test(p))).pop();
      if (file) maps[cur] = file;
    }
  }
  return { colors, maps };
}

/** .obj が使う .mtl のファイル名（mtllib） */
function mtlLibs(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("mtllib ")) out.push(line.slice(7).trim());
  }
  return out;
}

// ---- glTF ----

/** .gltf / .glb が参照する外部ファイル（buffers・images の uri。data: は除く） */
export function gltfUris(path: string, data: Uint8Array): string[] {
  let json: unknown;
  try {
    if (/\.glb$/i.test(path)) {
      const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
      if (data.byteLength < 20 || v.getUint32(0, true) !== 0x46546c67) return [];
      const len = v.getUint32(12, true);
      json = JSON.parse(new TextDecoder().decode(data.subarray(20, 20 + len)));
    } else json = JSON.parse(decodeText(data));
  } catch {
    return [];
  }
  const o = json as { buffers?: { uri?: unknown }[]; images?: { uri?: unknown }[] };
  return [...(o.buffers ?? []), ...(o.images ?? [])]
    .map((x) => (typeof x?.uri === "string" ? x.uri : ""))
    .filter((u) => u && !u.startsWith("data:"))
    .map((u) => {
      try {
        return decodeURIComponent(u);
      } catch {
        return u;
      }
    });
}

/** glTF の拡張のうち、読めないもの（圧縮されたメッシュ） */
export function gltfUnsupported(path: string, data: Uint8Array): string | null {
  const head = /\.glb$/i.test(path) ? new TextDecoder().decode(data.subarray(0, Math.min(data.length, 200000))) : decodeText(data);
  if (head.includes("KHR_draco_mesh_compression")) return "Draco で圧縮された glTF";
  if (head.includes("EXT_meshopt_compression")) return "meshopt で圧縮された glTF";
  if (head.includes("KHR_texture_basisu")) return "KTX2 のテクスチャを使う glTF";
  return null;
}

// ---- まとめ ----

const relTo = (from: string, file: string) => (dirOf(from) ? `${dirOf(from)}/${file}` : file).replace(/\\/g, "/");

/** 読み込んだファイル（ZIP を開いた中身、または直接選んだファイル）からモデルを取り出す */
export function modelsFromEntries(entries: ZipEntry[], sourceName: string, now = Date.now()): ModelPackResult {
  const problems: string[] = [];
  const paths = entries.map((e) => e.path);
  const byPath = new Map(entries.map((e) => [e.path, e.data]));
  const models: Model3d[] = [];
  /** RTM の json から使ったモデル（同じファイルを単独のモデルとしても並べない） */
  const used = new Set<string>();
  const take = (files: Record<string, Uint8Array>, path: string | null) => {
    if (path && byPath.has(path)) files[path] = byPath.get(path)!;
    return path;
  };
  const tooBig = (files: Record<string, Uint8Array>) => Object.values(files).reduce((n, d) => n + d.byteLength, 0) > MODEL_FILES_MAX_BYTES;

  // RealTrainMod の設置物（json）
  let rtmPack = false;
  let trains = 0;
  for (const e of entries) {
    if (!isJson(e.path)) continue;
    let json: unknown;
    try {
      json = parseLenientJson(decodeText(e.data));
    } catch {
      continue;
    }
    if (parseTrainConfig(json)) {
      rtmPack = true;
      trains++;
      continue;
    }
    const config = parseRtmObjectConfig(json);
    if (!config) continue;
    rtmPack = true;
    const files: Record<string, Uint8Array> = {};
    const main = take(files, findFile(paths, config.modelFile));
    if (!main) {
      problems.push(`${config.name}: モデル ${config.modelFile} が見つかりません`);
      continue;
    }
    if (/\.npm$/i.test(main) || !SUPPORTED_MODEL.test(main)) {
      problems.push(`${config.name}: ${config.modelFile} は読めない形式です（.mqo・.mqoz・.obj に対応）`);
      continue;
    }
    used.add(main);
    if (/\.obj$/i.test(main)) take(files, findFile(paths, main.replace(/\.obj$/i, ".mtl")));
    const textures = config.textures.map((t) => {
      const found = take(files, findFile(paths, t.path));
      if (!found) problems.push(`${config.name}: テクスチャ ${t.path} が見つかりません`);
      return { ...t, path: found ?? t.path };
    });
    models.push({
      id: modelId("rtm", main, config.name),
      name: config.name,
      source: sourceName,
      format: "rtm",
      main,
      textures,
      ...(config.kind ? { kind: config.kind } : {}),
      files,
      addedAt: now,
    });
  }

  if (trains > 0 && models.length === 0) problems.push(`${sourceName}: RealTrainMod の車両パックです。車両は運転席の映像の「RTMの車両…」から読み込んでください`);

  // 単独のモデル（glTF・OBJ・Metasequoia・STL）。RTM のパックの中の .mqo・.obj は json から使うので、単独では並べない
  for (const e of entries) {
    if (!MAIN_MODEL.test(e.path) || used.has(e.path)) continue;
    if (rtmPack && SUPPORTED_MODEL.test(e.path)) continue;
    const name = baseName(e.path).slice(0, 80) || "モデル";
    const files: Record<string, Uint8Array> = { [e.path]: e.data };
    let format: ModelFormat;
    let textures: RtmTexture[] | undefined;
    let colors: Record<string, [number, number, number]> | undefined;
    if (/\.(glb|gltf)$/i.test(e.path)) {
      format = "gltf";
      const bad = gltfUnsupported(e.path, e.data);
      if (bad) {
        problems.push(`${name}: ${bad}には対応していません。圧縮しないで書き出してください`);
        continue;
      }
      const missing: string[] = [];
      for (const uri of gltfUris(e.path, e.data)) {
        const hit = findFile(paths, relTo(e.path, uri)) ?? findFile(paths, uri);
        if (hit) take(files, hit);
        else missing.push(uri);
      }
      if (missing.some((u) => /\.bin$/i.test(u))) {
        problems.push(`${name}: ${missing.filter((u) => /\.bin$/i.test(u)).join("、")} が見つかりません（.gltf と一緒に選んでください）`);
        continue;
      }
      if (missing.length) problems.push(`${name}: テクスチャ ${missing.join("、")} が見つかりません`);
    } else if (/\.obj$/i.test(e.path)) {
      format = "obj";
      const text = decodeText(e.data);
      textures = [];
      colors = {};
      const libs = mtlLibs(text);
      const mtlPaths = (libs.length ? libs : [`${baseName(e.path)}.mtl`]).map((l) => findFile(paths, relTo(e.path, l)) ?? findFile(paths, l));
      for (const mtl of mtlPaths) {
        if (!mtl) continue;
        take(files, mtl);
        const m = parseMtl(decodeText(byPath.get(mtl)!));
        Object.assign(colors, m.colors);
        for (const [material, file] of Object.entries(m.maps)) {
          const found = take(files, findFile(paths, relTo(mtl, file)) ?? findFile(paths, file));
          if (found) textures.push({ material, path: found, option: "" });
          else problems.push(`${name}: テクスチャ ${file} が見つかりません`);
        }
      }
    } else if (/\.mqoz?$/i.test(e.path)) {
      format = "mqo";
      // Metasequoia はマテリアルのテクスチャ（tex("...")）を同じフォルダから探す
      textures = [];
      if (/\.mqo$/i.test(e.path)) {
        const text = decodeText(e.data);
        const block = /Material\s+\d+\s*\{([\s\S]*?)\n\s*\}/.exec(text)?.[1] ?? "";
        for (const line of block.split(/\r?\n/)) {
          const mat = /^\s*"([^"]*)"/.exec(line)?.[1];
          const tex = /tex\("([^"]+)"\)/.exec(line)?.[1];
          if (mat === undefined || !tex) continue;
          const found = take(files, findFile(paths, relTo(e.path, tex)) ?? findFile(paths, tex));
          if (found) textures.push({ material: mat, path: found, option: "" });
        }
      }
    } else format = "stl";
    if (tooBig(files)) {
      problems.push(`${name}: ファイルが大きすぎます（1つのモデルは合計 ${MODEL_FILES_MAX_BYTES / 1024 / 1024}MB まで）`);
      continue;
    }
    models.push({
      id: modelId(format, e.path, name),
      name,
      source: sourceName,
      format,
      main: e.path,
      ...(textures && textures.length ? { textures } : {}),
      ...(colors && Object.keys(colors).length ? { colors } : {}),
      files,
      addedAt: now,
    });
  }
  return { models, problems };
}

async function modelsFromZip(data: Uint8Array, sourceName: string, depth = 0): Promise<ModelPackResult> {
  const entries = await readZip(data, (p) => wantedEntry(p) || (depth < 2 && isArchive(p) && !isMacJunk(p)));
  const own = modelsFromEntries(entries.filter((e) => !isArchive(e.path)), sourceName);
  const models = [...own.models];
  const problems = [...own.problems];
  for (const e of entries.filter((x) => isArchive(x.path))) {
    try {
      const r = await modelsFromZip(e.data, `${sourceName}/${e.path.split("/").pop()}`, depth + 1);
      models.push(...r.models);
      problems.push(...r.problems);
    } catch {
      /* 壊れた ZIP は飛ばす */
    }
  }
  return { models, problems };
}

/**
 * 選んだファイル（ZIP、展開したフォルダの中身、またはモデル・テクスチャをまとめて選んだもの）からモデルを取り出す。
 * path はフォルダを選んだときのフォルダからのパス（なければファイル名）
 */
export async function readModelFiles(files: { name: string; path?: string; data: Uint8Array }[]): Promise<ModelPackResult> {
  const models: Model3d[] = [];
  const problems: string[] = [];
  const loose: ZipEntry[] = [];
  for (const f of files) {
    if (isArchive(f.name)) {
      try {
        const r = await modelsFromZip(f.data, f.name);
        models.push(...r.models);
        problems.push(...r.problems);
        if (r.models.length === 0 && r.problems.length === 0) problems.push(`${f.name}: 読み込める 3D モデルが見つかりませんでした`);
      } catch (e) {
        problems.push(`${f.name}: ${e instanceof Error ? e.message : "読めませんでした"}`);
      }
    } else if (wantedEntry(f.path ?? f.name)) loose.push({ path: (f.path ?? f.name).replace(/\\/g, "/"), data: f.data });
    else if (/\.(rar|7z|lzh)$/i.test(f.name)) problems.push(`${f.name}: この圧縮形式は読めません。展開してフォルダを選ぶか、ZIP にしてください`);
    else if (/\.(fbx|blend|dae|3ds|skp|schematic|schem|nbt)$/i.test(f.name)) {
      problems.push(`${f.name}: この形式には対応していません。glTF（.glb）か OBJ で書き出してください`);
    }
  }
  if (loose.length > 0) {
    const source = loose[0].path.includes("/") ? loose[0].path.split("/")[0] : loose.find((e) => MAIN_MODEL.test(e.path))?.path ?? loose[0].path;
    const r = modelsFromEntries(loose, source);
    models.push(...r.models);
    problems.push(...r.problems);
    if (r.models.length === 0 && r.problems.length === 0) problems.push("読み込める 3D モデルが見つかりませんでした（.glb・.gltf・.obj・.mqo・.stl、または RealTrainMod の設置物パック）");
  }
  return { models, problems: [...new Set(problems)] };
}
