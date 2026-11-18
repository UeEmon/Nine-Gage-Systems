import { describe, expect, it } from "vitest";
import { analyze, placeAt, worldJoints, type Layout, type Piece } from "../src/lib/geometry";
import {
  boardRect,
  checkAssembly,
  fillGap,
  findCandidates,
  findConnectors,
  mergeAssembly,
  placeToConnect,
  type ModuleSource,
  type PlacedModule,
} from "../src/lib/modules";

/** y の高さに、startX から右へ直線を並べる */
function line(y: number, startX: number, parts: string[], prefix: string, maker = "kato", z?: number): Piece[] {
  const out: Piece[] = [];
  let joint = { x: startX, y, deg: 0 };
  parts.forEach((id, i) => {
    const p = placeAt(`${maker}:${id}`, false, 0, joint, `${prefix}${i}`);
    if (z) p.z = z;
    out.push(p);
    joint = worldJoints(p)[1];
  });
  return out;
}

function layout(width: number, height: number, pieces: Piece[], maker: "kato" | "tomix" = "kato"): Layout {
  return { title: "t", maker, description: "", board: { width, height }, pieces };
}

const src = (key: string, l: Layout): ModuleSource => ({ key, layout: l, connectors: findConnectors(l) });

// 幅 640 のボードの y=150 に、x=10 から 620mm の直線（両端とも端から 10mm）
const straight = () => layout(640, 300, line(150, 10, ["S248", "S248", "S124"], "a"));

describe("modules: connectors", () => {
  it("finds track ends facing the left and right edges, with the inset to the edge", () => {
    const cs = findConnectors(straight());
    expect(cs.map((c) => c.edge)).toEqual(["right", "left"]);
    expect(cs[0].inset).toBeCloseTo(10);
    expect(cs[1].inset).toBeCloseTo(10);
    expect(cs[0].offset).toBeCloseTo(150);
    expect(cs[0].z).toBe(0);
  });

  it("ignores ends far from the edge", () => {
    const l = layout(1200, 300, line(150, 400, ["S248"], "a"));
    expect(findConnectors(l)).toEqual([]);
  });

  it("keeps the height of elevated ends", () => {
    const l = layout(640, 300, line(150, 10, ["S248", "S248", "S124"], "a", "kato", 50));
    expect(findConnectors(l).every((c) => c.z === 50)).toBe(true);
  });
});

describe("modules: fill", () => {
  it("connects directly when the gap is within the joiner's play", () => {
    expect(fillGap(1, "kato")).toEqual([]);
  });

  it("fills a gap with the fewest straights", () => {
    expect(fillGap(20 + 0, "kato")).toBeNull();
    expect(fillGap(62, "kato")).toEqual(["kato:S62"]);
    expect(fillGap(29 + 33, "kato")?.length).toBe(1); // 62 は S62 一本
    expect(fillGap(29 + 45, "kato")).toHaveLength(2);
    expect(fillGap(140 + 18.5, "tomix")).toEqual(["tomix:S158.5"]);
  });
});

describe("modules: assembly", () => {
  it("places the second board edge to edge, in line with the track, and fills the 20mm gap", () => {
    const a = src("A", straight());
    const b = src("B", straight());
    const right = a.connectors.find((c) => c.edge === "right")!;
    const left = b.connectors.find((c) => c.edge === "left")!;
    const pl = placeToConnect(right, { x: 0, y: 0, rot: 0 }, left);
    expect(pl).toEqual({ x: 640, y: 0, rot: 0 });
    const modules: PlacedModule[] = [{ key: "A", placement: { x: 0, y: 0, rot: 0 } }, { key: "B", placement: pl }];
    const sources = new Map([["A", a], ["B", b]]);
    const check = checkAssembly(modules, sources);
    expect(check.overlaps).toEqual([]);
    expect(check.junctions).toHaveLength(1);
    expect(check.junctions[0].gap).toBeCloseTo(20);
    // 20mm を埋める直線はない
    expect(check.junctions[0].fill).toBeNull();
  });

  it("turns the new board so its connector faces the old one", () => {
    // B は下の辺に端子がある（縦の線路。下の端から 31mm）
    const vertical = [placeAt("kato:S248", false, 0, { x: 150, y: 300 - 31, deg: -90 }, "v0")];
    const b = src("B", layout(300, 300, vertical));
    const bottom = b.connectors.find((c) => c.edge === "bottom")!;
    expect(bottom.inset).toBeCloseTo(31);
    const a = src("A", straight());
    const right = a.connectors.find((c) => c.edge === "right")!;
    const pl = placeToConnect(right, { x: 0, y: 0, rot: 0 }, bottom);
    // 下の辺（外向き 90°）を左向き（180°）にするには 90° 回す
    expect(pl.rot).toBe(90);
    const rect = boardRect(b.layout.board, pl);
    expect(rect.x0).toBeCloseTo(640);
    const check = checkAssembly([{ key: "A", placement: { x: 0, y: 0, rot: 0 } }, { key: "B", placement: pl }], new Map([["A", a], ["B", b]]));
    expect(check.junctions).toHaveLength(1);
    expect(check.junctions[0].gap).toBeCloseTo(41);
  });

  it("merges into one layout whose tracks connect through the filler", () => {
    // 端から 31mm と 31mm → すき間 62mm を S62 で埋める
    const mod = () => layout(620 + 62, 300, line(150, 31, ["S248", "S248", "S124"], "a"));
    const a = src("A", mod());
    const b = src("B", mod());
    const pl = placeToConnect(a.connectors.find((c) => c.edge === "right")!, { x: 0, y: 0, rot: 0 }, b.connectors.find((c) => c.edge === "left")!);
    const { layout: merged, check } = mergeAssembly("つないだ", [{ key: "A", placement: { x: 0, y: 0, rot: 0 } }, { key: "B", placement: pl }], new Map([["A", a], ["B", b]]));
    expect(check.junctions[0].fill).toEqual(["kato:S62"]);
    expect(merged.pieces).toHaveLength(7);
    expect(merged.board).toEqual({ width: 2 * 682, height: 300 });
    const an = analyze(merged);
    expect(an.openJoints).toHaveLength(2);
    expect(an.nearMisses).toHaveLength(0);
    expect(an.outOfBoard).toEqual([]);
    // 合成した結果の端子は、両端の2つだけ
    expect(findConnectors(merged)).toHaveLength(2);
  });

  it("refuses heights that do not match and boards that would overlap", () => {
    const low = src("L", straight());
    const high = src("H", layout(640, 300, line(150, 10, ["S248", "S248", "S124"], "h", "kato", 50)));
    const modules: PlacedModule[] = [{ key: "L", placement: { x: 0, y: 0, rot: 0 } }];
    const sources = new Map([["L", low]]);
    const right = low.connectors.find((c) => c.edge === "right")!;
    const cands = findCandidates(modules, { module: 0, connector: right.id }, sources, [low, high]);
    // 高さの違う H は出ない。L は左の端子で（回さずに）も、右の端子で（180°回して）もつながる
    expect(cands.map((c) => `${c.key}:${c.placement.rot}`).sort()).toEqual(["L:0", "L:180"]);
    expect(cands.find((c) => c.placement.rot === 0)!.placement).toEqual({ x: 640, y: 0, rot: 0 });
    // すでに右につないだ端子にはもう候補を出さない
    const two: PlacedModule[] = [...modules, { key: "L", placement: cands[0].placement }];
    expect(findCandidates(two, { module: 0, connector: right.id }, new Map([["L", low]]), [low])).toEqual([]);
  });

  it("matches a double track end and counts both links", () => {
    // 端から 31mm（すき間 62mm は S62 で埋まる）
    const dbl = () => layout(682, 300, [...line(150, 31, ["S248", "S248", "S124"], "a"), ...line(183, 31, ["S248", "S248", "S124"], "b")]);
    const a = src("A", dbl());
    expect(a.connectors).toHaveLength(4);
    const right = a.connectors.find((c) => c.edge === "right")!;
    const cands = findCandidates([{ key: "A", placement: { x: 0, y: 0, rot: 0 } }], { module: 0, connector: right.id }, new Map([["A", a]]), [a]);
    const best = cands[0];
    expect(best.links).toBe(2);
    expect(best.problems).toEqual([]);
    expect(best.fillers).toBe(2);
    // 1本しかそろわない置き方は、もう1本の行き止まりやずれを問題として出す
    const partial = cands.filter((c) => c !== best);
    expect(partial.length).toBeGreaterThan(0);
    expect(partial.every((c) => c.problems.length > 0)).toBe(true);
    expect(partial.some((c) => c.problems.some((p) => p.includes("ずれ")))).toBe(true);
    expect(partial.some((c) => c.problems.some((p) => p.includes("続く線路がありません")))).toBe(true);
  });

  it("does not join KATO and TOMIX", () => {
    const k = src("K", straight());
    const t = src("T", layout(640, 300, line(150, 10, ["S280", "S280"], "t", "tomix"), "tomix"));
    const right = k.connectors.find((c) => c.edge === "right")!;
    expect(findCandidates([{ key: "K", placement: { x: 0, y: 0, rot: 0 } }], { module: 0, connector: right.id }, new Map([["K", k]]), [t])).toEqual([]);
  });
});
