import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { costUsd, costWithoutCacheUsd, priceFor, priceTable } from "../src/lib/llm/pricing";
import { cacheHitRate, jstDay, priced, summarize, UsageLog, usageView, type NewUsage } from "../src/lib/server/aiUsage";
import { cacheKey, stableStringify } from "../src/lib/server/proposeCache";

describe("proposal result cache", () => {
  it("makes the same key for the same input regardless of key order", () => {
    const a = cacheKey({ board: { width: 1, height: 2 }, stock: new Map([["b", 1], ["a", 2]]), hint: undefined });
    const b = cacheKey({ stock: new Map([["a", 2], ["b", 1]]), board: { height: 2, width: 1 } });
    expect(a).toBe(b);
    expect(cacheKey({ request: "x" })).not.toBe(cacheKey({ request: "y" }));
    expect(stableStringify({ b: 1, a: [1, { d: 2, c: 3 }] })).toBe('{"a":[1,{"c":3,"d":2}],"b":1}');
  });
});

const zero = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
const usage = { inputTokens: 1_000, outputTokens: 10_000, cacheReadTokens: 100_000, cacheWriteTokens: 20_000 };

function rec(extra: Partial<NewUsage> = {}) {
  return priced(
    {
      at: "2026-11-14T03:00:00Z",
      userId: "u1",
      username: "alice",
      provider: "anthropic",
      model: "claude-opus-5-5",
      maker: "kato",
      feature: "free",
      attempts: 2,
      resultCached: false,
      ok: true,
      usage,
      ...extra,
    },
    {},
  );
}

describe("pricing", () => {
  it("prices Claude models including cache reads and writes", () => {
    const p = priceFor("claude-opus-5-5", priceTable({}))!;
    // 1000×4 + 10000×20 + 100000×0.2 + 20000×5 (=4×1.25) = 324,000 / 1e6
    expect(costUsd(usage, p)).toBeCloseTo(0.324);
    expect(costUsd({ ...usage, cacheWrite1hTokens: 20_000 }, p)).toBeCloseTo(0.384);
    expect(costWithoutCacheUsd(usage, p)).toBeCloseTo((121_000 * 4 + 10_000 * 20) / 1e6);
  });

  it("finds prices by prefix and accepts overrides", () => {
    const t = priceTable({ AI_PRICING_JSON: '{"gpt-5":{"input":1.25,"output":10,"cacheRead":0.125}}' });
    expect(priceFor("claude-fable-5-2", t)?.input).toBe(8);
    expect(priceFor("claude-fable-5", t)?.cacheRead).toBe(1);
    expect(priceFor("claude-sonnet-5-5-preview", t)?.input).toBe(2);
    expect(priceFor("gpt-5", t)?.output).toBe(10);
    expect(priceFor("llama3.1", t)).toBeNull();
    expect(costUsd(usage, null)).toBeNull();
  });
});

describe("usage records", () => {
  it("summarizes tokens, cost and the cache hit rate", () => {
    const t = summarize([rec(), rec({ attempts: 0, resultCached: true, usage: zero }), rec({ model: "llama3.1", provider: "local" })]);
    expect(t.proposals).toBe(3);
    expect(t.resultCacheHits).toBe(1);
    expect(t.apiCalls).toBe(4);
    expect(t.costUsd).toBeCloseTo(0.324);
    expect(t.unpriced).toBe(1);
    expect(t.cacheHitRate).toBeCloseTo(200_000 / 242_000);
    expect(cacheHitRate(zero)).toBeNull();
  });

  it("groups by day (JST), month, user and feature", () => {
    const now = new Date("2026-11-15T01:00:00Z"); // 日本時間 11/15 10:00
    const records = [
      rec({ at: "2026-11-14T16:30:00Z" }), // 日本時間 11/15
      rec({ at: "2026-11-14T03:00:00Z", userId: "u2", username: "bob", feature: "expand" }),
      rec({ at: "2026-10-20T03:00:00Z" }),
    ];
    expect(jstDay("2026-11-14T16:30:00Z")).toBe("2026-11-15");
    const v = usageView(records, "this-month", now);
    expect(v.totals.proposals).toBe(2);
    expect(v.overview["last-month"].proposals).toBe(1);
    expect(v.overview.all.proposals).toBe(3);
    expect(v.daily).toHaveLength(30);
    expect(v.daily.at(-1)).toMatchObject({ key: "2026-11-15", proposals: 1 });
    expect(v.daily.at(-2)).toMatchObject({ key: "2026-11-14", proposals: 1 });
    expect(v.monthly).toHaveLength(12);
    expect(v.monthly.at(-1)?.key).toBe("2026-11");
    expect(v.monthly.at(-2)).toMatchObject({ key: "2026-10", proposals: 1 });
    expect(v.byUser.map((u) => u.label).sort()).toEqual(["alice", "bob"]);
    expect(v.byFeature.map((f) => f.id).sort()).toEqual(["expand", "free"]);
    expect(v.recent[0].at).toBe("2026-10-20T03:00:00Z");
  });

  it("keeps records in a file across restarts", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ng-usage-"));
    const file = path.join(dir, "ai-usage.jsonl");
    const log = new UsageLog(() => file);
    await log.append(rec());
    await log.append(rec({ userId: "u2" }));
    expect(readFileSync(file, "utf8").trim().split("\n")).toHaveLength(2);
    const again = new UsageLog(() => file);
    const all = await again.all();
    expect(all).toHaveLength(2);
    expect(all[1].userId).toBe("u2");
    expect(all[0].costUsd).toBeCloseTo(0.324);
  });
});
