import { describe, expect, it } from "vitest";
import { exampleFor, sessionOptions, systemPrompt } from "../src/lib/ai";
import { billOfMaterials } from "../src/lib/bom";
import { CATALOG } from "../src/data/trackCatalog";
import { getPart, MAKERS, PARTS, partsFor } from "../src/lib/parts";
import { buildFromPlan, evaluatePlan, planSchemaFor } from "../src/lib/plan";

describe("track catalog", () => {
  it("has unique part ids across makers", () => {
    const ids = PARTS.map((p) => p.key);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(MAKERS)("%s has every category, each with product codes", (maker) => {
    const cats = new Set(partsFor(maker).map((p) => p.category));
    expect([...cats].sort()).toEqual(["bumper", "crossing", "curve", "double", "straight", "turnout"]);
    for (const e of CATALOG[maker]) expect(e.products.length).toBeGreaterThan(0);
  });

  it("derives the expected joints for each shape", () => {
    const j = (key: string) => getPart(key).joints.length;
    expect(j("kato:S248")).toBe(2);
    expect(j("kato:TO6")).toBe(3);
    expect(j("kato:TOY2")).toBe(3);
    expect(j("tomix:PLR541/280-15")).toBe(4);
    expect(j("kato:X90")).toBe(4);
    expect(j("tomix:PXL140-15")).toBe(4);
    expect(j("kato:XO4")).toBe(4);
    expect(j("kato:DXO")).toBe(4);
    expect(j("tomix:DC317-45")).toBe(4);
    expect(j("kato:BUMPER")).toBe(1);
    // ダブルクロスの渡り線は反対側の線路の端にぴったり届く
    const dxo = getPart("tomix:PX280").joints;
    expect(dxo[3].y).toBeCloseTo(-37);
    expect(dxo[3].x).toBeCloseTo(280);
  });

  it.each([
    ["kato", "DR414-45", "DA414-22.5", "DS248"],
    ["tomix", "DC391-45", null, "DS280"],
  ] as const)("a %s double-track oval closes", (maker, curve, approach, straight) => {
    const R = (part: string) => ({ part, dir: "R" as const, enter: 0, exit: 1 });
    const half = approach
      ? [R(straight), R(approach), R(curve), R(curve), R(curve), R(approach)]
      : [R(straight), R(curve), R(curve), R(curve), R(curve)];
    const plan = {
      title: "",
      description: "",
      start: { x: 600, y: 80, heading: 0 },
      segments: [{ from: null, pieces: [...half, ...half] }],
    };
    // 外側の線路（j0→j1）でつないでいくと、内側（j2→j3）も自動的に閉じる
    const { analysis } = evaluatePlan(plan, { width: 2400, height: 1400 }, maker);
    expect(analysis.openJoints).toHaveLength(0);
    expect(analysis.overlaps).toHaveLength(0);
  });

  it("a crossover joins two parallel tracks", () => {
    const S = (part: string, enter = 0, exit = 1) => ({ part, dir: "L" as const, enter, exit });
    const plan = {
      title: "",
      description: "",
      start: { x: 100, y: 300, heading: 0 },
      segments: [
        { from: null, pieces: [S("DS248"), S("XO4"), S("DS248")] },
      ],
    };
    const { analysis } = evaluatePlan(plan, { width: 1400, height: 800 }, "kato");
    // 両端の4つだけが開いていて、中はすべてつながっている
    expect(analysis.openJoints).toHaveLength(4);
    expect(analysis.connections).toHaveLength(4);
  });

  it.each(MAKERS)("the %s example in the AI prompt builds a closed layout", (maker) => {
    const { problems, analysis } = evaluatePlan(exampleFor(maker), { width: 1400, height: 800 }, maker);
    expect(problems).toBeNull();
    expect(analysis.openJoints).toHaveLength(0);
    expect(planSchemaFor(maker).safeParse(exampleFor(maker)).success).toBe(true);
  });

  it("restricts AI output to the chosen maker's parts", () => {
    expect(planSchemaFor("tomix").safeParse(exampleFor("kato")).success).toBe(false);
    const tomix = JSON.stringify(sessionOptions("tomix").jsonSchema);
    expect(tomix).toContain("C280-45");
    expect(tomix).not.toContain("R249-45");
    expect(systemPrompt("tomix")).toContain("TOMIX ファイントラック");
  });

  it("counts product codes and packs, with left/right turnouts separately", () => {
    const { pieces } = buildFromPlan(exampleFor("tomix"), "tomix");
    const bom = billOfMaterials(pieces);
    const byCode = Object.fromEntries(bom.map((r) => [r.product.code, r]));
    expect(byCode["1851"].count).toBe(8); // C280-45 x8 → 4本入り2箱
    expect(byCode["1851"].packs).toBe(2);
    expect(byCode["1272"].count).toBe(1); // PL541-15 左
    expect(byCode["1271"].count).toBe(1); // PR541-15 右
    expect(byCode["1802"].count).toBe(3); // S280
  });
});
