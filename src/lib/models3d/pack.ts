// RealTrainMod の設置物（車両以外の建物・設備などの置物）を、設置物パックから取り出す。
// ModelOrnament・ModelMachine・ModelSignal・ModelContainer などの json と、そのモデル（.mqo / .mqoz / .obj）・テクスチャを読む。
//
// 設置物パックは作者ごとに利用条件が違うので、SenroLab には同梱しない。ブラウザの中だけで読み、IndexedDB に保存する（サーバーには送らない）。
// レイアウトに保存するのは、置いた位置・向き・大きさとモデルの ID だけ（PlacedModel）。
// glTF・OBJ・STL など RTM 以外のモデルは、レイアウトに保存する「仮オブジェクト・3Dモデル」（object3d.ts）で扱う。

import { decodeText, SUPPORTED_MODEL } from "../rtm/model";
import { findFile, MM_PER_M, parseLenientJson, parseTrainConfig, type RtmTexture } from "../rtm/pack";
import { readZip, type ZipEntry } from "../rtm/zip";

export type ModelFormat = "rtm";

/** 読み込んだ RealTrainMod の設置物。ブラウザ（IndexedDB）に保存する */
export type Model3d = {
  /** 形式・ファイル・名前から決まる ID（同じファイルを別の端末で読んでも同じになる） */
  id: string;
  name: string;
  /** 読み込んだファイルの名前 */
  source: string;
  format: ModelFormat;
  /** モデル本体のファイル（files の中のパス） */
  main: string;
  /** マテリアル名 → テクスチャ（RTM の json から） */
  textures?: RtmTexture[];
  /** RTM の設置物の種類（ornamentType・machineType など。表示だけに使う） */
  kind?: string;
  /** このモデルで使うファイル（パス → 中身） */
  files: Record<string, Uint8Array>;
  /** モデルの寸法（モデルの単位。x=横, y=高さ, z=奥行き）。読み込んだときに測る */
  size?: [number, number, number];
  addedAt: number;
};

/** モデルの1単位が模型（レイアウト）で何 mm になるか。RTM は実物の m で作られているので 1/150 にする */
export function unitMm(format: ModelFormat): number {
  return format === "rtm" ? MM_PER_M : 1;
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
const wantedEntry = (p: string) => !isMacJunk(p) && (isJson(p) || SUPPORTED_MODEL.test(p) || /\.(mtl|png|jpe?g|npm|ngto)$/i.test(p));

/** 1つの設置物のファイルの合計の上限 */
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

// ---- まとめ ----

/** 読み込んだファイル（ZIP を開いた中身、または直接選んだファイル）から設置物を取り出す */
export function modelsFromEntries(entries: ZipEntry[], sourceName: string, now = Date.now()): ModelPackResult {
  const problems: string[] = [];
  const paths = entries.map((e) => e.path);
  const byPath = new Map(entries.map((e) => [e.path, e.data]));
  const models: Model3d[] = [];
  const take = (files: Record<string, Uint8Array>, path: string | null) => {
    if (path && byPath.has(path)) files[path] = byPath.get(path)!;
    return path;
  };
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
      trains++;
      continue;
    }
    const config = parseRtmObjectConfig(json);
    if (!config) continue;
    const files: Record<string, Uint8Array> = {};
    const main = take(files, findFile(paths, config.modelFile));
    if (!main) {
      problems.push(`${config.name}: モデル ${config.modelFile} が見つかりません`);
      continue;
    }
    if (!SUPPORTED_MODEL.test(main)) {
      problems.push(`${config.name}: ${config.modelFile} は読めない形式です（.mqo・.mqoz・.obj に対応）`);
      continue;
    }
    if (/\.obj$/i.test(main)) take(files, findFile(paths, main.replace(/\.obj$/i, ".mtl")));
    const textures = config.textures.map((t) => {
      const found = take(files, findFile(paths, t.path));
      if (!found) problems.push(`${config.name}: テクスチャ ${t.path} が見つかりません`);
      return { ...t, path: found ?? t.path };
    });
    if (Object.values(files).reduce((n, d) => n + d.byteLength, 0) > MODEL_FILES_MAX_BYTES) {
      problems.push(`${config.name}: ファイルが大きすぎます（1つの設置物は合計 ${MODEL_FILES_MAX_BYTES / 1024 / 1024}MB まで）`);
      continue;
    }
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
  if (models.length === 0 && problems.length === 0) {
    problems.push(
      trains > 0
        ? `${sourceName}: RealTrainMod の車両パックです。車両は運転席の映像の「RTMの車両…」から読み込んでください`
        : `${sourceName}: RealTrainMod の設置物（ModelOrnament・ModelMachine などの json）が見つかりませんでした`,
    );
  }
  return { models, problems };
}

async function modelsFromZip(data: Uint8Array, sourceName: string, depth = 0): Promise<ModelPackResult> {
  const entries = await readZip(data, (p) => wantedEntry(p) || (depth < 2 && isArchive(p) && !isMacJunk(p)));
  const inner = entries.filter((e) => isArchive(e.path));
  const own = modelsFromEntries(entries.filter((e) => !isArchive(e.path)), sourceName);
  const notFound = (p: string) => p.endsWith("見つかりませんでした") || p.includes("「RTMの車両…」");
  const models = [...own.models];
  const problems = own.models.length > 0 || inner.length === 0 ? [...own.problems] : own.problems.filter((p) => !notFound(p));
  for (const e of inner) {
    try {
      const r = await modelsFromZip(e.data, `${sourceName}/${e.path.split("/").pop()}`, depth + 1);
      models.push(...r.models);
      problems.push(...(r.models.length > 0 ? r.problems : r.problems.filter((p) => !notFound(p))));
    } catch {
      /* 壊れた ZIP は飛ばす */
    }
  }
  if (models.length === 0 && problems.length === 0) problems.push(`${sourceName}: RealTrainMod の設置物（ModelOrnament・ModelMachine などの json）が見つかりませんでした`);
  return { models, problems };
}

/**
 * 選んだファイル（設置物パックの ZIP、展開したフォルダの中身、または json・モデル・テクスチャをまとめて選んだもの）から設置物を取り出す。
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
      } catch (e) {
        problems.push(`${f.name}: ${e instanceof Error ? e.message : "読めませんでした"}`);
      }
    } else if (wantedEntry(f.path ?? f.name)) loose.push({ path: (f.path ?? f.name).replace(/\\/g, "/"), data: f.data });
    else if (/\.(rar|7z|lzh)$/i.test(f.name)) problems.push(`${f.name}: この圧縮形式は読めません。展開してフォルダを選ぶか、ZIP にしてください`);
  }
  if (loose.length > 0) {
    const source = loose[0].path.includes("/") ? loose[0].path.split("/")[0] : loose.find((e) => isJson(e.path))?.path ?? loose[0].path;
    const r = modelsFromEntries(loose, source);
    models.push(...r.models);
    problems.push(...r.problems);
  }
  return { models, problems: [...new Set(problems)] };
}
