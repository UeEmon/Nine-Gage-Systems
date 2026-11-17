import { describe, expect, it } from "vitest";
import { getAccessory, placeOnPiece } from "../src/lib/accessories";
import { buildDriveGraph, scaleKmhToMmPerSec } from "../src/lib/drive";
import { buildFromPlan } from "../src/lib/plan";
import {
  computeSchedule,
  detectStations,
  formatTime,
  newTrain,
  normalizeOperation,
  parseTime,
  profile,
  TrainPlayback,
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
    // 番線におさまる1両の列車
    const t = train({ id: "t1", departSec: 0, cars: 1 }, ["accA", "accB", "accA"]);
    t.stops[1].turnback = true;
    const r = computeSchedule(pieces, stations, { stationNames: {}, trains: [t] }).trains[0];
    expect(r.errors).toEqual([]);
    const [a, b, c] = r.events;
    // 来た道を戻るので、行きと帰りの所要時間はほぼ同じ（折り返しでは最後尾が新しい先頭になる）
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

describe("operation: playback", () => {
  it("keeps the train at the stations at the timetable times and moves it between them", () => {
    const { pieces, accessories } = layout();
    const stations = detectStations(pieces, accessories);
    const t = train({ id: "t1", departSec: 10, cars: 1 }, ["accA", "accB"]);
    const r = computeSchedule(pieces, stations, { stationNames: {}, trains: [t] }).trains[0];
    const pb = new TrainPlayback(buildDriveGraph(pieces), r.motion!);
    const [a, b] = r.events;
    // 現れる前は見えない
    expect(pb.stateAt(-100).hidden).toBe(true);
    // 発車前は始発駅の番線にいる
    const st = stations.find((s) => s.id === "accA")!;
    expect(st.tracks[0].pieces).toContain(pb.poseAt(5).uid);
    expect(pb.stateAt(5).stopped).toBe(true);
    // 途中は走っていて、着時刻には止まっている
    const mid = pb.stateAt((a.dep! + b.arr!) / 2);
    expect(mid.stopped).toBe(false);
    expect(mid.kmh).toBeGreaterThan(0);
    const atB = pb.stateAt(b.arr! + 1);
    expect(atB.stopped).toBe(true);
    const bTrack = stations.find((s) => s.id === "accB")!.tracks[0].pieces;
    expect(bTrack).toContain(pb.poseAt(b.arr! + 1, -r.motion!.length / 2).uid);
    // 加減速しても、駅に着くまでに進む距離は時刻表と同じ
    expect(pb.stateAt(b.arr! - 0.001).s).toBeCloseTo(atB.s, 0);
  });

  it("makes the rear the new front when turning back", () => {
    const { pieces, accessories } = layout();
    const stations = detectStations(pieces, accessories);
    const t = train({ id: "t1", departSec: 0, cars: 4 }, ["accA", "accB", "accA"]);
    t.stops[1].turnback = true;
    const r = computeSchedule(pieces, stations, { stationNames: {}, trains: [t] }).trains[0];
    const pb = new TrainPlayback(buildDriveGraph(pieces), r.motion!);
    const b = r.events[1];
    const before = pb.poseAt(b.dep! - 1);
    const after = pb.poseAt(b.dep! + 0.001);
    // 先頭は編成の長さぶん後ろへ移り、向きは逆
    expect(Math.hypot(before.x - after.x, before.y - after.y)).toBeGreaterThan(r.motion!.length * 0.8);
    const turn = Math.abs(((after.heading - before.heading + 540) % 360) - 180);
    expect(turn).toBeGreaterThan(150);
  });

  it("accelerates and brakes within the time of the timetable", () => {
    const a = 100;
    expect(profile(1000, 20, 0, a).s).toBe(0);
    expect(profile(1000, 20, 20, a).s).toBeCloseTo(1000, 6);
    expect(profile(1000, 20, 20, a).v).toBeCloseTo(0, 6);
    expect(profile(1000, 20, 10, a).s).toBeCloseTo(500, 6);
    // 短い区間（時間内に着けない加速）でも着く
    expect(profile(1000, 2, 2, a).s).toBeCloseTo(1000, 6);
  });
});
