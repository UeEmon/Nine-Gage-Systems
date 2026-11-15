import { describe, expect, it } from "vitest";
import { getAccessory, placeOnPiece } from "../src/lib/accessories";
import type { AskResult, ChatSession } from "../src/lib/llm/types";
import { buildFromPlan } from "../src/lib/plan";
import { describeLayout, OperationProposeError, proposeOperation, stationsFor, toOperationPlan, type OperationProposal } from "../src/lib/operation/ai";
import { sidingPlan } from "./fixtures";

function layout() {
  const { pieces } = buildFromPlan(sidingPlan());
  const def = getAccessory("kato:SIDE-A");
  const a = placeOnPiece(def, pieces.find((p) => p.uid === "s0p1")!, undefined, "L", "accA");
  const b = placeOnPiece(def, pieces.find((p) => p.uid === "s0p9")!, undefined, "R", "accB");
  return { pieces, accessories: [a, b] };
}

/** 決めた答えを順に返すAI */
function fakeSession(answers: unknown[]): ChatSession & { prompts: string[] } {
  const prompts: string[] = [];
  return {
    prompts,
    async ask(text: string): Promise<AskResult> {
      prompts.push(text);
      const json = answers.shift() ?? null;
      return { json, text: JSON.stringify(json), usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 } };
    },
  };
}

const stop = (station: string, extra: Partial<OperationProposal["trains"][number]["stops"][number]> = {}) => ({
  station,
  track: null,
  pass: false,
  dwellSec: 20,
  turnback: false,
  ...extra,
});
const train = (name: string, departSec: number, stops = [stop("S1"), stop("S2")]) => ({
  name,
  kind: "local" as const,
  cars: 1,
  speedKmh: 80,
  departSec,
  laps: 1,
  stops,
});

describe("operation AI", () => {
  it("describes stations, tracks and travel times with station codes", () => {
    const { pieces, accessories } = layout();
    const stations = stationsFor(pieces, accessories);
    const text = describeLayout(pieces, stations, { accA: "東町" });
    expect(text).toContain("S1 東町: 1番線（約248mm・1両まで）");
    expect(text).toMatch(/S1→S2: \d+秒/);
    expect(text).toMatch(/S2→S1: \d+秒/);
    expect(text).toMatch(/- S1: \d+秒/);
  });

  it("maps station codes to stations and reports unknown ones", () => {
    const { pieces, accessories } = layout();
    const stations = stationsFor(pieces, accessories);
    const { plan, problems } = toOperationPlan(
      { summary: "", trains: [{ ...train("1", 0, [stop("S1"), stop("S9"), stop("S2", { track: 3 })]), cars: 99 }] },
      stations,
      {},
    );
    expect(plan.trains[0].stops.map((s) => s.stationId)).toEqual([stations[0].id, stations[1].id]);
    expect(plan.trains[0].stops[1].track).toBeNull();
    expect(plan.trains[0].cars).toBe(16);
    expect(problems).toHaveLength(2);
    expect(problems[0]).toContain("S9");
  });

  it("feeds conflicts back and keeps the fixed plan", async () => {
    const { pieces, accessories } = layout();
    const session = fakeSession([
      // 2本が同時に同じ駅を出る（支障）
      { summary: "1回目", trains: [train("101", 0), train("103", 5)] },
      // 半周ずらして、逆の駅から出す
      { summary: "2回目", trains: [train("101", 0), train("102", 0, [stop("S2"), stop("S1")])] },
    ]);
    const r = await proposeOperation({ pieces, accessories, stationNames: {}, request: "2本" }, session, "fake");
    expect(r.attempts).toBe(2);
    expect(r.remainingProblems).toBeNull();
    expect(r.summary).toBe("2回目");
    expect(r.plan.trains.map((t) => t.name)).toEqual(["101", "102"]);
    expect(session.prompts[0]).toContain("## 要望\n2本");
    expect(session.prompts[1]).toContain("支障");
    expect(session.prompts[1]).toContain("参考: アプリで計算した時刻");
    expect(r.usage.inputTokens).toBe(20);
  });

  it("asks again when the output is not in the format", async () => {
    const { pieces, accessories } = layout();
    const session = fakeSession([{ foo: 1 }, { summary: "ok", trains: [train("101", 0)] }]);
    const r = await proposeOperation({ pieces, accessories, stationNames: {}, request: "" }, session, "fake");
    expect(r.attempts).toBe(2);
    expect(session.prompts[1]).toContain("JSON形式に合いません");
  });

  it("refuses a layout without stations", async () => {
    const { pieces } = layout();
    await expect(proposeOperation({ pieces, accessories: [], stationNames: {}, request: "" }, fakeSession([]), "fake")).rejects.toBeInstanceOf(
      OperationProposeError,
    );
  });
});
