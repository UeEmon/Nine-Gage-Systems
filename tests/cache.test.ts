import { describe, expect, it } from "vitest";
import { cacheHitRate, UsageStats } from "../src/lib/server/aiUsage";
import { cacheKey, proposeCacheTtlMs, ResultCache, stableStringify } from "../src/lib/server/proposeCache";

describe("proposal result cache", () => {
  it("makes the same key for the same input regardless of key order", () => {
    const a = cacheKey({ board: { width: 1, height: 2 }, stock: new Map([["b", 1], ["a", 2]]), hint: undefined });
    const b = cacheKey({ stock: new Map([["a", 2], ["b", 1]]), board: { height: 2, width: 1 } });
    expect(a).toBe(b);
    expect(cacheKey({ request: "x" })).not.toBe(cacheKey({ request: "y" }));
    expect(stableStringify({ b: 1, a: [1, { d: 2, c: 3 }] })).toBe('{"a":[1,{"c":3,"d":2}],"b":1}');
  });

  it("expires entries and keeps at most 200", () => {
    let now = 0;
    const cache = new ResultCache<number>(() => 1000, () => now);
    cache.set("k", 1);
    expect(cache.get("k")).toBe(1);
    now = 1000;
    expect(cache.get("k")).toBeUndefined();
    for (let i = 0; i < 250; i++) cache.set(`k${i}`, i);
    expect(cache.size).toBe(200);
    expect(cache.get("k0")).toBeUndefined();
    expect(cache.get("k249")).toBe(249);
  });

  it("can be turned off", () => {
    expect(proposeCacheTtlMs({})).toBe(60 * 60_000);
    expect(proposeCacheTtlMs({ PROPOSE_CACHE_TTL_MIN: "0" })).toBe(0);
    const cache = new ResultCache<number>(() => 0);
    cache.set("k", 1);
    expect(cache.get("k")).toBeUndefined();
  });
});

describe("usage stats", () => {
  it("totals tokens per model and computes the cache hit rate", () => {
    const s = new UsageStats();
    const usage = { inputTokens: 100, outputTokens: 500, cacheReadTokens: 800, cacheWriteTokens: 100 };
    s.record({ at: "", provider: "anthropic", model: "claude-opus-5-5", maker: "kato", attempts: 2, resultCached: false, ok: true, usage });
    s.record({
      at: "",
      provider: "anthropic",
      model: "claude-opus-5-5",
      maker: "kato",
      attempts: 0,
      resultCached: true,
      ok: true,
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
    });
    const v = s.view();
    expect(v.totals.proposals).toBe(2);
    expect(v.totals.resultCacheHits).toBe(1);
    expect(v.totals.apiCalls).toBe(2);
    expect(v.totals.cacheHitRate).toBeCloseTo(0.8);
    expect(v.byModel).toHaveLength(1);
    expect(v.recent).toHaveLength(2);
    expect(cacheHitRate({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 })).toBeNull();
    s.reset();
    expect(s.view().totals.proposals).toBe(0);
  });
});
