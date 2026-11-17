import { createHash } from "node:crypto";

/**
 * AI提案の条件から鍵を作る。同じ条件で頼み直したときに、自動保存したレイアウト（aiLayouts.ts）を探すのに使う。
 */

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
