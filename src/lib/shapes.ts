// 線路部品の形を「経路（線路1本分の中心線）」の集まりで表す。
// 経路は始点の位置・向きと、直線(S)と円弧(A)の並びで描く。
// 座標は左向き(L)基準のローカル座標（x 右, y 下, 角度は時計回りが正）。

export type Pose = { x: number; y: number; deg: number };

/** 直線 len mm、または半径 r・角度 deg の円弧（turn: L=左へ曲がる, R=右へ曲がる） */
export type Move = { t: "S"; len: number } | { t: "A"; r: number; deg: number; turn: "L" | "R" };

export type Route = { start: Pose; moves: Move[] };

const rad = (d: number) => (d * Math.PI) / 180;

/** 経路をたどった終点の位置と進行方向 */
export function routeEnd(route: Route): Pose {
  let { x, y, deg } = route.start;
  for (const m of route.moves) {
    if (m.t === "S") {
      x += m.len * Math.cos(rad(deg));
      y += m.len * Math.sin(rad(deg));
    } else {
      const sign = m.turn === "L" ? -1 : 1;
      // 円の中心は進行方向の左(L)または右(R)
      const cx = x - sign * m.r * Math.sin(rad(deg));
      const cy = y + sign * m.r * Math.cos(rad(deg));
      const nd = deg + sign * m.deg;
      x = cx + sign * m.r * Math.sin(rad(nd));
      y = cy - sign * m.r * Math.cos(rad(nd));
      deg = nd;
    }
  }
  return { x, y, deg };
}

export function routeLength(route: Route): number {
  return route.moves.reduce((s, m) => s + (m.t === "S" ? m.len : m.r * rad(m.deg)), 0);
}

/** SVGのパス文字列 */
export function routeSvg(route: Route): string {
  let pose = route.start;
  let d = `M${pose.x.toFixed(3)} ${pose.y.toFixed(3)}`;
  for (const m of route.moves) {
    const end = routeEnd({ start: pose, moves: [m] });
    if (m.t === "S") d += ` L${end.x.toFixed(3)} ${end.y.toFixed(3)}`;
    else d += ` A${m.r} ${m.r} 0 0 ${m.turn === "L" ? 0 : 1} ${end.x.toFixed(3)} ${end.y.toFixed(3)}`;
    pose = end;
  }
  return d;
}

/** 中心線上の点（およそ step mm 間隔） */
export function routeSamples(route: Route, step = 10): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = [{ x: route.start.x, y: route.start.y }];
  let pose = route.start;
  for (const m of route.moves) {
    const len = m.t === "S" ? m.len : m.r * rad(m.deg);
    const n = Math.max(1, Math.ceil(len / step));
    for (let i = 1; i <= n; i++) {
      const part: Move = m.t === "S" ? { t: "S", len: (m.len * i) / n } : { ...m, deg: (m.deg * i) / n };
      const p = routeEnd({ start: pose, moves: [part] });
      pts.push({ x: p.x, y: p.y });
    }
    pose = routeEnd({ start: pose, moves: [m] });
  }
  return pts;
}

/**
 * 経路の端点からジョイント（接続端）を作る。
 * 経路の順に「始点、終点」を並べ、同じ位置・同じ向きの端はまとめる。
 * ジョイントの角度は外向き（つながる相手の方向）。
 */
export function jointsOf(routes: Route[]): Pose[] {
  const out: Pose[] = [];
  const add = (p: Pose) => {
    const norm = ((p.deg % 360) + 540) % 360 - 180;
    if (out.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < 0.5 && Math.abs((((q.deg - norm) % 360) + 540) % 360 - 180) < 0.5)) return;
    out.push({ x: p.x, y: p.y, deg: norm === -180 ? 180 : norm });
  };
  for (const r of routes) {
    add({ ...r.start, deg: r.start.deg + 180 });
    add(routeEnd(r));
  }
  return out;
}

// ---- よく使う形 ----

const O: Pose = { x: 0, y: 0, deg: 0 };
const S = (len: number): Move => ({ t: "S", len });
const A = (r: number, deg: number, turn: "L" | "R" = "L"): Move => ({ t: "A", r, deg, turn });

export const shape = {
  straight: (len: number): Route[] => [{ start: O, moves: [S(len)] }],
  curve: (r: number, deg: number): Route[] => [{ start: O, moves: [A(r, deg)] }],

  /** ポイント。straight=直進側の長さ（なければ null）、branches=分岐側の円弧 */
  turnout: (straight: number | null, branches: { r: number; deg: number; turn: "L" | "R" }[]): Route[] => [
    ...(straight ? [{ start: O, moves: [S(straight)] }] : []),
    ...branches.map((b) => ({ start: O, moves: [A(b.r, b.deg, b.turn)] })),
  ],

  /** 交差: 長さ len の2本が中央で deg 度で交わる（2本目は左上へ向かう） */
  crossing: (len: number, deg: number): Route[] => {
    const h = len / 2;
    const c = Math.cos(rad(deg));
    const s = Math.sin(rad(deg));
    return [
      { start: O, moves: [S(len)] },
      { start: { x: h - h * c, y: h * s, deg: -deg }, moves: [S(len)] },
    ];
  },

  /** ダブルスリップ: 交差 + 交差する2本をつなぐ渡り線（左右とも） */
  doubleSlip: (len: number, deg: number): Route[] => {
    const routes = shape.crossing(len, deg);
    const end2 = routeEnd(routes[1]);
    // j0 から2本目の終点へ、2本目の始点から1本目の終点へ、それぞれ円弧で渡る
    const chord = Math.hypot(end2.x, end2.y);
    const r = chord / (2 * Math.sin(rad(deg / 2)));
    return [...routes, { start: O, moves: [A(r, deg, "L")] }, { start: routes[1].start, moves: [A(r, deg, "R")] }];
  },

  /** 複線: 線路中心間隔 spacing で左側にもう1本 */
  double: (inner: Route[], spacing: number, outer?: Route[]): Route[] => [
    ...inner,
    ...(outer ?? inner).map((r) => ({ ...r, start: { ...r.start, y: r.start.y - spacing } })),
  ],

  doubleStraight: (len: number, spacing: number): Route[] => shape.double(shape.straight(len), spacing),

  /** 複線曲線: 基準の線路が半径 r（外側）、左側の線路が r - spacing（内側） */
  doubleCurve: (r: number, deg: number, spacing: number): Route[] => [
    { start: O, moves: [A(r, deg)] },
    { start: { x: 0, y: -spacing, deg: 0 }, moves: [A(r - spacing, deg)] },
  ],

  /** 平行移動する S 字（offset だけ左へずれる） */
  sCurve: (start: Pose, len: number, offset: number): Route => {
    const half = Math.atan2(Math.abs(offset), len); // = θ/2
    const theta = 2 * half;
    const r = len / (2 * Math.sin(theta));
    const deg = (theta * 180) / Math.PI;
    const turn1 = offset > 0 ? "L" : "R";
    const turn2 = offset > 0 ? "R" : "L";
    return { start: start, moves: [A(r, deg, turn1), A(r, deg, turn2)] };
  },

  /** 片渡り（右側の線路から左側の線路へ渡る）または両渡り（ダブルクロス） */
  crossover: (len: number, spacing: number, both: boolean): Route[] => [
    ...shape.doubleStraight(len, spacing),
    shape.sCurve(O, len, spacing),
    ...(both ? [shape.sCurve({ x: 0, y: -spacing, deg: 0 }, len, -spacing)] : []),
  ],

  /** 複線間隔変換: 右側の線路は直線、左側の線路が offset だけ外へ広がる */
  spacingChange: (len: number, spacing: number, offset: number): Route[] => [
    { start: O, moves: [S(len)] },
    shape.sCurve({ x: 0, y: -spacing, deg: 0 }, len, offset),
  ],

  bumper: (len: number): Route[] => [{ start: O, moves: [S(len)] }],
};
