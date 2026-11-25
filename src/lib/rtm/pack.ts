// RealTrainMod の車両パック（ZIP）から、車両（ModelTrain の json）とそのモデル・テクスチャを取り出す。
//
// 車両パックは作者ごとに利用条件が違うので、SenroLab には同梱しない。
// 利用者が自分の持っている車両パックを選び、ブラウザの中だけで読む（サーバーには送らない）。

import { SUPPORTED_MODEL } from "./model";
import { decodeText } from "./model";
import { readZip, type ZipEntry } from "./zip";

export type RtmTexture = {
  /** マテリアル名（"default" は、ほかに当てはまらないマテリアル全部） */
  material: string;
  path: string;
  /** "Light"（光る）・"AlphaBlend"（半透明）など */
  option: string;
};

export type RtmModelSource = { modelFile: string; textures: RtmTexture[] };

export type RtmTrainConfig = {
  name: string;
  /** EC:電車, DC:気動車, EL:電気機関車, DL, SL, CC:コンテナ車, TC:タンク車 など */
  trainType: string;
  body: RtmModelSource;
  /** 前後の台車（なければ null） */
  bogies: [RtmModelSource | null, RtmModelSource | null];
  /** 台車の位置 {x, y, z}（m） */
  bogiePos: [number, number, number][];
  /** 車体長の半分（m）。連結面までの距離 */
  trainDistance: number;
};

/** 読み込んだ車両。ブラウザ（IndexedDB）に保存する */
export type RtmVehicle = {
  /** 車両名から決まる ID（同じ車両パックを別の端末で読んでも同じになる） */
  id: string;
  name: string;
  /** 読み込んだファイルの名前 */
  source: string;
  config: RtmTrainConfig;
  /** この車両で使うファイル（パックの中のパス → 中身） */
  files: Record<string, Uint8Array>;
  /** true で前後を逆にして表示する（モデルの前が -Z 向きの車両パック用） */
  flip?: boolean;
  /** 中間車に使う車両の ID（なければこの車両を中間車にも使う） */
  middleId?: string;
  addedAt: number;
};

/** Gson と同じくらいゆるく json を読む（コメント・末尾のカンマ・単引用符を許す） */
export function parseLenientJson(text: string): unknown {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"' || c === "'") {
      let s = '"';
      for (i++; i < text.length && text[i] !== c; i++) {
        if (text[i] === "\\") {
          s += text[i] + (text[i + 1] ?? "");
          i++;
        } else if (text[i] === '"') s += '\\"';
        else if (text[i] === "\n" || text[i] === "\r") s += text[i] === "\n" ? "\\n" : "";
        else s += text[i];
      }
      out += s + '"';
    } else if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
    } else if (c === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end < 0 ? text.length : end + 1;
    } else if (c === "#") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
    } else out += c;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"));
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : NaN);

function source(v: unknown): RtmModelSource | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const modelFile = str(o.modelFile);
  if (!modelFile) return null;
  const textures = (Array.isArray(o.textures) ? o.textures : [])
    .filter((t): t is unknown[] => Array.isArray(t) && t.length >= 2 && typeof t[1] === "string")
    .map((t) => ({ material: str(t[0]) || "default", path: str(t[1]), option: str(t[2]) }));
  return { modelFile, textures };
}

/** ModelTrain の json を読む。車両の json でなければ null */
export function parseTrainConfig(json: unknown): RtmTrainConfig | null {
  if (!json || typeof json !== "object") return null;
  const o = json as Record<string, unknown>;
  const name = str(o.trainName);
  if (!name) return null;
  // 古い書き方（trainModel・trainTexture など）も読む（RTM と同じ）
  const body = source(o.trainModel2) ?? (str(o.trainModel) ? { modelFile: str(o.trainModel), textures: str(o.trainTexture) ? [{ material: "default", path: str(o.trainTexture), option: "" }] : [] } : null);
  if (!body) return null;
  let bogies: [RtmModelSource | null, RtmModelSource | null];
  if (Array.isArray(o.bogieModel3)) bogies = [source(o.bogieModel3[0]), source(o.bogieModel3[1] ?? o.bogieModel3[0])];
  else {
    const b = source(o.bogieModel2) ?? (str(o.bogieModel) ? { modelFile: str(o.bogieModel), textures: str(o.bogieTexture) ? [{ material: "default", path: str(o.bogieTexture), option: "" }] : [] } : null);
    bogies = [b, b];
  }
  const pos = Array.isArray(o.bogiePos) ? o.bogiePos : null;
  const bogiePos = pos && pos.length >= 2 && pos.every((p) => Array.isArray(p) && p.length >= 3 && p.slice(0, 3).every((x) => Number.isFinite(num(x))))
    ? (pos as number[][]).map((p) => [p[0], p[1], p[2]] as [number, number, number])
    : [[0, 0, 7.125], [0, 0, -7.125]] as [number, number, number][];
  const d = num(o.trainDistance);
  return {
    name: name.slice(0, 60),
    trainType: str(o.trainType) || "EC",
    body,
    bogies,
    bogiePos,
    trainDistance: d > 0 ? d : 10.125,
  };
}

/** 車両名から ID を作る（FNV-1a） */
export function vehicleId(name: string): string {
  let h = 0x811c9dc5;
  for (const c of new TextEncoder().encode(name)) {
    h ^= c;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `v${h.toString(36)}`;
}

/**
 * パックの中のファイルを探す。RTM は assets/minecraft/ の下のパスで書くので、
 * そのまま・assets/minecraft/ を付けたもの・後ろが一致するもの・ファイル名だけ一致するもの、の順に探す
 */
export function findFile(paths: string[], wanted: string): string | null {
  const w = wanted.replace(/\\/g, "/").replace(/^\/+/, "").replace(/^minecraft:/, "");
  const lower = new Map(paths.map((p) => [p.toLowerCase(), p]));
  for (const c of [w, `assets/minecraft/${w}`]) {
    const hit = lower.get(c.toLowerCase());
    if (hit) return hit;
  }
  const suffix = `/${w.toLowerCase()}`;
  const bySuffix = paths.find((p) => p.toLowerCase().endsWith(suffix));
  if (bySuffix) return bySuffix;
  const base = w.split("/").pop()!.toLowerCase();
  return paths.find((p) => p.split("/").pop()!.toLowerCase() === base) ?? null;
}

/** 前照灯・尾灯で差し替えるテクスチャ（xxx.png → xxx0.png 消灯, xxx1.png 前照灯, xxx2.png 尾灯）の候補 */
export function lightVariants(path: string): string[] {
  const m = /^(.*?)(\.[^./]+)$/.exec(path);
  if (!m) return [path];
  return [path, `${m[1]}0${m[2]}`, `${m[1]}1${m[2]}`, `${m[1]}2${m[2]}`];
}

export type PackResult = { vehicles: RtmVehicle[]; problems: string[] };

const isJson = (p: string) => /\.json$/i.test(p);
const wantedEntry = (p: string) => isJson(p) || SUPPORTED_MODEL.test(p) || /\.(png|jpe?g|mtl|npm|ngto)$/i.test(p);

/** 読み込んだファイル（ZIP を開いた中身、または直接選んだファイル）から車両を取り出す */
export function vehiclesFromEntries(entries: ZipEntry[], sourceName: string, now = Date.now()): PackResult {
  const problems: string[] = [];
  const paths = entries.map((e) => e.path);
  const byPath = new Map(entries.map((e) => [e.path, e.data]));
  const vehicles: RtmVehicle[] = [];
  for (const e of entries) {
    if (!isJson(e.path)) continue;
    let json: unknown;
    try {
      json = parseLenientJson(decodeText(e.data));
    } catch {
      if (/ModelTrain/i.test(e.path)) problems.push(`${e.path}: json を読めませんでした`);
      continue;
    }
    const config = parseTrainConfig(json);
    if (!config) continue;
    const files: Record<string, Uint8Array> = {};
    const take = (wanted: string): string | null => {
      const hit = findFile(paths, wanted);
      if (hit) files[hit] = byPath.get(hit)!;
      return hit;
    };
    const resolve = (src: RtmModelSource | null, what: string): RtmModelSource | null => {
      if (!src) return null;
      if (!SUPPORTED_MODEL.test(src.modelFile)) {
        problems.push(`${config.name}: ${what}のモデル ${src.modelFile} は読めない形式です（.mqo・.mqoz・.obj に対応）`);
        return null;
      }
      const model = take(src.modelFile);
      if (!model) {
        problems.push(`${config.name}: ${what}のモデル ${src.modelFile} が見つかりません`);
        return null;
      }
      if (/\.obj$/i.test(model)) take(model.replace(/\.obj$/i, ".mtl"));
      const textures = src.textures.map((t) => {
        const found = lightVariants(t.path).map(take).filter((x): x is string => !!x);
        if (found.length === 0) problems.push(`${config.name}: テクスチャ ${t.path} が見つかりません`);
        return { ...t, path: found[0] ?? t.path };
      });
      return { modelFile: model, textures };
    };
    const body = resolve(config.body, "車体");
    if (!body) continue;
    const front = resolve(config.bogies[0], "台車");
    const back = config.bogies[1] === config.bogies[0] ? front : resolve(config.bogies[1], "台車");
    vehicles.push({
      id: vehicleId(config.name),
      name: config.name,
      source: sourceName,
      config: { ...config, body, bogies: [front, back] },
      files,
      addedAt: now,
    });
  }
  if (vehicles.length === 0 && problems.length === 0) problems.push(`${sourceName}: RealTrainMod の車両（ModelTrain の json）が見つかりませんでした`);
  return { vehicles, problems };
}

/** 選んだファイル（車両パックの ZIP、または json・モデル・テクスチャをまとめて選んだもの）から車両を取り出す */
export async function readVehicleFiles(files: { name: string; data: Uint8Array }[]): Promise<PackResult> {
  const vehicles: RtmVehicle[] = [];
  const problems: string[] = [];
  const loose: ZipEntry[] = [];
  for (const f of files) {
    if (/\.(zip|jar)$/i.test(f.name)) {
      try {
        const r = vehiclesFromEntries(await readZip(f.data, wantedEntry), f.name);
        vehicles.push(...r.vehicles);
        problems.push(...r.problems);
      } catch (e) {
        problems.push(`${f.name}: ${e instanceof Error ? e.message : "読めませんでした"}`);
      }
    } else loose.push({ path: f.name, data: f.data });
  }
  if (loose.length > 0) {
    const r = vehiclesFromEntries(loose, loose.find((e) => isJson(e.path))?.path ?? loose[0].path);
    vehicles.push(...r.vehicles);
    problems.push(...r.problems);
  }
  return { vehicles, problems };
}
