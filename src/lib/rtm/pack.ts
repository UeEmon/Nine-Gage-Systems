// RealTrainMod の車両パック（ZIP）から、車両（ModelTrain の json）とそのモデル・テクスチャを取り出す。
//
// 車両パックは作者ごとに利用条件が違うので、SenroLab には同梱しない。
// 利用者が自分の持っている車両パックを選び、ブラウザの中だけで読む（サーバーには送らない）。

import { decodeText, parseModelFile, SUPPORTED_MODEL } from "./model";
import { readZip, type ZipEntry } from "./zip";

export type RtmTexture = {
  /** マテリアル名（"default" は、ほかに当てはまらないマテリアル全部） */
  material: string;
  path: string;
  /** "Light"（前照灯・尾灯のテクスチャを重ねて光らせる）・"AlphaBlend"（半透明）など */
  option: string;
  /** Light のとき重ねるテクスチャ（[消灯, 前照灯, 尾灯]。パックの中のパス、見つからなければ null） */
  lights?: (string | null)[];
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

/**
 * Gson の lenient モードと同じくらいゆるく json を読む（RTM の車両パックは Gson で読むので、厳密な json でないものが多い）。
 * コメント（行コメント・ブロックコメント・#）・末尾のカンマ・単引用符・引用符のないキーや値（trta010_7001 など）・区切りの ; と = を許す
 */
export function parseLenientJson(text: string): unknown {
  let i = 0;
  const fail = (msg: string): never => {
    throw new Error(`${msg}（${i}文字目）`);
  };
  const skip = () => {
    for (;;) {
      const c = text[i];
      if (c === undefined) return;
      if (c === " " || c === "\t" || c === "\n" || c === "\r" || c === "\uFEFF") i++;
      else if (c === "/" && text[i + 1] === "/") while (i < text.length && text[i] !== "\n") i++;
      else if (c === "#") while (i < text.length && text[i] !== "\n") i++;
      else if (c === "/" && text[i + 1] === "*") {
        const e = text.indexOf("*/", i + 2);
        i = e < 0 ? text.length : e + 2;
      } else return;
    }
  };
  const quoted = (q: string): string => {
    let out = "";
    for (i++; i < text.length && text[i] !== q; i++) {
      if (text[i] !== "\\") {
        out += text[i];
        continue;
      }
      const e = text[++i];
      if (e === "u") {
        out += String.fromCharCode(parseInt(text.slice(i + 1, i + 5), 16) || 0);
        i += 4;
      } else out += ({ n: "\n", t: "\t", r: "\r", b: "\b", f: "\f" } as Record<string, string>)[e] ?? e;
    }
    if (text[i] !== q) fail("文字列が閉じていません");
    i++;
    return out;
  };
  const literal = (): string => {
    const m = /^[^\s,:;={}[\]"'#/]+/.exec(text.slice(i, i + 4096));
    if (!m) fail("値がありません");
    i += m![0].length;
    return m![0];
  };
  const value = (): unknown => {
    skip();
    const c = text[i];
    if (c === "{") {
      i++;
      const o: Record<string, unknown> = {};
      for (;;) {
        skip();
        if (text[i] === "}") {
          i++;
          return o;
        }
        if (text[i] === "," || text[i] === ";") {
          i++;
          continue;
        }
        const key = text[i] === '"' || text[i] === "'" ? quoted(text[i]) : literal();
        skip();
        if (text[i] === ":") i++;
        else if (text[i] === "=") i += text[i + 1] === ">" ? 2 : 1;
        else fail("キーのあとに : がありません");
        o[key] = value();
      }
    }
    if (c === "[") {
      i++;
      const a: unknown[] = [];
      for (;;) {
        skip();
        if (text[i] === "]") {
          i++;
          return a;
        }
        if (text[i] === "," || text[i] === ";") {
          i++;
          continue;
        }
        a.push(value());
      }
    }
    if (c === '"' || c === "'") return quoted(c);
    if (c === undefined) fail("途中で終わっています");
    const lit = literal();
    if (lit === "true") return true;
    if (lit === "false") return false;
    if (lit === "null") return null;
    const n = Number(lit);
    return /^[-+]?(\d|\.\d)/.test(lit) && Number.isFinite(n) ? n : lit;
  };
  const v = value();
  return v;
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
    .map((t) => {
      const lights = t.slice(3).filter((x): x is string => typeof x === "string" && !!x.trim()).map((x) => x.trim());
      return { material: str(t[0]) || "default", path: str(t[1]), option: str(t[2]), ...(lights.length ? { lights } : {}) };
    });
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

/** 前照灯・尾灯を光らせるテクスチャの名前（RTM と同じく xxx.png → xxx_light0.png 消灯, xxx_light1.png 前照灯, xxx_light2.png 尾灯） */
export function lightTextureNames(path: string): string[] {
  const m = /^(.*?)(\.[^./]+)$/.exec(path);
  const [stem, ext] = m ? [m[1], m[2]] : [path, ".png"];
  return [0, 1, 2].map((n) => `${stem}_light${n}${ext}`);
}

export type PackResult = { vehicles: RtmVehicle[]; problems: string[] };

const isJson = (p: string) => /\.json$/i.test(p);
/** macOS の圧縮で入る付属ファイル（__MACOSX/ と ._ で始まるもの）は中身ではない */
const isMacJunk = (p: string) => /(^|\/)__MACOSX\//.test(p) || /(^|\/)\._[^/]*$/.test(p) || /(^|\/)\.DS_Store$/.test(p);
const wantedEntry = (p: string) => !isMacJunk(p) && (isJson(p) || SUPPORTED_MODEL.test(p) || /\.(png|jpe?g|mtl|npm|ngto)$/i.test(p));

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
        problems.push(
          what === "台車"
            ? `${config.name}: 台車のモデル ${src.modelFile} がこのパックにないので、簡易な台車で表示します（ほかの車両パックの台車を使う車両）`
            : `${config.name}: ${what}のモデル ${src.modelFile} が見つかりません`,
        );
        return null;
      }
      if (/\.obj$/i.test(model)) take(model.replace(/\.obj$/i, ".mtl"));
      const textures = src.textures.map((t): RtmTexture => {
        const found = take(t.path);
        if (!found) problems.push(`${config.name}: テクスチャ ${t.path} が見つかりません`);
        if (!/light/i.test(t.option)) return { ...t, path: found ?? t.path };
        const lights = (t.lights?.filter((x): x is string => !!x) ?? lightTextureNames(t.path)).map((x) => take(x));
        return { ...t, path: found ?? t.path, lights };
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

const isArchive = (p: string) => /\.(zip|jar)$/i.test(p);

/**
 * 車両パックの ZIP を読む。配布用の ZIP の中に車両パックの ZIP が入っている形（readme と一緒に配る形）も、
 * 2段まで開いて読む
 */
async function vehiclesFromZip(data: Uint8Array, sourceName: string, depth = 0): Promise<PackResult> {
  const entries = await readZip(data, (p) => wantedEntry(p) || (depth < 2 && isArchive(p) && !isMacJunk(p)));
  const inner = entries.filter((e) => isArchive(e.path));
  const own = vehiclesFromEntries(entries.filter((e) => !isArchive(e.path)), sourceName);
  const vehicles = [...own.vehicles];
  const problems = own.vehicles.length > 0 || inner.length === 0 ? [...own.problems] : own.problems.filter((p) => !p.endsWith("見つかりませんでした"));
  for (const e of inner) {
    try {
      const r = await vehiclesFromZip(e.data, `${sourceName}/${e.path.split("/").pop()}`, depth + 1);
      vehicles.push(...r.vehicles);
      // 中の ZIP が車両パックでない（音のパックなど）ときは黙って飛ばす
      problems.push(...(r.vehicles.length > 0 ? r.problems : r.problems.filter((p) => !p.endsWith("見つかりませんでした"))));
    } catch {
      /* 壊れた ZIP は飛ばす */
    }
  }
  if (vehicles.length === 0 && problems.length === 0) problems.push(`${sourceName}: RealTrainMod の車両（ModelTrain の json）が見つかりませんでした`);
  return { vehicles, problems };
}

/** 車体のモデルを実際に読んでみて、読めない車両は理由を付けて外す */
async function checkModels(r: PackResult): Promise<PackResult> {
  const vehicles: RtmVehicle[] = [];
  const problems = [...r.problems];
  for (const v of r.vehicles) {
    const file = v.config.body.modelFile;
    try {
      const model = await parseModelFile(file, v.files[file]);
      if (model && model.parts.length > 0) vehicles.push(v);
      else problems.push(`${v.name}: 車体のモデル ${file} に読める形（三角形・四角形の面）がありません`);
    } catch {
      problems.push(`${v.name}: 車体のモデル ${file} を読めませんでした`);
    }
  }
  return { vehicles, problems };
}

/**
 * 選んだファイル（車両パックの ZIP、展開したフォルダの中身、または json・モデル・テクスチャをまとめて選んだもの）から車両を取り出す。
 * path はフォルダを選んだときのフォルダからのパス（なければファイル名）
 */
export async function readVehicleFiles(files: { name: string; path?: string; data: Uint8Array }[]): Promise<PackResult> {
  const vehicles: RtmVehicle[] = [];
  const problems: string[] = [];
  const loose: ZipEntry[] = [];
  for (const f of files) {
    if (isArchive(f.name)) {
      try {
        const r = await vehiclesFromZip(f.data, f.name);
        vehicles.push(...r.vehicles);
        problems.push(...r.problems);
      } catch (e) {
        problems.push(`${f.name}: ${e instanceof Error ? e.message : "読めませんでした"}`);
      }
    } else if (wantedEntry(f.path ?? f.name)) loose.push({ path: (f.path ?? f.name).replace(/\\/g, "/"), data: f.data });
    else if (/\.(rar|7z|lzh)$/i.test(f.name)) problems.push(`${f.name}: この圧縮形式は読めません。展開してフォルダを選ぶか、ZIP にしてください`);
  }
  if (loose.length > 0) {
    const r = vehiclesFromEntries(loose, (loose[0].path.includes("/") ? loose[0].path.split("/")[0] : loose.find((e) => isJson(e.path))?.path) ?? loose[0].path);
    vehicles.push(...r.vehicles);
    problems.push(...r.problems);
  }
  const r = await checkModels({ vehicles, problems });
  return { vehicles: r.vehicles, problems: [...new Set(r.problems)] };
}
