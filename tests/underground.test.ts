import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { systemPrompt, undergroundProblems } from "../src/lib/ai";
import { getAccessory, placeOnPiece, type Accessory } from "../src/lib/accessories";
import { buildDriveGraph, makeSegment, type DrivePoint } from "../src/lib/drive";
import { autoFootbridges, bridgePosts, buildScene, hallOpenings, FOOTBRIDGE_HEIGHT, FURNITURE_EDGE_MM, platformAccess, platformLabels, STAIR_RUN_PER_RISE, FURNITURE_HALF_DEPTH, inHall, platformFurniture, isCovered, isCutting, joinRuns, POST_CLEAR_MM, stationHalls, undergroundOf } from "../src/lib/driveScene";
import { levelOf, standardDepth } from "../src/lib/elevation";
import { analyze, placeAt, worldJoints, type Piece } from "../src/lib/geometry";
import { getPart } from "../src/lib/parts";
import { detectStations } from "../src/lib/operation/stations";
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

  it("上下両方の坑口で運転席の高さを遮らず、トンネルの天井は残す", () => {
    const pieces = dipPieces();
    const graph = buildDriveGraph(pieces);
    vi.stubGlobal("document", { createElement: () => ({ getContext: () => ({ fillRect() {} }) }) });
    try {
      const scene = buildScene(graph, pieces, [], board);
      try {
        scene.group.updateMatrixWorld(true);
        const hits = (origin: THREE.Vector3, direction: THREE.Vector3, distance: number) =>
          new THREE.Raycaster(origin, direction, 0, distance).intersectObject(scene.group, true);
        let portals = 0;
        for (const piece of pieces) {
          const { points } = makeSegment(graph, { uid: piece.uid, routeIndex: 0, reverse: false });
          for (let i = 1; i < points.length; i++) {
            const a = points[i - 1], b = points[i];
            if (isCovered(a.z) === isCovered(b.z)) continue;
            const eye = new THREE.Vector3(a.x, a.z + 18, a.y);
            const step = new THREE.Vector3(b.x - a.x, b.z - a.z, b.y - a.y);
            expect(hits(eye, step.clone().normalize(), step.length())).toHaveLength(0);
            portals++;
          }
        }
        expect(portals).toBe(2);
        const deep = makeSegment(graph, { uid: pieces[7].uid, routeIndex: 0, reverse: false }).points;
        const p = deep[Math.floor(deep.length / 2)];
        const ceiling = hits(new THREE.Vector3(p.x, p.z + 18, p.y), new THREE.Vector3(0, 1, 0), 15);
        expect(ceiling[0]?.distance).toBeCloseTo(12);
      } finally {
        scene.dispose();
      }
    } finally {
      vi.unstubAllGlobals();
    }
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

// ---- 地下駅の構内と、橋上駅舎の柱 ----

const stationBoard = { width: 4400, height: 1400 };


/** y の位置を通る、x 方向の直線の線路の中心線（4mm おき） */
const line = (y: number, z = 0, x0 = 0, x1 = 3000): DrivePoint[] => {
  const out: DrivePoint[] = [];
  for (let x = x0; x <= x1; x += 4) out.push({ x, y, z });
  return out;
};


/** 地上 → 勾配 → 地下(depth) → 勾配 → 地上 の直線 */
const dip = (y: number, prefix: string, depth: number) =>
  chain(
    { x: 50, y, deg: 0 },
    [
      ["kato:S248", 0],
      ...Array<[string, number | null]>(5).fill(["kato:S248", null]),
      ...Array<[string, number | null]>(5).fill(["kato:S248", depth]),
      ...Array<[string, number | null]>(5).fill(["kato:S248", null]),
      ["kato:S248", 0],
    ],
    prefix,
  );

/** 2本の地下の線路（線路中心の間隔49.5mm）と、その間の島式ホーム・外側の対向式ホーム */
function undergroundStation(depth: number) {
  const pieces = [...dip(700, "a", depth), ...dip(749.5, "b", depth)];
  const an = analyze({ board: stationBoard, pieces });
  const accessories: Accessory[] = [
    placeOnPiece(getAccessory("kato:ISLAND"), pieces[8], an.elevation, "R", "isl"),
    placeOnPiece(getAccessory("kato:SIDE"), pieces[17 + 8], an.elevation, "R", "side"),
  ];
  const graph = buildDriveGraph(pieces);
  const tracks: DrivePoint[] = [];
  for (const piece of pieces) {
    getPart(piece.partId).routes.forEach((_, routeIndex) => {
      tracks.push(...makeSegment(graph, { uid: piece.uid, routeIndex, reverse: false }, 4).points);
    });
  }
  return { pieces, accessories, graph, tracks };
}

describe("橋上駅舎・跨線橋の柱", () => {
  it("まわりに線路がなければ、4隅に立てる", () => {
    const def = getAccessory("kato:OVERPASS");
    const posts = bridgePosts({ x: 500, y: 500, rot: 0 }, def, []);
    expect(posts).toHaveLength(4);
    expect(new Set(posts.map((p) => Math.abs(p.v)))).toEqual(new Set([def.width / 2 - 4]));
  });

  it("線路の上には立てず、線路と線路の間はホームくらいの幅がある所だけに立てる", () => {
    // 複線（間隔33mm）と、島式ホームをはさむ2本（間隔49.5mm）の4本の線路の上に、跨線橋・橋上駅舎を置く
    const ys = [600, 649.5, 682.5, 732];
    const tracks = ys.flatMap((y) => line(y));
    for (const key of ["kato:OVERPASS", "kato:DX-BRIDGE-STATION", "kato:BRIDGE-STATION", "tomix:OVERPASS"]) {
      const def = getAccessory(key);
      const a = { x: 1500, y: 649.5, rot: 0 };
      const posts = bridgePosts(a, def, tracks);
      expect(posts.length, key).toBeGreaterThanOrEqual(2);
      for (const p of posts) {
        for (const y of ys) expect(Math.abs(a.y + p.v - y), `${key} v=${p.v}`).toBeGreaterThanOrEqual(POST_CLEAR_MM);
        expect(Math.abs(p.v)).toBeLessThanOrEqual(def.width / 2);
      }
      // 両端に柱がある
      expect(new Set(posts.map((p) => Math.sign(p.u)))).toEqual(new Set([-1, 1]));
      // 間隔33mmの複線の間（649.5〜682.5）には立てない
      expect(posts.some((p) => a.y + p.v > 649.5 && a.y + p.v < 682.5), key).toBe(false);
    }
  });

  it("斜めに置いても、線路の上に立てない", () => {
    const r = (30 * Math.PI) / 180;
    const along = (off: number) => line(0).map((p) => ({ x: 800 + p.x * Math.cos(r) - off * Math.sin(r), y: 400 + p.x * Math.sin(r) + off * Math.cos(r), z: 0 }));
    const tracks = [...along(0), ...along(55.5)];
    const def = getAccessory("kato:OVERPASS");
    const a = { x: 800 + 1000 * Math.cos(r), y: 400 + 1000 * Math.sin(r), rot: 30 };
    for (const p of bridgePosts(a, def, tracks)) {
      const w = { x: a.x + p.u * Math.cos(r) - p.v * Math.sin(r), y: a.y + p.u * Math.sin(r) + p.v * Math.cos(r) };
      const d = Math.min(...tracks.map((t) => Math.hypot(t.x - w.x, t.y - w.y)));
      expect(d).toBeGreaterThanOrEqual(POST_CLEAR_MM - 0.5);
    }
  });
});

describe("地下駅の構内", () => {
  it("地上のホームには構内を作らない", () => {
    const tracks = line(700);
    const def = getAccessory("kato:SIDE");
    const a: Accessory = { uid: "p", itemId: def.key, x: 1500, y: 700 - def.offset!, rot: 0, side: "L" };
    expect(stationHalls([a], tracks)).toEqual([]);
  });

  it("地下の島式ホームと対向式ホームを、面する線路ごと1つの構内で囲む", () => {
    const { accessories, tracks } = undergroundStation(-50);
    const halls = stationHalls(accessories, tracks);
    expect(halls).toHaveLength(1);
    const [h] = halls;
    expect(h.covered).toBe(true);
    // 2本の線路と2本のホームが構内に入る
    for (const y of [700, 749.5]) expect(inHall(h, { x: 2158, y })).toBe(true);
    for (const a of accessories) expect(inHall(h, a)).toBe(true);
    // 構内の壁は線路の車両に当たらない
    const ys = [h.y + h.v0, h.y + h.v1];
    expect(Math.min(...ys)).toBeLessThanOrEqual(700 - POST_CLEAR_MM);
    expect(Math.max(...ys)).toBeGreaterThanOrEqual(749.5 + getAccessory("kato:SIDE").width);
    // ホームの外の線路（地下へ下る勾配）は構内に入れない
    expect(inHall(h, { x: 600, y: 700 })).toBe(false);
  });

  it("浅い掘割の駅は、構内ごとボードに1つの穴を開け、穴どうしは重ならない", () => {
    const { accessories, tracks, graph, pieces } = undergroundStation(-20);
    const halls = stationHalls(accessories, tracks);
    expect(halls).toHaveLength(1);
    expect(halls[0].covered).toBe(false);
    const { holes } = undergroundOf(graph, pieces, halls);
    const shape = new THREE.Shape([
      new THREE.Vector2(0, 0),
      new THREE.Vector2(stationBoard.width, 0),
      new THREE.Vector2(stationBoard.width, -stationBoard.height),
      new THREE.Vector2(0, -stationBoard.height),
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
    // 構内の穴（長さ896mm × 幅）が入っている
    expect(holeArea).toBeGreaterThan(896 * 60);
    expect(area).toBeCloseTo(stationBoard.width * stationBoard.height - holeArea, -2);
  });
});

describe("ホームの上の設備", () => {
  it("ベンチ・駅名標・時刻表などを、ホームの縁の黄色い線より内側に、屋根の柱を避けて並べる", () => {
    for (const [L, W, edges] of [[896, 27, [-1, 1]], [896, 22, [1]], [124, 27.5, [-1]], [400, 37, [-1, 1]]] as [number, number, number[]][]) {
      const rl = Math.min(L, 280);
      const items = platformFurniture(L, W, edges, true, rl);
      const kinds = new Set(items.map((f) => f.kind));
      for (const k of ["bench", "nameSign", "departureBoard"] as const) expect(kinds.has(k), `${L}x${W} ${k}`).toBe(true);
      for (const f of items) {
        expect(Math.abs(f.v) + FURNITURE_HALF_DEPTH[f.kind]).toBeLessThanOrEqual(W / 2 - FURNITURE_EDGE_MM + 1e-6);
        expect(Math.abs(f.u)).toBeLessThanOrEqual(L / 2);
        // 屋根の柱（端から20mm＋40mmおき, v=0）と重ならない
        if (f.kind !== "departureBoard") for (let x = -rl / 2 + 20; x <= rl / 2 - 20; x += 40) expect(Math.abs(f.u - x) < 7 && Math.abs(f.v) < 3).toBe(false);
      }
    }
  });

  it("屋根も天井もないホームには発車標をつるさない", () => {
    expect(platformFurniture(400, 22, [1], false).some((f) => f.kind === "departureBoard")).toBe(false);
  });
});

describe("番線の表示", () => {
  it("ホームの両側の線路の番線と駅名を、運行計画と同じ決め方で出す", () => {
    const { pieces, accessories, graph } = undergroundStation(-50);
    const labels = platformLabels(pieces, accessories, graph.elevation, {});
    const isl = labels.get("isl")!;
    const side = labels.get("side")!;
    // 画面の上（y が小さい側）の線路から1番線・2番線
    expect(isl.tracks.get(-1)).toBe(1);
    expect(isl.tracks.get(1)).toBe(2);
    expect([...side.tracks]).toEqual([[-1, 2]]);
    expect(isl.station).toBe("A駅");
    const named = platformLabels(pieces, accessories, graph.elevation, { [[...labels.keys()].sort()[0]]: "大和" });
    expect(named.get("isl")!.station).toBe("大和");
  });
});

describe("ホームと駅舎を結ぶ階段・エスカレーター・エレベーター", () => {
  const within = (lane: [number, number], W: number) => lane[0] >= -W / 2 + FURNITURE_EDGE_MM - 1e-6 && lane[1] <= W / 2 - FURNITURE_EDGE_MM + 1e-6;

  it("橋上駅舎がかかる島式ホームから、駅舎の縁へ上がる。階段はホームの中に収まる", () => {
    const island = getAccessory("kato:ISLAND");
    const isl: Accessory = { uid: "i", itemId: island.key, x: 1500, y: 624.75, rot: 0, side: "R" };
    const bridge: Accessory = { uid: "b", itemId: "kato:DX-BRIDGE-STATION", x: 1300, y: 649.5, rot: 0, side: "L" };
    const x = platformAccess(isl, [isl, bridge], [...line(600), ...line(649.5)])!;
    expect(x.to).toBe("bridge");
    const bd = getAccessory("kato:DX-BRIDGE-STATION");
    expect(x.rise).toBeCloseTo(bd.height - island.height);
    // 駅舎の縁（ホームの座標で u=-200+124=-76）から、ホームの長いほう（+u）へ下ろす
    expect(x.uTop).toBeCloseTo(-76);
    expect(x.dir).toBe(-1);
    expect(x.uBottom - x.uTop).toBeCloseTo(x.rise * STAIR_RUN_PER_RISE);
    expect(Math.max(x.uTop, x.uBottom)).toBeLessThanOrEqual(island.length / 2);
    expect(within(x.stair, island.width)).toBe(true);
    expect(x.escalator && within(x.escalator, island.width)).toBe(true);
    // エレベーターは駅舎の下
    expect(x.elevator!.u).toBeLessThan(x.uTop);
    expect(x.elevator!.u).toBeGreaterThan(-200 - 124);
  });

  it("橋上駅舎のないホームには置かない", () => {
    const def = getAccessory("kato:SIDE");
    const a: Accessory = { uid: "p", itemId: def.key, x: 1500, y: 700 - def.offset!, rot: 0, side: "L" };
    expect(platformAccess(a, [a], line(700))).toBeNull();
  });

  it("地下駅のホームからは地上へ上がり、出入口は地上の線路の上を避ける", () => {
    const { accessories, tracks } = undergroundStation(-50);
    const isl = accessories.find((a) => a.uid === "isl")!;
    const x = platformAccess(isl, accessories, tracks)!;
    expect(x.to).toBe("surface");
    expect(x.entrance).not.toBeNull();
    expect(x.rise).toBeCloseTo(-6 + 50 - getAccessory("kato:ISLAND").height);
    // 出入口の側（+u の端）の真上を地上の線路が横切ると、反対の端に出入口を作る
    const end = x.entrance!.u;
    const cross: DrivePoint[] = [];
    for (let y = 400; y <= 1000; y += 4) cross.push({ x: isl.x + end, y, z: 0 });
    const y2 = platformAccess(isl, accessories, [...tracks, ...cross])!;
    expect(Math.sign(y2.entrance!.u)).toBe(-Math.sign(end));
  });

  it("階段・エレベーターのある所にはベンチなどを置かない", () => {
    const blocked: [number, number][] = [[100, 170]];
    for (const f of platformFurniture(896, 27, [-1, 1], true, 280, blocked)) expect(f.u > 92 && f.u < 178).toBe(false);
  });
});

describe("跨線橋の自動配置", () => {
  /** 4本の線路と、その間の島式ホーム2本（橋上駅舎なし） */
  function twoIslands(extra: (pieces: Piece[], an: ReturnType<typeof analyze>) => Accessory[] = () => []) {
    const ys = [600, 649.5, 682.5, 732];
    const pieces = ys.flatMap((y, k) => chain({ x: 50, y, deg: 0 }, Array<[string, number | null]>(14).fill(["kato:S248", 0]), `t${k}_`));
    const an = analyze({ board: stationBoard, pieces });
    const accessories = [
      placeOnPiece(getAccessory("kato:ISLAND"), pieces[6], an.elevation, "R", "i1"),
      placeOnPiece(getAccessory("kato:ISLAND"), pieces[14 * 2 + 6], an.elevation, "R", "i2"),
      ...extra(pieces, an),
    ];
    return { pieces, accessories, an, tracks: ys.flatMap((y) => line(y, 0, 0, 3500)) };
  }

  it("ホームが2本あって橋上駅舎がない駅に、両方のホームにかかる跨線橋を置き、各ホームから階段で上がれる", () => {
    const { pieces, accessories, an, tracks } = twoIslands();
    const stations = detectStations(pieces, accessories, an.elevation);
    const fbs = autoFootbridges(stations, accessories);
    expect(fbs).toHaveLength(1);
    const fb = fbs[0];
    expect(fb.height).toBe(FOOTBRIDGE_HEIGHT);
    // 2本のホームの外側の縁まで届く
    expect(fb.y - fb.width / 2).toBeLessThanOrEqual(624.75 - 13.5 + 0.01);
    expect(fb.y + fb.width / 2).toBeGreaterThanOrEqual(707.25 + 13.5 - 0.01);
    for (const a of accessories) {
      const x = platformAccess(a, accessories, tracks, fbs)!;
      expect(x.to).toBe("bridge");
      expect(Math.abs(x.uBottom)).toBeLessThanOrEqual(getAccessory(a.itemId).length / 2);
    }
    // 柱は線路の上に立たない
    for (const p of bridgePosts(fb, fb, tracks)) for (const y of [600, 649.5, 682.5, 732]) expect(Math.abs(fb.y + p.v - y)).toBeGreaterThanOrEqual(POST_CLEAR_MM);
  });

  it("製品の橋上駅舎が置いてある駅・ホームが1本の駅には置かない", () => {
    const withBridge = twoIslands((pieces, an) => [placeOnPiece(getAccessory("kato:DX-BRIDGE-STATION"), pieces[14 + 7], an.elevation, "L", "b1")]);
    expect(autoFootbridges(detectStations(withBridge.pieces, withBridge.accessories, withBridge.an.elevation), withBridge.accessories)).toEqual([]);
    const one = twoIslands();
    const single = one.accessories.slice(0, 1);
    expect(autoFootbridges(detectStations(one.pieces, single, one.an.elevation), single)).toEqual([]);
  });
});

describe("地下駅の構内の両端", () => {
  /** 線路の中心線（勾配の部品も含む） */
  const centerOf = (pieces: Piece[]) => {
    const graph = buildDriveGraph(pieces);
    return pieces.flatMap((piece) =>
      getPart(piece.partId).routes.flatMap((_, routeIndex) => makeSegment(graph, { uid: piece.uid, routeIndex, reverse: false }, 4).points),
    );
  };

  it("両端の壁には、通り抜ける線路ごとに口を開ける", () => {
    const { accessories, tracks } = undergroundStation(-50);
    const [h] = stationHalls(accessories, tracks);
    for (const u of [h.u0, h.u1]) expect(hallOpenings(h, u, tracks)).toHaveLength(2);
  });

  it("ホームが地下の区間より長く勾配にかかっていても、線路を壁でふさがない", () => {
    // 地下の区間は2本分（496mm）だけで、島式ホーム（896mm）の両端は勾配の上
    const dip2 = (y: number, p: string) =>
      chain(
        { x: 50, y, deg: 0 },
        [
          ["kato:S248", 0],
          ...Array<[string, number | null]>(4).fill(["kato:S248", null]),
          ...Array<[string, number | null]>(2).fill(["kato:S248", -55]),
          ...Array<[string, number | null]>(4).fill(["kato:S248", null]),
          ["kato:S248", 0],
        ],
        p,
      );
    const pieces = [...dip2(700, "a"), ...dip2(749.5, "b")];
    const an = analyze({ board: stationBoard, pieces });
    const isl = { ...placeOnPiece(getAccessory("kato:ISLAND"), pieces[5], an.elevation, "R", "isl"), x: pieces[6].x };
    const tracks = centerOf(pieces);
    const [h] = stationHalls([isl], tracks);
    expect(h.covered).toBe(true);
    for (const u of [h.u0, h.u1]) {
      const ops = hallOpenings(h, u, tracks);
      expect(ops).toHaveLength(2);
      // 口の上の端は、そこを通る線路の高さ＋トンネルの天井より低くない
      for (const [, , lintel] of ops) expect(lintel).toBeGreaterThanOrEqual(30);
    }
  });

  it("ホームが線路より高い所（勾配の途中）に吸着していても、構内は線路の高さで作り、両端に口を開ける", () => {
    const { accessories, tracks } = undergroundStation(-50);
    const isl = { ...accessories.find((a) => a.uid === "isl")!, z: -30 };
    const [h] = stationHalls([isl], tracks);
    expect(h.z).toBeCloseTo(-50);
    expect(h.covered).toBe(true);
    for (const u of [h.u0, h.u1]) expect(hallOpenings(h, u, tracks)).toHaveLength(2);
  });
});
