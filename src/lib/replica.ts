// 「再現してみた」: 実在の路線・駅の特徴を、ボードの上に再現するAI提案。
//
// 線路と、製品のあるストラクチャー（ホーム・駅舎など）は今までどおり品番のある部品で置く。
// 製品にない物（トンネル・鉄橋・高架橋・沿線の名所・特徴のある駅舎など）は
// 「シミュレーション上の仮オブジェクト」（SimObject）として、実在の製品と分けて保存・表示する。
// 仮オブジェクトは部品リスト・費用・所有パーツには数えない。

import { z } from "zod";
import type { Elevation } from "./elevation";
import type { Piece } from "./geometry";
import { normDeg } from "./parts";
import { trackPoints } from "./accessories";

/** 画面に必ず出す注意書き */
export const SIM_DISCLAIMER =
  "点線の「仮」は実在の製品ではなく、シミュレーション上のみで再現したオブジェクトです（部品リスト・費用には含みません）。実在の路線・駅の名前は再現の目安で、鉄道会社の公式なものではありません。";

export type ReplicaKind = "line" | "station";
export const REPLICA_KIND_LABELS: Record<ReplicaKind, string> = { line: "路線名", station: "駅名" };

export type ReplicaTarget = { kind: ReplicaKind; name: string };

export const SIM_KINDS = [
  "tunnel",
  "bridge",
  "viaduct",
  "station",
  "platform",
  "building",
  "landmark",
  "mountain",
  "water",
  "other",
] as const;
export type SimKind = (typeof SIM_KINDS)[number];

export const SIM_KIND_LABELS: Record<SimKind, string> = {
  tunnel: "トンネル",
  bridge: "鉄橋",
  viaduct: "高架橋",
  station: "駅舎",
  platform: "ホーム",
  building: "建物",
  landmark: "名所・ランドマーク",
  mountain: "山・丘",
  water: "川・海・湖",
  other: "その他",
};

/** 置き方。over=線路をまたぐ（中心線に合わせる）, edge=線路の縁に沿う, beside=線路から離す */
const SIM_MOUNT: Record<SimKind, "over" | "edge" | "beside"> = {
  tunnel: "over",
  bridge: "over",
  viaduct: "over",
  station: "beside",
  platform: "edge",
  building: "beside",
  landmark: "beside",
  mountain: "beside",
  water: "beside",
  other: "beside",
};

/** 線路の中心からホームの縁まで(mm)。accessories と同じ */
const EDGE_MM = 11;
/** 建物などを線路から離す距離(mm) */
const BESIDE_GAP_MM = 25;

/** シミュレーション上だけの仮オブジェクト（実在の製品ではない） */
export type SimObject = {
  uid: string;
  name: string;
  kind: SimKind;
  /** 中心のワールド座標と向き（度。線路に沿った方向が0°） */
  x: number;
  y: number;
  rot: number;
  /** 線路に沿った方向の長さ・直角の方向の幅・高さ(mm) */
  length: number;
  width: number;
  height: number;
  /** 置いた所の線路の高さ(mm) */
  z?: number;
  host?: string;
  side?: "L" | "R";
  /** 実物のどんな特徴を表したか */
  note: string;
};

/** 再現の内容（レイアウトと一緒に保存する） */
export type ReplicaInfo = {
  kind: ReplicaKind;
  target: string;
  /** 再現した実物の特徴（箇条書き） */
  features: string[];
};

export const SIZE_LIMITS = {
  length: [10, 2000],
  width: [5, 800],
  height: [0, 400],
} as const;

const clamp = (v: number, [lo, hi]: readonly [number, number]) => Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : lo));

/** AIが出す仮オブジェクト */
export const PlanSimObjectSchema = z.object({
  name: z.string().describe("名前（例: 〇〇トンネル、〇〇駅 駅舎、〇〇川橋梁）"),
  kind: z.enum(SIM_KINDS).describe("種類"),
  segment: z.number().int().describe("置く線路の区間番号（0始まり）"),
  piece: z.number().int().describe("その区間内の部品番号（0始まり）。その部品の中央に置く"),
  side: z.enum(["L", "R"]).describe("進行方向に向かって線路のどちら側か。トンネル・鉄橋・高架橋はL"),
  length: z.number().describe("線路に沿った方向の長さ(mm)"),
  width: z.number().describe("線路と直角の方向の幅(mm)"),
  height: z.number().describe("高さ(mm)"),
  note: z.string().describe("実物のどんな特徴を表したか（1文）"),
});
export type PlanSimObject = z.infer<typeof PlanSimObjectSchema>;

export const PlanReplicaSchema = z.object({
  target: z.string().describe("再現した路線・駅の名前"),
  features: z.array(z.string()).describe("再現した実物の特徴（3〜6項目。例: 複線、高架区間、急カーブ、島式2面4線）"),
  objects: z.array(PlanSimObjectSchema).describe("製品にない物をシミュレーション上の仮オブジェクトとして置く"),
});
export type PlanReplica = z.infer<typeof PlanReplicaSchema>;

/** 部品の中央に仮オブジェクトを置く */
export function placeSimOnPiece(
  o: Omit<PlanSimObject, "segment" | "piece">,
  piece: Piece,
  elevation: Elevation | undefined,
  uid: string,
): SimObject {
  const length = clamp(o.length, SIZE_LIMITS.length);
  const width = clamp(o.width, SIZE_LIMITS.width);
  const height = clamp(o.height, SIZE_LIMITS.height);
  // ポイントは直進側（route 0）のまんなかに置く
  const pts = trackPoints(piece, elevation).filter((t) => t.route === 0);
  const mid = pts[Math.floor(pts.length / 2)] ?? { x: piece.x, y: piece.y, z: piece.z ?? 0, deg: piece.rot };
  const mount = SIM_MOUNT[o.kind];
  const side = o.side;
  const off =
    mount === "over" ? 0 : (mount === "edge" ? EDGE_MM + width / 2 : EDGE_MM + BESIDE_GAP_MM + width / 2) * (side === "L" ? 1 : -1);
  const r = (mid.deg * Math.PI) / 180;
  // 進行方向の左は (sin, -cos)（画面の y は下向き）
  return {
    uid,
    name: o.name.trim().slice(0, 60) || SIM_KIND_LABELS[o.kind],
    kind: o.kind,
    x: mid.x + Math.sin(r) * off,
    y: mid.y - Math.cos(r) * off,
    rot: normDeg(mid.deg),
    length,
    width,
    height,
    ...(mid.z ? { z: mid.z } : {}),
    host: piece.uid,
    side,
    note: o.note.trim().slice(0, 200),
  };
}

export function isSimObject(v: unknown): v is SimObject {
  const s = v as SimObject;
  return (
    !!s &&
    typeof s === "object" &&
    typeof s.uid === "string" &&
    typeof s.name === "string" &&
    (SIM_KINDS as readonly string[]).includes(s.kind) &&
    [s.x, s.y, s.rot, s.length, s.width, s.height].every((n) => typeof n === "number" && Number.isFinite(n))
  );
}

/** 再現モードのAIへの説明（システムプロンプトに足す） */
export function replicaGuide(): string {
  const kinds = SIM_KINDS.map((k) => `${k}=${SIM_KIND_LABELS[k]}`).join("、");
  return `## 再現モード（replica）
利用者が実在の路線名か駅名を指定したときは、その特徴をボードの上に縮めて再現します。
- 路線名なら: 複線か単線か、高架・地下・築堤、急カーブや長い直線、分岐・待避駅、トンネル・鉄橋など路線の特徴と、沿線の有名な建物・名所（ストラクチャー）を再現します。
- 駅名なら: ホームの形（島式・対向式・頭端式）と面数・番線数、駅舎の形（橋上駅舎・地上駅舎・高架駅など）、引き上げ線や留置線などの駅の特徴を再現します。前後の線路はボードに収まる範囲で、運転できる形（エンドレスや折り返し）にします。
- 線路と、上の一覧にあるパーツ（ホーム・駅舎・踏切など）で表せる物は、segments と accessories で置きます。
- 一覧にない物（トンネル、鉄橋、高架橋、特徴のある駅舎、沿線の建物・名所、山、川など）は replica.objects に仮オブジェクトとして置きます。製品ではなく、シミュレーション上だけの目安です。
- replica.objects の各項目: segment と piece=近くの線路の部品（その部品の中央に置く）, side=線路の左右, length/width/height=大きさ(mm、1/150の目安。ボードに収まる大きさに縮めてよい)。
  トンネル・鉄橋・高架橋は線路をまたいで置き、length はその区間の線路の長さに合わせます。高架橋は height>0 の線路の部品を指定します。ホームは線路の縁に沿い、その他は線路から少し離して置きます。
- 種類（kind）: ${kinds}
- replica.target に再現した路線・駅の名前、replica.features に再現した実物の特徴を3〜6項目書きます。わからないことは推測と断ったうえで一般的な形にし、事実と違うことを断定しないでください。
- 鉄道会社のロゴ・商標・車両の塗装は再現しません。名前は駅名・路線名・地名・名所の一般的な名前だけを使います。
- description には、どこをどう再現したか、何を縮めたり省いたりしたかを日本語で2〜4文で書きます。`;
}

/** 再現モードで、利用者の入力からAIに渡す要望の文 */
export function replicaRequest(target: ReplicaTarget, extra: string): string {
  const what =
    target.kind === "line"
      ? `路線「${target.name}」の特徴（線路の形・高架やトンネル・カーブ）と沿線の有名なストラクチャーを再現したレイアウト`
      : `駅「${target.name}」の駅舎とホームの特徴（ホームの形・番線数・駅舎）を再現したレイアウト`;
  return extra.trim() ? `${what}。追加の要望: ${extra.trim()}` : what;
}
