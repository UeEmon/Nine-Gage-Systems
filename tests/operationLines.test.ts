import { describe, expect, it } from "vitest";
import { getAccessory, placeOnPiece } from "../src/lib/accessories";
import { computeSchedule, layoutLines, lineFromEvents, stationLines, trackLines, trainLine, type LineSource, type OperationPlan } from "../src/lib/operation";
import { describeLayout, stationsFor, toOperationPlan } from "../src/lib/operation/ai";
import { buildFromPlan, type LayoutPlan } from "../src/lib/plan";
import type { PlanReplica } from "../src/lib/replica";
import { sidingPlan } from "./fixtures";

const replica = (lines: string[]): PlanReplica => ({ target: "テスト駅", features: [], lines, objects: [] });

/** 区間0（本線）と区間1（待避線）に路線名をつけた計画 */
function linedPlan(line0: string, line1: string, lines = ["山手線", "京浜東北線"]): LayoutPlan {
  const base = sidingPlan();
  return {
    ...base,
    segments: [
      { ...base.segments[0], line: line0 },
      { ...base.segments[1], line: line1 },
    ],
    replica: replica(lines),
  };
}

function withStations(pieces: ReturnType<typeof buildFromPlan>["pieces"]) {
  const def = getAccessory("kato:SIDE-A");
  const a = placeOnPiece(def, pieces.find((p) => p.uid === "s0p1")!, undefined, "L", "accA");
  const b = placeOnPiece(def, pieces.find((p) => p.uid === "s0p9")!, undefined, "R", "accB");
  return [a, b];
}

describe("再現してみた: 線路の路線名", () => {
  it("区間の line を部品に入れ、replica.lines の書き方にそろえる", () => {
    const { pieces } = buildFromPlan(linedPlan("山手", "京浜東北線"));
    expect(pieces.filter((p) => p.uid.startsWith("s0")).every((p) => p.line === "山手線")).toBe(true);
    expect(pieces.filter((p) => p.uid.startsWith("s1")).every((p) => p.line === "京浜東北線")).toBe(true);
  });

  it("line が空の区間は分岐元の区間の路線を受け継ぐ", () => {
    const { pieces } = buildFromPlan(linedPlan("山手線", ""));
    expect(pieces.every((p) => p.line === "山手線")).toBe(true);
  });

  it("再現してみた以外の計画では部品に路線名をつけない", () => {
    const { pieces } = buildFromPlan(sidingPlan());
    expect(pieces.some((p) => "line" in p)).toBe(false);
  });
});

describe("運行計画の路線", () => {
  it("路線を1つ再現したレイアウトは、線路に路線名がなくても再現した路線になる", () => {
    const { pieces } = buildFromPlan(sidingPlan());
    const source: LineSource = { pieces, replica: { kind: "line", target: "箱根登山鉄道" } };
    expect(layoutLines(source)).toEqual(["箱根登山鉄道"]);
    const stations = stationsFor(pieces, withStations(pieces));
    const tl = trackLines(stations, source);
    for (const s of stations) expect(stationLines(s.id, tl)).toEqual(["箱根登山鉄道"]);
  });

  it("再現していないレイアウトには路線がない", () => {
    const { pieces } = buildFromPlan(sidingPlan());
    expect(layoutLines({ pieces })).toEqual([]);
  });

  it("路線の一覧は replica.lines の順で、線路のある路線だけ", () => {
    const { pieces } = buildFromPlan(linedPlan("京浜東北線", "山手線", ["山手線", "京浜東北線", "中央線"]));
    expect(layoutLines({ pieces, replica: { kind: "station", target: "テスト駅", lines: ["山手線", "京浜東北線", "中央線"] } })).toEqual([
      "山手線",
      "京浜東北線",
    ]);
  });

  it("列車の路線は、指定がなければ使う番線の路線になる", () => {
    const { pieces } = buildFromPlan(linedPlan("山手線", ""));
    const source: LineSource = { pieces, replica: { kind: "station", target: "テスト駅", lines: ["山手線"] } };
    const accessories = withStations(pieces);
    const stations = stationsFor(pieces, accessories);
    const tl = trackLines(stations, source);
    const plan: OperationPlan = {
      stationNames: {},
      trains: [
        {
          id: "t1",
          name: "501G",
          kind: "local" as const,
          color: "#2f6fb5",
          cars: 1,
          speedKmh: 80,
          departSec: 0,
          laps: 1,
          stops: stations.map((s) => ({ stationId: s.id, track: null, pass: false, dwellSec: 20 })),
        },
      ],
    };
    const events = computeSchedule(pieces, stations, plan).trains[0].events;
    expect(lineFromEvents(events, tl)).toBe("山手線");
    expect(trainLine(plan.trains[0], events, tl)).toBe("山手線");
    expect(trainLine({ line: "京浜東北線" }, events, tl)).toBe("京浜東北線");
    expect(trainLine({}, undefined, tl)).toBeUndefined();
  });

  it("AIに渡すレイアウトの説明に路線と番線の路線が入る", () => {
    const { pieces } = buildFromPlan(linedPlan("山手線", ""));
    const stations = stationsFor(pieces, withStations(pieces));
    const text = describeLayout(pieces, stations, { accA: "東町" }, { kind: "station", target: "テスト駅", lines: ["山手線"] });
    expect(text).toContain("## 路線");
    expect(text).toContain("- 山手線（駅: S1 東町");
    expect(text).toContain("S1 東町: 1番線［山手線］");
    // 路線のないレイアウトでは今までどおり
    const plain = describeLayout(pieces.map(({ line: _l, ...p }) => p), stations, {});
    expect(plain).not.toContain("## 路線");
    expect(plain).not.toContain("［");
  });

  it("AIの列車の路線を一覧の書き方にそろえ、ない路線は知らせる", () => {
    const { pieces } = buildFromPlan(linedPlan("山手線", "京浜東北線"));
    const stations = stationsFor(pieces, withStations(pieces));
    const t = (name: string, line: string) => ({
      name,
      line,
      kind: "local" as const,
      cars: 1,
      speedKmh: 80,
      departSec: 0,
      laps: 1,
      stops: [{ station: "S1", track: null, pass: false, dwellSec: 20, turnback: false }],
    });
    const { plan, problems } = toOperationPlan(
      { summary: "", trains: [t("A", "山手"), t("B", "中央線"), t("C", "")] },
      stations,
      {},
      ["山手線", "京浜東北線"],
    );
    expect(plan.trains.map((x) => x.line)).toEqual(["山手線", undefined, undefined]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("中央線");
  });
});
