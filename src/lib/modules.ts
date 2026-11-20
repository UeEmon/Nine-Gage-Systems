// レイアウト同士をつなぐ（モジュールレイアウト）ための計算。共有サイト（share/）とテストで使う。
//
// 考え方:
// - ボードの端に向かって外向きに終わっている線路の端（開放端）を「端子」とする。端子からボードの端までの距離（奥行き）が
//   MAX_INSET_MM 以内で、線路の向きがボードの端と直角（±EDGE_ANGLE_TOL_DEG）のもの。
// - 2つのレイアウトは、ボードの端どうしを突き合わせ、端子の線路が一直線にそろう位置でつなぐ。ボードは90°単位でしか回さない。
// - 端子がボードの端からへこんでいる分（両方の奥行きの合計）は、同じメーカーの直線線路で埋める（埋め草線路）。
// - つないだ結果は、ふつうのレイアウト（Layout）1つに合成でき、SenroLab のエディタでそのまま開ける。
//   ボードごとの運行計画（列車と駅の名前）も引き継ぐ。

import { findConnections, placeAt, worldJoints, type Layout, type Piece } from "./geometry";
import { computeElevation } from "./elevation";
import { getPart, hasPart, normDeg, partKey, type Maker } from "./parts";
import type { OperationPlan } from "./operation/model";

/** 端子とみなす、線路の端からボードの端までの距離の上限（mm） */
export const MAX_INSET_MM = 300;
/** 端子の線路の向きと、ボードの端の直角の向きのずれの許容（度） */
export const EDGE_ANGLE_TOL_DEG = 2;
/** これ以下のすき間は線路を足さずにそのままつながる（ジョイントの遊び） */
export const DIRECT_GAP_MM = 1.5;
/** 埋め草線路の長さの合計と、すき間の差の許容（mm） */
export const FILL_TOL_MM = 1;
/** 横方向（端に沿った方向）のずれの許容（mm） */
export const LATERAL_TOL_MM = 1;
/** 高さの差の許容（mm） */
export const HEIGHT_TOL_MM = 1;

/** ボードの辺。外向きの向き（度）は right=0, bottom=90, left=180, top=-90 */
export type Edge = "top" | "right" | "bottom" | "left";

export const EDGE_LABELS: Record<Edge, string> = { top: "上", right: "右", bottom: "下", left: "左" };

const EDGE_DEG: Record<Edge, number> = { right: 0, bottom: 90, left: 180, top: -90 };

export type Connector = {
  /** "<部品のuid>:<ジョイント番号>" */
  id: string;
  edge: Edge;
  /** 線路の端からボードの端までの距離（mm） */
  inset: number;
  /** 端に沿った位置（top/bottom は x、left/right は y。mm） */
  offset: number;
  /** レール面の高さ（mm） */
  z: number;
  /** ジョイントの位置（レイアウトの座標） */
  x: number;
  y: number;
};

/** レイアウトのメーカー（古いデータは KATO） */
export function layoutMaker(layout: Pick<Layout, "maker" | "pieces">): Maker {
  if (layout.maker) return layout.maker;
  const first = layout.pieces[0];
  return first && hasPart(first.partId) ? getPart(first.partId).maker : "kato";
}

function edgeOfDeg(deg: number): Edge | null {
  for (const e of Object.keys(EDGE_DEG) as Edge[]) {
    if (Math.abs(normDeg(deg - EDGE_DEG[e])) <= EDGE_ANGLE_TOL_DEG) return e;
  }
  return null;
}

/** レイアウトの端子を探す */
export function findConnectors(layout: Pick<Layout, "board" | "pieces">): Connector[] {
  const { width: W, height: H } = layout.board;
  if (!Number.isFinite(W) || !Number.isFinite(H)) return [];
  const { connections, openJoints } = findConnections(layout.pieces);
  const elevation = computeElevation(layout.pieces, connections);
  const out: Connector[] = [];
  for (const j of openJoints) {
    const edge = edgeOfDeg(j.deg);
    if (!edge) continue;
    const inset = edge === "right" ? W - j.x : edge === "left" ? j.x : edge === "bottom" ? H - j.y : j.y;
    const offset = edge === "top" || edge === "bottom" ? j.x : j.y;
    const len = edge === "top" || edge === "bottom" ? W : H;
    if (inset < -LATERAL_TOL_MM || inset > MAX_INSET_MM) continue;
    if (offset < 0 || offset > len) continue;
    const z = elevation.joints.get(j.pieceUid)?.[j.index] ?? 0;
    out.push({ id: `${j.pieceUid}:${j.index}`, edge, inset: Math.max(0, inset), offset, z, x: j.x, y: j.y });
  }
  const order: Edge[] = ["top", "right", "bottom", "left"];
  return out.sort((a, b) => order.indexOf(a.edge) - order.indexOf(b.edge) || a.offset - b.offset);
}

// ---- 配置（ボードの置き方） ----

/** つないだレイアウトの中の1枚のボード。rot は 0/90/180/270 */
export type Placement = { x: number; y: number; rot: number };

const rad = (d: number) => (d * Math.PI) / 180;

/** 90°単位の回転はちょうどの値にする（浮動小数の誤差でつなぎ目がずれないように） */
function rotate(rot: number, p: { x: number; y: number }) {
  const r = ((Math.round(rot / 90) % 4) + 4) % 4;
  if (r === 0) return { x: p.x, y: p.y };
  if (r === 1) return { x: -p.y, y: p.x };
  if (r === 2) return { x: -p.x, y: -p.y };
  return { x: p.y, y: -p.x };
}

export function applyPlacement(pl: Placement, p: { x: number; y: number }) {
  const r = rotate(pl.rot, p);
  return { x: pl.x + r.x, y: pl.y + r.y };
}

function normRot(rot: number) {
  return (((Math.round(rot / 90) * 90) % 360) + 360) % 360;
}

/** ボードの範囲（ワールド座標の長方形） */
export function boardRect(board: { width: number; height: number }, pl: Placement) {
  const a = applyPlacement(pl, { x: 0, y: 0 });
  const b = applyPlacement(pl, { x: board.width, y: board.height });
  return { x0: Math.min(a.x, b.x), y0: Math.min(a.y, b.y), x1: Math.max(a.x, b.x), y1: Math.max(a.y, b.y) };
}

type Rect = ReturnType<typeof boardRect>;

/** 2枚のボードが重なるか（接しているだけなら重ならない） */
export function rectsOverlap(a: Rect, b: Rect, tol = 1) {
  return a.x0 < b.x1 - tol && b.x0 < a.x1 - tol && a.y0 < b.y1 - tol && b.y0 < a.y1 - tol;
}

/** 端子のワールドでの外向きの向き（度） */
export function worldEdgeDeg(c: Pick<Connector, "edge">, pl: Placement) {
  return normDeg(EDGE_DEG[c.edge] + normRot(pl.rot));
}

export function worldConnector(c: Connector, pl: Placement) {
  const p = applyPlacement(pl, c);
  return { ...c, x: p.x, y: p.y, deg: worldEdgeDeg(c, pl) };
}

/**
 * 置いてあるボードの端子 a に、新しいボードの端子 b をつなぐときの、新しいボードの置き方。
 * ボードの端どうしが接し、2つの端子の線路が一直線になる。
 */
export function placeToConnect(a: Connector, aPl: Placement, b: Connector): Placement {
  const wa = worldConnector(a, aPl);
  // b の外向きが a の外向きと逆になるように回す
  const rot = normRot(wa.deg + 180 - EDGE_DEG[b.edge]);
  const gap = a.inset + b.inset;
  const dir = { x: Math.round(Math.cos(rad(wa.deg))), y: Math.round(Math.sin(rad(wa.deg))) };
  const target = { x: wa.x + dir.x * gap, y: wa.y + dir.y * gap };
  const r = rotate(rot, b);
  return { x: target.x - r.x, y: target.y - r.y, rot };
}

// ---- すき間を埋める線路 ----

/** 埋め草に使う直線（メーカーごと、標準の道床、長さの決まったもの） */
function fillerStraights(maker: Maker): { partId: string; len: number }[] {
  const ids: Record<Maker, string[]> = {
    kato: ["S248", "S186", "S124", "S64", "S62", "S45", "S38", "S33", "S29"],
    tomix: ["S280", "S158.5", "S140", "S99", "S72.5", "S70", "S33", "S18.5"],
  };
  return ids[maker]
    .map((id) => partKey(maker, id))
    .filter(hasPart)
    .map((partId) => ({ partId, len: getPart(partId).routeLength }));
}

/**
 * すき間 gap（mm）を埋める直線の組み合わせ（少ない本数を優先、最大4本）。
 * そのままつながるなら []、埋められないなら null。
 */
export function fillGap(gap: number, maker: Maker): string[] | null {
  if (gap <= DIRECT_GAP_MM) return [];
  const parts = fillerStraights(maker);
  let best: { ids: string[]; err: number } | null = null;
  const search = (start: number, rest: number, ids: string[]) => {
    const err = Math.abs(rest);
    if (ids.length && err <= FILL_TOL_MM) {
      if (!best || ids.length < best.ids.length || (ids.length === best.ids.length && err < best.err)) best = { ids: [...ids], err };
      return;
    }
    if (ids.length >= 4 || rest < 0) return;
    if (best && ids.length + 1 > best.ids.length) return;
    for (let i = start; i < parts.length; i++) {
      ids.push(parts[i].partId);
      search(i, rest - parts[i].len, ids);
      ids.pop();
    }
  };
  search(0, gap, []);
  return best ? (best as { ids: string[] }).ids : null;
}

// ---- つないだレイアウト ----

export type ModuleSource = { key: string; layout: Layout; connectors: Connector[] };
export type PlacedModule = { key: string; placement: Placement };

export type Junction = {
  /** modules の番号と端子 */
  a: { module: number; connector: string };
  b: { module: number; connector: string };
  gap: number;
  /** 埋め草の直線（部品キー）。null は埋められない */
  fill: string[] | null;
  z: number;
};

export type AssemblyCheck = {
  junctions: Junction[];
  /** 重なっているボードの組 */
  overlaps: [number, number][];
  /** 向かい合っているのに位置か高さが合わない端子 */
  mismatches: { a: { module: number; connector: string }; b: { module: number; connector: string }; reason: string }[];
};

/**
 * 並べたボードの、つながっている端子・重なり・合わない所を調べる。
 * ボードの端が接していて、端子が向かい合い一直線にそろっていれば「つながっている」。
 */
export function checkAssembly(modules: PlacedModule[], sources: Map<string, ModuleSource>): AssemblyCheck {
  const items = modules.map((m) => ({ m, src: sources.get(m.key)! })).filter((x) => x.src);
  const rects = items.map(({ m, src }) => boardRect(src.layout.board, m.placement));
  const overlaps: [number, number][] = [];
  for (let i = 0; i < items.length; i++)
    for (let k = i + 1; k < items.length; k++) if (rectsOverlap(rects[i], rects[k])) overlaps.push([i, k]);

  const ends = items.flatMap(({ m, src }, module) =>
    src.connectors.map((c) => {
      const w = worldConnector(c, m.placement);
      // ボードの端の上の点
      const dir = { x: Math.round(Math.cos(rad(w.deg))), y: Math.round(Math.sin(rad(w.deg))) };
      return { module, c, w, dir, edgeX: w.x + dir.x * c.inset, edgeY: w.y + dir.y * c.inset, maker: layoutMaker(src.layout) };
    }),
  );
  const junctions: Junction[] = [];
  const mismatches: AssemblyCheck["mismatches"] = [];
  const used = new Set<string>();
  for (let i = 0; i < ends.length; i++) {
    for (let k = i + 1; k < ends.length; k++) {
      const a = ends[i];
      const b = ends[k];
      if (a.module === b.module) continue;
      if (Math.abs(normDeg(a.w.deg - b.w.deg - 180)) > 1) continue;
      // 同じ線（ボードの端）の上にあるか
      const along = a.dir.x !== 0 ? "y" : "x";
      const across = along === "y" ? "x" : "y";
      const aEdge = across === "x" ? a.edgeX : a.edgeY;
      const bEdge = across === "x" ? b.edgeX : b.edgeY;
      if (Math.abs(aEdge - bEdge) > LATERAL_TOL_MM) continue;
      const aPos = along === "x" ? a.w.x : a.w.y;
      const bPos = along === "x" ? b.w.x : b.w.y;
      const lateral = Math.abs(aPos - bPos);
      // 相手のボードがその位置で接しているか
      const ka = `${a.module}:${a.c.id}`;
      const kb = `${b.module}:${b.c.id}`;
      if (used.has(ka) || used.has(kb)) continue;
      const ref = { a: { module: a.module, connector: a.c.id }, b: { module: b.module, connector: b.c.id } };
      if (lateral > 60) continue;
      if (lateral > LATERAL_TOL_MM) {
        mismatches.push({ ...ref, reason: `線路の位置が ${lateral.toFixed(1)}mm ずれています` });
        continue;
      }
      if (Math.abs(a.c.z - b.c.z) > HEIGHT_TOL_MM) {
        mismatches.push({ ...ref, reason: `線路の高さが ${a.c.z.toFixed(0)}mm と ${b.c.z.toFixed(0)}mm で違います` });
        continue;
      }
      if (a.maker !== b.maker) {
        mismatches.push({ ...ref, reason: "KATO と TOMIX の線路は、そのままではつながりません（変換線路が必要）" });
        continue;
      }
      used.add(ka);
      used.add(kb);
      const gap = a.c.inset + b.c.inset;
      junctions.push({ ...ref, gap, fill: fillGap(gap, a.maker), z: a.c.z });
    }
  }
  // 隣のボードの端に突き当たるのに、向かいに線路がない端子
  const flagged = new Set(mismatches.flatMap((m) => [`${m.a.module}:${m.a.connector}`, `${m.b.module}:${m.b.connector}`]));
  for (const e of ends) {
    const k = `${e.module}:${e.c.id}`;
    if (used.has(k) || flagged.has(k)) continue;
    const px = e.edgeX + e.dir.x;
    const py = e.edgeY + e.dir.y;
    const other = rects.findIndex((r, m) => m !== e.module && px > r.x0 && px < r.x1 && py > r.y0 && py < r.y1);
    if (other < 0) continue;
    mismatches.push({
      a: { module: e.module, connector: e.c.id },
      b: { module: other, connector: "" },
      reason: "隣のボードに、続く線路がありません",
    });
  }
  return { junctions, overlaps, mismatches };
}

export type Candidate = {
  key: string;
  /** 新しいボードの端子 */
  connector: string;
  placement: Placement;
  /** この置き方でつながる端子の数（複線なら2） */
  links: number;
  /** すき間を埋める線路の本数の合計 */
  fillers: number;
  /** 埋められないすき間・合わない端子があるか */
  problems: string[];
};

/**
 * 置いてあるボードの空いている端子 target に、つなげられるレイアウトと置き方を探す。
 * ボードが重なる置き方は出さない。
 */
export function findCandidates(
  modules: PlacedModule[],
  target: { module: number; connector: string },
  sources: Map<string, ModuleSource>,
  pool: ModuleSource[],
): Candidate[] {
  const base = modules[target.module];
  const baseSrc = base && sources.get(base.key);
  const a = baseSrc?.connectors.find((c) => c.id === target.connector);
  if (!base || !baseSrc || !a) return [];
  const maker = layoutMaker(baseSrc.layout);
  const before = checkAssembly(modules, sources);
  const taken = new Set(before.junctions.flatMap((j) => [`${j.a.module}:${j.a.connector}`, `${j.b.module}:${j.b.connector}`]));
  if (taken.has(`${target.module}:${target.connector}`)) return [];

  const out: Candidate[] = [];
  for (const src of pool) {
    if (layoutMaker(src.layout) !== maker) continue;
    for (const b of src.connectors) {
      if (Math.abs(a.z - b.z) > HEIGHT_TOL_MM) continue;
      const placement = placeToConnect(a, base.placement, b);
      const next = [...modules, { key: src.key, placement }];
      const all = new Map(sources);
      all.set(src.key, src);
      const check = checkAssembly(next, all);
      const idx = next.length - 1;
      if (check.overlaps.some(([i, k]) => i === idx || k === idx)) continue;
      const mine = check.junctions.filter((j) => j.a.module === idx || j.b.module === idx);
      if (!mine.some((j) => j.b.connector === b.id || j.a.connector === b.id)) continue;
      const problems = [
        ...mine.filter((j) => j.fill === null).map((j) => `すき間 ${j.gap.toFixed(1)}mm を埋める直線の組み合わせがありません`),
        ...check.mismatches.filter((m) => m.a.module === idx || m.b.module === idx).map((m) => m.reason),
      ];
      out.push({
        key: src.key,
        connector: b.id,
        placement,
        links: mine.length,
        fillers: mine.reduce((s, j) => s + (j.fill?.length ?? 0), 0),
        problems,
      });
    }
  }
  return out.sort(
    (x, y) =>
      Number(x.problems.length > 0) - Number(y.problems.length > 0) ||
      y.links - x.links ||
      x.problems.length - y.problems.length ||
      x.fillers - y.fillers,
  );
}

// ---- 合成 ----

/** つないだレイアウトを、1つのレイアウトにまとめる（ボードは全体を囲む長方形） */
export function mergeAssembly(
  title: string,
  modules: PlacedModule[],
  sources: Map<string, ModuleSource>,
): { layout: Layout; check: AssemblyCheck; offset: { x: number; y: number } } {
  const check = checkAssembly(modules, sources);
  const items = modules.map((m) => ({ m, src: sources.get(m.key)! })).filter((x) => x.src);
  const rects = items.map(({ m, src }) => boardRect(src.layout.board, m.placement));
  const minX = rects.length ? Math.min(...rects.map((r) => r.x0)) : 0;
  const minY = rects.length ? Math.min(...rects.map((r) => r.y0)) : 0;
  const maxX = rects.length ? Math.max(...rects.map((r) => r.x1)) : 0;
  const maxY = rects.length ? Math.max(...rects.map((r) => r.y1)) : 0;
  const shift = (pl: Placement): Placement => ({ ...pl, x: pl.x - minX, y: pl.y - minY });

  const pieces: Piece[] = [];
  const accessories: NonNullable<Layout["accessories"]> = [];
  const sims: NonNullable<Layout["sims"]> = [];
  // 運行計画は、ボードごとの列車をそのまま引き継ぐ（駅のIDはホームの uid なので、uid と同じ接頭辞を付ける）
  const operation: OperationPlan = { stationNames: {}, trains: [] };
  items.forEach(({ m, src }, i) => {
    const pl = shift(m.placement);
    const prefix = `m${i}_`;
    for (const p of src.layout.pieces) {
      const q = applyPlacement(pl, p);
      pieces.push({ ...p, uid: prefix + p.uid, x: q.x, y: q.y, rot: normDeg(p.rot + pl.rot) });
    }
    for (const a of src.layout.accessories ?? []) {
      const q = applyPlacement(pl, a);
      accessories.push({ ...a, uid: prefix + a.uid, host: a.host && prefix + a.host, x: q.x, y: q.y, rot: normDeg(a.rot + pl.rot) });
    }
    for (const s of src.layout.sims ?? []) {
      const q = applyPlacement(pl, s);
      sims.push({ ...s, uid: prefix + s.uid, host: s.host && prefix + s.host, x: q.x, y: q.y, rot: normDeg(s.rot + pl.rot) });
    }
    const op = src.layout.operation;
    if (op) {
      for (const [id, name] of Object.entries(op.stationNames ?? {})) operation.stationNames[prefix + id] = name;
      for (const t of op.trains ?? []) {
        operation.trains.push({ ...t, id: prefix + t.id, stops: t.stops.map((st) => ({ ...st, stationId: prefix + st.stationId })) });
      }
    }
  });

  // すき間を埋める直線を、a 側の端子から順に置く
  check.junctions.forEach((j, n) => {
    if (!j.fill?.length) return;
    const it = items[j.a.module];
    const c = it.src.connectors.find((x) => x.id === j.a.connector)!;
    const w = worldConnector(c, shift(it.m.placement));
    let joint = { x: w.x, y: w.y, deg: w.deg };
    j.fill.forEach((partId, i) => {
      const piece = placeAt(partId, false, 0, joint, `fill${n}_${i}`);
      if (j.z) piece.z = j.z;
      pieces.push(piece);
      joint = worldJoints(piece)[1];
    });
  });

  const first = items[0]?.src.layout;
  const makers = new Set(items.map(({ src }) => layoutMaker(src.layout)));
  const layout: Layout = {
    title,
    maker: makers.size === 1 ? [...makers][0] : first ? layoutMaker(first) : "kato",
    description: `${items.length}枚のレイアウトをつないだもの`,
    board: { width: Math.round((maxX - minX) * 10) / 10, height: Math.round((maxY - minY) * 10) / 10 },
    pieces,
    ...(accessories.length ? { accessories } : {}),
    ...(sims.length ? { sims } : {}),
    ...(operation.trains.length ? { operation } : {}),
  };
  // offset: 合成したレイアウトの原点が、置き方の座標でどこにあるか
  return { layout, check, offset: { x: minX, y: minY } };
}
