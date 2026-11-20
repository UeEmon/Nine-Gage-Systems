import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { systemPrompt, undergroundProblems } from "../src/lib/ai";
import { buildDriveGraph } from "../src/lib/drive";
import { isCovered, isCutting, joinRuns, undergroundOf } from "../src/lib/driveScene";
import { levelOf, standardDepth } from "../src/lib/elevation";
import { analyze, placeAt, worldJoints, type Piece } from "../src/lib/geometry";
import { buildFromPlan, evaluatePlan, type LayoutPlan } from "../src/lib/plan";
import { replicaGuide } from "../src/lib/replica";

const board = { width: 4000, height: 1500 };

/** 部品を順に直線でつなぐ（heights: 数値=高さ, null=勾配） */
function chain(start: { x: number; y: number; deg: number }, parts: [string, number | null][], prefix = "c"): Piece[] {
  const out: Piece[] = [];
  let cursor = start;
  parts.forEach(([partId, h], i) => {
    const placed = placeAt(partId, false, 0, cursor, `${prefix}${i}`);
    out.push(h === null ? { ...placed, ramp: true } : h ? { ...placed, z: h } : placed);
    cursor = worldJoints(placed)[1];
  });
  return out;
}

/** 地上 → 勾配で地下へ → 地下 → 勾配で地上へ（KATO、地下 -50mm） */
function dipPieces(): Piece[] {
  return chain({ x: 50, y: 700, deg: 0 }, [
    ["kato:S248", 0],
    ...Array<[string, number | null]>(5).fill(["kato:S248", null]),
    ["kato:S248", -50],
    ["kato:S248", -50],
    ["kato:S248", -50],
    ...Array<[string, number | null]>(5).fill(["kato:S248", null]),
    ["kato:S248", 0],
  ]);
}

describe("地下の線路", () => {
  it("地下の標準の深さは、立体交差に必要な高さの差と同じ", () => {
    expect(standardDepth("kato")).toBe(50);
    expect(standardDepth("tomix")).toBe(55);
  });

  it("マイナスの高さの部品は地下、勾配はそのまま勾配として分ける", () => {
    const pieces = dipPieces();
    const a = analyze({ board, pieces });
    expect(levelOf(pieces[0], a.elevation)).toBe("ground");
    expect(levelOf(pieces[1], a.elevation)).toBe("ramp");
    expect(levelOf(pieces[6], a.elevation)).toBe("underground");
    // 地下へ下る勾配は段差・急勾配にならず、橋脚も立たない
    expect(a.heightSteps).toEqual([]);
    expect(a.steepGrades).toEqual([]);
    expect(a.piers).toEqual([]);
    const zs = a.elevation.joints.get("c3")!;
    expect(Math.min(...zs)).toBeLessThan(0);
    expect(Math.max(...zs)).toBeGreaterThan(-50);
  });

  it("地下の区間の真上を地上の線路が横切っても、重なりではなく立体交差になる", () => {
    const under = dipPieces();
    // 地下区間（x≈1290〜2030）の上を南北に横切る地上の線路
    const over = chain({ x: 1600, y: 300, deg: 90 }, [["kato:S248", 0], ["kato:S248", 0], ["kato:S248", 0]], "o");
    const a = analyze({ board, pieces: [...under, ...over] });
    expect(a.overlaps).toEqual([]);
    expect(a.crossings.length).toBeGreaterThan(0);
  });

  it("掘割はボードに穴を開け、深い所はトンネルにする。部品ごとの穴は1つにつなぐ", () => {
    expect(isCutting(-20)).toBe(true);
    expect(isCutting(0)).toBe(false);
    expect(isCovered(-50)).toBe(true);
    expect(isCutting(-50)).toBe(false);

    const pieces = dipPieces();
    const { holes, lowest } = undergroundOf(buildDriveGraph(pieces), pieces);
    expect(lowest).toBeCloseTo(-50);
    // 下り坂と上り坂の掘割が1つずつ（いくつもの部品にまたがるが、つないで1つの穴にする）
    expect(holes).toHaveLength(2);

    // 穴を開けたボードが三角形に分けられ、面積がボードから穴を引いたものになる
    const shape = new THREE.Shape([
      new THREE.Vector2(0, 0),
      new THREE.Vector2(board.width, 0),
      new THREE.Vector2(board.width, -board.height),
      new THREE.Vector2(0, -board.height),
    ]);
    for (const h of holes) shape.holes.push(new THREE.Path(h.map((p) => new THREE.Vector2(p.x, -p.y))));
    const g = new THREE.ShapeGeometry(shape);
    const pos = g.getAttribute("position");
    const idx = g.getIndex()!;
    let area = 0;
    for (let i = 0; i < idx.count; i += 3) {
      const [a, b, c] = [idx.getX(i), idx.getX(i + 1), idx.getX(i + 2)];
      area += Math.abs((pos.getX(b) - pos.getX(a)) * (pos.getY(c) - pos.getY(a)) - (pos.getX(c) - pos.getX(a)) * (pos.getY(b) - pos.getY(a))) / 2;
    }
    const holeArea = holes.reduce((s, h) => s + Math.abs(THREE.ShapeUtils.area(h.map((p) => new THREE.Vector2(p.x, p.y)))), 0);
    expect(holeArea).toBeGreaterThan(0);
    expect(area).toBeCloseTo(board.width * board.height - holeArea, -2);
  });

  it("端どうしが接する線は、向きが逆でもつなぐ", () => {
    const a = [{ x: 0, y: 0 }, { x: 10, y: 0 }];
    const b = [{ x: 20, y: 0 }, { x: 10, y: 0 }];
    const c = [{ x: 100, y: 0 }, { x: 110, y: 0 }];
    const out = joinRuns([a, b, c]);
    expect(out).toHaveLength(2);
    expect(out.find((l) => l.length === 3)!.map((p) => p.x).sort((m, n) => m - n)).toEqual([0, 10, 20]);
  });
});

describe("再現してみた: 地下の路線", () => {
  const S = (height: number | null) => ({ part: "S248", dir: "L" as const, enter: 0, exit: 1, height });
  const C = (height: number | null) => ({ part: "R249-45", dir: "R" as const, enter: 0, exit: 1, height });
  /** 楕円のエンドレス（全部同じ高さ、または一部を地下にして両端を勾配） */
  const oval = (h: (i: number) => number | null) => [
    ...[0, 1, 2, 3, 4, 5, 6].map((i) => S(h(i))),
    C(0), C(0), C(0), C(0),
    ...[0, 1, 2, 3, 4, 5, 6].map(() => S(0)),
    C(0), C(0), C(0), C(0),
  ];
  const plan = (pieces: ReturnType<typeof oval>, undergroundLines: string[] = []): LayoutPlan => ({
    title: "テスト駅",
    description: "",
    start: { x: 400, y: 200, heading: 0 },
    segments: [{ from: null, line: "テスト線", pieces }],
    replica: { target: "テスト駅", features: [], lines: ["テスト線"], undergroundLines, objects: [] },
  });

  it("路線全体を地下にすると、一部だけを地下にするよう指摘する", () => {
    const p = plan(oval(() => -50).map((x) => ({ ...x, height: -50 })));
    const build = buildFromPlan(p);
    const { elevation } = analyze({ board, pieces: build.pieces });
    const problems = undergroundProblems(p, build, elevation);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("テスト線");
    expect(problems[0]).toContain("勾配区間");
  });

  it("全線が地下の路線（地下鉄など）と書いてあれば指摘しない", () => {
    const p = plan(oval(() => -50).map((x) => ({ ...x, height: -50 })), ["テスト線"]);
    const build = buildFromPlan(p);
    const { elevation } = analyze({ board, pieces: build.pieces });
    expect(undergroundProblems(p, build, elevation)).toEqual([]);
  });

  it("駅の前後だけ地下にして勾配で地上へ出すなら指摘しない", () => {
    const p = plan(oval((i) => (i === 0 || i === 6 ? null : i === 3 ? -50 : i < 3 ? null : null)));
    const build = buildFromPlan(p);
    const { elevation } = analyze({ board, pieces: build.pieces });
    expect(undergroundProblems(p, build, elevation)).toEqual([]);
    expect(evaluatePlan(p, board).analysis.heightSteps).toEqual([]);
  });

  it("AIへの説明に、地下の高さと、一部だけを地下にして勾配で出入りすることを書く", () => {
    const sys = systemPrompt("tomix", true);
    expect(sys).toContain("-55mm");
    expect(sys).toContain("坑口");
    expect(replicaGuide()).toContain("undergroundLines");
    expect(replicaGuide()).toContain("路線全体を地下にしてはいけません");
  });
});
