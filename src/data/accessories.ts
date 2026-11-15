// 線路以外のストラクチャー・アクセサリー（踏切・信号機・駅のホーム・駅舎・建物）。Nゲージ（1/150）。
//
// 品番・製品名・メーカー希望小売価格（税込）・寸法は各社公式サイトの掲載値（2026-11-15 取得）。
//   KATO 自動踏切: https://unitrack.katomodels.com/products/line_single/automatic_crossing
//   KATO 信号機:   https://unitrack.katomodels.com/products/line_single/traffic_light
//   KATO 駅・ホーム: https://unitrack.katomodels.com/products/station_yard/station_home
//   KATO 駅・ホームDX: https://unitrack.katomodels.com/products/station_yard/station_home_dx
//   KATO ローカル駅・ホーム: https://unitrack.katomodels.com/products/station_yard/local_station_home
//   KATO 鉄道施設: https://unitrack.katomodels.com/products/station_yard/railway_facility
//   TOMIX 各製品ページ: https://www.tomytec.co.jp/tomix/products/n/<品番>.html
//   TOMIX 自動踏切: https://www.tomytec.co.jp/tomix/necst/autocrossing/
//
// 公式に載っていない寸法（ホームの幅、踏切の道路の幅、TOMIXの建物の大きさなど）は推定で、
// geometryNote に「推定」と書いている。長さ（線路に沿った方向）はホーム長・踏切線路長など公式の値。

import type { CatalogMaker } from "./trackCatalog";

/**
 * 置き方。
 * - onTrack: 線路の上（中心線に合わせる）。踏切・信号機付き線路
 * - beside: 線路の横（中心線から offset だけ離す）。ホーム
 * - over: 線路をまたぐ（中心線に合わせ、線路の上空に建つ）。橋上駅舎・跨線橋
 * - free: どこにでも置ける。駅舎・建物
 */
export type AccessoryMount = "onTrack" | "beside" | "over" | "free";

export type AccessoryKind = "crossing" | "signal" | "platform" | "island" | "station" | "bridgeStation" | "building";

export type AccessoryEntry = {
  /** メーカー内で一意のID（AIへの指示にも使う） */
  id: string;
  kind: AccessoryKind;
  /** パレットに出す名前 */
  label: string;
  code: string;
  /** 公式の製品名 */
  name: string;
  priceJpy: number;
  mount: AccessoryMount;
  /** 線路に沿った方向の長さ(mm) */
  length: number;
  /** 線路と直角の方向の幅(mm) */
  width: number;
  /** 高さ(mm, 3D表示用。レール面から) */
  height: number;
  /** beside: 線路の中心からホームの中心までの距離(mm) */
  offset?: number;
  /** 屋根付きのホーム */
  roof?: boolean;
  /**
   * 製品に線路が入っていて、その線路の代わりに置くときの部品ID（KATOの踏切線路124mm など）。
   * この部品の上に置くと、部品リストではその線路を数えない
   */
  replaces?: string;
  /** AI・画面向けの説明 */
  description: string;
  geometryNote?: string;
  sources: string[];
};

const KATO_CROSSING = "https://unitrack.katomodels.com/products/line_single/automatic_crossing";
const KATO_SIGNAL = "https://unitrack.katomodels.com/products/line_single/traffic_light";
const KATO_HOME = "https://unitrack.katomodels.com/products/station_yard/station_home";
const KATO_DX = "https://unitrack.katomodels.com/products/station_yard/station_home_dx";
const KATO_LOCAL = "https://unitrack.katomodels.com/products/station_yard/local_station_home";
const KATO_FACILITY = "https://unitrack.katomodels.com/products/station_yard/railway_facility";
const tomix = (code: string) => `https://www.tomytec.co.jp/tomix/products/n/${code}.html`;

/** 線路の中心からホームの縁までの間隔(mm)。車両の幅（約19mm）の半分＋すき間 */
export const PLATFORM_EDGE_MM = 11;
/** 対向式ホームの中心までの距離 */
const side = (width: number) => PLATFORM_EDGE_MM + width / 2;

export const ACCESSORY_CATALOG: Record<CatalogMaker, AccessoryEntry[]> = {
  kato: [
    {
      id: "CROSSING",
      kind: "crossing",
      label: "自動踏切",
      code: "20-652",
      name: "自動踏切S基本セット",
      priceJpy: 19800,
      mount: "onTrack",
      length: 124,
      width: 60,
      height: 22,
      replaces: "S124",
      description: "単線の自動踏切。踏切線路124mm（直線S124の代わり）・センサー線路62mm×2付き。直線の上に置く",
      geometryNote: "道路の幅（線路と直角の方向）は推定",
      sources: [KATO_CROSSING],
    },
    {
      id: "SIGNAL3",
      kind: "signal",
      label: "3灯式自動信号機",
      code: "20-606",
      name: "3灯式自動信号機SX 64mm(補助線路付)",
      priceJpy: 6600,
      mount: "onTrack",
      length: 64,
      width: 25,
      height: 32,
      replaces: "S64",
      description: "3灯式の自動信号機付き直線64mm（直線S64の代わり。補助線路30mm×2付き）。直線の上に置く",
      geometryNote: "信号機の高さは推定",
      sources: [KATO_SIGNAL],
    },
    {
      id: "ISLAND",
      kind: "island",
      label: "島式ホームセット",
      code: "23-170",
      name: "島式ホームセット",
      priceJpy: 3300,
      mount: "beside",
      length: 896,
      width: 27,
      height: 8,
      offset: 24.75,
      roof: true,
      description: "6両編成が両側に停車できる島式ホーム（248mm×2＋ホームエンド200mm×2、全長約896mm）。線路中心の間隔49.5mmの2本の線路の間に置く",
      geometryNote: "ホームの幅と、両側の線路の間隔49.5mmは推定（公式の掲載はホーム長のみ）",
      sources: [KATO_HOME],
    },
    {
      id: "ISLAND-A",
      kind: "island",
      label: "島式ホームA",
      code: "23-171",
      name: "島式ホームA",
      priceJpy: 1540,
      mount: "beside",
      length: 248,
      width: 27,
      height: 8,
      offset: 24.75,
      roof: true,
      description: "屋根付きの島式ホーム248mm（延長用）。線路中心の間隔49.5mmの2本の線路の間に置く",
      geometryNote: "ホームの幅と両側の線路の間隔は推定",
      sources: [KATO_HOME],
    },
    {
      id: "SIDE",
      kind: "platform",
      label: "対向式ホームセット",
      code: "23-177",
      name: "対向式ホームセット",
      priceJpy: 3300,
      mount: "beside",
      length: 896,
      width: 22,
      height: 8,
      offset: side(22),
      roof: true,
      description: "6両編成が停車できる片側だけに線路のある対向式ホーム（248mm×2＋ホームエンド200mm×2、全長約896mm）。線路の横に置く",
      geometryNote: "ホームの幅は推定",
      sources: [KATO_HOME],
    },
    {
      id: "SIDE-A",
      kind: "platform",
      label: "対向式ホームA",
      code: "23-178",
      name: "対向式ホームA",
      priceJpy: 1650,
      mount: "beside",
      length: 248,
      width: 22,
      height: 8,
      offset: side(22),
      roof: true,
      description: "屋根付きの対向式ホーム248mm（延長用）。線路の横に置く",
      geometryNote: "ホームの幅は推定",
      sources: [KATO_HOME],
    },
    {
      id: "LOCAL-SIDE",
      kind: "platform",
      label: "ローカル線の対向式ホーム",
      code: "23-133",
      name: "ローカル線の対向式ホーム(2本入)",
      priceJpy: 1650,
      mount: "beside",
      length: 124,
      width: 27.5,
      height: 7,
      offset: side(27.5),
      description: "ローカル線の小さな対向式ホーム124mm（1箱2本入。1本ずつ置く）。線路の横に置く",
      geometryNote: "ホームの幅は同じシリーズのホームエンドの掲載値（27.5mm）",
      sources: [KATO_LOCAL],
    },
    {
      id: "DX-ISLAND",
      kind: "island",
      label: "近郊形ホームDX 島式セット",
      code: "23-160",
      name: "近郊形ホームDX 島式セット",
      priceJpy: 6820,
      mount: "beside",
      length: 896,
      width: 27,
      height: 8,
      offset: 24.75,
      roof: true,
      description: "都市部の近代的な島式ホーム（6両編成が両側に停車、全長約896mm）。線路中心の間隔49.5mmの2本の線路の間に置く",
      geometryNote: "ホームの幅と両側の線路の間隔は推定。長さは248mm×2＋ホームエンド200mm×2として計算",
      sources: [KATO_DX],
    },
    {
      id: "BRIDGE-STATION",
      kind: "bridgeStation",
      label: "橋上駅舎",
      code: "23-200",
      name: "橋上駅舎",
      priceJpy: 3300,
      mount: "over",
      length: 137,
      width: 338,
      height: 50,
      description: "線路とホームの上をまたぐ橋上駅舎（338mm×137mm）。島式・対向式ホームの上に置く",
      geometryNote: "338mmを線路と直角の方向として扱う。高さは推定",
      sources: [KATO_HOME],
    },
    {
      id: "DX-BRIDGE-STATION",
      kind: "bridgeStation",
      label: "近郊形橋上駅舎",
      code: "23-122",
      name: "近郊形橋上駅舎",
      priceJpy: 6380,
      mount: "over",
      length: 248,
      width: 149,
      height: 50,
      description: "エスカレーター付きの近代的な橋上駅舎（長さ248mm・全幅149mm）。ホームの上に置く",
      geometryNote: "高さは推定",
      sources: [KATO_DX],
    },
    {
      id: "OVERPASS",
      kind: "bridgeStation",
      label: "近郊形跨線橋",
      code: "23-234",
      name: "近郊形跨線橋",
      priceJpy: 2970,
      mount: "over",
      length: 111,
      width: 119,
      height: 45,
      description: "ホームどうしを結ぶ跨線橋（111mm×119mm）。線路の上に置く",
      geometryNote: "111mmを線路に沿った方向として扱う。高さは推定",
      sources: [KATO_HOME],
    },
    {
      id: "STATION",
      kind: "station",
      label: "地上駅舎",
      code: "23-210",
      name: "地上駅舎",
      priceJpy: 1320,
      mount: "free",
      length: 125,
      width: 73,
      height: 30,
      description: "小規模な地上駅舎（125mm×73mm）。ホームの外側に置く",
      geometryNote: "高さは推定",
      sources: [KATO_HOME],
    },
    {
      id: "LOCAL-STATION",
      kind: "station",
      label: "ローカル線の小形駅舎",
      code: "23-241",
      name: "ローカル線の小形駅舎",
      priceJpy: 3740,
      mount: "free",
      length: 124,
      width: 97.3,
      height: 30,
      description: "ホーム（186mm）付きのローカル線の小さな駅舎（124mm×97.3mm）",
      geometryNote: "高さは推定",
      sources: [KATO_LOCAL],
    },
    {
      id: "CAR-SHED",
      kind: "building",
      label: "電車庫",
      code: "23-300",
      name: "電車庫",
      priceJpy: 2420,
      mount: "free",
      length: 187,
      width: 96,
      height: 40,
      description: "複線の電車庫（187mm×96mm）。留置線の終端に置く",
      geometryNote: "高さは推定",
      sources: [KATO_FACILITY],
    },
    {
      id: "OFFICE",
      kind: "building",
      label: "詰所",
      code: "23-310",
      name: "詰所",
      priceJpy: 3960,
      mount: "free",
      length: 150,
      width: 75,
      height: 35,
      description: "機関区・電車区の鉄筋コンクリートの詰所（150mm×75mm）",
      geometryNote: "高さは推定",
      sources: [KATO_FACILITY],
    },
  ],
  tomix: [
    {
      id: "CROSSING",
      kind: "crossing",
      label: "TCS自動踏切Ⅱ",
      code: "5569",
      name: "TCS自動踏切Ⅱ",
      priceJpy: 19800,
      mount: "onTrack",
      length: 70,
      width: 70,
      height: 22,
      description: "遮断機4本の自動踏切。標準の単線レールの直線・曲線の上に置く（レール・センサーは別売）",
      geometryNote: "道路の幅・長さは推定。動かすにはセンサー（5558など）が2組必要",
      sources: ["https://www.tomytec.co.jp/tomix/necst/autocrossing/", tomix("5569")],
    },
    {
      id: "SIGNAL3",
      kind: "signal",
      label: "TCS3灯式信号機",
      code: "5564",
      name: "TCS3灯式信号機(F)",
      priceJpy: 5280,
      mount: "onTrack",
      length: 70,
      width: 25,
      height: 32,
      replaces: "S70",
      description: "3灯式の自動信号機付きストレートレールS70（S70の代わり）。直線の上に置く",
      geometryNote: "信号機の高さは推定",
      sources: [tomix("5564")],
    },
    {
      id: "SIGNAL2",
      kind: "signal",
      label: "TCS2灯式信号機",
      code: "5565",
      name: "TCS2灯式信号機(F)",
      priceJpy: 5016,
      mount: "onTrack",
      length: 70,
      width: 25,
      height: 30,
      replaces: "S70",
      description: "2灯式の自動信号機付きストレートレールS70（S70の代わり）。直線の上に置く",
      geometryNote: "信号機の高さは推定",
      sources: [tomix("5565")],
    },
    {
      id: "ISLAND",
      kind: "island",
      label: "島式ホームセット(近代型)",
      code: "4009",
      name: "島式ホームセット(近代型)",
      priceJpy: 2640,
      mount: "beside",
      length: 560,
      width: 37,
      height: 8,
      offset: 29.5,
      roof: true,
      description: "近代型の島式ホーム（屋根付き280mm＋屋根なし140mm＋曲線端ホーム2個、全長約560mm）。線路中心の間隔約59mmの2本の線路の間に置く",
      geometryNote: "ホームの幅・全長・両側の線路の間隔は推定（公式の掲載は各ブロックの長さのみ）",
      sources: [tomix("4009")],
    },
    {
      id: "ISLAND-OLD",
      kind: "island",
      label: "島式ホームセット",
      code: "4021",
      name: "島式ホームセット",
      priceJpy: 2420,
      mount: "beside",
      length: 560,
      width: 37,
      height: 8,
      offset: 29.5,
      roof: true,
      description: "基本の島式ホーム（屋根付き280mm＋屋根なし140mm＋曲線端ホーム2個、全長約560mm）。2本の線路の間に置く",
      geometryNote: "ホームの幅・全長・両側の線路の間隔は推定",
      sources: [tomix("4021")],
    },
    {
      id: "SIDE",
      kind: "platform",
      label: "対向式ホームセット(近代型)",
      code: "4031",
      name: "対向式ホームセット(近代型)",
      priceJpy: 3080,
      mount: "beside",
      length: 665,
      width: 25,
      height: 8,
      offset: side(25),
      roof: true,
      description: "20m級5両分の近代型の対向式ホーム（屋根付き280mm＋140mm＋105mm＋端ホーム2個、全長約665mm）。線路の横に置く",
      geometryNote: "ホームの幅と全長は推定",
      sources: [tomix("4031")],
    },
    {
      id: "LOCAL-SIDE",
      kind: "platform",
      label: "対向式ホームセット",
      code: "4001",
      name: "対向式ホームセット",
      priceJpy: 1320,
      mount: "beside",
      length: 280,
      width: 25,
      height: 7,
      offset: side(25),
      description: "20m級2両分のローカルタイプの片面ホーム（約280mm）。線路の横に置く",
      geometryNote: "ホームの幅と長さは推定（公式の掲載は「20m級車両2両分」）",
      sources: [tomix("4001")],
    },
    {
      id: "BRIDGE-STATION",
      kind: "bridgeStation",
      label: "橋上駅舎(近代型)",
      code: "4033",
      name: "橋上駅舎(近代型)",
      priceJpy: 3080,
      mount: "over",
      length: 140,
      width: 200,
      height: 50,
      description: "島式・対向式ホームの上をまたぐ近代型の橋上駅舎。ホームの上に置く",
      geometryNote: "大きさ・高さは推定",
      sources: [tomix("4033")],
    },
    {
      id: "NEW-BRIDGE-STATION",
      kind: "bridgeStation",
      label: "ニュー橋上駅舎",
      code: "4040",
      name: "ニュー橋上駅舎",
      priceJpy: 2310,
      mount: "over",
      length: 140,
      width: 200,
      height: 50,
      description: "歩道橋の付いた橋上駅舎。ホームの上に置く",
      geometryNote: "大きさ・高さは推定",
      sources: [tomix("4040")],
    },
    {
      id: "OVERPASS",
      kind: "bridgeStation",
      label: "木造跨線橋",
      code: "4004",
      name: "木造跨線橋",
      priceJpy: 1408,
      mount: "over",
      length: 60,
      width: 120,
      height: 45,
      description: "ローカル線タイプの木造跨線橋。ホームどうしを結ぶように線路の上に置く",
      geometryNote: "大きさ・高さは推定",
      sources: [tomix("4004")],
    },
    {
      id: "SHOPS",
      kind: "building",
      label: "商店セット",
      code: "4008",
      name: "商店セット",
      priceJpy: 1188,
      mount: "free",
      length: 140,
      width: 60,
      height: 30,
      description: "商店街の店舗（歩道付き）。駅前に置く",
      geometryNote: "大きさ・高さは推定",
      sources: [tomix("4008")],
    },
    {
      id: "RESTAURANT",
      kind: "building",
      label: "郊外型レストラン(和風)",
      code: "4027",
      name: "郊外型レストラン(和風)",
      priceJpy: 1870,
      mount: "free",
      length: 110,
      width: 80,
      height: 25,
      description: "郊外のロードサイドのレストラン",
      geometryNote: "大きさ・高さは推定",
      sources: [tomix("4027")],
    },
  ],
};

export const ACCESSORY_KIND_LABELS: Record<AccessoryKind, string> = {
  crossing: "踏切",
  signal: "信号機",
  platform: "対向式ホーム",
  island: "島式ホーム",
  station: "駅舎",
  bridgeStation: "橋上駅舎・跨線橋",
  building: "建物",
};
