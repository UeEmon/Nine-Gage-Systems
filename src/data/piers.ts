// 高架・立体交差の高さの規格と橋脚の品番（Nゲージ）。
//
// 高さは「地上の線路のレール面からの高さ（mm）」で表す。橋脚の高さの呼び（KATO「勾配橋脚基本セット 15-50mm」、
// TOMIX「PC橋脚P10-55」など）がほぼこの値になるので、その数字をそのまま使う。
//
// 出典（2026-11-14 確認）:
//   KATO 高架線路・橋脚の一覧: https://unitrack.katomodels.com/products/line_single/elevated_line
//   KATO 橋脚の一覧: https://www.unitrack-kato.com/line-up-viaduct-pier-jp
//   KATO 勾配橋脚の各番号の高さ（No.0.5〜No.5 = 10〜50mm、248mmごとに10mm＝約4%）:
//     https://kureport.livedoor.blog/archives/18495912.html
//     https://railsofsheffield.com/products/unitrack-single-track-pier-set-15-50mm （基本セットは 15〜50mm）
//   TOMIX レール関連製品の一覧（品番・価格）: https://www.tomytec.co.jp/tomix/nyumon/tomixrail/raillineup.cgi?category=knr
//   TOMIX PC橋脚 P1〜P10 の高さ（5mm刻み、P1=10mm〜P10=55mm）:
//     https://www.tomytec.co.jp/tomix/products/n/3234.html （品名 P1-10〜P10-55）
//     https://vrmcloud.net/nx/manual/tec/tomix/s1_plate.html
//     https://mvrgourmet.com/knowledge-height/ （P10=55mmが単線高架の標準、P4=25mmは築堤）

import type { CatalogMaker } from "./trackCatalog";

export type PierProduct = {
  code: string;
  name: string;
  /** 複線用（幅の広い橋脚）か */
  double: boolean;
  /** 入っている橋脚の高さ(mm)と本数 */
  contents: { height: number; count: number }[];
  note?: string;
};

export type PierSystem = {
  /** 高架の標準の高さ（mm）。立体交差の上の線路の基準 */
  standardHeight: number;
  /** 立体交差で、下の線路の上に必要な高さの差（mm）。標準の高架の高さと同じにする */
  clearance: number;
  /** 勾配の目安。この長さ(mm)ごとに step(mm) 上がる */
  gradeRunMm: number;
  gradeStepMm: number;
  /** 勾配の上限（%）。これを超えると警告 */
  maxGradePct: number;
  /** 橋脚どうしの最大の間隔（mm）。これより長い線路は途中にも橋脚を立てる */
  maxSpanMm: number;
  products: PierProduct[];
  note: string;
};

const range = (from: number, to: number, step: number) =>
  Array.from({ length: Math.round((to - from) / step) + 1 }, (_, i) => from + i * step);

export const PIER_SYSTEMS: Record<CatalogMaker, PierSystem> = {
  kato: {
    standardHeight: 50,
    clearance: 50,
    gradeRunMm: 248,
    gradeStepMm: 10,
    maxGradePct: 4,
    // R348-45 の高架曲線（約273mm）は中間にも橋脚が必要（公式一覧）。直線248mmは両端だけでよい
    maxSpanMm: 250,
    note: "KATOの高架は橋脚No.5（50mm）が標準。勾配橋脚は248mmごとに1段（10mm）で約4%",
    products: [
      { code: "23-017-1", name: "橋脚No.5 50mm（5本入）", double: false, contents: [{ height: 50, count: 5 }] },
      {
        code: "23-015-1",
        name: "勾配橋脚基本セット 15-50mm",
        double: false,
        contents: [15, 25, 35, 45, 50].map((height) => ({ height, count: 2 })),
        note: "No.1〜No.5（15/25/35/45/50mm）各2本",
      },
      {
        code: "23-016-1",
        name: "勾配橋脚補助セット",
        double: false,
        contents: [10, 20, 30, 40, 47.5].map((height) => ({ height, count: 2 })),
        note: "No.0.5〜No.4.5（10/20/30/40/47.5mm）各2本。基本セットの間に入れて勾配をゆるくする",
      },
      { code: "23-047", name: "単線鉄橋用橋脚No.5 50mm（5本入）", double: false, contents: [{ height: 50, count: 5 }] },
      { code: "23-069", name: "単線鉄橋用円錐台形橋脚NO5（5本入）", double: false, contents: [{ height: 50, count: 5 }] },
      { code: "23-019", name: "複線橋脚 No.5（6本入）", double: true, contents: [{ height: 50, count: 6 }] },
      { code: "23-020", name: "複線高架橋脚（6本入）", double: true, contents: [{ height: 50, count: 6 }] },
      {
        code: "23-048",
        name: "複線勾配橋脚基本セット",
        double: true,
        contents: [15, 25, 35, 45, 50].map((height) => ({ height, count: 2 })),
        note: "B1〜B5（単線のNo.1〜No.5と同じ高さ）各2本",
      },
      {
        code: "23-049",
        name: "複線勾配橋脚補助セット",
        double: true,
        contents: [10, 20, 30, 40, 47.5].map((height) => ({ height, count: 2 })),
        note: "A1〜A4・B4.5（単線の補助セットと同じ高さ）各2本",
      },
    ],
  },
  tomix: {
    standardHeight: 55,
    clearance: 55,
    gradeRunMm: 140,
    gradeStepMm: 5,
    maxGradePct: 4,
    maxSpanMm: 285,
    note: "TOMIXの高架はPC橋脚P10（55mm）が標準。勾配はS140ごとに1段（5mm）で約3.6%",
    products: [
      { code: "3235", name: "PC水平橋脚P10（8本セット）", double: false, contents: [{ height: 55, count: 8 }] },
      { code: "3236", name: "PC水平橋脚P4（8本セット）", double: false, contents: [{ height: 25, count: 8 }], note: "築堤など低い高架用" },
      {
        code: "3234",
        name: "PC勾配橋脚P1-P10（10本2組）",
        double: false,
        contents: range(10, 55, 5).map((height) => ({ height, count: 2 })),
        note: "P1〜P10（10〜55mm、5mm刻み）各2本",
      },
      { code: "3048", name: "複線PC橋脚（4本セット）", double: true, contents: [{ height: 55, count: 4 }] },
      { code: "3041", name: "複線高架橋脚（4本セット）", double: true, contents: [{ height: 55, count: 4 }], note: "高さは標準のP10相当として扱う（推定）" },
      {
        code: "3044",
        name: "複線勾配橋脚セット（10組）",
        double: true,
        contents: range(10, 55, 5).map((height) => ({ height, count: 1 })),
        note: "高さは単線のP1〜P10と同じ5mm刻みとして扱う（推定）",
      },
    ],
  },
};

/** その会社・単線/複線で用意されている橋脚の高さ（低い順） */
export function pierHeights(maker: CatalogMaker, double: boolean): number[] {
  const hs = new Set<number>();
  for (const p of PIER_SYSTEMS[maker].products) if (p.double === double) for (const c of p.contents) hs.add(c.height);
  return [...hs].sort((a, b) => a - b);
}

/** 高さ(mm)の小数を整えた文字列（47.5 など） */
export const heightText = (h: number) => String(Math.round(h * 10) / 10);
