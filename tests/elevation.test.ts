import { describe, expect, it } from "vitest";
import { overpassExampleFor, systemPrompt } from "../src/lib/ai";
import { billOfMaterials, usageOf } from "../src/lib/bom";
import { trackPlacementHeight } from "../src/lib/elevation";
import { analyze, placeAt, worldJoints, type Piece } from "../src/lib/geometry";
import { evaluatePlan, planSchemaFor, type LayoutPlan } from "../src/lib/plan";
import { findProduct, shortfall } from "../src/lib/productDb";
import { getPart } from "../src/lib/parts";

const board = { width: 3000, height: 1500 };

/** 部品を順に直線でつなぐ（heights: 数値=高さ, null=勾配） */
function chain(start: { x: number; y: number; deg: number }, parts: [string, number | null][]): Piece[] {
  const out: Piece[] = [];
  let cursor = start;
  parts.forEach(([partId, h], i) => {
    const placed = placeAt(partId, false, 0, cursor, `c${i}`);
    out.push(h === null ? { ...placed, ramp: true } : { ...placed, z: h });
    cursor = worldJoints(placed)[1];
  });
  return out;
}

describe("elevation", () => {
  it("places new track at the selected level or at the exact height of the connecting end", () => {
    const part = getPart("kato:S248");
    expect(trackPlacementHeight(part, "ground")).toEqual({});
    expect(trackPlacementHeight(part, "ramp", 0)).toEqual({ ramp: true });
    expect(trackPlacementHeight(part, "elevated", 0)).toEqual({ z: 50 });
    expect(trackPlacementHeight(part, "elevated", 73.5)).toEqual({ z: 73.5 });
    expect(trackPlacementHeight(getPart("tomix:S280"), "underground")).toEqual({ z: -55 });
    expect(trackPlacementHeight(part, -65)).toEqual({ z: -65 });

    const pieces = chain({ x: 50, y: 300, deg: 0 }, [["kato:S248", 73.5], ["kato:S248", null]]);
    const rampEnd = analyze({ board, pieces }).elevation.joints.get("c1")![1];
    const next = {
      ...placeAt(part.key, false, 0, worldJoints(pieces[1])[1], "next"),
      ...trackPlacementHeight(part, "auto", rampEnd),
    };
    expect(next).toMatchObject({ z: 73.5 });
    expect(next.ramp).toBeUndefined();
    expect(analyze({ board, pieces: [...pieces, next] }).heightSteps).toEqual([]);
  });

  it("connects to the same height when another open end overlaps it in plan view", () => {
    const [ground] = chain({ x: 50, y: 300, deg: 0 }, [["kato:S248", 0]]);
    const elevated = { ...ground, uid: "elevated", z: 50 };
    const next = { ...placeAt("kato:S248", false, 0, worldJoints(elevated)[1], "next"), z: 50 };
    const analysis = analyze({ board, pieces: [ground, elevated, next] });
    expect(analysis.connections).toHaveLength(1);
    expect(analysis.connections[0]).toMatchObject({ a: { pieceUid: "elevated" }, b: { pieceUid: "next" } });
    expect(analysis.heightSteps).toEqual([]);
  });

  it("interpolates a ramp between ground and viaduct by length", () => {
    const pieces = chain({ x: 50, y: 300, deg: 0 }, [
      ["kato:S248", 0],
      ...Array<[string, number | null]>(5).fill(["kato:S248", null]),
      ["kato:S248", 50],
    ]);
    const a = analyze({ board, pieces });
    const z = (uid: string) => a.elevation.joints.get(uid)!;
    expect(z("c1")).toEqual([0, 10]);
    expect(z("c3")[0]).toBeCloseTo(20);
    expect(z("c5")[1]).toBeCloseTo(50);
    // 248mmで10mm = 約4.03% は KATO の標準の勾配として通す
    expect(a.elevation.grades.get("c3")).toBeCloseTo(4.03, 2);
    expect(a.steepGrades).toEqual([]);
    expect(a.heightSteps).toEqual([]);
  });

  it("flags steep grades and height steps", () => {
    const steep = chain({ x: 50, y: 300, deg: 0 }, [["kato:S248", 0], ["kato:S248", null], ["kato:S248", 50]]);
    expect(analyze({ board, pieces: steep }).steepGrades[0].gradePct).toBeCloseTo(20.2, 1);
    const step = chain({ x: 50, y: 300, deg: 0 }, [["kato:S248", 0], ["kato:S248", 50]]);
    const res = analyze({ board, pieces: step });
    expect(res.heightSteps).toHaveLength(1);
    expect(res.heightSteps[0].dz).toBe(50);
  });

  it("treats a crossing with enough height difference as an overpass", () => {
    const ground = placeAt("kato:S248", false, 0, { x: 400, y: 400, deg: 0 }, "g");
    const upper = (z: number) => ({ ...placeAt("kato:S248", false, 0, { x: 524, y: 276, deg: 90 }, "u"), z });
    const ok = analyze({ board, pieces: [ground, upper(50)] });
    expect(ok.overlaps).toEqual([]);
    expect(ok.crossings).toEqual([{ a: "g", b: "u", dz: 50 }]);
    const low = analyze({ board, pieces: [ground, upper(30)] });
    expect(low.overlaps).toEqual([["g", "u"]]);
    expect(low.lowClearance[0]).toMatchObject({ dz: 30, needed: 50 });
  });

  it("places piers under raised track and catches piers standing on lower track", () => {
    const ground = placeAt("kato:S248", false, 0, { x: 400, y: 400, deg: 0 }, "g");
    // 高架の直線のつなぎ目（橋脚の位置）が地上の線路の真上にある
    const upperA = { ...placeAt("kato:S248", false, 0, { x: 524, y: 152, deg: 90 }, "u1"), z: 50 };
    const upperB = { ...placeAt("kato:S248", false, 0, worldJoints(upperA)[1], "u2"), z: 50 };
    const a = analyze({ board, pieces: [ground, upperA, upperB] });
    expect(a.piers).toHaveLength(3);
    expect(a.piers.every((p) => p.height === 50 && p.fit && !p.double)).toBe(true);
    expect(a.pierHits).toEqual([{ pier: 1, uid: "g" }]);
  });

  it("uses a double-track pier under double-track viaduct", () => {
    const d = { ...placeAt("kato:DS248", false, 0, { x: 100, y: 300, deg: 0 }, "d"), z: 50 };
    const piers = analyze({ board, pieces: [d] }).piers;
    expect(piers).toHaveLength(2);
    expect(piers.every((p) => p.double)).toBe(true);
    // 2本の線路の中間（右側 y=300 と左側 y=267 の間）に立つ
    expect(piers[0].y).toBeCloseTo(283.5);
  });
});

describe("parts list for viaducts", () => {
  it("counts viaduct track, piers and pier sets", () => {
    const pieces = chain({ x: 50, y: 300, deg: 0 }, [
      ["kato:S248", 0],
      ...Array<[string, number | null]>(5).fill(["kato:S248", null]),
      ["kato:S248", 50],
      ["kato:S248", 50],
    ]);
    const usage = usageOf(pieces);
    expect(usage.get("kato:S248")).toBe(1); // 地上の1本だけ普通の線路
    expect(usage.get("kato:S248:V")).toBe(7); // 勾配と高架は高架線路
    expect(usage.get("kato:pier:S:10")).toBe(1);
    expect(usage.get("kato:pier:S:50")).toBe(3);

    const bom = billOfMaterials(pieces);
    const viaduct = bom.find((r) => r.key === "kato:S248:V")!;
    expect(viaduct.product.code).toBe("20-400");
    expect(viaduct.packs).toBe(4);
    expect(bom.filter((r) => r.kind === "pier").map((r) => r.key)).toContain("kato:pier:S:30");

    // 10mm のために買う補助セットに 20/30/40mm も入っているので、それらは買い足さない。50mm は橋脚No.5を買う
    const sf = shortfall(usage, new Map());
    const bought = sf.rows.filter((r) => r.packs > 0).map((r) => `${r.buy!.code}x${r.packs}`);
    expect(bought.sort()).toEqual(["20-000-Lx1", "20-400x4", "23-016-1x1", "23-017-1x1"]);
    const thirty = sf.rows.find((r) => r.stockKey === "kato:pier:S:30")!;
    expect(thirty).toMatchObject({ missing: 0, fromSet: 1 });
  });

  it("adds the separately sold rail for a TOMIX bridge", () => {
    const bridge = { ...placeAt("tomix:TRUSS280", false, 0, { x: 100, y: 300, deg: 0 }, "b"), z: 55 };
    const usage = usageOf([bridge]);
    expect(usage.get("tomix:TRUSS280")).toBe(1);
    expect(usage.get("tomix:S280")).toBe(1);
    expect(usage.get("tomix:pier:S:55")).toBe(2);
  });

  it("lists viaduct, bridge and pier products with prices", () => {
    expect(findProduct("kato", "20-400")!.category).toBe("elevated");
    expect(findProduct("kato", "20-544")!.contents[0].stockKey).toBe("kato:DR414-45:V");
    expect(findProduct("tomix", "1822")!.contents[0].stockKey).toBe("tomix:S280:V");
    expect(findProduct("kato", "20-430")!.category).toBe("bridge");
    const set = findProduct("kato", "23-015-1")!;
    expect(set.category).toBe("pier");
    expect(set.perPack).toBe(10);
    expect(findProduct("tomix", "3234")!.contents).toHaveLength(10);
    expect(getPart("kato:DGC448-15").handed).toBe(true);
  });
});

describe("AI and overpasses", () => {
  it("the TOMIX figure-eight overpass example closes, crosses over and stays within the grade", () => {
    const plan = overpassExampleFor("tomix")!;
    const { problems, analysis, build } = evaluatePlan(plan, { width: 1600, height: 800 }, "tomix");
    expect(problems).toBeNull();
    expect(analysis.crossings).toHaveLength(1);
    expect(analysis.crossings[0].dz).toBe(55);
    expect(build.pieces.filter((p) => p.ramp)).toHaveLength(16);
    expect(planSchemaFor("tomix").safeParse(plan).success).toBe(true);
  });

  it("explains heights in the prompt and accepts plans without heights", () => {
    expect(systemPrompt("kato")).toContain("立体交差");
    expect(systemPrompt("tomix")).toContain("8の字の立体交差");
    const plan: LayoutPlan = {
      title: "",
      description: "",
      start: { x: 0, y: 0, heading: 0 },
      segments: [{ from: null, pieces: [{ part: "S248", dir: "L", enter: 0, exit: 1 }] }],
    };
    const parsed = planSchemaFor("kato").parse(plan);
    expect(parsed.segments[0].pieces[0].height).toBe(0);
  });

  it("reports elevation problems to the AI", () => {
    const plan: LayoutPlan = {
      title: "",
      description: "",
      start: { x: 100, y: 300, heading: 0 },
      segments: [
        {
          from: null,
          pieces: [
            { part: "S248", dir: "L", enter: 0, exit: 1, height: 0 },
            { part: "S248", dir: "L", enter: 0, exit: 1, height: null },
            { part: "S248", dir: "L", enter: 0, exit: 1, height: 50 },
            { part: "BUMPER", dir: "L", enter: 0, exit: 0, height: 50 },
          ],
        },
      ],
    };
    const { problems } = evaluatePlan(plan, board, "kato");
    expect(problems).toContain("急勾配");
  });
});
