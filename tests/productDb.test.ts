import { describe, expect, it } from "vitest";
import { overStock } from "../src/lib/ai";
import { usageOf } from "../src/lib/bom";
import { evaluatePlan } from "../src/lib/plan";
import { exampleFor } from "../src/lib/ai";
import { findProduct, PRODUCTS, productsCsv, shortfall, stockFromInventory } from "../src/lib/productDb";
import { mergePatterns, parsePatternFile, toPatternFile } from "../src/lib/patternFile";
import { getPart } from "../src/lib/parts";
import { PRICE_UNKNOWN } from "../src/data/prices";

describe("product database", () => {
  it("has one row per maker and code, each with contents and a price", () => {
    const keys = PRODUCTS.map((p) => `${p.maker}:${p.code}`);
    expect(new Set(keys).size).toBe(keys.length);
    const noPrice = PRODUCTS.filter((p) => p.priceJpy === null).map((p) => `${p.maker}:${p.code}`);
    // 定価を確認できなかった品番だけ価格不明（src/data/prices.ts の PRICE_UNKNOWN）
    expect(noPrice).toEqual(PRICE_UNKNOWN);
    for (const p of PRODUCTS) expect(p.contents.length).toBeGreaterThan(0);
  });

  it("merges mixed packs into one product", () => {
    const set = findProduct("tomix", "1099")!;
    expect(set.contents.map((c) => [c.partId, c.count])).toEqual([["S33", 2], ["S18.5", 2]]);
    expect(set.perPack).toBe(4);
    const kato = findProduct("kato", "20-091")!;
    expect(kato.contents.map((c) => [c.partId, c.count]).sort()).toEqual([["S29", 4], ["S45", 2]]);
  });

  it("keeps left and right turnouts apart in stock", () => {
    const stock = stockFromInventory({ "kato:20-202": 1, "kato:20-203": 2, "kato:20-100": 2 });
    expect(stock.get("kato:TO6")).toBe(1);
    expect(stock.get("kato:TO6:R")).toBe(2);
    expect(stock.get("kato:R249-45")).toBe(8);
  });

  it("uses verified dimensions", () => {
    expect(getPart("kato:TO6").joints[1].x).toBeCloseTo(186);
    expect(getPart("kato:TOC150").joints[1].x).toBeCloseTo(124);
    expect(getPart("kato:X15").joints[1].x).toBeCloseTo(186);
    expect(getPart("kato:X90").joints[1].x).toBeCloseTo(124);
    // TOMIX: PL541-15 の分岐に C541-15 を逆向きに足すと間隔37mm（公式製品ページ）
    expect(2 * 541 * (1 - Math.cos((15 * Math.PI) / 180))).toBeCloseTo(36.9, 1);
    expect(findProduct("tomix", "1272")!.geometryStatus).toBe("confirmed");
  });

  it("computes what to buy and its cost", () => {
    const { build } = evaluatePlan(exampleFor("kato"), { width: 1400, height: 800 }, "kato");
    const usage = usageOf(build.pieces);
    // R249-45 を1箱(4本)だけ持っている
    const res = shortfall(usage, stockFromInventory({ "kato:20-100": 1 }));
    const curve = res.rows.find((r) => r.stockKey === "kato:R249-45")!;
    expect(curve.used).toBe(8);
    expect(curve.missing).toBe(4);
    expect(curve.packs).toBe(1);
    expect(curve.costJpy).toBe(990);
    const to6 = res.rows.find((r) => r.stockKey === "kato:TO6")!;
    expect(to6.buy?.code).toBe("20-202");
    expect(res.totalCostJpy).toBeGreaterThan(990);
    expect(res.hasUnknownPrice).toBe(false);
  });

  it("flags parts used beyond what the user owns", () => {
    const { build } = evaluatePlan(exampleFor("kato"), { width: 1400, height: 800 }, "kato");
    const over = overStock(build.pieces, stockFromInventory({ "kato:20-100": 2, "kato:20-202": 1 }));
    expect(over.some((l) => l.includes("TO6 dir=R"))).toBe(true);
    expect(over.some((l) => l.includes("R249-45"))).toBe(false);
  });

  it("exports CSV with a header and every product", () => {
    const lines = productsCsv().trim().split("\n");
    expect(lines[0]).toContain("品番");
    expect(lines).toHaveLength(PRODUCTS.length + 1);
  });
});

describe("pattern files", () => {
  const layout = {
    title: "テスト",
    maker: "kato" as const,
    description: "",
    board: { width: 900, height: 600 },
    pieces: [{ uid: "a", partId: "kato:S248", mirror: false, x: 100, y: 100, rot: 0 }],
  };

  it("round-trips a pattern collection", () => {
    const file = toPatternFile([{ id: "p1", name: "A", savedAt: "2026-01-01T00:00:00Z", layout }]);
    const back = parsePatternFile(JSON.stringify(file));
    expect(back).toHaveLength(1);
    expect(back[0].layout.pieces[0].partId).toBe("kato:S248");
  });

  it("reads a single layout file and rejects unknown data", () => {
    expect(parsePatternFile(JSON.stringify(layout))[0].name).toBe("テスト");
    expect(() => parsePatternFile("{}")).toThrow();
    expect(() =>
      parsePatternFile(JSON.stringify({ ...layout, pieces: [{ ...layout.pieces[0], partId: "nope" }] })),
    ).toThrow();
  });

  it("keeps both patterns when ids collide", () => {
    const p = { id: "x", name: "A", savedAt: "", layout };
    expect(new Set(mergePatterns([p], [p]).map((q) => q.id)).size).toBe(2);
  });
});
