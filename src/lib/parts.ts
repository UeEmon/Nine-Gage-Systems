// 線路部品の定義。品番・寸法・形は src/data/trackCatalog.ts（各社公式サイトから抽出）から生成する。単位: mm
//
// 座標系: SVGと同じく x は右、y は下が正。角度(deg)は +x 方向を0とし、画面上で時計回りが正。
// 各部品はローカル座標で定義し、ジョイント0は常に原点で外向き180°（-x方向）を向く。
// 左右のある部品は「左（L）」を基準に定義し、右（R）は y 軸反転（鏡像）で表す。

import { CATALOG, type CatalogProduct, type PartCategory } from "../data/trackCatalog";
import { jointsOf, routeLength, type Pose, type Route } from "./shapes";

export type Joint = Pose;

export const MAKERS = ["kato", "tomix"] as const;
export type Maker = (typeof MAKERS)[number];

export const MAKER_INFO: Record<Maker, { label: string; system: string; trackSpacing: number }> = {
  kato: { label: "KATO", system: "ユニトラック", trackSpacing: 33 },
  tomix: { label: "TOMIX", system: "ファイントラック", trackSpacing: 37 },
};

export const CATEGORY_LABELS: Record<PartCategory, string> = {
  straight: "直線",
  curve: "曲線",
  turnout: "ポイント",
  crossing: "交差",
  double: "複線",
  bumper: "車止め",
};

export type PartDef = {
  /** メーカー内で一意の部品ID（AIへの指示にも使う） */
  id: string;
  /** 全メーカーで一意のキー（"kato:S248" など）。配置データにはこれを保存する */
  key: string;
  maker: Maker;
  category: PartCategory;
  name: string;
  /** 左右の向きがある部品か */
  handed: boolean;
  bumper: boolean;
  routes: Route[];
  /** 左向き（mirror=false）時のローカルジョイント */
  joints: Joint[];
  /** 経路の長さの合計（分岐側も含む） */
  routeLength: number;
  products: CatalogProduct[];
  productsRight?: CatalogProduct[];
  geometryNote?: string;
  jointHelp?: string;
  /** AI向けの説明 */
  description: string;
};

function describe(category: PartCategory, routes: Route[], label: string): string {
  const r0 = routes[0];
  const m = r0.moves[0];
  switch (category) {
    case "straight":
      return `長さ${m.t === "S" ? m.len : "?"}mmの直線`;
    case "curve":
      return m.t === "A" ? `半径${m.r}mm・${m.deg}°の曲線（${Math.round(360 / m.deg)}本で円）` : label;
    case "bumper":
      return "線路の終端に置く車止め（ジョイントは j0 だけ）";
    default:
      return label;
  }
}

export const PARTS: PartDef[] = MAKERS.flatMap((maker) =>
  CATALOG[maker].map((e): PartDef => {
    // 車止めは j0 だけ（先端はつながない）
    const joints = e.bumper ? [{ x: 0, y: 0, deg: 180 }] : jointsOf(e.routes);
    return {
      id: e.id,
      key: `${maker}:${e.id}`,
      maker,
      category: e.category,
      name: e.label,
      handed: e.handed,
      bumper: Boolean(e.bumper),
      routes: e.routes,
      joints,
      routeLength: e.routes.reduce((s, r) => s + routeLength(r), 0),
      products: e.products,
      productsRight: e.productsRight,
      geometryNote: e.geometryNote,
      jointHelp: e.jointHelp,
      description: describe(e.category, e.routes, e.label),
    };
  }),
);

export function partsFor(maker: Maker): PartDef[] {
  return PARTS.filter((p) => p.maker === maker);
}

export function partIdsFor(maker: Maker): [string, ...string[]] {
  return partsFor(maker).map((p) => p.id) as [string, ...string[]];
}

/** 部品の購入用の品番（左右で品番が違うものは向きで変わる） */
export function productsOf(part: PartDef, mirror: boolean): CatalogProduct[] {
  return mirror && part.productsRight ? part.productsRight : part.products;
}

const byKey = new Map(PARTS.map((p) => [p.key, p]));

/** キー（"kato:S248"）で部品を引く。メーカーのない古い保存データは KATO とみなす */
export function getPart(key: string): PartDef {
  const p = byKey.get(key) ?? byKey.get(`kato:${key}`);
  if (!p) throw new Error(`未知の部品: ${key}`);
  return p;
}

export function hasPart(key: string): boolean {
  return byKey.has(key) || byKey.has(`kato:${key}`);
}

/** メーカーと部品IDからキーを作る */
export function partKey(maker: Maker, id: string): string {
  return `${maker}:${id}`;
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
