import { elevationOf, type Piece } from "./geometry";
import { isPierKey, PIER_MIN_MM, pierStockKey } from "./elevation";
import { getPart, MAKER_INFO, partKey, type Maker } from "./parts";
import { PRODUCTS, stockKeyName, stockKeyOf, stockLabel, type ProductRecord } from "./productDb";
import type { CatalogProduct } from "../data/trackCatalog";

export type BomRow = {
  key: string;
  partId: string;
  maker: string;
  label: string;
  /** "track"=線路・鉄橋、"pier"=橋脚 */
  kind: "track" | "pier";
  count: number;
  /** 代表の品番（カタログの最初の製品） */
  product: CatalogProduct;
  /** 代表品番で買う場合のパック数（入数不明なら null） */
  packs: number | null;
  alternatives: CatalogProduct[];
  /** 代表品番のメーカー希望小売価格（1箱・税込円） */
  priceJpy: number | null;
};

/**
 * 配置した線路で使う部品の本数（在庫キーごと）。
 * 高さのある線路は高架用の品番で数え、TOMIXの鉄橋は別売りのレールも足し、橋脚も高さごとに数える。
 */
export function usageOf(pieces: Piece[]): Map<string, number> {
  const usage = new Map<string, number>();
  const add = (k: string, n = 1) => usage.set(k, (usage.get(k) ?? 0) + n);
  const { elevation, piers } = elevationOf(pieces);
  for (const piece of pieces) {
    const part = getPart(piece.partId);
    const zs = elevation.joints.get(piece.uid) ?? [piece.z ?? 0];
    const elevated = Math.max(...zs) >= PIER_MIN_MM;
    add(stockKeyOf(part, piece.mirror, elevated));
    for (const r of part.requires ?? []) add(partKey(part.maker, r.id), r.count);
  }
  for (const pier of piers) add(pierStockKey(pier));
  return usage;
}

/** 在庫キーの部品が入っている品番（カタログ順）と、1箱に入っている本数 */
function productsFor(stockKey: string): { prod: ProductRecord; per: number }[] {
  return PRODUCTS.filter((p) => p.contents.some((c) => c.stockKey === stockKey)).map((prod) => ({
    prod,
    per: prod.contents.filter((c) => c.stockKey === stockKey).reduce((s, c) => s + c.count, 0),
  }));
}

/** 配置した線路から、購入に必要な品番と数を集計する */
export function billOfMaterials(pieces: Piece[]): BomRow[] {
  const rows: BomRow[] = [];
  for (const [key, count] of usageOf(pieces)) {
    const options = productsFor(key);
    const pier = isPierKey(key);
    // 橋脚は単品で入っている品番（なければ勾配橋脚セット）を代表にする
    const main = pier ? (options.find((o) => o.prod.contents.length === 1) ?? options[0]) : options[0];
    if (!main) continue;
    const maker = main.prod.maker as Maker;
    const toProduct = (o: { prod: ProductRecord; per: number }): CatalogProduct => ({
      code: o.prod.code,
      name: o.prod.name,
      perPack: o.prod.perPack === null ? null : o.per,
    });
    rows.push({
      key,
      partId: pier ? key : getPart(stockLabel(key).partKey).id,
      maker: MAKER_INFO[maker].label,
      label: stockKeyName(key),
      kind: pier ? "pier" : "track",
      count,
      product: toProduct(main),
      packs: null,
      alternatives: options.filter((o) => o !== main).map(toProduct),
      priceJpy: main.prod.priceJpy,
    });
  }
  return rows
    .map((r) => ({ ...r, packs: r.product.perPack ? Math.ceil(r.count / r.product.perPack) : null }))
    .sort((a, b) => (a.kind === b.kind ? a.key.localeCompare(b.key) : a.kind === "track" ? -1 : 1));
}
