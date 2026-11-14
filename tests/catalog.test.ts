import { describe, expect, it } from "vitest";
import { exampleFor, sessionOptions, systemPrompt } from "../src/lib/ai";
import { billOfMaterials } from "../src/lib/bom";
import { CATALOG } from "../src/data/trackCatalog";
import { MAKERS, PARTS, partsFor } from "../src/lib/parts";
import { buildFromPlan, evaluatePlan, planSchemaFor } from "../src/lib/plan";

describe("track catalog", () => {
  it("has unique part ids across makers", () => {
    const ids = PARTS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(MAKERS)("%s has straights, curves, a turnout and a bumper with product codes", (maker) => {
    const kinds = new Set(partsFor(maker).map((p) => p.kind));
    expect([...kinds].sort()).toEqual(["bumper", "curve", "straight", "turnout"]);
    for (const e of CATALOG[maker]) {
      expect(e.products.length).toBeGreaterThan(0);
      if (e.kind === "turnout") expect(e.productsRight?.length).toBeGreaterThan(0);
    }
  });

  it.each(MAKERS)("the %s example in the AI prompt builds a closed layout", (maker) => {
    const { problems, analysis } = evaluatePlan(exampleFor(maker), { width: 1400, height: 800 });
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
    const { pieces } = buildFromPlan(exampleFor("tomix"));
    const bom = billOfMaterials(pieces);
    const byCode = Object.fromEntries(bom.map((r) => [r.product.code, r]));
    expect(byCode["1851"].count).toBe(8); // C280-45 x8 → 4本入り2箱
    expect(byCode["1851"].packs).toBe(2);
    expect(byCode["1272"].count).toBe(1); // PL541-15 左
    expect(byCode["1271"].count).toBe(1); // PR541-15 右
    expect(byCode["1802"].count).toBe(3); // S280
  });
});
