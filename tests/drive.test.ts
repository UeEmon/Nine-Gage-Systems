import { describe, expect, it } from "vitest";
import { buildDriveGraph, Drive, scaleKmhToMmPerSec, startRef } from "../src/lib/drive";
import { placeAt, worldJoints, type Piece } from "../src/lib/geometry";
import { buildFromPlan, type LayoutPlan } from "../src/lib/plan";
import { p, sidingPlan } from "./fixtures";

function oval(): Piece[] {
  const half = [p("S248"), p("S248"), ...Array(4).fill(p("R249-45", "R"))];
  const plan: LayoutPlan = {
    title: "oval",
    description: "",
    start: { x: 300, y: 80, heading: 0 },
    segments: [{ from: null, pieces: [...half, ...half] }],
  };
  return buildFromPlan(plan).pieces;
}

const LOOP = 4 * 248 + 2 * Math.PI * 249;

/** 走って通った部品 uid の並び */
function visited(drive: Drive, mm: number): string[] {
  const out: string[] = [];
  for (let d = 0; d < mm; d += 20) {
    if (!drive.advance(20)) break;
    const uid = drive.poseAt().uid;
    if (out[out.length - 1] !== uid) out.push(uid);
  }
  return out;
}

describe("drive", () => {
  it("goes around an oval and comes back to the start", () => {
    const pieces = oval();
    const drive = new Drive(buildDriveGraph(pieces), startRef(pieces)!);
    const start = drive.poseAt();
    expect(start.heading).toBeCloseTo(0);
    for (let i = 0; i < 100; i++) expect(drive.advance(LOOP / 100)).toBe(true);
    expect(drive.odometer).toBeCloseTo(LOOP);
    const end = drive.poseAt();
    expect(Math.hypot(end.x - start.x, end.y - start.y)).toBeLessThan(2);
    // 右回りのオーバルなので、カーブでは右カーブ（曲率が正）
    drive.advance(248 * 2 + 50);
    expect(drive.poseAt().curvature).toBeCloseTo(1 / 249, 4);
  });

  it("chooses the route at a turnout by the policy and the override", () => {
    const { pieces } = buildFromPlan(sidingPlan());
    const graph = buildDriveGraph(pieces);
    const straight = new Drive(graph, startRef(pieces, "s0p0")!);
    expect(straight.nextSwitch()).toBeNull(); // 走り始めの部品がポイントそのもの
    const sv = visited(straight, LOOP * 2);
    expect(sv).not.toContain("s1p0");

    const diverge = new Drive(graph, startRef(pieces, "s0p15")!);
    diverge.policy = "diverge";
    const sw = diverge.nextSwitch();
    expect(sw?.uid).toBe("s0p0");
    expect(sw?.options[0]).toBe("直進");
    expect(sw?.options[1]).toMatch(/分岐/);
    expect(visited(diverge, 600)).toContain("s1p0");

    const override = new Drive(graph, startRef(pieces, "s0p15")!);
    override.nextOverride = 1;
    expect(visited(override, 600)).toContain("s1p0");
  });

  it("stops at a dead end and can turn back", () => {
    const a = placeAt("kato:S248", false, 0, { x: 0, y: 0, deg: 0 }, "a");
    const b = placeAt("kato:S248", false, 0, worldJoints(a)[1], "b");
    const drive = new Drive(buildDriveGraph([a, b]), startRef([a, b], "a")!);
    expect(drive.remaining()).toBeCloseTo(496);
    expect(drive.advance(400)).toBe(true);
    expect(drive.advance(400)).toBe(false);
    expect(drive.poseAt().x).toBeCloseTo(496);
    drive.reverseDirection();
    expect(drive.poseAt().heading).toBeCloseTo(180);
    expect(drive.advance(300)).toBe(true);
    expect(drive.poseAt().x).toBeCloseTo(196);
  });

  it("climbs a ramp with the grade from the elevation", () => {
    const pieces: Piece[] = [];
    let cursor = { x: 0, y: 0, deg: 0 };
    const heights: (number | null)[] = [0, null, null, 20];
    heights.forEach((h, i) => {
      const placed = placeAt("kato:S248", false, 0, cursor, `c${i}`);
      pieces.push(h === null ? { ...placed, ramp: true } : { ...placed, z: h });
      cursor = worldJoints(placed)[1];
    });
    const drive = new Drive(buildDriveGraph(pieces), startRef(pieces, "c0")!);
    drive.advance(248 + 124);
    const pose = drive.poseAt();
    expect(pose.z).toBeCloseTo(5);
    expect(pose.gradePct).toBeCloseTo((10 / 248) * 100, 1);
    drive.advance(400);
    expect(drive.poseAt().z).toBeCloseTo(20);
  });

  it("converts scale speed to model speed", () => {
    // 1/150 で 100km/h は 約185mm/s
    expect(scaleKmhToMmPerSec(100)).toBeCloseTo(185.2, 1);
  });
});
