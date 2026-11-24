// 「再現してみた」: 実在の路線・駅の特徴を、ボードの上に再現するAI提案。
//
// 線路と、製品のあるストラクチャー（ホーム・駅舎など）は今までどおり品番のある部品で置く。
// 製品にない物（トンネル・鉄橋・高架橋・沿線の名所・特徴のある駅舎など）は
// 「シミュレーション上の仮オブジェクト」（SimObject）として、実在の製品と分けて保存・表示する。
// 仮オブジェクトは部品リスト・費用・所有パーツには数えない。

import { z } from "zod";
import { isUploadedModel, type UploadedModel } from "./object3d";
import type { Elevation } from "./elevation";
import type { Piece } from "./geometry";
import { normDeg } from "./parts";
import { trackPoints } from "./accessories";

/** 画面に必ず出す注意書き */
export const SIM_DISCLAIMER =
  "点線の「仮」は実在の製品ではなく、シミュレーション上のみで再現したオブジェクトです（部品リスト・費用には含みません）。実在の路線・駅の名前は再現の目安で、鉄道会社の公式なものではありません。";

export type ReplicaKind = "line" | "station";
export const REPLICA_KIND_LABELS: Record<ReplicaKind, string> = { line: "路線名", station: "駅名" };

/** 再現度。light=雰囲気だけ, standard=標準, faithful=実物に忠実 */
export const REPLICA_LEVELS = ["light", "standard", "faithful"] as const;
export type ReplicaLevel = (typeof REPLICA_LEVELS)[number];
export const REPLICA_LEVEL_LABELS: Record<ReplicaLevel, string> = { light: "雰囲気", standard: "標準", faithful: "忠実" };
export const REPLICA_LEVEL_HELP: Record<ReplicaLevel, string> = {
  light: "目立つ特徴を2〜3個に絞り、小さなボードでも組みやすい形にします。",
  standard: "主な特徴と有名なストラクチャーを、ボードに収まるよう縮めて再現します。",
  faithful:
    "線路の配置・駅の配線・構造物の並びをできるだけ実物どおりにし、縮めるのは長さだけにします。ボードの大きさは、出来上がったレイアウトに合わせます。部品とAIのトークン消費が多くなります。",
};

/** 路線名を比べるための形（空白と「線」の有無の違いを無視する） */
export const lineKey = (name: string) => name.normalize("NFKC").replace(/\s+/g, "").replace(/線$/, "");

/** 路線名を、known の中の同じ路線の書き方にそろえる（なければ前後の空白を除いたもの。空なら undefined） */
export function canonicalLine(name: string | undefined, known: readonly string[]): string | undefined {
  const t = (name ?? "").trim().slice(0, 40);
  if (!t) return undefined;
  return known.find((k) => lineKey(k) === lineKey(t)) ?? t;
}

export type ReplicaTarget = { kind: ReplicaKind; name: string; level?: ReplicaLevel };

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
  model?: UploadedModel;
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
  /** 再現度（ない場合は標準） */
  level?: ReplicaLevel;
  /** 駅名のとき、再現した乗り入れ路線 */
  lines?: string[];
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
  features: z.array(z.string()).describe("再現した実物の特徴（3〜8項目。例: 複線、高架区間、急カーブ、島式2面4線）"),
  lines: z
    .array(z.string())
    .default([])
    .describe("駅名のとき、その駅に乗り入れていて再現した路線の名前（例: 山手線、京浜東北線、丸ノ内線）。路線名のときは空の配列"),
  undergroundLines: z
    .array(z.string())
    .default([])
    .describe("全線が地下で地上に出ない路線（地下鉄など）の名前。駅の前後など一部だけが地下の路線は入れない。なければ空の配列"),
  objects: z.array(PlanSimObjectSchema).describe("製品にない物をシミュレーション上の仮オブジェクトとして置く"),
});
export type PlanReplica = z.input<typeof PlanReplicaSchema>;

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
    [s.x, s.y, s.rot, s.length, s.width, s.height].every((n) => typeof n === "number" && Number.isFinite(n)) &&
    (s.model === undefined || isUploadedModel(s.model))
  );
}

/** 再現モードのAIへの説明（システムプロンプトに足す） */
export function replicaGuide(): string {
  const kinds = SIM_KINDS.map((k) => `${k}=${SIM_KIND_LABELS[k]}`).join("、");
  return `## 再現モード（replica）
利用者が実在の路線名か駅名を指定したときは、その特徴をボードの上に縮めて再現します。
- 路線名なら: 複線か単線か、高架・地下・築堤、急カーブや長い直線、分岐・待避駅、トンネル・鉄橋など路線の特徴と、沿線の有名な建物・名所（ストラクチャー）を再現します。
- 駅名なら: ホームの形（島式・対向式・頭端式）と面数・番線数、駅舎の形（橋上駅舎・地上駅舎・高架駅など）、引き上げ線や留置線などの駅の特徴を再現します。前後の線路はボードに収まる範囲で、運転できる形（エンドレスや折り返し）にします。
- 複数の路線が乗り入れる駅では、1路線だけにせず、乗り入れる路線をそれぞれ線路として再現します（JR・私鉄・地下鉄の別の会社の路線も含みます）。路線ごとにホームと番線を分け、実物の位置関係（並んでいる・直角に交わる・高架と地上・地下など）に合わせて置きます。乗り換えの通路や別の駅舎など、製品にない物は仮オブジェクトにします。路線ごとに運転できるよう、それぞれの線路をエンドレスか折り返しにし、直通運転している路線はつなげます。再現した路線は replica.lines に書き、各路線の区間の line にその路線名を入れます。路線をまとめて1本の線路で表してはいけません。ほかの線路とつながらない路線は、from=null と区間の start で別に始めます。
- 地下を通る路線・地下駅は、線路の height をマイナス（地下）にします。実物で地下なのが駅の前後など一部の区間だけなら、その区間だけを地下にし、両端に勾配区間（height=null）を入れて地上へ出します（そこがトンネルの坑口）。エンドレスの残りは地上か実物どおりの高さにし、路線全体を地下にしてはいけません。全線が地下で地上に出ない路線（地下鉄など）だけは全体を地下にしてよく、その路線名を replica.undergroundLines に書きます。
- 地下駅のホームは仮オブジェクトにせず、製品のホーム（accessories の島式・対向式ホーム）を地下（height<0）の線路の部品に置きます。運転席の映像では、地下のホームと面する線路を囲む地下駅の構内として描きます。
- 地上の路線の下を地下の路線がくぐる駅では、平面で重なる所（交差する所）が地下区間の中に入るように、勾配区間は交差する所から離して置きます。地下の駅と地上の駅の位置関係（直交・並行、どちらが上か）も実物に合わせます。
- 線路と、上の一覧にあるパーツ（ホーム・駅舎・踏切など）で表せる物は、segments と accessories で置きます。
- 一覧にない物（トンネル、鉄橋、高架橋、特徴のある駅舎、沿線の建物・名所、山、川など）は replica.objects に仮オブジェクトとして置きます。製品ではなく、シミュレーション上だけの目安です。
- replica.objects の各項目: segment と piece=近くの線路の部品（その部品の中央に置く）, side=線路の左右, length/width/height=大きさ(mm、1/150の目安。ボードに収まる大きさに縮めてよい)。
  トンネル・鉄橋・高架橋は線路をまたいで置き、length はその区間の線路の長さに合わせます。高架橋は height>0 の線路の部品を、地下のトンネルは height<0 の線路の部品を指定します。ホームは線路の縁に沿い、その他は線路から少し離して置きます。
- 種類（kind）: ${kinds}
- replica.target に再現した路線・駅の名前、replica.features に再現した実物の特徴を3〜6項目書きます。わからないことは推測と断ったうえで一般的な形にし、事実と違うことを断定しないでください。
- 鉄道会社のロゴ・商標・車両の塗装は再現しません。名前は駅名・路線名・地名・名所の一般的な名前だけを使います。
- description には、どこをどう再現したか、何を縮めたり省いたりしたかを日本語で2〜4文で書きます。`;
}

/** 再現度ごとの、AIへの指示 */
const LEVEL_GUIDE: Record<ReplicaLevel, string> = {
  light:
    "再現度は「雰囲気」です。いちばん目立つ特徴を2〜3個に絞り、ボードに楽に収まるシンプルな形にしてください。仮オブジェクトは2〜4個までにします。乗り入れる路線が多い駅は、主な2路線までに絞ってかまいません（絞ったことを description に書きます）。",
  standard: "再現度は「標準」です。主な特徴と有名なストラクチャーを、ボードに収まるよう縮めて再現してください。",
  faithful: [
    "再現度は「忠実」です。できるだけ実物に忠実に再現してください。",
    "- 線路の配置を実物どおりの並びにします: 複線・単線の区間、分岐の位置と向き、カーブの向きと順序、高架・築堤・地下・トンネル・鉄橋の位置と順序。縮めるのは長さとカーブの半径だけにし、並びや本数は変えません。",
    "- 駅は実物の配線にします: ホームの形と面数・番線数、渡り線・引き上げ線・留置線・副本線、駅舎の位置（橋上・地上・高架下）。乗り入れる路線はすべて、実物の位置関係と番線の並びで再現します。",
    "- 路線の数を減らしたり、複数の路線を1本の線路にまとめたりしません。会社ごとにまとめず路線ごとに数え、線路を共用していない路線（並行する複々線の別の路線など）はそれぞれ別の線路にします。各路線の線路の本数（単線・複線）とホームの番線数も実物どおりにします。",
    "- 沿線の主な構造物・名所は、実際の順序と線路の左右に合わせて置き、大きさは1/150の実寸を目安にします（ボードに収まらない物だけ縮めます）。",
    "- features は実物の特徴を6〜8項目書きます。確かでない所は推測と断り、作り話はしません。",
    "- description には、実物と違う所（縮めた所・省いた所・推測した所）をはっきり書きます。",
  ].join("\n"),
};

/** 再現モードで、利用者の入力からAIに渡す要望の文 */
export function replicaRequest(target: ReplicaTarget, extra: string): string {
  const what =
    target.kind === "line"
      ? `路線「${target.name}」の特徴（線路の形・高架やトンネル・カーブ）と沿線の有名なストラクチャーを再現したレイアウト`
      : `駅「${target.name}」の駅舎とホームの特徴（ホームの形・番線数・駅舎）を再現したレイアウト。複数の路線が乗り入れる駅なら、乗り入れる路線をそれぞれ再現する`;
  const base = extra.trim() ? `${what}。追加の要望: ${extra.trim()}` : what;
  return `${base}\n${LEVEL_GUIDE[target.level ?? "standard"]}`;
}
