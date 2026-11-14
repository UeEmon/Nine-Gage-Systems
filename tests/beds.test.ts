import { describe, expect, it } from "vitest";
import { bedOfProductName } from "../src/data/trackCatalog";
import { bedsFor, bedVariantsOf, getPart, partsFor } from "../src/lib/parts";
import { findProduct, productsCsv, productsOfPart, stockFromInventory } from "../src/lib/productDb";
import { jointsOf } from "../src/lib/shapes";

describe("roadbed variants (slab, wide PC)", () => {
  it("reads the roadbed type from product names", () => {
    expect(bedOfProductName("スラブレールS280-SL(F)(4本セット)")).toBe("slab");
    expect(bedOfProductName("ワイドPCレールS280-WP(F)(4本セット)")).toBe("widePc");
    expect(bedOfProductName("ストレートPCレール S280-PC(F)")).toBe("pc");
    expect(bedOfProductName("高架橋付PCレールHS280-PC(F)")).toBe("viaduct");
    expect(bedOfProductName("電動合成枕木ポイントN-PL541-15-SY(F)")).toBe("synthetic");
    expect(bedOfProductName("ストレートレールS280(F)")).toBe("ballast");
  });

  it("adds TOMIX slab and wide PC rails with the same shape as the basic rail", () => {
    for (const [variant, base] of [
      ["S280-SL", "S280"],
      ["S140-SL", "S140"],
      ["DS280-SL", "DS280"],
      ["DS1120-SL", "DS1120"],
      ["DC465-45-SL", "DC465-45"],
      ["S280-WP", "S280"],
      ["C391-45-WP", "C391-45"],
      ["C541-15-WP", "C541-15"],
    ]) {
      const v = getPart(`tomix:${variant}`);
      const b = getPart(`tomix:${base}`);
      expect(v.shapeId).toBe(base);
      expect(v.joints).toEqual(b.joints);
      expect(bedVariantsOf(b).map((p) => p.id)).toContain(variant);
      expect(bedVariantsOf(v)[0].id).toBe(base);
    }
    expect(getPart("tomix:S280-SL").bed).toBe("slab");
    expect(getPart("tomix:S280-WP").bed).toBe("widePc");
    expect(bedsFor("tomix")).toEqual(["ballast", "slab", "widePc"]);
  });

  it("models the 22.5° double slab curve (16 pieces make a circle)", () => {
    const p = getPart("tomix:DC539-22.5-SL");
    expect(p.joints).toHaveLength(4);
    expect(Math.abs(p.joints[1].deg)).toBeCloseTo(22.5);
    expect(jointsOf(p.routes)).toHaveLength(4);
  });

  it("counts slab products toward the slab part, not the ballast part", () => {
    const stock = stockFromInventory({ "tomix:1048": 1, "tomix:1802": 1, "kato:20-006": 1 });
    expect(stock.get("tomix:S280-SL")).toBe(4);
    expect(stock.get("tomix:S280")).toBe(4);
    expect(stock.get("kato:DS248-SL")).toBe(1);
    expect(stock.get("kato:DS248")).toBeUndefined();
  });

  it("keeps PC sleeper products with the basic part, labelled as PC", () => {
    const codes = productsOfPart(getPart("tomix:S280")).map((p) => [p.code, p.bed]);
    expect(codes).toContainEqual(["1802", "ballast"]);
    expect(codes).toContainEqual(["1012", "pc"]);
    expect(codes).toContainEqual(["1822", "viaduct"]);
    expect(findProduct("tomix", "1067")!.bed).toBe("slab");
  });

  it("splits KATO slab double track into its own parts", () => {
    expect(productsOfPart(getPart("kato:DS248")).map((p) => p.code)).not.toContain("20-006");
    expect(productsOfPart(getPart("kato:DS248-SL")).map((p) => p.code)).toEqual(["20-006"]);
    expect(partsFor("kato").filter((p) => p.bed === "slab").map((p) => p.id)).toEqual([
      "DS248-SL", "DS186-SL", "DS124-SL", "DS62-SL", "DR414-45-SL", "DA414-22.5-SL",
    ]);
  });

  it("exports the roadbed type in the CSV", () => {
    const csv = productsCsv();
    expect(csv.split("\n")[0]).toContain("道床");
    expect(csv).toMatch(/1048,スラブレールS280-SL\(F\)\(4本セット\),直線,,4,S280-SL×4,直線280mm,スラブ,/);
  });
});
