import { describe, expect, it } from "vitest";
import { buildDriveGraph, carPlacements, Drive, N_CAR, scaleKmhToMmPerSec, startRef, trainLength } from "../src/lib/drive";
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

  it("places N-scale cars on the track by their bogies, also right after starting", () => {
    const pieces = oval();
    const drive = new Drive(buildDriveGraph(pieces), startRef(pieces)!, Math.random, trainLength(3) + 20);
    // 走り始めから後ろの車両も線路の上（通ってきた線路を逆にたどって用意する）
    const front = drive.poseAt();
    const cars = carPlacements(drive, 3);
    expect(cars).toHaveLength(3);
    // 1両目は直線の上なので前端から半両分うしろ。3両目は後ろの曲線にかかるので、線路に沿った距離より少し近い
    const along = 2 * (N_CAR.length + N_CAR.gap) + N_CAR.length / 2;
    const d3 = Math.hypot(cars[2].x - front.x, cars[2].y - front.y);
    expect(d3).toBeGreaterThan(along - 30);
    expect(d3).toBeLessThan(along);
    drive.advance(200);
    const [first] = carPlacements(drive, 1);
    expect(first.x).toBeCloseTo(drive.poseAt().x - N_CAR.length / 2);
    expect(first.y).toBeCloseTo(drive.poseAt().y);

    // 半径249mmの曲線の中では、車体の中心は台車の間の弦の中点（中心線から内側へ 約4.3mm）
    drive.advance(2 * 248 + 249 * Math.PI * 0.5 - 200);
    const center = { x: 300 + 496, y: 80 + 249 };
    const car = carPlacements(drive, 1)[0];
    const r = Math.hypot(car.x - center.x, car.y - center.y);
    expect(r).toBeCloseTo(Math.sqrt(249 ** 2 - (N_CAR.bogieCenters / 2) ** 2), 0);
  });

  it("keeps the cars on the track after turning back", () => {
    const a = placeAt("kato:S248", false, 0, { x: 0, y: 0, deg: 0 }, "a");
    const b = placeAt("kato:S248", false, 0, worldJoints(a)[1], "b");
    const drive = new Drive(buildDriveGraph([a, b]), startRef([a, b], "a")!, Math.random, 300);
    drive.advance(200);
    drive.reverseDirection();
    const [car] = carPlacements(drive, 1);
    expect(car.heading).toBeCloseTo(180);
    expect(car.x).toBeCloseTo(200 + N_CAR.length / 2);
    expect(car.y).toBeCloseTo(0);
  });

  it("converts scale speed to model speed", () => {
    // 1/150 で 100km/h は 約185mm/s
    expect(scaleKmhToMmPerSec(100)).toBeCloseTo(185.2, 1);
  });
});

describe("映像の車両", () => {
  it("車種ごとに異なる形を作り、既存の車両長に収める", async () => {
    const { buildTrain } = await import("../src/lib/driveScene");
    const { VEHICLE_TYPES } = await import("../src/lib/drive");
    const { Box3, Vector3 } = await import("three");
    const shapes: number[] = [];
    for (const type of VEHICLE_TYPES) {
      const model = buildTrain(3, 0x2f6fb5, type.value);
      expect(model.cars).toHaveLength(3);
      let meshes = 0;
      model.group.traverse((o) => { if (o.type === "Mesh") meshes++; });
      shapes.push(meshes);
      for (const car of model.cars) {
        const box = new Box3().setFromObject(car);
        expect(box.getSize(new Vector3()).x).toBeLessThanOrEqual(N_CAR.length + 0.7);
        expect(box.min.y).toBeGreaterThanOrEqual(0);
      }
      model.dispose();
    }
    expect(new Set(shapes).size).toBeGreaterThan(1);
  });
  it("保存した車種を維持し、古いデータと未知の車種も読み込める", async () => {
    const { normalizeOperation } = await import("../src/lib/operation");
    const source = { id: "t1", kind: "express", stops: [] };
    expect(normalizeOperation({ trains: [{ ...source, vehicleType: "shinkansen" }] })?.trains[0].vehicleType).toBe("shinkansen");
    expect(normalizeOperation({ trains: [source] })?.trains[0].vehicleType).toBeUndefined();
    expect(normalizeOperation({ trains: [{ ...source, vehicleType: "unknown" }] })?.trains[0].vehicleType).toBeUndefined();
  });
});
