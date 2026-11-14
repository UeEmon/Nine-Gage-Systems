import { describe, expect, it } from "vitest";
import { analyze, placeAt, worldJoints } from "../src/lib/geometry";
import { evaluatePlan, type LayoutPlan } from "../src/lib/plan";
import { sidingPlan } from "./fixtures";

const p = (part: string, dir: "L" | "R" = "L", enter = 0, exit = 1) => ({ part, dir, enter, exit }) as const;

const board = { width: 1200, height: 700 };

function oval(): LayoutPlan {
  const half = [p("S248"), p("S248"), ...Array(4).fill(p("R249-45", "R"))];
  return {
    title: "oval",
    description: "",
    start: { x: 300, y: 80, heading: 0 },
    segments: [{ from: null, pieces: [...half, ...half] }],
  };
}

describe("geometry", () => {
  it("places a straight at a joint facing outward", () => {
    const piece = placeAt("S248", false, 0, { x: 10, y: 20, deg: 0 });
    const [j0, j1] = worldJoints(piece);
    expect(j0.x).toBeCloseTo(10);
    expect(j1.x).toBeCloseTo(258);
    expect(j1.deg).toBeCloseTo(0);
  });

  it("a right curve turns clockwise on screen (heading increases)", () => {
    const piece = placeAt("R249-45", true, 0, { x: 0, y: 0, deg: 0 });
    const j1 = worldJoints(piece)[1];
    expect(j1.deg).toBeCloseTo(45);
    expect(j1.y).toBeGreaterThan(0);
  });

  it("closes a simple oval with no open ends", () => {
    const { analysis, problems } = evaluatePlan(oval(), board);
    expect(analysis.openJoints).toHaveLength(0);
    expect(analysis.connections).toHaveLength(12);
    expect(problems).toBeNull();
  });

  it("reports open ends and out-of-board pieces", () => {
    const plan = oval();
    plan.segments[0].pieces.pop();
    plan.start.x = -100;
    const { analysis, problems } = evaluatePlan(plan, board);
    expect(analysis.openJoints.length).toBe(2);
    expect(analysis.outOfBoard.length).toBeGreaterThan(0);
    expect(problems).toContain("つながっていない端");
  });

  it("builds a passing siding with two turnouts", () => {
    const { analysis, problems } = evaluatePlan(sidingPlan(), { width: 1400, height: 800 });
    expect(problems).toBeNull();
    expect(analysis.openJoints).toHaveLength(0);
    // ポイント2個 + 待避線の曲線2本 → 3ジョイントの部品が2つ増える
    expect(analysis.connections).toHaveLength(19);
  });

  it("detects overlapping pieces", () => {
    const a = placeAt("S248", false, 0, { x: 100, y: 100, deg: 0 }, "a");
    const b = placeAt("S248", false, 0, { x: 120, y: 105, deg: 0 }, "b");
    const res = analyze({ board, pieces: [a, b] });
    expect(res.overlaps).toEqual([["a", "b"]]);
  });
});
