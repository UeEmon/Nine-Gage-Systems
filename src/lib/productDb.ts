// 品番データベース。線路カタログ（部品の形）と価格表から、品番ごとの1行を作る。
// 所有パーツの登録・不足数と追加費用の計算・CSV出力はすべてこのデータを使う。

import { bedOfProductName, CATALOG, CATALOG_SOURCES, NOT_MODELED, type BedType, type PartCategory } from "../data/trackCatalog";
import { PRICES, PRICES_FETCHED_AT } from "../data/prices";
import { heightText, PIER_SYSTEMS } from "../data/piers";
import { isPierKey, parsePierKey, pierStockKey } from "./elevation";
import { BED_INFO, MAKERS, MAKER_INFO, PARTS, type Maker, type PartDef } from "./parts";
import type { Move } from "./shapes";

export type GeometryStatus = "official" | "confirmed" | "estimated";

export const STATUS_LABELS: Record<GeometryStatus, string> = {
  official: "公式掲載値",
  confirmed: "確認済み",
  estimated: "一部推定",
};

/** 1箱に入っている部品。stockKey が同じ部品は在庫として同じものに数える */
export type ProductContent = {
  partKey: string;
  partId: string;
  /** 在庫・部品リストのキー。左右で品番が違う部品の右向きは ":R" が付く */
  stockKey: string;
  count: number;
};

/** 品番の分類。線路の分類に「高架線路」と「橋脚」を加えたもの */
export type ProductCategory = PartCategory | "elevated" | "pier";

export const PRODUCT_CATEGORY_LABELS: Record<ProductCategory, string> = {
  straight: "直線",
  curve: "曲線",
  turnout: "ポイント",
  crossing: "交差",
  double: "複線",
  elevated: "高架線路",
  bridge: "鉄橋",
  pier: "橋脚",
  bumper: "車止め",
};

export type ProductRecord = {
  maker: Maker;
  code: string;
  name: string;
  category: ProductCategory;
  /** 1箱の部品数の合計（入数がわからないものは null） */
  perPack: number | null;
  contents: ProductContent[];
  /** メーカー希望小売価格（税込・円）。不明なら null */
  priceJpy: number | null;
  /** 寸法の要約 */
  spec: string;
  /** 左右の区別（左右で品番が違うもののみ） */
  side: "L" | "R" | null;
  /** 道床の種類（橋脚は null） */
  bed: BedType | null;
  geometryStatus: GeometryStatus;
  geometryNote: string | null;
  /** 品番・価格の出典（公式一覧）と、寸法の確認に使った資料 */
  sources: string[];
};

/**
 * 部品リスト・在庫で使うキー。
 * 左右で品番が違う部品の右向きは ":R"、高架用の品番がある部品を高架に置いたときは ":V" が付く。
 * 橋脚は "kato:pier:S:50"（単線・高さ50mm）のような別の形。
 */
export function stockKeyOf(part: PartDef, mirror: boolean, elevated = false): string {
  if (elevated && part.elevatedProducts) return `${part.key}:V`;
  return part.productsRight && mirror ? `${part.key}:R` : part.key;
}

/** 在庫キーを部品キーと向き・高架に分ける（橋脚のキーはそのまま partKey に入る） */
export function stockLabel(stockKey: string): { partKey: string; right: boolean; elevated: boolean } {
  const right = stockKey.endsWith(":R");
  const elevated = stockKey.endsWith(":V");
  return { partKey: right || elevated ? stockKey.slice(0, -2) : stockKey, right, elevated };
}

/** 在庫キーの画面向けの名前 */
export function stockKeyName(stockKey: string): string {
  const pier = parsePierKey(stockKey);
  if (pier) return `${pier.double ? "複線" : "単線"}橋脚 高さ${heightText(pier.height)}mm`;
  const { partKey, right, elevated } = stockLabel(stockKey);
  const part = PARTS.find((p) => p.key === partKey);
  if (!part) return stockKey;
  return `${part.name}${elevated ? "（高架）" : part.productsRight ? (right ? "（右）" : "（左）") : ""}`;
}

const fmt = (n: number) => String(Math.round(n * 10) / 10);
function moveText(m: Move): string {
  return m.t === "S" ? `直線${fmt(m.len)}mm` : `R${fmt(m.r)}-${fmt(m.deg)}°${m.turn === "R" ? "(右)" : ""}`;
}

export function specOf(part: PartDef): string {
  if (part.category === "bridge") return `鉄橋 ${part.routes.map((r) => r.moves.map(moveText).join("+")).join(" / ")}`;
  const routes = part.routes.map((r) => r.moves.map(moveText).join("+"));
  switch (part.category) {
    case "straight":
    case "curve":
      return routes[0];
    case "bumper":
      return `車止め 長さ${fmt(part.routes[0].moves[0].t === "S" ? part.routes[0].moves[0].len : 0)}mm`;
    default:
      return `${routes.join(" / ")}`;
  }
}

function build(): ProductRecord[] {
  const byCode = new Map<string, ProductRecord>();
  for (const maker of MAKERS) {
    for (const entry of CATALOG[maker]) {
      const part = PARTS.find((p) => p.key === `${maker}:${entry.id}`)!;
      const lists: [typeof entry.products, boolean, boolean][] = [[entry.products, false, false]];
      if (entry.productsRight) lists.push([entry.productsRight, true, false]);
      if (entry.elevatedProducts) lists.push([entry.elevatedProducts, false, true]);
      for (const [products, right, elevated] of lists) {
        for (const prod of products) {
          const key = `${maker}:${prod.code}`;
          const content: ProductContent = {
            partKey: part.key,
            partId: part.id,
            stockKey: stockKeyOf(part, right, elevated),
            count: prod.perPack ?? 1,
          };
          const existing = byCode.get(key);
          if (existing) {
            // 端数線路セットなど、1箱に複数の部品が入っているもの
            existing.contents.push(content);
            existing.perPack = existing.perPack !== null && prod.perPack !== null ? existing.perPack + prod.perPack : null;
            existing.spec += ` ＋ ${specOf(part)}`;
            continue;
          }
          const status: GeometryStatus = entry.geometryStatus ?? "official";
          byCode.set(key, {
            maker,
            code: prod.code,
            name: prod.name,
            category: elevated ? "elevated" : entry.category,
            perPack: prod.perPack,
            contents: [content],
            priceJpy: PRICES[key] ?? null,
            spec: elevated ? `高架 ${specOf(part)}` : specOf(part),
            side: entry.productsRight && !elevated ? (right ? "R" : "L") : null,
            bed: elevated ? "viaduct" : bedOfProductName(prod.name, entry.bed ?? "ballast"),
            geometryStatus: status,
            geometryNote: entry.geometryNote ?? null,
            sources: [listUrl(maker, elevated ? "elevated" : entry.category), ...(entry.geometrySources ?? [])],
          });
        }
      }
    }
    // 橋脚
    for (const pier of PIER_SYSTEMS[maker].products) {
      const key = `${maker}:${pier.code}`;
      const contents = pier.contents.map((c) => {
        const stockKey = pierStockKey({ maker, double: pier.double, height: c.height });
        return { partKey: stockKey, partId: stockKey, stockKey, count: c.count };
      });
      byCode.set(key, {
        maker,
        code: pier.code,
        name: pier.name,
        category: "pier",
        perPack: contents.reduce((s, c) => s + c.count, 0),
        contents,
        priceJpy: PRICES[key] ?? null,
        bed: null,
        spec: `${pier.double ? "複線" : "単線"}用 高さ${[...new Set(pier.contents.map((c) => heightText(c.height)))].join("/")}mm`,
        side: null,
        geometryStatus: pier.note?.includes("推定") ? "estimated" : "confirmed",
        geometryNote: pier.note ?? null,
        sources: [PIER_SOURCES[maker]],
      });
    }
  }
  return [...byCode.values()];
}

/** 品番・価格の出典にする公式一覧のURL */
function listUrl(maker: Maker, category: ProductCategory): string {
  const urls = CATALOG_SOURCES[maker].urls;
  if (maker === "kato" && category === "elevated") return urls.find((u) => u.endsWith("elevated_line"))!;
  if (category === "bridge") return urls.find((u) => u.endsWith("iron_bridge") || u.endsWith("category=knr"))!;
  return urls[0];
}

const PIER_SOURCES: Record<Maker, string> = {
  kato: "https://unitrack.katomodels.com/products/line_single/elevated_line",
  tomix: "https://www.tomytec.co.jp/tomix/nyumon/tomixrail/raillineup.cgi?category=knr",
};

export const PRODUCTS: ProductRecord[] = build();
const productByKey = new Map(PRODUCTS.map((p) => [`${p.maker}:${p.code}`, p]));

export function productsForMaker(maker: Maker): ProductRecord[] {
  return PRODUCTS.filter((p) => p.maker === maker);
}

/** 部品（左右・高架を含む）が入っている品番。カタログ順 */
export function productsOfPart(part: PartDef): ProductRecord[] {
  return PRODUCTS.filter((p) => p.contents.some((c) => c.partKey === part.key));
}

export function findProduct(maker: Maker, code: string): ProductRecord | undefined {
  return productByKey.get(`${maker}:${code}`);
}

export const DB_INFO = {
  pricesFetchedAt: PRICES_FETCHED_AT,
  notModeled: NOT_MODELED,
};

// ---- 所有パーツ（在庫） ----

/** 所有パーツ。キーは "メーカー:品番"、値は箱（個）数 */
export type Inventory = Record<string, number>;

/** 所有パーツを部品ごとの本数にする */
export function stockFromInventory(inv: Inventory, maker?: Maker): Map<string, number> {
  const stock = new Map<string, number>();
  for (const [key, boxes] of Object.entries(inv)) {
    const prod = productByKey.get(key);
    if (!prod || boxes <= 0 || (maker && prod.maker !== maker)) continue;
    for (const c of prod.contents) stock.set(c.stockKey, (stock.get(c.stockKey) ?? 0) + c.count * boxes);
  }
  return stock;
}

/** 在庫キーごとに、買うときの候補品番（価格のわかるもの、1本あたりが安い順） */
function buyOptions(stockKey: string): { prod: ProductRecord; per: number }[] {
  return PRODUCTS.filter((p) => p.contents.some((c) => c.stockKey === stockKey))
    .map((prod) => ({ prod, per: prod.contents.find((c) => c.stockKey === stockKey)!.count }))
    .sort((a, b) => {
      // 単品で入っているものを優先し、その中で1本あたりの価格が安いもの
      const mixedA = a.prod.contents.length > 1 ? 1 : 0;
      const mixedB = b.prod.contents.length > 1 ? 1 : 0;
      if (mixedA !== mixedB) return mixedA - mixedB;
      const ua = a.prod.priceJpy === null ? Infinity : a.prod.priceJpy / a.per;
      const ub = b.prod.priceJpy === null ? Infinity : b.prod.priceJpy / b.per;
      return ua - ub;
    });
}

/** 在庫キーの部品を1本買うときのいちばん安い単価（円。価格不明なら null） */
export function unitPriceOf(stockKey: string): number | null {
  const opt = buyOptions(stockKey)[0];
  return opt?.prod.priceJpy != null ? Math.round(opt.prod.priceJpy / opt.per) : null;
}

export type ShortfallRow = {
  stockKey: string;
  partId: string;
  right: boolean;
  /** レイアウトで使う本数 */
  used: number;
  /** 所有している本数 */
  owned: number;
  /** ほかの不足分で買うセットに入っていて、それで足りる本数 */
  fromSet: number;
  /** 足りない本数 */
  missing: number;
  /** 買う品番（安い順で最初のもの） */
  buy: ProductRecord | null;
  /** 買う箱数 */
  packs: number;
  /** 追加費用（価格不明なら null） */
  costJpy: number | null;
};

export type Shortfall = {
  rows: ShortfallRow[];
  totalCostJpy: number;
  /** 価格のわからない品番を含むか */
  hasUnknownPrice: boolean;
};

/**
 * 使う本数（在庫キーごと）と所有本数から、追加で買う品番・箱数・費用を出す。
 * 勾配橋脚セットのように1箱に何種類も入っている品番を買ったときは、
 * 一緒に入っている分をほかの部品の不足に充てる。
 */
export function shortfall(usage: Map<string, number>, stock: Map<string, number>): Shortfall {
  const rows: ShortfallRow[] = [];
  const fromSets = new Map<string, number>();
  let total = 0;
  let unknown = false;
  for (const [stockKey, used] of [...usage.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const owned = stock.get(stockKey) ?? 0;
    const bonus = fromSets.get(stockKey) ?? 0;
    const missing = Math.max(0, used - owned - bonus);
    const { partKey, right } = stockLabel(stockKey);
    const partId = isPierKey(stockKey) ? stockKeyName(stockKey) : (PARTS.find((p) => p.key === partKey)?.id ?? partKey);
    let buy: ProductRecord | null = null;
    let packs = 0;
    let cost: number | null = 0;
    if (missing > 0) {
      const opt = buyOptions(stockKey)[0];
      buy = opt?.prod ?? null;
      packs = opt ? Math.ceil(missing / opt.per) : missing;
      cost = opt?.prod.priceJpy != null ? opt.prod.priceJpy * packs : null;
      if (cost === null) unknown = true;
      else total += cost;
      for (const c of opt?.prod.contents ?? []) {
        if (c.stockKey !== stockKey) fromSets.set(c.stockKey, (fromSets.get(c.stockKey) ?? 0) + c.count * packs);
      }
    }
    rows.push({ stockKey, partId, right, used, owned, fromSet: Math.min(bonus, Math.max(0, used - owned)), missing, buy, packs, costJpy: cost });
  }
  return { rows, totalCostJpy: total, hasUnknownPrice: unknown };
}

/** 所有パーツの合計金額（価格のわかるもの） */
export function inventoryValue(inv: Inventory): number {
  let sum = 0;
  for (const [key, boxes] of Object.entries(inv)) sum += (productByKey.get(key)?.priceJpy ?? 0) * boxes;
  return sum;
}

// ---- CSV ----

const CSV_HEADER = [
  "メーカー",
  "品番",
  "製品名",
  "分類",
  "左右",
  "入数",
  "内容（部品ID×本数）",
  "寸法",
  "道床",
  "寸法の確認状況",
  "寸法の注記",
  "希望小売価格(税込円)",
  "出典",
];


function csvCell(v: string | number | null): string {
  const s = v === null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function productsCsv(): string {
  const lines = [CSV_HEADER.join(",")];
  for (const p of PRODUCTS) {
    lines.push(
      [
        MAKER_INFO[p.maker].label,
        p.code,
        p.name,
        PRODUCT_CATEGORY_LABELS[p.category],
        p.side === "L" ? "左" : p.side === "R" ? "右" : "",
        p.perPack,
        p.contents
          .map((c) => `${isPierKey(c.stockKey) ? stockKeyName(c.stockKey) : c.partId}${c.stockKey.endsWith(":R") ? "(右)" : c.stockKey.endsWith(":V") ? "(高架)" : ""}×${c.count}`)
          .join(" "),
        p.spec,
        p.bed ? BED_INFO[p.bed].label : "",
        STATUS_LABELS[p.geometryStatus],
        p.geometryNote,
        p.priceJpy,
        p.sources.join(" "),
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return lines.join("\n") + "\n";
}
