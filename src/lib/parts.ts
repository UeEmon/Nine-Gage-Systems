// 線路部品の定義。品番・寸法・形は src/data/trackCatalog.ts（各社公式サイトから抽出）から生成する。単位: mm
//
// 座標系: SVGと同じく x は右、y は下が正。角度(deg)は +x 方向を0とし、画面上で時計回りが正。
// 各部品はローカル座標で定義し、ジョイント0は常に原点で外向き180°（-x方向）を向く。
// 左右のある部品は「左（L）」を基準に定義し、右（R）は y 軸反転（鏡像）で表す。

import { CATALOG, type BedType, type CatalogProduct, type PartCategory } from "../data/trackCatalog";
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
  bridge: "鉄橋",
  bumper: "車止め",
};

/** 道床の表示名と略号（アイコンの右下に出す） */
export const BED_INFO: Record<BedType, { label: string; short: string; note: string }> = {
  ballast: { label: "標準（バラスト）", short: "", note: "バラスト道床・木まくら木" },
  pc: { label: "PCまくら木", short: "PC", note: "バラスト道床・コンクリート製まくら木" },
  slab: { label: "スラブ", short: "SL", note: "バラストのないコンクリート板の道床（新幹線・高架線向け）" },
  widePc: { label: "ワイドPC", short: "WP", note: "幅の広いバラスト道床・PCまくら木。曲線はカント付き" },
  viaduct: { label: "高架橋付き", short: "高架", note: "高架橋と一体になった線路（橋脚の上に置く）" },
  synthetic: { label: "合成まくら木", short: "SY", note: "合成まくら木のポイント" },
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
  /** 高架（橋脚の上）に置くときの品番 */
  elevatedProducts?: CatalogProduct[];
  /** 一緒に買う必要がある部品（TOMIXの鉄橋のレールなど）。部品IDと本数 */
  requires?: { id: string; count: number }[];
  /**
   * 勾配にできる部品の両端のジョイント（始点側, 終点側）。
   * 単線は [[0],[1]]、複線は [[0,2],[1,3]]。ポイントや交差は勾配にできないので null
   */
  rampEnds: [number[], number[]] | null;
  /** 道床の種類 */
  bed: BedType;
  /** 同じ形の部品をまとめるID（道床違いの部品は標準の部品のID） */
  shapeId: string;
  geometryNote?: string;
  jointHelp?: string;
  /** AI向けの説明 */
  description: string;
};

function describe(category: PartCategory, routes: Route[], label: string, bed: BedType): string {
  const base = describeShape(category, routes, label);
  return bed === "ballast" ? base : `${base}・${BED_INFO[bed].label}の道床`;
}

function describeShape(category: PartCategory, routes: Route[], label: string): string {
  const r0 = routes[0];
  const m = r0.moves[0];
  switch (category) {
    case "straight":
      return `長さ${m.t === "S" ? m.len : "?"}mmの直線`;
    case "curve":
      return m.t === "A" ? `半径${m.r}mm・${m.deg}°の曲線（${Math.round(360 / m.deg)}本で円）` : label;
    case "double": {
      // 2本とも1区間だけの単純な形のときだけ寸法で説明する（間隔変換線路などは名前のまま）
      const m1 = routes[1]?.moves[0];
      if (routes.length !== 2 || r0.moves.length !== 1 || routes[1].moves.length !== 1 || !m1 || m1.t !== m.t) return label;
      if (m.t === "S") return `長さ${m.len}mmの複線直線`;
      return m1.t === "A" ? `半径${m.r}/${m1.r}mm・${m.deg}°の複線曲線` : label;
    }
    case "bumper":
      return "線路の終端に置く車止め（ジョイントは j0 だけ）";
    case "bridge":
      return `${label}（${m.t === "S" ? `長さ${m.len}mmの直線` : `半径${m.r}mm・${m.deg}°の曲線`}${routes.length > 1 ? "・複線" : ""}）`;
    default:
      return label;
  }
}

function rampEndsOf(joints: Joint[], category: PartCategory, routes: number): [number[], number[]] | null {
  if (category === "turnout" || category === "crossing") return null;
  if (joints.length === 2 && routes === 1) return [[0], [1]];
  // 複線: j0→j1 が右側、j2→j3 が左側の線路
  if (joints.length === 4 && routes === 2) return [[0, 2], [1, 3]];
  return null;
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
      elevatedProducts: e.elevatedProducts,
      requires: e.requires,
      rampEnds: rampEndsOf(e.bumper ? [] : joints, e.category, e.routes.length),
      bed: e.bed ?? "ballast",
      shapeId: e.variantOf ?? e.id,
      geometryNote: e.geometryNote,
      jointHelp: e.jointHelp,
      description: describe(e.category, e.routes, e.label, e.bed ?? "ballast"),
    };
  }),
);

export function partsFor(maker: Maker): PartDef[] {
  return PARTS.filter((p) => p.maker === maker);
}

/** 同じ形で道床の違う部品（自分を含む。標準の部品が先頭） */
export function bedVariantsOf(part: PartDef): PartDef[] {
  return PARTS.filter((p) => p.maker === part.maker && p.shapeId === part.shapeId).sort(
    (a, b) => (a.id === a.shapeId ? -1 : 0) - (b.id === b.shapeId ? -1 : 0),
  );
}

/** メーカーにある道床の種類（部品の多い順ではなく BED_INFO の順） */
export function bedsFor(maker: Maker): BedType[] {
  const set = new Set(partsFor(maker).map((p) => p.bed));
  return (Object.keys(BED_INFO) as BedType[]).filter((b) => set.has(b));
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
