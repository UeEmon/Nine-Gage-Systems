// 品番データベース。線路カタログ（部品の形）と価格表から、品番ごとの1行を作る。
// 所有パーツの登録・不足数と追加費用の計算・CSV出力はすべてこのデータを使う。

import { CATALOG, CATALOG_SOURCES, NOT_MODELED, type PartCategory } from "../data/trackCatalog";
import { PRICES, PRICES_FETCHED_AT } from "../data/prices";
import { MAKERS, MAKER_INFO, PARTS, type Maker, type PartDef } from "./parts";
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

export type ProductRecord = {
  maker: Maker;
  code: string;
  name: string;
  category: PartCategory;
  /** 1箱の部品数の合計（入数がわからないものは null） */
  perPack: number | null;
  contents: ProductContent[];
  /** メーカー希望小売価格（税込・円）。不明なら null */
  priceJpy: number | null;
  /** 寸法の要約 */
  spec: string;
  /** 左右の区別（左右で品番が違うもののみ） */
  side: "L" | "R" | null;
  geometryStatus: GeometryStatus;
  geometryNote: string | null;
  /** 品番・価格の出典（公式一覧）と、寸法の確認に使った資料 */
  sources: string[];
};

/** 部品リスト・在庫で使うキー */
export function stockKeyOf(part: PartDef, mirror: boolean): string {
  return part.productsRight && mirror ? `${part.key}:R` : part.key;
}

/** 在庫キーをAI向け・画面向けの名前にする */
export function stockLabel(stockKey: string): { partKey: string; right: boolean } {
  const right = stockKey.endsWith(":R");
  return { partKey: right ? stockKey.slice(0, -2) : stockKey, right };
}

const fmt = (n: number) => String(Math.round(n * 10) / 10);
function moveText(m: Move): string {
  return m.t === "S" ? `直線${fmt(m.len)}mm` : `R${fmt(m.r)}-${fmt(m.deg)}°${m.turn === "R" ? "(右)" : ""}`;
}

export function specOf(part: PartDef): string {
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
      const lists: [typeof entry.products, boolean][] = [[entry.products, false]];
      if (entry.productsRight) lists.push([entry.productsRight, true]);
      for (const [products, right] of lists) {
        for (const prod of products) {
          const key = `${maker}:${prod.code}`;
          const content: ProductContent = {
            partKey: part.key,
            partId: part.id,
            stockKey: stockKeyOf(part, right),
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
            category: entry.category,
            perPack: prod.perPack,
            contents: [content],
            priceJpy: PRICES[key] ?? null,
            spec: specOf(part),
            side: entry.productsRight ? (right ? "R" : "L") : null,
            geometryStatus: status,
            geometryNote: entry.geometryNote ?? null,
            sources: [CATALOG_SOURCES[maker].urls[0], ...(entry.geometrySources ?? [])],
          });
        }
      }
    }
  }
  return [...byCode.values()];
}

export const PRODUCTS: ProductRecord[] = build();
const productByKey = new Map(PRODUCTS.map((p) => [`${p.maker}:${p.code}`, p]));

export function productsForMaker(maker: Maker): ProductRecord[] {
  return PRODUCTS.filter((p) => p.maker === maker);
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

/** 使う本数（在庫キーごと）と所有本数から、追加で買う品番・箱数・費用を出す */
export function shortfall(usage: Map<string, number>, stock: Map<string, number>): Shortfall {
  const rows: ShortfallRow[] = [];
  let total = 0;
  let unknown = false;
  for (const [stockKey, used] of [...usage.entries()].sort()) {
    const owned = stock.get(stockKey) ?? 0;
    const missing = Math.max(0, used - owned);
    const { partKey, right } = stockLabel(stockKey);
    const partId = PARTS.find((p) => p.key === partKey)?.id ?? partKey;
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
    }
    rows.push({ stockKey, partId, right, used, owned, missing, buy, packs, costJpy: cost });
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
  "寸法の確認状況",
  "寸法の注記",
  "希望小売価格(税込円)",
  "出典",
];

const CATEGORY_JA: Record<PartCategory, string> = {
  straight: "直線",
  curve: "曲線",
  turnout: "ポイント",
  crossing: "交差",
  double: "複線",
  bumper: "車止め",
};

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
        CATEGORY_JA[p.category],
        p.side === "L" ? "左" : p.side === "R" ? "右" : "",
        p.perPack,
        p.contents.map((c) => `${c.partId}${c.stockKey.endsWith(":R") ? "(右)" : ""}×${c.count}`).join(" "),
        p.spec,
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
