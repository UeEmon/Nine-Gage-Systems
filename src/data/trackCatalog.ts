// KATO・TOMIX 公式サイトの製品一覧から抽出した線路カタログ（Nゲージ）。
//
// 抽出元（2026-11-14 取得）:
//   KATO ユニトラック
//     直線: https://unitrack.katomodels.com/products/line_single/straight_line
//     曲線: https://unitrack.katomodels.com/products/line_single/curve_line
//     分岐/交差: https://unitrack.katomodels.com/products/line_single/branch_cross
//     複線: https://unitrack.katomodels.com/products/line_single/double_track_line
//     コンパクト: https://unitrack.katomodels.com/products/line_single/compact
//     車止め: https://unitrack.katomodels.com/products/line_single/car_stop
//     高架線路: https://unitrack.katomodels.com/products/line_single/elevated_line
//     鉄橋: https://unitrack.katomodels.com/products/line_single/iron_bridge
//   TOMIX ファイントラック
//     基本レール: https://www.tomytec.co.jp/tomix/nyumon/tomixrail/raillineup.cgi
//     ポイント: https://www.tomytec.co.jp/tomix/nyumon/tomixrail/raillineup.cgi?category=rail_point
//     特殊レール: https://www.tomytec.co.jp/tomix/nyumon/tomixrail/raillineup.cgi?category=rail_spc
//     複線: https://www.tomytec.co.jp/tomix/nyumon/tomixrail/raillineup.cgi?category=rail_double
//     ミニカーブ: https://www.tomytec.co.jp/tomix/nyumon/tomixrail/raillineup.cgi?category=rail_mini
//     レール関連製品（鉄橋・橋脚）: https://www.tomytec.co.jp/tomix/nyumon/tomixrail/raillineup.cgi?category=knr
//
// 品番・製品名・入数は一覧ページの記載どおり。直線の長さ・曲線の半径と角度は製品名・掲載値どおり。
// 一覧ページに数値がない寸法（ポイントの直進長、交差の長さなど）は、公式の製品ページ・
// KATO USA の配線プラン資料・販売店の製品仕様で確認し、geometryStatus と geometrySources に
// 出典を残している。確認できなかった値だけ geometryNote に「推定」と書いている。
// メーカー希望小売価格は src/data/prices.ts。橋脚と高さの規格は src/data/piers.ts。

import { shape, type Route } from "../lib/shapes";

export type CatalogMaker = "kato" | "tomix";

export type CatalogProduct = {
  /** メーカー品番 */
  code: string;
  /** 公式の製品名 */
  name: string;
  /** 1パックの本数（記載がないものは null） */
  perPack: number | null;
};

export type PartCategory = "straight" | "curve" | "turnout" | "crossing" | "double" | "bridge" | "bumper";

export type CatalogEntry = {
  /** アプリ内の部品ID（AIへの指示にも使う） */
  id: string;
  category: PartCategory;
  /** パレットに出す名前 */
  label: string;
  /** 左向き(L)基準の形 */
  routes: Route[];
  /** 左右の向きがあるか（あるものは右向き＝鏡像でも置ける） */
  handed: boolean;
  /** 車止め（ジョイント0だけで、先は行き止まり） */
  bumper?: boolean;
  /** AI向けのジョイントの説明 */
  jointHelp?: string;
  /** 左向きの品番（左右のないものはこれだけ） */
  products: CatalogProduct[];
  /** 右向きの品番（左右で品番が違うもの） */
  productsRight?: CatalogProduct[];
  /**
   * 高架（橋脚の上）に置くときの品番。KATOは高架線路、TOMIXは高架橋付PCレール。
   * 地上用の線路は橋脚に載らないので、高さのある線路はこちらで数える。
   */
  elevatedProducts?: CatalogProduct[];
  /** 鉄橋など、レールが別売りで一緒に買う必要がある部品（TOMIXの鉄橋） */
  requires?: { id: string; count: number }[];
  geometryNote?: string;
  /**
   * 寸法の確認状況。省略時は "official"（公式一覧の製品名・掲載値どおり）。
   * "confirmed" = 公式一覧にはないが、公式の製品ページ・配線プラン資料や複数の販売店の記載で確認済み。
   * "estimated" = 確認できる資料が見つからず、一般的な規格値から補った値を含む。
   */
  geometryStatus?: "official" | "confirmed" | "estimated";
  /** 寸法の確認に使った資料（公式一覧以外） */
  geometrySources?: string[];
};

export const CATALOG_SOURCES: Record<CatalogMaker, { label: string; urls: string[]; fetchedAt: string }> = {
  kato: {
    label: "KATO ユニトラック",
    fetchedAt: "2026-11-14",
    urls: [
      "https://unitrack.katomodels.com/products/line_single",
      "https://unitrack.katomodels.com/products/line_single/straight_line",
      "https://unitrack.katomodels.com/products/line_single/curve_line",
      "https://unitrack.katomodels.com/products/line_single/branch_cross",
      "https://unitrack.katomodels.com/products/line_single/double_track_line",
      "https://unitrack.katomodels.com/products/line_single/compact",
      "https://unitrack.katomodels.com/products/line_single/car_stop",
      "https://unitrack.katomodels.com/products/line_single/elevated_line",
      "https://unitrack.katomodels.com/products/line_single/iron_bridge",
    ],
  },
  tomix: {
    label: "TOMIX ファイントラック",
    fetchedAt: "2026-11-14",
    urls: [
      "https://www.tomytec.co.jp/tomix/nyumon/tomixrail/raillineup.cgi",
      "https://www.tomytec.co.jp/tomix/nyumon/tomixrail/raillineup.cgi?category=rail_point",
      "https://www.tomytec.co.jp/tomix/nyumon/tomixrail/raillineup.cgi?category=rail_spc",
      "https://www.tomytec.co.jp/tomix/nyumon/tomixrail/raillineup.cgi?category=rail_double",
      "https://www.tomytec.co.jp/tomix/nyumon/tomixrail/raillineup.cgi?category=rail_mini",
      "https://www.tomytec.co.jp/tomix/nyumon/tomixrail/raillineup.cgi?category=knr",
    ],
  },
};

const p = (code: string, name: string, perPack: number | null = null): CatalogProduct => ({ code, name, perPack });

const st = (id: string, len: number, products: CatalogProduct[], geometryNote?: string): CatalogEntry => ({
  id,
  category: "straight",
  label: `直線 ${id}`,
  routes: shape.straight(len),
  handed: false,
  products,
  geometryNote,
});

const cv = (id: string, r: number, deg: number, products: CatalogProduct[], geometryNote?: string): CatalogEntry => ({
  id,
  category: "curve",
  label: `曲線 ${id}`,
  routes: shape.curve(r, deg),
  handed: true,
  products,
  geometryNote,
});

const EST = "推定（公式一覧・製品ページ・販売店の記載で確認できなかったため、一般的な規格値から）";

// 寸法の裏付けに使った資料（2026-11-14 確認）
const SRC = {
  katoUsa6: "https://dev3.katousa.com/PDF/plans/N-plan-6-turnouts.pdf",
  sumida: "http://www.sumidacrossing.org/ModelTrains/TrackandRoadbed/KatoUnitrack/UnitrackSwitchesEtc/",
  ix23: "https://trains.ix23.com/kato-unitrack-4-turnout-geometry/",
  branchline: "https://branchline.com.au/collections/track-kato",
  branchlineY: "https://www.branchline.com.au/products/kato-20-222-wye-turnout-481mm-radius-15-degree-124mm-long",
  gaugemaster240: "https://www.gaugemasterretail.com/kato-k20-240.html",
  sheffield240: "https://railsofsheffield.com/products/kato-20-240-kato-20-240-compact-left-hand-electric-turnout-r150mm-45-degree",
  sheffield300: "https://railsofsheffield.com/products/kato-20-300-kato-20-300-crossing-left-186mm-15-deg",
  sheffield320: "https://railsofsheffield.com/products/kato-20-320-kato-20-320-124mm-90-deg-crossing",
  lombard320: "https://lombardhobby.com/products/kato-n-20-320-unitrack-90-degree-crossing-124mm-4-7-8",
  katoBranch: "https://unitrack.katomodels.com/products/line_single/branch_cross",
  tomix: (n: number) => `https://www.tomytec.co.jp/tomix/products/n/${n}.html`,
};

const TURNOUT_HELP = "j0=トング側, j1=直進側, j2=分岐側";
const CROSSING_HELP = "j0→j1 が1本目、j2→j3 が2本目（交差）";
const DOUBLE_HELP = "j0→j1 が右側の線路、j2→j3 が左側の線路（進行方向に向かって）";

// ---- KATO ユニトラック ----
const KATO_SPACING = 33; // 複線線路ページの規格（33mm）

const KATO: CatalogEntry[] = [
  // 直線
  st("S248", 248, [p("20-000", "直線線路 248mm", 4), p("20-000-L", "直線線路248mm(10本入)", 10), p("20-007", "PC直線線路248mm＜S248PC＞", 4)]),
  st("S186", 186, [p("20-010", "直線線路 186mm", 4), p("20-015", "アッシュピット線路 186mm"), p("20-016", "開放ピット線路 186mm")]),
  st("S124", 124, [p("20-020", "直線線路 124mm", 4), p("20-028", "PC直線線路124mm＜S124PC＞", 4), p("20-026", "リレーラー線路124mm(2本入り)", 2)]),
  st("S64", 64, [p("20-030", "直線線路 64mm", 2)]),
  st("S62", 62, [p("20-040", "直線線路 62mm", 4), p("20-054", "PC直線線路62mm＜S62PC＞", 4), p("20-041", "フィーダー線路 62mm", 1), p("20-055", "PCフィーダー線路62mm＜S62FPC＞", 1), p("20-045", "ジョイント線路 62mm", 2)]),
  st("S45", 45, [p("20-091", "端数線路セット", 2)], "長さは端数線路セットの規格図の表記（29mm・45mm）から"),
  st("S38", 38, [p("20-092", "端数線路セットB", 4)], "長さは端数線路セットBの規格図の表記（33mm・38mm）から"),
  st("S33", 33, [p("20-092", "端数線路セットB", 4)], "長さは端数線路セットBの規格図の表記（33mm・38mm）から"),
  st("S29", 29, [p("20-091", "端数線路セット", 4)], "長さは端数線路セットの規格図の表記（29mm・45mm）から"),
  st("SL78", 78, [p("20-050", "スライド線路 78mm", 1)], "スライド線路は78〜108mmで伸縮。配置計算では最短の78mmとして扱う"),
  // 曲線
  cv("R117-45", 117, 45, [p("20-176", "コンパクト曲線線路 R117mm", 4)], "角度は「8本で1周」の記載から45°"),
  cv("R150-45", 150, 45, [p("20-174", "コンパクト曲線線路 R150mm", 4)], "角度は「8本で1周」の記載から45°"),
  cv("R183-45", 183, 45, [p("20-172", "コンパクト曲線線路 R183mm", 4)], "角度は「8本で1周」の記載から45°"),
  cv("R216-45", 216, 45, [p("20-170", "曲線線路 R216-45°", 4)]),
  cv("R249-45", 249, 45, [p("20-100", "曲線線路 R249-45°", 4)]),
  cv("R282-45", 282, 45, [p("20-110", "曲線線路 R282-45°", 4)]),
  cv("R315-45", 315, 45, [p("20-120", "曲線線路 R315-45°", 4), p("20-124", "PC曲線線路R315-45°", 4)]),
  cv("R348-45", 348, 45, [p("20-132", "曲線線路 R348-45°", 4)]),
  cv("R348-30", 348, 30, [p("20-130", "曲線線路 R348-30°", 4)]),
  cv("R381-30", 381, 30, [p("20-140", "曲線線路 R381-30°", 4)]),
  cv("R216-15", 216, 15, [p("20-171", "曲線線路 R216-15°", 4)]),
  cv("R249-15", 249, 15, [p("20-101", "曲線線路 R249-15°", 4)]),
  cv("R282-15", 282, 15, [p("20-111", "曲線線路 R282-15°", 4)]),
  cv("R315-15", 315, 15, [p("20-121", "曲線線路 R315-15°", 4)]),
  cv("R481-15", 481, 15, [p("20-160", "曲線線路 R481-15°", 4)]),
  cv("R718-15", 718, 15, [p("20-150", "曲線線路 R718-15°", 4)]),
  // 分岐
  {
    id: "TO6", category: "turnout", label: "6番ポイント", handed: true, jointHelp: TURNOUT_HELP,
    routes: shape.turnout(186, [{ r: 718, deg: 15, turn: "L" }]),
    products: [p("20-202", "電動ポイント6番(左)", 1)],
    productsRight: [p("20-203", "電動ポイント6番(右)", 1)],
    geometryNote: "直進186mm（KATO USAの配線プラン資料）、分岐R718-15°（製品名）",
    geometryStatus: "confirmed", geometrySources: [SRC.katoUsa6, SRC.sumida],
  },
  {
    id: "TO4", category: "turnout", label: "4番ポイント", handed: true, jointHelp: TURNOUT_HELP,
    routes: shape.turnout(126, [{ r: 481, deg: 15, turn: "L" }]),
    products: [p("20-220", "電動ポイント4番(左)", 1)],
    productsRight: [p("20-221", "電動ポイント4番(右)", 1)],
    geometryNote: "直進126mm（付属の延長線路60mmで186mm）、分岐R481-15°",
    geometryStatus: "confirmed", geometrySources: [SRC.ix23, SRC.sumida],
  },
  {
    id: "TOY2", category: "turnout", label: "Y字ポイント2番", handed: false,
    jointHelp: "j0=トング側, j1=左へ分岐, j2=右へ分岐（直進側はない）",
    routes: shape.turnout(null, [{ r: 481, deg: 15, turn: "L" }, { r: 481, deg: 15, turn: "R" }]),
    products: [p("20-222", "電動Y字ポイント2番", 1)],
    geometryNote: "左右にR481-15°ずつ分かれる（#4ポイント2つ分の形）。全長124mm",
    geometryStatus: "confirmed", geometrySources: [SRC.sumida, SRC.branchlineY],
  },
  {
    id: "TOC150", category: "turnout", label: "コンパクトポイントR150", handed: true, jointHelp: TURNOUT_HELP,
    routes: shape.turnout(124, [{ r: 150, deg: 45, turn: "L" }]),
    products: [p("20-240", "電動ポイント R150mm 左", 1)],
    productsRight: [p("20-241", "電動ポイント R150mm 右", 1)],
    geometryNote: "直進124mm・分岐R150-45°（販売店の製品仕様）",
    geometryStatus: "confirmed", geometrySources: [SRC.gaugemaster240, SRC.sheffield240],
  },
  {
    id: "XO4", category: "turnout", label: "複線片渡りポイント4番", handed: true,
    jointHelp: `${DOUBLE_HELP}。j0→j3 が渡り線（右側から左側の線路へ）`,
    routes: shape.crossover(248, KATO_SPACING, false),
    products: [p("20-230", "複線片渡りポイント4番(左)", 1)],
    productsRight: [p("20-231", "複線片渡りポイント4番(右)", 1)],
    geometryNote: `長さ248mmは公式ページ、間隔33mmは複線規格。渡り線の曲線の形は${EST}`,
    geometryStatus: "estimated", geometrySources: [SRC.katoBranch, SRC.sumida],
  },
  {
    id: "DXO", category: "turnout", label: "複線両渡りポイント（ダブルクロス）", handed: false,
    jointHelp: `${DOUBLE_HELP}。j0→j3 と j2→j1 が渡り線`,
    routes: shape.crossover(310, KATO_SPACING, true),
    products: [p("20-210", "複線両渡りポイント（ダブルクロス）", 1)],
    geometryNote: `長さ310mm・間隔33mmは確認済み。渡り線の曲線の形は${EST}`,
    geometryStatus: "estimated", geometrySources: [SRC.sumida, "https://www.branchline.com.au/collections/all/products/kato-20-210-double-crossover-310mm-long-electric"],
  },
  {
    id: "X15", category: "crossing", label: "交差線路15°", handed: true, jointHelp: CROSSING_HELP,
    routes: shape.crossing(186, 15),
    products: [p("20-300", "交差線路15°(左)", 1)],
    productsRight: [p("20-301", "交差線路15°(右)", 1)],
    geometryNote: "長さ186mm・交差角15°（販売店の製品名。斜めの側は実物では192mm）",
    geometryStatus: "confirmed", geometrySources: [SRC.sumida, SRC.sheffield300],
  },
  {
    id: "X90", category: "crossing", label: "交差線路90°", handed: false, jointHelp: CROSSING_HELP,
    routes: shape.crossing(124, 90),
    products: [p("20-320", "交差線路90°(補助線路付)", 1)],
    geometryNote: "長さ124mm・交差角90°（販売店の製品名）",
    geometryStatus: "confirmed", geometrySources: [SRC.sumida, SRC.sheffield320, SRC.lombard320],
  },
  // 複線
  ...(
    [
      [248, [p("20-004", "複線直線線路 248mm", 2), p("20-006", "複線スラブ軌道直線線路248mm"), p("20-875", "複線駅構内延長線路")]],
      [186, [p("20-012", "複線直線線路 186mm"), p("20-014", "複線スラブ軌道直線線路186mm")]],
      [124, [p("20-023", "複線直線線路 124mm", 2), p("20-025", "複線スラブ軌道直線線路124mm")]],
      [62, [p("20-042", "複線直線線路 62mm", 2), p("20-044", "複線スラブ軌道直線線路62mm"), p("20-043", "複線フィーダー線路セット", 2), p("20-049", "複線スラブ軌道フィーダー線路S")]],
    ] as [number, CatalogProduct[]][]
  ).map(([len, products]): CatalogEntry => ({
    id: `DS${len}`, category: "double", label: `複線直線 DS${len}`, handed: false, jointHelp: DOUBLE_HELP,
    routes: shape.doubleStraight(len, KATO_SPACING), products,
  })),
  ...(
    [
      [414, [p("20-181", "複線曲線線路R414/381mm45°", 2), p("20-187", "スラブ曲線R414/381-45")]],
      [315, [p("20-183", "複線曲線線路R315/282mm45°")]],
      [480, [p("20-185", "複線曲線線路R480/447mm45°", 2)]],
    ] as [number, CatalogProduct[]][]
  ).map(([r, products]): CatalogEntry => ({
    id: `DR${r}-45`, category: "double", label: `複線曲線 R${r}/${r - KATO_SPACING}-45°`, handed: true,
    jointHelp: `${DOUBLE_HELP}。L向きでは右側が外側R${r}、左側が内側R${r - KATO_SPACING}`,
    routes: shape.doubleCurve(r, 45, KATO_SPACING), products,
  })),
  ...(
    [
      [414, [p("20-182", "複線アプローチ線路セットR414/381mm(左・右)", 2), p("20-188", "スラブアプローチR414/381", 2)]],
      [315, [p("20-184", "複線アプローチ線路セットR315/282mm(左・右)", 2)]],
      [480, [p("20-186", "複線アプローチ線路セットR480/447mm(左・右)", 2)]],
    ] as [number, CatalogProduct[]][]
  ).map(([r, products]): CatalogEntry => ({
    id: `DA${r}-22.5`, category: "double", label: `複線アプローチ R${r}/${r - KATO_SPACING}-22.5°`, handed: true,
    jointHelp: `${DOUBLE_HELP}。複線曲線の両端に1本ずつ使う`,
    routes: shape.doubleCurve(r, 22.5, KATO_SPACING), products,
    geometryNote: `22.5°は製品ページの記載。内外の線路を同心の円弧として扱う（実物の端部の形は${EST}）`,
    geometryStatus: "estimated",
  })),
  {
    id: "DW310", category: "double", label: "複線間隔変換 33→66mm", handed: true,
    jointHelp: `${DOUBLE_HELP}。左側の線路が33mm外へ広がる（j3 は間隔66mm）`,
    routes: shape.spacingChange(310, KATO_SPACING, 33),
    products: [p("20-051", "複線間隔変換線路310mm左", 1)],
    productsRight: [p("20-052", "複線間隔変換線路310mm右", 1)],
    geometryNote: `長さ310mm・間隔33→66mmは製品ページの記載。S字の曲線は${EST}`,
    geometryStatus: "estimated",
  },
  // 車止め
  {
    id: "BUMPER", category: "bumper", label: "車止め", handed: false, bumper: true,
    routes: shape.bumper(62),
    products: [p("20-046", "車止め線路A", 2), p("20-047", "車止め線路B", 2), p("20-063", "車止め線路A(標識灯点灯)")],
  },
  {
    id: "BUMPER-C", category: "bumper", label: "車止め（短）", handed: false, bumper: true,
    routes: shape.bumper(50),
    products: [p("20-048", "車止め線路C", 2), p("20-060", "車止め線路D"), p("20-064", "車止め線路C(標識灯点灯仕様)")],
    geometryNote: "車止め線路Cは50mm（D は35mm、標識灯付きCは66mm）",
  },
];

// ---- TOMIX ファイントラック ----
const TOMIX_SPACING = 37; // 公式「標準複線間隔37mm」（複線レールDS280の製品ページ）

const TOMIX: CatalogEntry[] = [
  // 直線
  st("S280", 280, [p("1802", "ストレートレールS280(F)", 4), p("1092", "ストレートレール S280(F)", 10), p("1012", "ストレートPCレール S280-PC(F)", 4), p("1093", "ストレートPCレール S280-PC(F)", 12)]),
  st("S158.5", 158.5, [p("1806", "ストレートレールS158.5(F)", 4), p("1016", "ストレートPCレール S158.5-PC(F)", 4)]),
  st("S140", 140, [p("1801", "ストレートレールS140(F)", 4), p("1011", "ストレートPCレール S140-PC(F)", 4)]),
  st("S99", 99, [p("1805", "ストレートレールS99(F)", 4), p("1015", "ストレートPCレール S99-PC(F)", 4)]),
  st("S72.5", 72.5, [p("1803", "ストレートレールS72.5(F)", 4), p("1013", "ストレートPCレール S72.5-PC(F)", 4)]),
  st("S70", 70, [p("1804", "ストレートレールS70(F)", 4), p("1014", "ストレートPCレール S70-PC(F)", 4)]),
  st("S33", 33, [p("1099", "端数レールS18.5(F)S33(F)(各2本セット)", 2)]),
  st("S18.5", 18.5, [p("1099", "端数レールS18.5(F)S33(F)(各2本セット)", 2)]),
  st("V70", 70, [p("1525", "バリアブルレールV70(F)"), p("1526", "バリアブルPCレールV70-PC(F)")], "バリアブルレールは伸縮する。配置計算では70mmとして扱う"),
  // 曲線
  cv("C103-30", 103, 30, [p("1111", "スーパーミニカーブレールC103(F)(30゜60゜各2)", 2)]),
  cv("C103-60", 103, 60, [p("1111", "スーパーミニカーブレールC103(F)(30゜60゜各2)", 2)]),
  cv("C140-30", 140, 30, [p("1112", "ミニカーブレールC140(F)(30゜60゜各2)", 2)]),
  cv("C140-60", 140, 60, [p("1112", "ミニカーブレールC140(F)(30゜60゜各2)", 2)]),
  cv("C177-30", 177, 30, [p("1113", "ミニカーブレールC177(F)(30゜60゜各2)", 2)]),
  cv("C177-60", 177, 60, [p("1113", "ミニカーブレールC177(F)(30゜60゜各2)", 2)]),
  cv("C243-45", 243, 45, [p("1855", "カーブレールC243-45(F)", 4), p("1195", "カーブPCレール C243-45-PC(F)", 4)]),
  cv("C280-45", 280, 45, [p("1851", "カーブレールC280-45(F)", 4), p("1191", "カーブPCレール C280-45-PC(F)", 4)]),
  cv("C317-45", 317, 45, [p("1852", "カーブレールC317-45(F)", 4), p("1192", "カーブPCレール C317-45-PC(F)", 4)]),
  cv("C354-45", 354, 45, [p("1856", "カーブレールC354-45(F)", 4), p("1196", "カーブPCレール C354-45-PC(F)", 4)]),
  cv("C391-45", 391, 45, [p("1858", "カーブレールC391-45(F)", 4), p("1198", "カーブPCレール C391-45-PC(F)", 4)]),
  cv("C243-15", 243, 15, [p("1863", "カーブPCレール C243-15-PC(F)", 4)]),
  cv("C280-15", 280, 15, [p("1854", "カーブレールC280-15(F)", 4), p("1194", "カーブPCレール C280-15-PC(F)", 4)]),
  cv("C317-15", 317, 15, [p("1197", "カーブPCレール C317-15-PC(F)", 4)]),
  cv("C354-15", 354, 15, [p("1864", "カーブPCレール C354-15-PC(F)", 4)]),
  cv("C391-15", 391, 15, [p("1865", "カーブPCレール C391-15-PC(F)", 4)]),
  cv("C541-15", 541, 15, [p("1853", "カーブレールC541-15(F)", 4), p("1193", "カーブPCレール C541-15-PC(F)", 4)]),
  cv("C605-10", 605, 10, [p("1870", "カーブレールC605-10(F)", 4), p("1190", "カーブPCレール C605-10-PC(F)", 4)]),
  // ポイント
  {
    id: "PL541-15", category: "turnout", label: "ポイント PL541-15", handed: true, jointHelp: TURNOUT_HELP,
    routes: shape.turnout(140, [{ r: 541, deg: 15, turn: "L" }]),
    products: [p("1272", "電動ポイントN-PL541-15(F)(完全選択式)", 1), p("1282", "電動合成枕木ポイントN-PL541-15-SY(F)", 1), p("1226", "手動合成枕木ポイントN-PL541-15-SY(F)", 1)],
    productsRight: [p("1271", "電動ポイントN-PR541-15(F)(完全選択式)", 1), p("1281", "電動合成枕木ポイントN-PR541-15-SY(F)", 1), p("1225", "手動合成枕木ポイントN-PR541-15-SY(F)", 1)],
    geometryNote: "直進140mm・分岐R541-15°。C541-15と組み合わせて間隔37mm（公式製品ページ）",
    geometryStatus: "confirmed", geometrySources: [SRC.tomix(1272)],
  },
  {
    id: "PL280-30", category: "turnout", label: "ポイント PL280-30", handed: true, jointHelp: TURNOUT_HELP,
    routes: shape.turnout(140, [{ r: 280, deg: 30, turn: "L" }]),
    products: [p("1274", "電動ポイントN-PL280-30(F)(完全選択式)", 1)],
    productsRight: [p("1273", "電動ポイントN-PR280-30(F)(完全選択式)", 1)],
    geometryNote: "直進140mm・分岐R280-30°（公式製品ページ）",
    geometryStatus: "confirmed", geometrySources: [SRC.tomix(1274)],
  },
  {
    id: "PL140-30", category: "turnout", label: "ミニポイント PL140-30", handed: true, jointHelp: TURNOUT_HELP,
    routes: shape.turnout(70, [{ r: 140, deg: 30, turn: "L" }]),
    products: [p("1232", "ミニ電動ポイントN-PL140-30(F)", 1)],
    productsRight: [p("1231", "ミニ電動ポイントN-PR140-30(F)", 1)],
    geometryNote: "長さ70mm・分岐R140（公式製品ページ）、30°は製品名から",
    geometryStatus: "confirmed", geometrySources: [SRC.tomix(1232)],
  },
  {
    id: "PY280-15", category: "turnout", label: "Y字ポイント PY280-15", handed: false,
    jointHelp: "j0=トング側, j1=左へ分岐, j2=右へ分岐（直進側はない）",
    routes: shape.turnout(null, [{ r: 280, deg: 15, turn: "L" }, { r: 280, deg: 15, turn: "R" }]),
    products: [p("1240", "電動Y字ポイント N-PY280-15 (F)", 1)],
    geometryNote: "左右にR280-15°ずつは製品名から",
  },
  {
    id: "PLR541/280-15", category: "turnout", label: "3方ポイント PLR541/280-15", handed: true,
    jointHelp: "j0=トング側, j1=直進側, j2=左へ分岐(R541), j3=右へ分岐(R280)",
    routes: shape.turnout(140, [{ r: 541, deg: 15, turn: "L" }, { r: 280, deg: 15, turn: "R" }]),
    products: [p("1262", "電動3方ポイントN-PLR541/280-15(F)", 1)],
    productsRight: [p("1261", "電動3方ポイントN-PRL541/280-15(F)", 1)],
    geometryNote: `左がR541・右がR280（公式製品ページ）。直進140mmは${EST}`,
    geometryStatus: "estimated", geometrySources: [SRC.tomix(1262)],
  },
  {
    id: "CPL317/280-45", category: "turnout", label: "カーブポイント CPL317/280-45", handed: true,
    jointHelp: "j0=トング側, j1=外側のカーブ(R317)へ, j2=内側のカーブ(R280)へ（どちらも左へ曲がる）",
    routes: shape.turnout(null, [{ r: 317, deg: 45, turn: "L" }, { r: 280, deg: 45, turn: "L" }]),
    products: [p("1279", "電動ポイントN-CPL317/280-45(F)(完全選択式)", 1)],
    productsRight: [p("1278", "電動ポイントN-CPR317/280-45(F)(完全選択式)", 1)],
    geometryNote: "R317・R280の45°は製品名から（同じ点から2本の円弧が出る形として扱う）",
  },
  {
    id: "PX280", category: "turnout", label: "ダブルクロッシング PX280", handed: false,
    jointHelp: `${DOUBLE_HELP}。j0→j3 と j2→j1 が渡り線`,
    routes: shape.crossover(280, TOMIX_SPACING, true),
    products: [p("1247", "電動ポイント N-PX280 (F)", 1)],
    geometryNote: `長さ280mm（公式製品ページ）・間隔37mm（標準複線間隔）。渡り線の曲線の形は${EST}`,
    geometryStatus: "estimated", geometrySources: [SRC.tomix(1247)],
  },
  {
    id: "PXL140-15", category: "turnout", label: "ダブルスリップ PXL140-15", handed: true,
    jointHelp: `${CROSSING_HELP}。j0→j3 と j2→j1 にも渡れる`,
    routes: shape.doubleSlip(140, 15),
    products: [p("1246", "電動ダブルスリップポイントN-PXL140-15(F)", 1)],
    productsRight: [p("1245", "電動ダブルスリップポイントN-PXR140-15(F)", 1)],
    geometryNote: `長さ140mm・15°は製品名から。渡りの曲線の形は${EST}`,
    geometryStatus: "estimated",
  },
  // 交差
  {
    id: "XL140-15", category: "crossing", label: "クロッシング XL140-15", handed: true, jointHelp: CROSSING_HELP,
    routes: shape.crossing(140, 15),
    products: [p("1323", "クロッシングレール XL140-15(F)", 1)],
    productsRight: [p("1322", "クロッシングレール XR140-15(F)", 1)],
    geometryNote: "長さ140mm・15°は製品名から",
  },
  {
    id: "X72.5-30", category: "crossing", label: "クロッシング X72.5-30", handed: false, jointHelp: CROSSING_HELP,
    routes: shape.crossing(72.5, 30),
    products: [p("1321", "クロッシングレール X72.5-30(F)", 1)],
    geometryNote: "長さ72.5mm・30°は製品名から",
  },
  {
    id: "X37-90", category: "crossing", label: "クロッシング X37-90", handed: false, jointHelp: CROSSING_HELP,
    routes: shape.crossing(37, 90),
    products: [p("1324", "クロッシングレール X37-90(F)(補助レール付)", 1)],
    geometryNote: "長さ37mm・90°は製品名から",
  },
  // 複線
  ...(
    [
      [280, [p("1812", "複線レールDS280(F)(2本セット)", 2)]],
      [140, [p("1811", "複線レールDS140(F)(2本セット)", 2)]],
      [1120, [p("1819", "複線レールDS1120(F)(2本セット)", 2)]],
    ] as [number, CatalogProduct[]][]
  ).map(([len, products]): CatalogEntry => ({
    id: `DS${len}`, category: "double", label: `複線直線 DS${len}`, handed: false, jointHelp: DOUBLE_HELP,
    routes: shape.doubleStraight(len, TOMIX_SPACING), products,
    geometryNote: "間隔37mm（公式製品ページ「標準複線間隔37mm」）",
    geometryStatus: "confirmed", geometrySources: [SRC.tomix(1812)],
  })),
  ...(
    [
      [317, [p("1881", "複線カーブレールDC317・280-45(F)(2本セット)", 2)]],
      [391, [p("1882", "複線カーブレールDC391・354-45(F)(2本セット)", 2)]],
      [465, [p("1883", "複線カーブレールDC465・428-45(F)(2本セット)", 2)]],
    ] as [number, CatalogProduct[]][]
  ).map(([r, products]): CatalogEntry => ({
    id: `DC${r}-45`, category: "double", label: `複線曲線 DC${r}/${r - TOMIX_SPACING}-45`, handed: true,
    jointHelp: `${DOUBLE_HELP}。L向きでは右側が外側R${r}、左側が内側R${r - TOMIX_SPACING}`,
    routes: shape.doubleCurve(r, 45, TOMIX_SPACING), products,
  })),
  // 車止め
  {
    id: "E", category: "bumper", label: "エンドレール", handed: false, bumper: true,
    routes: shape.bumper(40),
    products: [p("1421", "エンドレールE (F)"), p("1423", "エンドレールE(LED2・ノイズキャンセラー付)(F)"), p("1428", "エンドPCレールE-PC(LEDタイプ)(F)")],
    geometryNote: `長さ40mmは${EST}`,
    geometryStatus: "estimated",
  },
];

// ---- 高架用の品番 ----
// KATO: 公式「高架線路」一覧（入数は KATO USA・販売店の記載で2本入りを確認）。
// TOMIX: 公式の基本レール一覧の「高架橋付PCレール」。
const ELEVATED: Record<CatalogMaker, Record<string, CatalogProduct[]>> = {
  kato: {
    S248: [p("20-400", "単線高架線路 直線 248mm", 2)],
    S186: [p("20-410", "単線高架線路 直線 186mm", 2)],
    S124: [p("20-420", "単線高架線路 直線 124mm", 2)],
    S62: [p("20-440", "単線高架線路 直線 62mm", 2)],
    "R249-45": [p("20-505", "単線高架線路 曲線R249-45", 2)],
    "R282-45": [p("20-510", "単線高架線路 曲線R282-45", 2)],
    "R315-45": [p("20-520", "単線高架線路 曲線R315-45", 2)],
    "R348-45": [p("20-530", "単線高架線路 曲線R348-45", 2)],
    "R348-30": [p("20-531", "単線高架線路 曲線R348-30", 2)],
    "R381-30": [p("20-540", "単線高架線路 曲線R381-30", 2)],
    DS248: [p("20-401", "複線高架直線線路 248mm", 2)],
    DS186: [p("20-411", "複線高架直線線路 186mm", 2)],
    DS124: [p("20-422", "複線高架直線線路 124mm", 2)],
    "DR414-45": [p("20-544", "複線高架曲線414/381-45", 2)],
    "DA414-22.5": [p("20-545", "複線高架アプローチ線路R414", 2)],
  },
  tomix: {
    S280: [p("1822", "高架橋付PCレールHS280-PC(F)", 4)],
    "S158.5": [p("1826", "高架橋付PCレールHS158．5-PC(F)", 4)],
    S140: [p("1821", "高架橋付PCレールHS140-PC(F)", 4)],
    S99: [p("1825", "高架橋付PCレールHS99-PC(F)", 4)],
    "C243-45": [p("1873", "高架橋付PCレールHC243-45-PC(F)", 4)],
    "C280-45": [p("1871", "高架橋付PCレールHC280-45-PC(F)", 4)],
    "C317-45": [p("1872", "高架橋付PCレールHC317-45-PC(F)", 4)],
    "C354-45": [p("1874", "高架橋付PCレールHC354-45-PC(F)", 4)],
    "C391-45": [p("1875", "高架橋付PCレールHC391-45-PC(F)", 4)],
    "C541-15": [p("1876", "高架橋付PCレールHC541-15-PC(F)", 4)],
  },
};

// ---- 鉄橋 ----
const SRC_BRIDGE = {
  kato: "https://unitrack.katomodels.com/products/line_single/iron_bridge",
  traintrax: "https://traintrax.co.uk/20-400-248mm-single-track-straight-viaduct-2pcs",
};

const bridge = (
  id: string,
  label: string,
  routes: Route[],
  products: CatalogProduct[],
  extra: Partial<CatalogEntry> = {},
): CatalogEntry => ({ id, category: "bridge", label, routes, handed: false, products, ...extra });

const KATO_BRIDGES: CatalogEntry[] = [
  bridge("TRUSS248", "単線トラス鉄橋 248mm", shape.straight(248), [
    p("20-430", "単線トラス鉄橋(朱)", 1), p("20-431", "単線トラス鉄橋(緑)", 1), p("20-432", "単線トラス鉄橋(灰)", 1),
    p("20-428", "単線トラス鉄橋(ライトグリーン)", 1), p("20-429", "単線トラス鉄橋(赤茶)", 1),
  ], { geometrySources: [SRC_BRIDGE.kato] }),
  bridge("PG186", "単線プレートガーダー鉄橋 186mm", shape.straight(186), [
    p("20-450", "単線プレートガーダー鉄橋(朱)", 1), p("20-451", "単線プレートガーダー鉄橋(緑)", 1),
    p("20-452", "単線プレートガーダー鉄橋(灰)", 1), p("20-449", "単線プレートガーダー鉄橋(ライトグリーン)", 1),
  ], { geometrySources: [SRC_BRIDGE.kato] }),
  bridge("DG124", "単線デッキガーダー鉄橋 124mm", shape.straight(124), [
    p("20-460", "単線デッキガーダー鉄橋124 朱", 1), p("20-461", "単線デッキガーダー鉄橋124 緑", 1),
    p("20-462", "単線デッキガーダー鉄橋124 灰", 1), p("20-459", "単線デッキガーダー鉄橋(ライトグリーン)", 1),
  ], { geometrySources: [SRC_BRIDGE.kato] }),
  bridge("DGC448-15", "デッキガーダー曲線鉄橋 R448-15°", shape.curve(448, 15), [
    p("20-465", "単線デッキガーダー曲線鉄橋 朱", 1), p("20-466", "単線デッキガーダー曲線鉄橋 緑", 1),
    p("20-467", "単線デッキガーダー曲線鉄橋 灰", 1), p("20-468", "単線デッキガーダー曲線鉄橋R448-15°(ライトグリーン)", 1),
  ], { handed: true, geometryNote: "R448とR481を並べると複線の曲線鉄橋になる（中心間隔33mm）", geometrySources: [SRC_BRIDGE.kato] }),
  bridge("DGC481-15", "デッキガーダー曲線鉄橋 R481-15°", shape.curve(481, 15), [
    p("20-470", "単線デッキガーダー曲線鉄橋 R481-15°(朱)", 1), p("20-471", "単線デッキガーダー曲線鉄橋 R481-15°(緑)", 1),
    p("20-472", "単線デッキガーダー曲線鉄橋 R481-15°(灰)", 1), p("20-473", "単線デッキガーダー曲線鉄橋R481-15°(ライトグリーン)", 1),
  ], { handed: true, geometrySources: [SRC_BRIDGE.kato] }),
  bridge("DPG186", "複線プレートガーダー鉄橋 186mm", shape.doubleStraight(186, KATO_SPACING), [
    p("20-455", "複線プレートガーダー鉄橋Lブルー", 1), p("20-456", "複線プレートガーダー鉄橋LG", 1),
    p("20-457", "複線プレートガーダー鉄橋グレー", 1),
  ], { jointHelp: DOUBLE_HELP, geometryNote: "線路中心間隔33mm（KATOの複線規格）", geometrySources: [SRC_BRIDGE.kato] }),
  bridge("DTRUSS248", "複線トラス鉄橋 248mm", shape.doubleStraight(248, KATO_SPACING), [
    p("20-436", "複線トラス鉄橋(ライトブルー)", 1), p("20-439", "複線トラス鉄橋(ライトグリーン)", 1),
  ], {
    jointHelp: DOUBLE_HELP,
    geometryNote: `長さ248mmは公式一覧。線路中心間隔33mmは${EST}`,
    geometryStatus: "estimated", geometrySources: [SRC_BRIDGE.kato],
  }),
];

// TOMIX の鉄橋はレールが別売り（製品ページの「セット内容」にレールがない）。同じ長さのレールを一緒に数える
const TOMIX_BRIDGES: CatalogEntry[] = [
  bridge("TRUSS280", "単線トラス鉄橋 280mm", shape.straight(280), [
    p("3030", "単線トラス鉄橋(F)(青)(PC橋脚・2本付)", 1), p("3031", "単線トラス鉄橋(F)(赤)(レンガ橋脚・2本付)", 1),
    p("3033", "単線トラス鉄橋(F)(深緑)(PC橋脚・2本付)", 1),
  ], {
    requires: [{ id: "S280", count: 1 }],
    geometryNote: "長さ280mm（S280と同じ）。レールS280は別売りなので部品リストに一緒に入る。付属の橋脚2本は数えていない",
    geometryStatus: "confirmed", geometrySources: [SRC.tomix(3030)],
  }),
  bridge("DTRUSS280", "上路式単線トラス鉄橋 280mm", shape.straight(280), [
    p("3266", "上路式単線トラス鉄橋S280(F)(赤)(レンガ橋脚・2本付)", 1), p("3267", "上路式単線トラス鉄橋S280(F)(深緑)(PC橋脚・2本付)", 1),
  ], {
    requires: [{ id: "S280", count: 1 }],
    geometryNote: "長さ280mm（公式製品ページ）。レールS280は別売り。付属の橋脚2本は数えていない",
    geometryStatus: "confirmed", geometrySources: [SRC.tomix(3266)],
  }),
  bridge("DG140", "上路式デッキガーダー鉄橋 140mm", shape.straight(140), [
    p("3255", "上路式デッキガーダー鉄橋S140(F)(赤)(レンガ橋脚・2本付)", 1), p("3256", "上路式デッキガーダー鉄橋S140(F)(深緑)(PC橋脚・2本付)", 1),
  ], {
    requires: [{ id: "S140", count: 1 }],
    geometryNote: "長さ140mm（S140と同じ、公式製品ページ）。レールS140は別売り。付属の橋脚2本は数えていない",
    geometryStatus: "confirmed", geometrySources: [SRC.tomix(3255)],
  }),
];

function withElevated(maker: CatalogMaker, entries: CatalogEntry[]): CatalogEntry[] {
  return entries.map((e) => (ELEVATED[maker][e.id] ? { ...e, elevatedProducts: ELEVATED[maker][e.id] } : e));
}

export const CATALOG: Record<CatalogMaker, CatalogEntry[]> = {
  kato: withElevated("kato", [...KATO, ...KATO_BRIDGES]),
  tomix: withElevated("tomix", [...TOMIX, ...TOMIX_BRIDGES]),
};

/** 一覧に掲載されているが、配置計算の対象にしていない製品（理由つき） */
export const NOT_MODELED: { maker: CatalogMaker; code: string; name: string; reason: string }[] = [
  { maker: "tomix", code: "1297", name: "安全側線レールPL541-15-S140-SY(F)", reason: "ポイントPL541-15とS140・車止めの組み合わせで代用できる" },
  { maker: "tomix", code: "1298", name: "安全側線レールPR541-15-C541-SY(F)", reason: "ポイントPR541-15とC541-15・車止めの組み合わせで代用できる" },
  { maker: "tomix", code: "1425", name: "ワイドエンドレールE-WI(F)(2本セット)", reason: "ワイドPCレール用" },
];
