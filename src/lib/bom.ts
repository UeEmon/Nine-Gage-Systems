import type { Piece } from "./geometry";
import { getPart, MAKER_INFO, productsOf } from "./parts";
import { stockKeyOf } from "./productDb";
import { PRICES } from "../data/prices";
import type { CatalogProduct } from "../data/trackCatalog";

export type BomRow = {
  key: string;
  partId: string;
  maker: string;
  label: string;
  count: number;
  /** 代表の品番（カタログの最初の製品） */
  product: CatalogProduct;
  /** 代表品番で買う場合のパック数（入数不明なら null） */
  packs: number | null;
  alternatives: CatalogProduct[];
  /** 代表品番のメーカー希望小売価格（1箱・税込円） */
  priceJpy: number | null;
};

/** 配置した線路から、購入に必要な品番と数を集計する */
export function billOfMaterials(pieces: Piece[]): BomRow[] {
  const rows = new Map<string, BomRow>();
  for (const piece of pieces) {
    const part = getPart(piece.partId);
    // 左右で品番が違う部品（ポイントなど）だけ向きで分ける。曲線などは同じ品番
    const right = Boolean(part.productsRight) && piece.mirror;
    const key = stockKeyOf(part, right);
    const row = rows.get(key);
    if (row) {
      row.count += 1;
      continue;
    }
    const products = productsOf(part, right);
    rows.set(key, {
      key,
      partId: part.id,
      maker: MAKER_INFO[part.maker].label,
      label: part.productsRight ? `${part.name}（${right ? "右" : "左"}）` : part.name,
      count: 1,
      product: products[0],
      packs: null,
      alternatives: products.slice(1),
      priceJpy: PRICES[`${part.maker}:${products[0].code}`] ?? null,
    });
  }
  return [...rows.values()]
    .map((r) => ({ ...r, packs: r.product.perPack ? Math.ceil(r.count / r.product.perPack) : null }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

/** 部品リストのキー（在庫キー）ごとの使用本数 */
export function usageOf(pieces: Piece[]): Map<string, number> {
  return new Map(billOfMaterials(pieces).map((r) => [r.key, r.count]));
}
