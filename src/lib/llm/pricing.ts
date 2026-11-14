import type { TokenUsage } from "./types";

/**
 * モデルごとのトークン単価（米ドル / 100万トークン）。
 * Anthropic の公表価格（2026年11月時点）。キャッシュの書き込みは入力単価の1.25倍（5分保持）・2倍（1時間保持）。
 * 他社のモデルや価格が変わったときは、環境変数 AI_PRICING_JSON で上書き・追加できる。
 *   例: {"gpt-5":{"input":1.25,"output":10,"cacheRead":0.125}}
 */
export type ModelPrice = {
  input: number;
  output: number;
  cacheRead: number;
  /** 省略時は input×1.25 */
  cacheWrite5m?: number;
  /** 省略時は input×2 */
  cacheWrite1h?: number;
};

export const PRICES_AS_OF = "2026-11";

export const BUILTIN_PRICES: Record<string, ModelPrice> = {
  "claude-fable-5-2": { input: 8, output: 40, cacheRead: 0.2 },
  "claude-mythos-5-2": { input: 8, output: 40, cacheRead: 0.2 },
  "claude-fable-5-1": { input: 10, output: 50, cacheRead: 0.25 },
  "claude-mythos-5-1": { input: 10, output: 50, cacheRead: 0.25 },
  "claude-fable-5": { input: 10, output: 50, cacheRead: 1 },
  "claude-mythos-5": { input: 10, output: 50, cacheRead: 1 },
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2 },
  "claude-opus-5": { input: 5, output: 25, cacheRead: 0.5 },
  "claude-opus-4-8": { input: 5, output: 25, cacheRead: 0.5 },
  "claude-opus-4-7": { input: 5, output: 25, cacheRead: 0.5 },
  "claude-opus-4-6": { input: 5, output: 25, cacheRead: 0.5 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.1 },
  "claude-sonnet-5": { input: 2, output: 10, cacheRead: 0.2 },
  "claude-sonnet-4-6": { input: 3, output: 15, cacheRead: 0.3 },
  // 入力が10万トークン以下の単価（レイアウト提案はこの範囲に収まる）
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01 },
  "claude-haiku-4-5": { input: 1, output: 5, cacheRead: 0.1 },
};

type Env = Record<string, string | undefined>;

function isPrice(v: unknown): v is ModelPrice {
  const p = v as ModelPrice;
  return !!p && typeof p === "object" && [p.input, p.output, p.cacheRead].every((n) => typeof n === "number" && n >= 0);
}

export function priceTable(env: Env = process.env): Record<string, ModelPrice> {
  const table = { ...BUILTIN_PRICES };
  if (env.AI_PRICING_JSON) {
    try {
      const extra = JSON.parse(env.AI_PRICING_JSON) as Record<string, unknown>;
      for (const [k, v] of Object.entries(extra)) if (isPrice(v)) table[k] = v;
    } catch {
      console.warn("AI_PRICING_JSON を読めませんでした（JSONの形を確認してください）");
    }
  }
  return table;
}

/**
 * モデル名から単価を探す。完全一致を優先し、なければ前方一致でいちばん長いもの
 * （日付つきの名前や "claude-opus-5-5-xxx" のような名前でも見つかる）。
 */
export function priceFor(model: string, table: Record<string, ModelPrice> = priceTable()): ModelPrice | null {
  const m = model.trim().replace(/^models\//, "").replace(/^anthropic\./, "");
  if (table[m]) return table[m];
  let best: string | null = null;
  for (const k of Object.keys(table)) {
    if ((m.startsWith(`${k}-`) || m.startsWith(`${k}@`)) && (!best || k.length > best.length)) best = k;
  }
  return best ? table[best] : null;
}

/** 使ったトークンの料金（米ドル）。単価が分からないモデルは null */
export function costUsd(usage: TokenUsage, price: ModelPrice | null): number | null {
  if (!price) return null;
  const w1h = Math.min(usage.cacheWrite1hTokens ?? 0, usage.cacheWriteTokens);
  const w5m = usage.cacheWriteTokens - w1h;
  const usd =
    usage.inputTokens * price.input +
    usage.outputTokens * price.output +
    usage.cacheReadTokens * price.cacheRead +
    w5m * (price.cacheWrite5m ?? price.input * 1.25) +
    w1h * (price.cacheWrite1h ?? price.input * 2);
  return usd / 1_000_000;
}

/** キャッシュがなかったら（全部を通常の入力として読んだら）いくらだったか。節約額の表示用 */
export function costWithoutCacheUsd(usage: TokenUsage, price: ModelPrice | null): number | null {
  if (!price) return null;
  const input = usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens;
  return (input * price.input + usage.outputTokens * price.output) / 1_000_000;
}
