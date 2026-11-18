// 運行計画（ダイヤ）のデータ。レイアウト（Layout.operation）と一緒に保存する。
//
// 時刻は「運転開始からの秒」で持つ。Nゲージの縮尺速度（1/150）で走らせたときの、模型の実際の時間。

/** 列車の種別 */
export type TrainKind = "local" | "rapid" | "express" | "freight" | "deadhead";

export const TRAIN_KINDS: { value: TrainKind; label: string; color: string }[] = [
  { value: "local", label: "普通", color: "#2f6fb5" },
  { value: "rapid", label: "快速", color: "#e07a1f" },
  { value: "express", label: "特急", color: "#c8323c" },
  { value: "freight", label: "貨物", color: "#5b6b3a" },
  { value: "deadhead", label: "回送", color: "#7a7f86" },
];

export function kindLabel(kind: TrainKind): string {
  return TRAIN_KINDS.find((k) => k.value === kind)?.label ?? kind;
}

/** 列車が立ち寄る駅（停車または通過） */
export type TrainStop = {
  stationId: string;
  /** 使う番線（1始まり）。null は「空いている近い番線」（経路のいちばん短い番線） */
  track: number | null;
  /** true で通過 */
  pass: boolean;
  /** 停車時間(秒) */
  dwellSec: number;
  /** true でこの駅で折り返す（向きを変えて次の駅へ） */
  turnback?: boolean;
};

export type Train = {
  id: string;
  name: string;
  /** 走る路線の名前（「再現してみた」で作ったレイアウトの路線など）。ない列車もある */
  line?: string;
  kind: TrainKind;
  /** ダイヤグラムの線の色 */
  color: string;
  cars: number;
  /** 縮尺の最高速度(km/h)。駅間はこの速度で走るとして時間を計算する */
  speedKmh: number;
  /** 始発駅を出る時刻（運転開始からの秒） */
  departSec: number;
  /** 停車駅を何周するか（エンドレスのレイアウトで回り続ける列車）。1 = 1回だけ */
  laps: number;
  stops: TrainStop[];
};

export type OperationPlan = {
  /** 駅の名前（駅ID → 名前）。駅はホームの配置から自動で見つける */
  stationNames: Record<string, string>;
  trains: Train[];
};

export const EMPTY_OPERATION: OperationPlan = { stationNames: {}, trains: [] };

export const LIMITS = {
  cars: { min: 1, max: 16 },
  speedKmh: { min: 10, max: 320 },
  laps: { min: 1, max: 20 },
  dwellSec: { min: 0, max: 600 },
  departSec: { min: 0, max: 24 * 3600 },
} as const;

const clamp = (v: number, r: { min: number; max: number }) => Math.min(r.max, Math.max(r.min, v));

let counter = 0;
export function newTrainId(): string {
  counter += 1;
  return `t${Date.now().toString(36)}${counter.toString(36)}`;
}

export function newTrain(index: number, stationIds: string[], line?: string): Train {
  const kind = TRAIN_KINDS[0];
  return {
    id: newTrainId(),
    name: `${index + 1}列車`,
    ...(line ? { line } : {}),
    kind: kind.value,
    color: kind.color,
    cars: 4,
    speedKmh: 80,
    departSec: index * 60,
    laps: 1,
    stops: stationIds.map((stationId) => ({ stationId, track: null, pass: false, dwellSec: 20 })),
  };
}

/** 保存データを読み込める形にそろえる（壊れた値は捨てるか、範囲内に直す） */
export function normalizeOperation(v: unknown): OperationPlan | undefined {
  if (!v || typeof v !== "object") return undefined;
  const o = v as Partial<OperationPlan>;
  const stationNames: Record<string, string> = {};
  if (o.stationNames && typeof o.stationNames === "object") {
    for (const [k, name] of Object.entries(o.stationNames)) if (typeof name === "string") stationNames[k] = name.slice(0, 40);
  }
  const num = (x: unknown, d: number) => (typeof x === "number" && Number.isFinite(x) ? x : d);
  const trains: Train[] = (Array.isArray(o.trains) ? o.trains : [])
    .filter((t): t is Train => !!t && typeof t === "object" && typeof t.id === "string" && Array.isArray(t.stops))
    .map((t) => ({
      id: t.id,
      name: typeof t.name === "string" ? t.name.slice(0, 40) : "列車",
      ...(typeof t.line === "string" && t.line.trim() ? { line: t.line.trim().slice(0, 40) } : {}),
      kind: TRAIN_KINDS.some((k) => k.value === t.kind) ? t.kind : "local",
      color: typeof t.color === "string" && /^#[0-9a-fA-F]{6}$/.test(t.color) ? t.color : "#2f6fb5",
      cars: Math.round(clamp(num(t.cars, 4), LIMITS.cars)),
      speedKmh: clamp(num(t.speedKmh, 80), LIMITS.speedKmh),
      departSec: Math.round(clamp(num(t.departSec, 0), LIMITS.departSec)),
      laps: Math.round(clamp(num(t.laps, 1), LIMITS.laps)),
      stops: t.stops
        .filter((s) => s && typeof s.stationId === "string")
        .map((s) => ({
          stationId: s.stationId,
          track: typeof s.track === "number" && s.track >= 1 ? Math.round(s.track) : null,
          pass: !!s.pass,
          dwellSec: Math.round(clamp(num(s.dwellSec, 20), LIMITS.dwellSec)),
          ...(s.turnback ? { turnback: true } : {}),
        })),
    }));
  return { stationNames, trains };
}

/** 秒 → "m:ss"（1時間以上は "h:mm:ss"） */
export function formatTime(sec: number): string {
  if (!Number.isFinite(sec)) return "—";
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** "m:ss" / "h:mm:ss" / 秒の数字 → 秒。読めなければ null */
export function parseTime(text: string): number | null {
  const t = text.trim();
  if (/^\d+$/.test(t)) return Number(t);
  const m = t.match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2})$/);
  if (!m) return null;
  const sec = Number(m[3]);
  const min = Number(m[2]);
  if (sec >= 60 || (m[1] !== undefined && min >= 60)) return null;
  return Number(m[1] ?? 0) * 3600 + min * 60 + sec;
}
