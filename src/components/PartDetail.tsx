"use client";

import { useEffect } from "react";
import { BED_INFO, bedVariantsOf, CATEGORY_LABELS, getPart, MAKER_INFO, partKey } from "@/lib/parts";
import { productsOfPart, specOf, STATUS_LABELS } from "@/lib/productDb";
import { routeSamples } from "@/lib/shapes";
import { PartIcon } from "./PartIcon";
import { yen } from "./InventoryPanel";

type Props = {
  partKey: string;
  mirror?: boolean;
  onClose: () => void;
  /** 道床違いなど、別の部品の仕様に切り替える */
  onShow: (partKey: string) => void;
  /** 「この部品を置く」。省略時はボタンを出さない */
  onPlace?: (partKey: string) => void;
};

const fmt = (n: number) => String(Math.round(n * 10) / 10);

/** 部品の仕様（品番・寸法・道床・価格・入数など）を確認するダイアログ */
export function PartDetail({ partKey: key, mirror = false, onClose, onShow, onPlace }: Props) {
  const part = getPart(key);
  const products = productsOfPart(part);
  const variants = bedVariantsOf(part);
  const first = products.find((p) => p.category !== "elevated") ?? products[0];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // 中心線の外形（向きを置いたときの幅×奥行き）
  const pts = part.routes.flatMap((r) => routeSamples(r, 5));
  const w = Math.max(...pts.map((p) => p.x)) - Math.min(...pts.map((p) => p.x));
  const h = Math.max(...pts.map((p) => p.y)) - Math.min(...pts.map((p) => p.y));

  const contentFor = (code: string) => products.find((p) => p.code === code)?.contents.find((c) => c.partKey === part.key);

  return (
    <div className="part-detail-backdrop" onClick={onClose}>
      <div className="part-detail" role="dialog" aria-modal="true" aria-label={`${part.name}の仕様`} onClick={(e) => e.stopPropagation()}>
        <header>
          <div>
            <h3>{part.name}</h3>
            <div className="sub">
              {MAKER_INFO[part.maker].label} {MAKER_INFO[part.maker].system} ／ 部品ID {part.id}
            </div>
          </div>
          <button className="mini" onClick={onClose} aria-label="閉じる">
            ✕
          </button>
        </header>

        <PartIcon partId={part.key} mirror={mirror} large />

        {variants.length > 1 && (
          <div className="chips beds" role="group" aria-label="道床の種類">
            {variants.map((v) => (
              <button key={v.key} className={`chip${v.key === part.key ? " on" : ""}`} onClick={() => onShow(v.key)}>
                {BED_INFO[v.bed].label}
              </button>
            ))}
          </div>
        )}

        <dl>
          <dt>分類</dt>
          <dd>{CATEGORY_LABELS[part.category]}</dd>
          <dt>形・寸法</dt>
          <dd>{specOf(part)}</dd>
          <dt>説明</dt>
          <dd>{part.description}</dd>
          {h >= 1 && (
            <>
              <dt>外形（中心線）</dt>
              <dd>
                約 {fmt(w)} × {fmt(h)} mm
              </dd>
            </>
          )}
          <dt>道床</dt>
          <dd>
            {BED_INFO[part.bed].label}（{BED_INFO[part.bed].note}）
          </dd>
          <dt>つなぐ端</dt>
          <dd>
            {part.joints.length}か所{part.jointHelp ? `（${part.jointHelp}）` : ""}
          </dd>
          <dt>左右</dt>
          <dd>{part.handed ? (part.productsRight ? "左右で品番が違う" : "左右どちら向きにも置ける") : "左右の区別なし"}</dd>
          <dt>高さ</dt>
          <dd>
            {part.rampEnds ? "勾配にできる" : "勾配にできない"}
            {part.elevatedProducts ? "・高架用の品番あり" : ""}
          </dd>
          {part.requires && (
            <>
              <dt>一緒に必要</dt>
              <dd>{part.requires.map((r) => `${getPart(partKey(part.maker, r.id)).name}×${r.count}`).join("、")}</dd>
            </>
          )}
          {first && (
            <>
              <dt>寸法の確認</dt>
              <dd>
                {STATUS_LABELS[first.geometryStatus]}
                {part.geometryNote ? `：${part.geometryNote}` : ""}
              </dd>
            </>
          )}
        </dl>

        <h4>品番（メーカー希望小売価格・税込）</h4>
        <table className="bom">
          <thead>
            <tr>
              <th>品番</th>
              <th>製品名</th>
              <th>道床</th>
              <th className="num">入数</th>
              <th className="num">価格</th>
              <th className="num">1本</th>
            </tr>
          </thead>
          <tbody>
            {products.map((p) => {
              const c = contentFor(p.code);
              const per = c?.count ?? p.perPack ?? 1;
              const mixed = p.contents.length > 1;
              return (
                <tr key={p.code}>
                  <td className="code">{p.code}</td>
                  <td>
                    {p.name}
                    {p.side === "R" ? "（右）" : p.side === "L" ? "（左）" : ""}
                    {mixed && <span className="muted">（この部品{per}本入り）</span>}
                  </td>
                  <td className="nowrap">{p.bed ? BED_INFO[p.bed].label : ""}</td>
                  <td className="num">{p.perPack ?? "不明"}</td>
                  <td className="num">{p.priceJpy !== null ? yen(p.priceJpy) : "不明"}</td>
                  <td className="num">{p.priceJpy !== null && !mixed ? yen(Math.round(p.priceJpy / per)) : ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {first && first.sources.length > 0 && (
          <>
            <h4>出典</h4>
            <ul className="sources">
              {[...new Set(products.flatMap((p) => p.sources))].map((u) => (
                <li key={u}>
                  <a href={u} target="_blank" rel="noreferrer">
                    {u}
                  </a>
                </li>
              ))}
            </ul>
          </>
        )}

        {onPlace && (
          <button className="primary" onClick={() => onPlace(part.key)}>
            この部品を置く
          </button>
        )}
      </div>
    </div>
  );
}
