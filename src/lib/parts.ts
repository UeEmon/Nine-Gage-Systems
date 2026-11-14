// 線路部品カタログ（KATOユニトラック互換の一般的な寸法, 単位: mm）
//
// 座標系: SVGと同じく x は右、y は下が正。角度(deg)は +x 方向を0とし、画面上で時計回りが正。
// 各部品はローカル座標で定義し、ジョイント0は常に原点で外向き180°（-x方向）を向く。
// 曲線・ポイントは「左（L）」を基準に定義し、右（R）は y 軸反転で表す。

export type Joint = { x: number; y: number; deg: number };

export type PartKind = "straight" | "curve" | "turnout" | "bumper";

export type PartDef = {
  id: string;
  name: string;
  kind: PartKind;
  /** 直線長、またはポイントの直進側の長さ */
  length?: number;
  /** 曲線半径、またはポイント分岐側の半径 */
  radius?: number;
  /** 曲線角度、またはポイント分岐側の角度 */
  angle?: number;
  /** 左右の向きがある部品か */
  handed: boolean;
  /** 左向き（mirror=false）時のローカルジョイント */
  joints: Joint[];
  description: string;
};

const rad = (d: number) => (d * Math.PI) / 180;

function arcEnd(radius: number, angle: number): Joint {
  // 左カーブ: 中心 (0, -R)。進行方向は反時計回り（角度が減る）。
  return {
    x: radius * Math.sin(rad(angle)),
    y: -radius * (1 - Math.cos(rad(angle))),
    deg: -angle,
  };
}

function straight(length: number): PartDef {
  return {
    id: `S${length}`,
    name: `直線 ${length}mm`,
    kind: "straight",
    length,
    handed: false,
    joints: [
      { x: 0, y: 0, deg: 180 },
      { x: length, y: 0, deg: 0 },
    ],
    description: `長さ${length}mmの直線`,
  };
}

function curve(radius: number, angle: number): PartDef {
  return {
    id: `R${radius}-${angle}`,
    name: `曲線 R${radius} ${angle}°`,
    kind: "curve",
    radius,
    angle,
    handed: true,
    joints: [{ x: 0, y: 0, deg: 180 }, arcEnd(radius, angle)],
    description: `半径${radius}mm・${angle}°の曲線（${Math.round(360 / angle)}本で円）`,
  };
}

function turnout(length: number, radius: number, angle: number, label: string): PartDef {
  return {
    id: `TO${label}`,
    name: `${label}番ポイント`,
    kind: "turnout",
    length,
    radius,
    angle,
    handed: true,
    joints: [
      { x: 0, y: 0, deg: 180 },
      { x: length, y: 0, deg: 0 },
      arcEnd(radius, angle),
    ],
    description: `${label}番ポイント。直進${length}mm、分岐側はR${radius} ${angle}°。ジョイント1=直進側、2=分岐側`,
  };
}

const bumper: PartDef = {
  id: "BUMPER",
  name: "車止め",
  kind: "bumper",
  length: 40,
  handed: false,
  joints: [{ x: 0, y: 0, deg: 180 }],
  description: "線路の終端に置く車止め（ジョイントは1つ）",
};

export const PARTS: PartDef[] = [
  straight(248),
  straight(186),
  straight(124),
  straight(64),
  curve(216, 45),
  curve(249, 45),
  curve(282, 45),
  curve(315, 45),
  curve(348, 45),
  curve(481, 15),
  curve(718, 15),
  turnout(186, 718, 15, "6"),
  bumper,
];

export const PART_IDS = PARTS.map((p) => p.id) as [string, ...string[]];

const byId = new Map(PARTS.map((p) => [p.id, p]));

export function getPart(id: string): PartDef {
  const p = byId.get(id);
  if (!p) throw new Error(`未知の部品: ${id}`);
  return p;
}

export function hasPart(id: string): boolean {
  return byId.has(id);
}

/** 向きを反映したローカルジョイント */
export function localJoints(part: PartDef, mirror: boolean): Joint[] {
  if (!mirror) return part.joints;
  return part.joints.map((j) => ({ x: j.x, y: -j.y, deg: normDeg(-j.deg) }));
}

export function normDeg(d: number): number {
  let r = d % 360;
  if (r <= -180) r += 360;
  if (r > 180) r -= 360;
  return r;
}
