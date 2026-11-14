// 線路部品の幾何定義。品番・寸法は src/data/trackCatalog.ts（各社公式サイトから抽出）から生成する。単位: mm
//
// 座標系: SVGと同じく x は右、y は下が正。角度(deg)は +x 方向を0とし、画面上で時計回りが正。
// 各部品はローカル座標で定義し、ジョイント0は常に原点で外向き180°（-x方向）を向く。
// 曲線・ポイントは「左（L）」を基準に定義し、右（R）は y 軸反転で表す。

import { CATALOG, type CatalogEntry, type CatalogProduct } from "../data/trackCatalog";

export type Joint = { x: number; y: number; deg: number };

export type PartKind = "straight" | "curve" | "turnout" | "bumper";

export const MAKERS = ["kato", "tomix"] as const;
export type Maker = (typeof MAKERS)[number];

export const MAKER_INFO: Record<Maker, { label: string; system: string; trackSpacing: number }> = {
  kato: { label: "KATO", system: "ユニトラック", trackSpacing: 33 },
  tomix: { label: "TOMIX", system: "ファイントラック", trackSpacing: 37 },
};

export type PartDef = {
  id: string;
  maker: Maker;
  /** 公式カタログの品番（右向きのポイントは productsRight） */
  products: CatalogProduct[];
  productsRight?: CatalogProduct[];
  /** 寸法を規格値で補った場合の注記 */
  geometryNote?: string;
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

function fromCatalog(maker: Maker, e: CatalogEntry): PartDef {
  const base = { id: e.id, maker, products: e.products, productsRight: e.productsRight, geometryNote: e.geometryNote };
  switch (e.kind) {
    case "straight":
      return {
        ...base,
        name: `直線 ${e.id}`,
        kind: "straight",
        length: e.length,
        handed: false,
        joints: [
          { x: 0, y: 0, deg: 180 },
          { x: e.length!, y: 0, deg: 0 },
        ],
        description: `長さ${e.length}mmの直線`,
      };
    case "curve":
      return {
        ...base,
        name: `曲線 ${e.id}°`,
        kind: "curve",
        radius: e.radius,
        angle: e.angle,
        handed: true,
        joints: [{ x: 0, y: 0, deg: 180 }, arcEnd(e.radius!, e.angle!)],
        description: `半径${e.radius}mm・${e.angle}°の曲線（${Math.round(360 / e.angle!)}本で円）`,
      };
    case "turnout":
      return {
        ...base,
        name: `ポイント ${e.id}`,
        kind: "turnout",
        length: e.length,
        radius: e.radius,
        angle: e.angle,
        handed: true,
        joints: [
          { x: 0, y: 0, deg: 180 },
          { x: e.length!, y: 0, deg: 0 },
          arcEnd(e.radius!, e.angle!),
        ],
        description: `ポイント（左右あり）。直進${e.length}mm、分岐側はR${e.radius} ${e.angle}°。ジョイント1=直進側、2=分岐側`,
      };
    case "bumper":
      return {
        ...base,
        name: "車止め",
        kind: "bumper",
        length: e.length,
        handed: false,
        joints: [{ x: 0, y: 0, deg: 180 }],
        description: "線路の終端に置く車止め（ジョイントは1つ）",
      };
  }
}

export const PARTS: PartDef[] = MAKERS.flatMap((m) => CATALOG[m].map((e) => fromCatalog(m, e)));

export function partsFor(maker: Maker): PartDef[] {
  return PARTS.filter((p) => p.maker === maker);
}

export function partIdsFor(maker: Maker): [string, ...string[]] {
  return partsFor(maker).map((p) => p.id) as [string, ...string[]];
}

/** 部品の購入用の品番（左右のあるポイントは向きで変わる） */
export function productsOf(part: PartDef, mirror: boolean): CatalogProduct[] {
  return mirror && part.productsRight ? part.productsRight : part.products;
}

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
