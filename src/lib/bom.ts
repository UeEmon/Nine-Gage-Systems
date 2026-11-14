import type { Piece } from "./geometry";
import { getPart, MAKER_INFO, productsOf } from "./parts";
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
};

/** 配置した線路から、購入に必要な品番と数を集計する */
export function billOfMaterials(pieces: Piece[]): BomRow[] {
  const rows = new Map<string, BomRow>();
  for (const piece of pieces) {
    const part = getPart(piece.partId);
    // 曲線は左右どちらにも使えるので向きで分けない。ポイントは左右で品番が違う
    const right = part.kind === "turnout" && piece.mirror;
    const key = `${part.maker}:${part.id}${right ? ":R" : ""}`;
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
      label: part.kind === "turnout" ? `${part.name}（${right ? "右" : "左"}）` : part.name,
      count: 1,
      product: products[0],
      packs: null,
      alternatives: products.slice(1),
    });
  }
  return [...rows.values()]
    .map((r) => ({ ...r, packs: r.product.perPack ? Math.ceil(r.count / r.product.perPack) : null }))
    .sort((a, b) => a.key.localeCompare(b.key));
}
