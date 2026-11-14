import { createHash } from "node:crypto";

/**
 * AI提案の結果の一時保存（サーバーのメモリ内）。
 * 同じ人が同じ条件（AIの設定・ボード・要望・所有パーツ・予算・案の方向）で提案を頼んだときは、
 * AIを呼ばずに前の結果を返す。サーバーを再起動すると消える。
 *
 * 保持時間は PROPOSE_CACHE_TTL_MIN（分、既定60。0で無効）。
 */

type Env = Record<string, string | undefined>;

const MAX_ENTRIES = 200;

type Entry<T> = { value: T; expiresAt: number };

export function proposeCacheTtlMs(env: Env = process.env): number {
  const raw = env.PROPOSE_CACHE_TTL_MIN;
  const min = raw === undefined || raw === "" ? 60 : Number(raw);
  return Number.isFinite(min) && min > 0 ? min * 60_000 : 0;
}

/** 入力から鍵を作る。オブジェクトのキーは並べ替えて、同じ内容なら同じ鍵になるようにする */
export function cacheKey(parts: unknown): string {
  return createHash("sha256").update(stableStringify(parts)).digest("hex");
}

export function stableStringify(v: unknown): string {
  if (v instanceof Map) return stableStringify(Object.fromEntries([...v.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))));
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  if (v && typeof v === "object") {
    const keys = Object.keys(v as object)
      .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
      .sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify((v as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(v ?? null);
}

export class ResultCache<T> {
  private map = new Map<string, Entry<T>>();

  constructor(
    private readonly ttlMs: () => number,
    private readonly now: () => number = Date.now,
  ) {}

  get(key: string): T | undefined {
    const e = this.map.get(key);
    if (!e) return undefined;
    if (e.expiresAt <= this.now()) {
      this.map.delete(key);
      return undefined;
    }
    // 最近使ったものを後ろへ（古いものから捨てる）
    this.map.delete(key);
    this.map.set(key, e);
    return e.value;
  }

  set(key: string, value: T) {
    const ttl = this.ttlMs();
    if (ttl <= 0) return;
    this.map.delete(key);
    this.map.set(key, { value, expiresAt: this.now() + ttl });
    while (this.map.size > MAX_ENTRIES) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }

  get size() {
    return this.map.size;
  }

  clear() {
    this.map.clear();
  }
}

/** Next.js の開発サーバーで読み直されても消えないよう globalThis に置く */
const g = globalThis as unknown as { __ninegageProposeCache?: ResultCache<unknown> };
export const proposeCache: ResultCache<unknown> = (g.__ninegageProposeCache ??= new ResultCache<unknown>(() =>
  proposeCacheTtlMs(),
));
