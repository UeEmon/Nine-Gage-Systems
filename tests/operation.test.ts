import { describe, expect, it } from "vitest";
import { getAccessory, placeOnPiece } from "../src/lib/accessories";
import { scaleKmhToMmPerSec } from "../src/lib/drive";
import { buildFromPlan } from "../src/lib/plan";
import {
  computeSchedule,
  detectStations,
  formatTime,
  newTrain,
  normalizeOperation,
  parseTime,
  type OperationPlan,
  type Train,
} from "../src/lib/operation";
import { sidingPlan } from "./fixtures";

/** 待避線付きエンドレスに、本線の直線2か所へ相対式ホームを置いたレイアウト */
function layout() {
  const { pieces } = buildFromPlan(sidingPlan());
  const def = getAccessory("kato:SIDE-A");
  const a = placeOnPiece(def, pieces.find((p) => p.uid === "s0p1")!, undefined, "L", "accA");
  const b = placeOnPiece(def, pieces.find((p) => p.uid === "s0p9")!, undefined, "R", "accB");
  return { pieces, accessories: [a, b] };
}

function train(over: Partial<Train>, stationIds: string[]): Train {
  return { ...newTrain(0, stationIds), ...over };
}

describe("operation: stations", () => {
  it("finds a station for each platform and its track", () => {
    const { pieces, accessories } = layout();
    const stations = detectStations(pieces, accessories);
    expect(stations).toHaveLength(2);
    const ids = stations.map((s) => s.id).sort();
    expect(ids).toEqual(["accA", "accB"]);
    const a = stations.find((s) => s.id === "accA")!;
    expect(a.tracks).toHaveLength(1);
    expect(a.tracks[0].pieces).toContain("s0p1");
    expect(stations.map((s) => s.defaultName)).toEqual(["A駅", "B駅"]);
  });

  it("puts both sides of an island platform into one station with two tracks", () => {
    const def = getAccessory("kato:ISLAND-A");
    const gap = def.offset! * 2;
    const lower = { uid: "lower", partId: "kato:S248", mirror: false, x: 0, y: gap, rot: 0 };
    const upper = { uid: "upper", partId: "kato:S248", mirror: false, x: 0, y: 0, rot: 0 };
    const isl = placeOnPiece(def, lower, undefined, "L", "isl");
    const stations = detectStations([upper, lower], [isl]);
    expect(stations).toHaveLength(1);
    // 画面の上の線路から 1番線
    expect(stations[0].tracks.map((t) => t.pieces)).toEqual([["upper"], ["lower"]]);
  });
});

describe("operation: schedule", () => {
  it("computes the arrival from the distance and the speed", () => {
    const { pieces, accessories } = layout();
    const stations = detectStations(pieces, accessories);
    const plan: OperationPlan = {
      stationNames: { accA: "東駅" },
      trains: [train({ id: "t1", departSec: 30, speedKmh: 60 }, ["accA", "accB"])],
    };
    const r = computeSchedule(pieces, stations, plan);
    const t = r.trains[0];
    expect(t.errors).toEqual([]);
    expect(t.events).toHaveLength(2);
    expect(t.events[0]).toMatchObject({ stationId: "accA", arr: null, dep: 30, track: 1 });
    const arr = t.events[1].arr!;
    expect(arr).toBeGreaterThan(30);
    // 駅間は 半周くらい（ループは約 2.6m）。60km/h ≒ 111mm/s
    const mm = (arr - 30) * scaleKmhToMmPerSec(60);
    expect(mm).toBeGreaterThan(500);
    expect(mm).toBeLessThan(2600);
    expect(r.conflicts).toEqual([]);
  });

  it("goes around the loop for each lap", () => {
    const { pieces, accessories } = layout();
    const stations = detectStations(pieces, accessories);
    const plan: OperationPlan = { stationNames: {}, trains: [train({ id: "t1", laps: 3 }, ["accA", "accB"])] };
    const t = computeSchedule(pieces, stations, plan).trains[0];
    expect(t.errors).toEqual([]);
    expect(t.events.map((e) => e.stationId)).toEqual(["accA", "accB", "accA", "accB", "accA", "accB"]);
    const times = t.events.map((e) => e.arr ?? e.dep!);
    for (let i = 1; i < times.length; i++) expect(times[i]).toBeGreaterThan(times[i - 1]);
    // 1周の時間はどの周も同じ
    expect(times[5] - times[3]).toBeCloseTo(times[3] - times[1], 3);
  });

  it("reports two trains using the same track at the same time", () => {
    const { pieces, accessories } = layout();
    const stations = detectStations(pieces, accessories);
    const plan: OperationPlan = {
      stationNames: {},
      trains: [
        train({ id: "t1", name: "1列車", departSec: 0 }, ["accA", "accB"]),
        train({ id: "t2", name: "2列車", departSec: 5 }, ["accA", "accB"]),
      ],
    };
    const r = computeSchedule(pieces, stations, plan);
    expect(r.conflicts.length).toBeGreaterThan(0);
    expect(r.conflicts[0]).toMatchObject({ trainA: "t1", trainB: "t2" });
    expect(r.conflicts.some((c) => c.location.startsWith("A駅"))).toBe(true);
  });

  it("has no conflict when two trains follow each other half a loop apart", () => {
    const { pieces, accessories } = layout();
    const stations = detectStations(pieces, accessories);
    const t1 = train({ id: "t1", departSec: 0 }, ["accA", "accB"]);
    const t2 = train({ id: "t2", departSec: 0 }, ["accB", "accA"]);
    const r = computeSchedule(pieces, stations, { stationNames: {}, trains: [t1, t2] });
    expect(r.trains.flatMap((t) => t.errors)).toEqual([]);
    expect(r.conflicts).toEqual([]);
  });

  it("keeps a train that ended at a station on its track", () => {
    const { pieces, accessories } = layout();
    const stations = detectStations(pieces, accessories);
    const t1 = train({ id: "t1", departSec: 0 }, ["accA", "accB"]);
    const t2 = train({ id: "t2", departSec: 120 }, ["accA", "accB"]);
    const r = computeSchedule(pieces, stations, { stationNames: { accB: "西駅" }, trains: [t1, t2] });
    expect(r.conflicts.map((c) => c.location)).toContain("西駅 1番線");
  });

  it("turns back at a station and returns the way it came", () => {
    const { pieces, accessories } = layout();
    const stations = detectStations(pieces, accessories);
    const t = train({ id: "t1", departSec: 0 }, ["accA", "accB", "accA"]);
    t.stops[1].turnback = true;
    const r = computeSchedule(pieces, stations, { stationNames: {}, trains: [t] }).trains[0];
    expect(r.errors).toEqual([]);
    const [a, b, c] = r.events;
    // 来た道を戻るので、行きと帰りの所要時間はほぼ同じ（折り返しでは先頭の位置をそのままにするので、編成の長さぶんの差は出る）
    expect(Math.abs(c.arr! - b.dep! - (b.arr! - a.dep!))).toBeLessThan(2);
  });

  it("warns when a station of the plan is gone", () => {
    const { pieces, accessories } = layout();
    const stations = detectStations(pieces, accessories);
    const r = computeSchedule(pieces, stations, { stationNames: {}, trains: [train({ id: "t1" }, ["accA", "gone"])] });
    expect(r.trains[0].errors[0]).toContain("レイアウトにない駅");
  });
});

describe("operation: model", () => {
  it("formats and parses times", () => {
    expect(formatTime(0)).toBe("0:00");
    expect(formatTime(75)).toBe("1:15");
    expect(formatTime(3725)).toBe("1:02:05");
    expect(parseTime("1:15")).toBe(75);
    expect(parseTime("1:02:05")).toBe(3725);
    expect(parseTime("90")).toBe(90);
    expect(parseTime("1:75")).toBeNull();
    expect(parseTime("abc")).toBeNull();
  });

  it("normalizes broken saved data", () => {
    const n = normalizeOperation({
      stationNames: { a: "東", b: 3 },
      trains: [{ id: "x", name: "1", kind: "??", color: "red", cars: 99, speedKmh: -5, departSec: 1, laps: 0, stops: [{ stationId: "a", track: 0 }] }, { bad: true }],
    })!;
    expect(n.stationNames).toEqual({ a: "東" });
    expect(n.trains).toHaveLength(1);
    expect(n.trains[0]).toMatchObject({ kind: "local", color: "#2f6fb5", cars: 16, speedKmh: 10, laps: 1 });
    expect(n.trains[0].stops[0]).toMatchObject({ track: null, pass: false, dwellSec: 20 });
    expect(normalizeOperation(null)).toBeUndefined();
  });
});
