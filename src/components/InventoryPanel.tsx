"use client";

import { useMemo, useState } from "react";
import type { Maker } from "@/lib/parts";
import {
  findProduct,
  inventoryValue,
  PRODUCT_CATEGORY_LABELS,
  productsForMaker,
  stockFromInventory,
  type Inventory,
  type ProductCategory,
} from "@/lib/productDb";
import type { BomRow } from "@/lib/bom";

export const yen = (n: number) => `${n.toLocaleString("ja-JP")}円`;

type Props = {
  maker: Maker;
  inventory: Inventory;
  setInventory: (fn: (inv: Inventory) => Inventory) => void;
  bom: BomRow[];
};

/** 所有パーツの登録（品番と箱数） */
export function InventoryPanel({ maker, inventory, setInventory, bom }: Props) {
  const products = useMemo(() => productsForMaker(maker), [maker]);
  const [code, setCode] = useState("");
  const [qty, setQty] = useState(1);

  const entries = Object.entries(inventory)
    .filter(([k, n]) => k.startsWith(`${maker}:`) && n > 0)
    .map(([k, n]) => ({ key: k, boxes: n, prod: findProduct(maker, k.slice(maker.length + 1)) }))
    .sort((a, b) => a.key.localeCompare(b.key));
  const pieces = [...stockFromInventory(inventory, maker).values()].reduce((s, n) => s + n, 0);
  const mine = Object.fromEntries(entries.map((e) => [e.key, e.boxes]));

  const add = (key: string, n: number) =>
    setInventory((inv) => {
      const next = { ...inv, [key]: Math.max(0, Math.min(999, (inv[key] ?? 0) + n)) };
      if (next[key] === 0) delete next[key];
      return next;
    });

  const selected = code ? findProduct(maker, code) : undefined;

  /** 今キャンバスにある線路を、代表品番の箱数で所有パーツに加える */
  const addFromLayout = () =>
    setInventory((inv) => {
      const next = { ...inv };
      for (const r of bom) {
        // 橋脚は勾配橋脚セットなどまとめ買いが多いので、品番を選んで登録してもらう
        if (!r.product.code || r.kind === "pier") continue;
        const key = `${maker}:${r.product.code}`;
        const per = r.product.perPack ?? 1;
        next[key] = (next[key] ?? 0) + Math.ceil(r.count / per);
      }
      return next;
    });

  const groups = (Object.keys(PRODUCT_CATEGORY_LABELS) as ProductCategory[]).map((c) => ({
    c,
    items: products.filter((p) => p.category === c),
  })).filter((g) => g.items.length > 0);

  return (
    <details className="ai-settings inventory" open={entries.length > 0 || undefined}>
      <summary>
        所有パーツ{" "}
        <span className="muted">
          {entries.length ? `${entries.length}品番・${pieces}本・${yen(inventoryValue(mine))}相当` : "未登録"}
        </span>
      </summary>
      <div className="form">
        <label>
          品番
          <select value={code} onChange={(e) => setCode(e.target.value)} aria-label="追加する品番">
            <option value="">選んでください</option>
            {groups.map((g) => (
              <optgroup key={g.c} label={PRODUCT_CATEGORY_LABELS[g.c]}>
                {g.items.map((p) => (
                  <option key={p.code} value={p.code}>
                    {p.code} {p.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        {selected && (
          <p className="hint">
            {selected.spec}
            {selected.perPack ? ` ／ ${selected.perPack}本入` : " ／ 入数不明（1本として数えます）"}
            {selected.priceJpy !== null && ` ／ ${yen(selected.priceJpy)}`}
          </p>
        )}
        <div className="input-row">
          <input
            type="number"
            min={1}
            max={99}
            value={qty}
            onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))}
            aria-label="箱数"
          />
          <button disabled={!code} onClick={() => add(`${maker}:${code}`, qty)}>
            箱を追加
          </button>
        </div>
        {entries.length > 0 && (
          <table className="bom">
            <thead>
              <tr>
                <th>品番</th>
                <th>製品</th>
                <th className="num">箱</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.key}>
                  <td className="code">{e.prod?.code ?? e.key}</td>
                  <td>{e.prod?.name ?? "（データベースにない品番）"}</td>
                  <td className="num">{e.boxes}</td>
                  <td className="num">
                    <button className="mini" onClick={() => add(e.key, 1)} aria-label="1箱増やす">
                      ＋
                    </button>
                    <button className="mini" onClick={() => add(e.key, -1)} aria-label="1箱減らす">
                      −
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="row wrap">
          <button onClick={addFromLayout} disabled={bom.length === 0} title="キャンバスにある線路を代表品番の箱数で加えます">
            今の配置から追加
          </button>
          <button
            className="danger"
            disabled={entries.length === 0}
            onClick={() => {
              if (confirm("登録した所有パーツ（このメーカー分）を消しますか？"))
                setInventory((inv) => Object.fromEntries(Object.entries(inv).filter(([k]) => !k.startsWith(`${maker}:`))));
            }}
          >
            すべて消す
          </button>
        </div>
        <p className="hint">
          所有パーツはこのブラウザに保存されます。品番・寸法・価格の一覧は{" "}
          <a href="/api/products?format=csv">CSVで出力</a>できます。
        </p>
      </div>
    </details>
  );
}
