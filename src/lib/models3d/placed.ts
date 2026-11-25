// レイアウトに置いた 3D モデル。レイアウトにはモデルの中身は入れず、ID と位置・向き・大きさだけを保存する
// （モデルの中身は、読み込んだブラウザの IndexedDB にある）。

export type PlacedModel = {
  uid: string;
  /** 読み込んだモデルの ID（Model3d.id） */
  modelId: string;
  /** 置いたときのモデルの名前（モデルがこの端末にないときの表示にも使う） */
  name: string;
  /** 底の中心のワールド座標（mm）と向き（度） */
  x: number;
  y: number;
  rot: number;
  /** 置く高さ（mm、地上のレール面が 0） */
  z?: number;
  /** 大きさ（mm）。length はモデルの横（X）、width は奥行き（Z）、height は高さ */
  length: number;
  width: number;
  height: number;
};

/** 置けるモデルの数の上限（1つのレイアウト） */
export const MAX_PLACED_MODELS = 200;

export const PLACED_SIZE_LIMITS = { min: 0.5, max: 3000 } as const;

export function isPlacedModel(v: unknown): v is PlacedModel {
  const m = v as PlacedModel;
  return (
    !!m &&
    typeof m === "object" &&
    typeof m.uid === "string" &&
    typeof m.modelId === "string" &&
    typeof m.name === "string" &&
    [m.x, m.y, m.rot, m.length, m.width, m.height].every((n) => typeof n === "number" && Number.isFinite(n)) &&
    (m.z === undefined || (typeof m.z === "number" && Number.isFinite(m.z))) &&
    [m.length, m.width, m.height].every((n) => n > 0)
  );
}

let counter = 0;
export function newPlacedUid(): string {
  counter += 1;
  return `pm${Date.now().toString(36)}${counter.toString(36)}`;
}

/** 大きさを、縦横比を保ったまま k 倍にする（範囲に収める） */
export function scalePlaced(m: PlacedModel, k: number): PlacedModel {
  const longest = Math.max(m.length, m.width, m.height);
  const lo = PLACED_SIZE_LIMITS.min / Math.min(m.length, m.width, m.height);
  const hi = PLACED_SIZE_LIMITS.max / longest;
  const f = Math.min(hi, Math.max(lo, Number.isFinite(k) && k > 0 ? k : 1));
  const r = (v: number) => Math.round(v * f * 100) / 100;
  return { ...m, length: r(m.length), width: r(m.width), height: r(m.height) };
}

/** 四隅（ボードの座標）。編集画面の当たり判定・ボードに合わせる計算に使う */
export function placedCorners(m: Pick<PlacedModel, "x" | "y" | "rot" | "length" | "width">): { x: number; y: number }[] {
  const r = (m.rot * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([a, b]) => {
    const u = (a * m.length) / 2;
    const v = (b * m.width) / 2;
    return { x: m.x + u * c - v * s, y: m.y + u * s + v * c };
  });
}
