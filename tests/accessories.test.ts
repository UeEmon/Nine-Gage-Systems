import { describe, expect, it } from "vitest";
import { ACCESSORIES, accessoriesFor, getAccessory, placeOnPiece, snapAccessory, trackPoints, type Accessory } from "../src/lib/accessories";
import { billOfMaterials, usageOf } from "../src/lib/bom";
import { placeAt, type Piece } from "../src/lib/geometry";
import { evaluatePlan, planSchemaFor, type LayoutPlan } from "../src/lib/plan";
import { exampleFor, sessionOptions, systemPrompt } from "../src/lib/ai";
import { findProduct, productsCsv, shortfall, stockFromInventory } from "../src/lib/productDb";
import { parsePatternFile, toPatternFile } from "../src/lib/patternFile";

const straight = (id: string, uid: string, x = 0, y = 0): Piece => ({ uid, partId: id, mirror: false, x, y, rot: 0 });

describe("accessory catalog", () => {
  it("has real products with prices for both makers", () => {
    for (const maker of ["kato", "tomix"] as const) {
      const list = accessoriesFor(maker);
      expect(list.length).toBeGreaterThan(8);
      for (const k of ["crossing", "signal", "platform", "island", "bridgeStation"]) expect(list.some((a) => a.kind === k)).toBe(true);
      for (const a of list) {
        const prod = findProduct(maker, a.code)!;
        expect(prod.priceJpy).toBe(a.priceJpy);
        expect(prod.contents[0].stockKey).toBe(`${maker}:acc:${a.code}`);
      }
    }
    const keys = ACCESSORIES.map((a) => a.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(findProduct("kato", "20-652")!.priceJpy).toBe(19800);
    expect(findProduct("tomix", "5569")!.name).toBe("TCS自動踏切Ⅱ");
    expect(productsCsv()).toContain("自動踏切S基本セット");
  });
});

describe("snapping to track", () => {
  const pieces = [straight("kato:S248", "a")];
  it("puts a side platform beside the track on the side it was dragged to", () => {
    const def = getAccessory("kato:SIDE-A");
    const left = snapAccessory(def, { x: 120, y: -30 }, pieces)!;
    expect(left.side).toBe("L");
    expect(left.host).toBe("a");
    expect(left.y).toBeCloseTo(-def.offset!);
    expect(left.rot).toBeCloseTo(0);
    const right = snapAccessory(def, { x: 120, y: 30 }, pieces)!;
    expect(right.side).toBe("R");
    expect(right.y).toBeCloseTo(def.offset!);
  });
  it("puts a crossing on the track center and ignores far points", () => {
    const def = getAccessory("kato:CROSSING");
    const s = snapAccessory(def, { x: 100, y: 12 }, pieces)!;
    expect(s.y).toBeCloseTo(0);
    expect(s.x).toBeCloseTo(100, 0);
    expect(snapAccessory(def, { x: 100, y: 300 }, pieces)).toBeNull();
  });
  it("follows curves and keeps the current direction", () => {
    const curve = placeAt("kato:R249-45", false, 0, { x: 0, y: 0, deg: 180 }, "c");
    const mid = trackPoints(curve)[Math.floor(trackPoints(curve).length / 2)];
    const def = getAccessory("kato:SIGNAL3");
    const s = snapAccessory(def, { x: mid.x + 3, y: mid.y }, [curve])!;
    expect(Math.abs(s.rot - mid.deg)).toBeLessThan(2);
    const back = snapAccessory(def, { x: mid.x + 3, y: mid.y }, [curve], undefined, { rot: mid.deg + 180 })!;
    expect(Math.abs(Math.abs(back.rot - mid.deg) - 180)).toBeLessThan(2);
  });
  it("uses the track height for elevated stations", () => {
    const high = { ...straight("kato:S248", "h"), z: 50 };
    const acc = placeOnPiece(getAccessory("kato:ISLAND-A"), high, undefined, "L", "x");
    expect(acc.z).toBe(50);
  });
});

describe("parts list", () => {
  it("counts accessories and drops the track a crossing set replaces", () => {
    const pieces = [straight("kato:S124", "a"), straight("kato:S248", "b", 124)];
    const crossing: Accessory = { uid: "x", itemId: "kato:CROSSING", x: 62, y: 0, rot: 0, host: "a" };
    const station: Accessory = { uid: "y", itemId: "kato:STATION", x: 300, y: 100, rot: 0 };
    const usage = usageOf(pieces, [crossing, station]);
    expect(usage.get("kato:S124")).toBeUndefined();
    expect(usage.get("kato:S248")).toBe(1);
    expect(usage.get("kato:acc:20-652")).toBe(1);
    expect(usage.get("kato:acc:23-210")).toBe(1);
    // S248 の上なら線路はそのまま
    expect(usageOf(pieces, [{ ...crossing, host: "b" }]).get("kato:S124")).toBe(1);
    const bom = billOfMaterials(pieces, [crossing, station]);
    expect(bom.filter((r) => r.kind === "accessory").map((r) => r.product.code).sort()).toEqual(["20-652", "23-210"]);
    expect(bom[bom.length - 1].kind).toBe("accessory");
  });
  it("uses owned accessories in the shortfall", () => {
    const usage = usageOf([], [{ uid: "s", itemId: "tomix:SIDE", x: 0, y: 0, rot: 0 }]);
    const sf = shortfall(usage, stockFromInventory({ "tomix:4031": 1 }));
    expect(sf.totalCostJpy).toBe(0);
    expect(shortfall(usage, new Map()).totalCostJpy).toBe(3080);
  });
});

describe("AI plan with accessories", () => {
  it("places stations on the planned pieces", () => {
    const plan: LayoutPlan = {
      ...exampleFor("kato"),
      accessories: [
        { item: "SIDE-A", segment: 0, piece: 1, side: "L" },
        { item: "CROSSING", segment: 0, piece: 11, side: "L" },
      ],
    };
    const { build, problems } = evaluatePlan(plan, { width: 1400, height: 800 }, "kato");
    expect(build.accessories).toHaveLength(2);
    expect(build.accessories[0].host).toBe(build.index[0][1]);
    expect(problems).toBeNull();
  });
  it("reports bad references", () => {
    const plan: LayoutPlan = { ...exampleFor("kato"), accessories: [{ item: "SIDE-A", segment: 5, piece: 0, side: "L" }] };
    expect(evaluatePlan(plan, { width: 1400, height: 800 }, "kato").problems).toContain("ありません");
    const onTurnout: LayoutPlan = { ...exampleFor("kato"), accessories: [{ item: "CROSSING", segment: 0, piece: 0, side: "L" }] };
    expect(evaluatePlan(onTurnout, { width: 1400, height: 800 }, "kato").problems).toContain("直線の上");
  });
  it("tells the AI about the accessories and accepts plans without them", () => {
    expect(systemPrompt("tomix")).toContain("5569");
    expect(JSON.stringify(sessionOptions("kato").jsonSchema)).toContain("accessories");
    expect(planSchemaFor("kato").parse(exampleFor("kato")).accessories).toEqual([]);
  });
});

describe("pattern file", () => {
  it("keeps accessories and rejects unknown ones", () => {
    const layout = {
      title: "駅",
      description: "",
      board: { width: 900, height: 600 },
      pieces: [straight("kato:S248", "a")],
      accessories: [{ uid: "s", itemId: "kato:SIDE-A", x: 124, y: -22, rot: 0, host: "a", side: "L" as const }],
    };
    const text = JSON.stringify(toPatternFile([{ id: "p", name: "駅", savedAt: "2026-11-15T00:00:00Z", layout }]));
    expect(parsePatternFile(text)[0].layout.accessories).toHaveLength(1);
    expect(() => parsePatternFile(text.replace("kato:SIDE-A", "kato:NOPE"))).toThrow();
  });
});
