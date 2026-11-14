// KATO・TOMIX 公式サイトの製品一覧から抽出した線路カタログ（Nゲージ・単線の基本線路）。
//
// 抽出元（2026-11-14 取得）:
//   KATO ユニトラック  直線: https://unitrack.katomodels.com/products/line_single/straight_line
//                     曲線: https://unitrack.katomodels.com/products/line_single/curve_line
//                     分岐: https://unitrack.katomodels.com/products/line_single/branch_cross
//                     車止め: https://unitrack.katomodels.com/products/line_single/car_stop
//   TOMIX ファイントラック 基本レール: https://www.tomytec.co.jp/tomix/nyumon/tomixrail/raillineup.cgi
//                     ポイント: https://www.tomytec.co.jp/tomix/nyumon/tomixrail/raillineup.cgi?category=rail_point
//                     特殊レール: https://www.tomytec.co.jp/tomix/nyumon/tomixrail/raillineup.cgi?category=rail_spc
//
// 直線の長さ・曲線の半径と角度は製品名・掲載値のとおり。
// ポイントの直進側の長さと分岐側の半径・角度は公式の一覧ページに数値の記載がないため、
// 製品名（例 PL541-15 = 半径541mm・15°）と各社の線路規格の一般的な値から補っている（geometryNote）。
// 車止めの長さが一覧にないもの（TOMIX）は描画用の値。
//
// 掲載されているが、まだ配置計算に対応していない製品（コンパクト曲線、Y字・3方・ダブルクロス、
// 交差線路、可変長線路、複線線路など）は含めていない。

export type CatalogMaker = "kato" | "tomix";

export type CatalogProduct = {
  /** メーカー品番 */
  code: string;
  /** 公式の製品名 */
  name: string;
  /** 1パックの本数（記載がないものは null） */
  perPack: number | null;
};

export type CatalogEntry = {
  /** アプリ内の部品ID（AIへの指示にも使う） */
  id: string;
  kind: "straight" | "curve" | "turnout" | "bumper";
  length?: number;
  radius?: number;
  angle?: number;
  /** 左右があるポイントは左用・右用の品番を分ける */
  products: CatalogProduct[];
  productsRight?: CatalogProduct[];
  geometryNote?: string;
};

export const CATALOG_SOURCES: Record<CatalogMaker, { label: string; urls: string[]; fetchedAt: string }> = {
  kato: {
    label: "KATO ユニトラック",
    fetchedAt: "2026-11-14",
    urls: [
      "https://unitrack.katomodels.com/products/line_single/straight_line",
      "https://unitrack.katomodels.com/products/line_single/curve_line",
      "https://unitrack.katomodels.com/products/line_single/branch_cross",
      "https://unitrack.katomodels.com/products/line_single/car_stop",
    ],
  },
  tomix: {
    label: "TOMIX ファイントラック",
    fetchedAt: "2026-11-14",
    urls: [
      "https://www.tomytec.co.jp/tomix/nyumon/tomixrail/raillineup.cgi",
      "https://www.tomytec.co.jp/tomix/nyumon/tomixrail/raillineup.cgi?category=rail_point",
      "https://www.tomytec.co.jp/tomix/nyumon/tomixrail/raillineup.cgi?category=rail_spc",
    ],
  },
};

const p = (code: string, name: string, perPack: number | null = null): CatalogProduct => ({ code, name, perPack });

export const CATALOG: Record<CatalogMaker, CatalogEntry[]> = {
  kato: [
    // 直線線路
    { id: "S248", kind: "straight", length: 248, products: [p("20-000", "直線線路 248mm", 4), p("20-000-L", "直線線路248mm(10本入)", 10), p("20-007", "PC直線線路248mm＜S248PC＞", 4)] },
    { id: "S186", kind: "straight", length: 186, products: [p("20-010", "直線線路 186mm", 4)] },
    { id: "S124", kind: "straight", length: 124, products: [p("20-020", "直線線路 124mm", 4), p("20-028", "PC直線線路124mm＜S124PC＞", 4)] },
    { id: "S64", kind: "straight", length: 64, products: [p("20-030", "直線線路 64mm", 2)] },
    { id: "S62", kind: "straight", length: 62, products: [p("20-040", "直線線路 62mm", 4), p("20-054", "PC直線線路62mm＜S62PC＞", 4)] },
    // 曲線線路
    { id: "R216-45", kind: "curve", radius: 216, angle: 45, products: [p("20-170", "曲線線路 R216-45°")] },
    { id: "R249-45", kind: "curve", radius: 249, angle: 45, products: [p("20-100", "曲線線路 R249-45°")] },
    { id: "R282-45", kind: "curve", radius: 282, angle: 45, products: [p("20-110", "曲線線路 R282-45°")] },
    { id: "R315-45", kind: "curve", radius: 315, angle: 45, products: [p("20-120", "曲線線路 R315-45°"), p("20-124", "PC曲線線路R315-45°", 4)] },
    { id: "R348-45", kind: "curve", radius: 348, angle: 45, products: [p("20-132", "曲線線路 R348-45°")] },
    { id: "R348-30", kind: "curve", radius: 348, angle: 30, products: [p("20-130", "曲線線路 R348-30°")] },
    { id: "R381-30", kind: "curve", radius: 381, angle: 30, products: [p("20-140", "曲線線路 R381-30°")] },
    { id: "R216-15", kind: "curve", radius: 216, angle: 15, products: [p("20-171", "曲線線路 R216-15°")] },
    { id: "R249-15", kind: "curve", radius: 249, angle: 15, products: [p("20-101", "曲線線路 R249-15°")] },
    { id: "R282-15", kind: "curve", radius: 282, angle: 15, products: [p("20-111", "曲線線路 R282-15°")] },
    { id: "R315-15", kind: "curve", radius: 315, angle: 15, products: [p("20-121", "曲線線路 R315-15°")] },
    { id: "R481-15", kind: "curve", radius: 481, angle: 15, products: [p("20-160", "曲線線路 R481-15°")] },
    { id: "R718-15", kind: "curve", radius: 718, angle: 15, products: [p("20-150", "曲線線路 R718-15°")] },
    // 分岐
    {
      id: "TO6",
      kind: "turnout",
      length: 186,
      radius: 718,
      angle: 15,
      products: [p("20-202", "電動ポイント6番(左)", 1)],
      productsRight: [p("20-203", "電動ポイント6番(右)", 1)],
      geometryNote: "直進186mm・分岐R718-15°はユニトラックの一般的な規格値（一覧ページに数値の記載なし）",
    },
    // 車止め
    { id: "BUMPER", kind: "bumper", length: 62, products: [p("20-046", "車止め線路A"), p("20-047", "車止め線路B")] },
  ],
  tomix: [
    // ストレートレール（木製まくら木 / PCまくら木）
    { id: "S280", kind: "straight", length: 280, products: [p("1802", "ストレートレールS280(F)", 4), p("1092", "ストレートレール S280(F)", 10), p("1012", "ストレートPCレール S280-PC(F)", 4)] },
    { id: "S158.5", kind: "straight", length: 158.5, products: [p("1806", "ストレートレールS158.5(F)", 4), p("1016", "ストレートPCレール S158.5-PC(F)", 4)] },
    { id: "S140", kind: "straight", length: 140, products: [p("1801", "ストレートレールS140(F)", 4), p("1011", "ストレートPCレール S140-PC(F)", 4)] },
    { id: "S99", kind: "straight", length: 99, products: [p("1805", "ストレートレールS99(F)", 4), p("1015", "ストレートPCレール S99-PC(F)", 4)] },
    { id: "S72.5", kind: "straight", length: 72.5, products: [p("1803", "ストレートレールS72.5(F)", 4), p("1013", "ストレートPCレール S72.5-PC(F)", 4)] },
    { id: "S70", kind: "straight", length: 70, products: [p("1804", "ストレートレールS70(F)", 4), p("1014", "ストレートPCレール S70-PC(F)", 4)] },
    // カーブレール
    { id: "C243-45", kind: "curve", radius: 243, angle: 45, products: [p("1855", "カーブレールC243-45(F)", 4), p("1195", "カーブPCレール C243-45-PC(F)", 4)] },
    { id: "C280-45", kind: "curve", radius: 280, angle: 45, products: [p("1851", "カーブレールC280-45(F)", 4), p("1191", "カーブPCレール C280-45-PC(F)", 4)] },
    { id: "C317-45", kind: "curve", radius: 317, angle: 45, products: [p("1852", "カーブレールC317-45(F)", 4), p("1192", "カーブPCレール C317-45-PC(F)", 4)] },
    { id: "C354-45", kind: "curve", radius: 354, angle: 45, products: [p("1856", "カーブレールC354-45(F)", 4), p("1196", "カーブPCレール C354-45-PC(F)", 4)] },
    { id: "C391-45", kind: "curve", radius: 391, angle: 45, products: [p("1858", "カーブレールC391-45(F)", 4), p("1198", "カーブPCレール C391-45-PC(F)", 4)] },
    { id: "C243-15", kind: "curve", radius: 243, angle: 15, products: [p("1863", "カーブPCレール C243-15-PC(F)", 4)] },
    { id: "C280-15", kind: "curve", radius: 280, angle: 15, products: [p("1854", "カーブレールC280-15(F)", 4), p("1194", "カーブPCレール C280-15-PC(F)", 4)] },
    { id: "C317-15", kind: "curve", radius: 317, angle: 15, products: [p("1197", "カーブPCレール C317-15-PC(F)", 4)] },
    { id: "C354-15", kind: "curve", radius: 354, angle: 15, products: [p("1864", "カーブPCレール C354-15-PC(F)", 4)] },
    { id: "C391-15", kind: "curve", radius: 391, angle: 15, products: [p("1865", "カーブPCレール C391-15-PC(F)", 4)] },
    { id: "C541-15", kind: "curve", radius: 541, angle: 15, products: [p("1853", "カーブレールC541-15(F)", 4), p("1193", "カーブPCレール C541-15-PC(F)", 4)] },
    { id: "C605-10", kind: "curve", radius: 605, angle: 10, products: [p("1870", "カーブレールC605-10(F)", 4), p("1190", "カーブPCレール C605-10-PC(F)", 4)] },
    // ポイント
    {
      id: "PL541-15",
      kind: "turnout",
      length: 140,
      radius: 541,
      angle: 15,
      products: [p("1272", "電動ポイントN-PL541-15(F)(完全選択式)", 1), p("1282", "電動合成枕木ポイントN-PL541-15-SY(F)", 1), p("1226", "手動合成枕木ポイントN-PL541-15-SY(F)", 1)],
      productsRight: [p("1271", "電動ポイントN-PR541-15(F)(完全選択式)", 1), p("1281", "電動合成枕木ポイントN-PR541-15-SY(F)", 1), p("1225", "手動合成枕木ポイントN-PR541-15-SY(F)", 1)],
      geometryNote: "分岐R541-15°は製品名から、直進140mmはファイントラックの一般的な規格値（一覧ページに数値の記載なし）",
    },
    {
      id: "PL280-30",
      kind: "turnout",
      length: 140,
      radius: 280,
      angle: 30,
      products: [p("1274", "電動ポイントN-PL280-30(F)(完全選択式)", 1)],
      productsRight: [p("1273", "電動ポイントN-PR280-30(F)(完全選択式)", 1)],
      geometryNote: "分岐R280-30°は製品名から、直進140mmはファイントラックの一般的な規格値（一覧ページに数値の記載なし）",
    },
    // 車止め（長さは一覧に記載がないため描画用の値）
    { id: "E", kind: "bumper", length: 40, products: [p("1421", "エンドレールE (F)"), p("1428", "エンドPCレールE-PC(LEDタイプ)(F)")] },
  ],
};
