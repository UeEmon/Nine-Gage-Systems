import { z } from "zod";
import { worldSamples, type Board, type Piece } from "./geometry";
import { sanitizeSchema } from "./llm/json";
import { addUsage, emptyUsage, type ChatSession, type SessionOptions, type TokenUsage } from "./llm/types";
import { MAKER_INFO, partsFor, type Maker } from "./parts";
import { evaluatePlan, planSchemaFor, type BuildResult, type LayoutPlan } from "./plan";
import { usageOf } from "./bom";
import { getPart } from "./parts";
import { shortfall, stockKeyName, stockKeyOf, stockLabel, unitPriceOf } from "./productDb";
import { isPierKey, levelOf, type Elevation } from "./elevation";
import { PIER_SYSTEMS } from "../data/piers";
import { accessoriesFor, isAccessoryKey, type Accessory } from "./accessories";
import type { AccessoryMount } from "../data/accessories";
import { lineKey, REPLICA_LEVEL_LABELS, replicaGuide, replicaRequest, type ReplicaInfo, type ReplicaTarget, type SimObject } from "./replica";

const MOUNT_PROMPT: Record<AccessoryMount, string> = {
  onTrack: "線路の上",
  beside: "線路の横",
  over: "線路をまたぐ",
  free: "線路から離して置く",
};

const MAX_ATTEMPTS = 4;

function catalogText(maker: Maker): string {
  return partsFor(maker)
    .map((p) => {
      const ends = p.joints
        .map((j, i) => `j${i}=(${j.x.toFixed(1)}, ${j.y.toFixed(1)}, 外向き${j.deg.toFixed(1)}°)`)
        .join(" ");
      const lr = p.handed ? "左右あり" : "左右なし";
      const extra = [p.elevatedProducts ? "高架用の品番あり" : "", p.rampEnds ? "" : "勾配不可"].filter(Boolean).join("・");
      return `- ${p.id}: ${p.description}（${lr}${extra ? `・${extra}` : ""}）${p.jointHelp ? `。${p.jointHelp}` : ""}。L向きのローカル座標: ${ends}`;
    })
    .join("\n");
}

type PlanPiece = LayoutPlan["segments"][number]["pieces"][number];
const pc = (part: string, dir: "L" | "R" = "L", enter = 0, exit = 1, height: number | null = 0): PlanPiece => ({
  part,
  dir,
  enter,
  exit,
  height,
});

/** メーカーごとの例と設計のコツ（例はテストで閉じることを確認済み） */
const MAKER_GUIDE: Record<Maker, { example: LayoutPlan; tips: string; overpass?: LayoutPlan }> = {
  kato: {
    example: {
      title: "待避線付きエンドレス",
      description: "R249の楕円に、外側へ6番ポイントで待避線を1本付けた例",
      start: { x: 300, y: 120, heading: 0 },
      segments: [
        {
          from: null,
          pieces: [
            pc("TO6", "L"), pc("S248"), pc("S124"), pc("TO6", "R", 1, 0),
            ...Array(4).fill(pc("R249-45", "R")),
            pc("S186"), pc("S248"), pc("S186"), pc("S124"),
            ...Array(4).fill(pc("R249-45", "R")),
          ],
        },
        { from: { segment: 0, piece: 0, joint: 2 }, pieces: [pc("R718-15", "R"), pc("R718-15", "R")] },
      ],
    },
    tips: `- 6番ポイント(TO6)の分岐の後に逆向きのR718-15を1本置くと、本線と平行（中心間隔約49mm）に戻ります。待避線の両端をこの形にすると、本線側には直線を約372mm（S248+S124）入れると長さが合います。
- R249の楕円は線路中心で高さ約498mm。`,
  },
  tomix: {
    example: {
      title: "待避線付きエンドレス",
      description: "C280の楕円に、外側へPL541-15ポイントで待避線を1本付けた例",
      start: { x: 330, y: 120, heading: 0 },
      segments: [
        {
          from: null,
          pieces: [
            pc("PL541-15", "L"), pc("S280"), pc("PL541-15", "R", 1, 0),
            ...Array(4).fill(pc("C280-45", "R")),
            pc("S280"), pc("S280"),
            ...Array(4).fill(pc("C280-45", "R")),
          ],
        },
        { from: { segment: 0, piece: 0, joint: 2 }, pieces: [pc("C541-15", "R"), pc("C541-15", "R")] },
      ],
    },
    overpass: (() => {
      // 8の字の立体交差。対角線の長さ（中心の直線S280＋両側のS140）が 2×R(280) と同じなので閉じる
      const lobe = (d: "L" | "R") => [pc("S140", d, 0, 1, null), ...Array(6).fill(pc("C280-45", d, 0, 1, null)), pc("S140", d, 0, 1, null)];
      return {
        title: "8の字の立体交差",
        description: "C280の輪を2つつないだ8の字で、中央は高架(55mm)が地上の線路をまたぐ。両側の輪が勾配区間（約3.4%）",
        start: { x: 701, y: 499, heading: -45 },
        segments: [{ from: null, pieces: [pc("S280", "L", 0, 1, 55), ...lobe("R"), pc("S280", "L", 0, 1, 0), ...lobe("L")] }],
      };
    })(),
    tips: `- ポイントPL541-15の分岐の後に逆向きのC541-15を1本置くと、本線と平行（中心間隔約37mm）に戻ります。待避線の両端をこの形にすると、本線側には直線を約280mm（S280）入れると長さが合います。
- C280の楕円は線路中心で高さ約560mm。`,
  },
};

/** 高架・立体交差の説明（メーカーごとの規格） */
function elevationGuide(maker: Maker): string {
  const sys = PIER_SYSTEMS[maker];
  const minRamp = Math.ceil((sys.standardHeight / sys.maxGradePct) * 100);
  return `## 高さ（高架・立体交差・地下）
- 各部品の height は線路面の高さ(mm)で、0=地上です。高架の標準は ${sys.standardHeight}mm（${sys.note}）。高架の部品はすべて同じ height にそろえます。
- 地下の線路は height をマイナスにします。地下の標準は -${sys.clearance}mm（上を地上の線路が立体交差で通れる深さ）。地下の部品はすべて同じ height にそろえ、橋脚は立ちません。地上から地下へ入る所（トンネルの坑口）は、高架と同じく勾配区間（height=null）で下ります。0mmから-${sys.clearance}mmへ下るにも、勾配区間が${Math.ceil((sys.clearance / sys.maxGradePct) * 100)}mm以上必要です。
- 地下にするのは実際に地下を通る区間だけにします。駅の前後だけが地下の路線は、地下区間の両端に勾配区間を入れて地上へ出し、エンドレスの残りは地上にします。地上の線路と立体交差する所は、地下（または高架）の区間の中に入れます。
- height=null の部品は勾配区間です。前後の高さの決まった部品の間を、長さに比例して自動で上り下りします。勾配にできるのは直線・曲線・複線・鉄橋だけで、ポイント・交差・車止めは平らな高さ（数値）にします。
- 勾配は${sys.maxGradePct}%以内（${sys.gradeRunMm}mm進むごとに${sys.gradeStepMm}mmが目安）。0mmから${sys.standardHeight}mmへ上るには、勾配区間（height=null の部品の長さの合計）が${minRamp}mm以上必要です。
- 高さの違う部品を直接つなぐと段差になります。高さを変えるところには必ず勾配区間を入れます。
- 線路どうしを高さの差${sys.clearance}mm以上で交差させると立体交差になり、平面で重なっていてもかまいません。差が足りないと重なりとして指摘されます。
- 高架の線路はジョイントごとに橋脚が立ちます。下の線路の真上に上の線路のジョイントが来ないようにしてください（橋脚が下の線路に当たる）。
- 鉄橋の部品は、高架の途中や立体交差で上を通る線路に使えます。
- 高さのある線路は高架用の品番（${maker === "kato" ? "高架線路" : "高架橋付PCレール"}）と橋脚の費用がかかります。高架用の品番がない部品（ポイントなど）を高架に置くと、台の自作が必要になるので避けてください。`;
}

export function systemPrompt(maker: Maker, replica = false): string {
  const base = basePrompt(maker);
  return replica ? `${base}\n\n${replicaGuide()}` : base;
}

function basePrompt(maker: Maker): string {
  const info = MAKER_INFO[maker];
  const guide = MAKER_GUIDE[maker];
  const bumper = partsFor(maker).find((p) => p.bumper)!.id;
  return `あなたはNゲージ鉄道模型（軌間9mm）のレイアウト設計の専門家です。
利用者の要望とボードの大きさから、${info.label}の${info.system}だけを使って、実際に組めて楽しく運転できる線路配置を設計します。

## 出力形式
座標ではなく「線路部品の並び」を出力します。位置はアプリが計算し、つながっていない端・ずれ・はみ出し・重なりがあれば指摘を返すので、そのときは直した計画全体を出し直してください。

- start: 区間0の最初の部品をつなぐ位置(mm)と進行方向(度)。
- segments: 区間の配列。区間0は from=null で start から始まり、部品を順に前の部品の出口へつなぎます。
- 区間1以降は from で既存の部品のジョイント（主にポイントの分岐側 j2）から伸ばします。from が指す区間は自分より前の番号にしてください。
- ほかの線路とつながらない別の線路（別の路線のエンドレスなど）は、from=null にして、その区間の start に始める位置と向きを入れます。
- 各部品: part=部品ID, dir=L/R, enter=前の部品につなぐジョイント, exit=次へ進むジョイント, height=線路面の高さ(mm。0=地上、null=勾配)。

## 座標と向き
- ボードの左上が(0,0)。xは右、yは下が正。単位はmm。
- 角度は +x(右) が0°、画面上で時計回りが正。90°=下、-90°=上、180°=左。
- dir=L は進行方向に向かって左へ曲がる（角度が減る）、dir=R は右へ曲がる（角度が増える）。dir=R は部品を鏡像にして置くことなので、複線部品を dir=R にすると左側の線路が右側に来ます（周回の内側に2本目を置くときは、曲線と同じ dir にそろえる）。左右なしの部品は L/R どちらでも同じ品番です。
- 曲線・直線は常に enter=0, exit=1。曲がる向きは dir だけで決めます。
- ポイントは j0=トング側, j1=直進側, j2=分岐側（部品ごとのジョイントの意味はカタログを参照）。複線部品は j0→j1 が右側の線路、j2→j3 が左側の線路。
  - 分かれる向きに通るとき: enter=0, exit=1(直進) または 2(分岐)。dir は分岐側が進行方向の左右どちらに出るか。
  - 合流する向きに通るとき: enter=1(直進側から入る) または 2(分岐側から入る), exit=0。dir は j0 から見たときの分岐の左右で、進行方向から見ると逆になる点に注意。
- 行き止まりの線路は最後に車止め ${bumper} を置きます（exit は 0）。
- すべての端はどこかにつながるか、車止めで終わる必要があります。

${elevationGuide(maker)}

## 部品カタログ（${info.label} ${info.system}。この一覧にない部品は使えません）
ローカル座標は j0 を原点・進行方向を+xとしたときの各ジョイントの位置と外向きの角度です（L向き。R向きは y と角度の符号が逆）。
${catalogText(maker)}

## 設計のコツ
- 同じ半径の45°曲線を8本で円になります。楕円は上下に直線を同じ長さずつ入れると閉じます。
- 円の直径はおよそ 2×R。ボード端から線路中心まで25mm以上空けるとはみ出しません。
${guide.tips}
- 平行な複線は中心間隔${info.trackSpacing}mmが${info.label}の標準です（重なり判定は22mm未満）。
- 平面で線路を交差させるときは、交差・ダブルスリップ部品を使ってください（同じ高さで部品同士を重ねるのは不可）。立体交差は下の「高さ」を参照。
- ボードからはみ出さないこと。曲線の外側にも余裕を取ること。

## 例（ボード1400×800mm）
${JSON.stringify(guide.example)}
${guide.overpass ? `\n## 立体交差の例（ボード1600×800mm）\n${JSON.stringify(guide.overpass)}\n` : ""}
${accessoryGuide(maker)}

description には、どんな運転ができるか（周回、待避、行き違い、入換など）と工夫した点を日本語で2〜4文で書いてください。`;
}

/** 線路以外のパーツ（踏切・信号機・ホーム・駅舎・建物）の一覧と置き方 */
function accessoryGuide(maker: Maker): string {
  const list = accessoriesFor(maker)
    .map((a) => `- ${a.id}: ${a.name}（${a.code}）。${a.description}。長さ${a.length}mm×幅${a.width}mm・${MOUNT_PROMPT[a.mount]}`)
    .join("\n");
  return `## 線路以外のパーツ（accessories）
要望に駅・ホーム・踏切・信号機・建物などがあれば、accessories に置きます。なければ空の配列にします。
- 各パーツ: item=パーツID, segment と piece=置く線路の部品（その部品の中央に置く）, side=進行方向に向かって線路の左(L)か右(R)か。
- ホームは長さ（下の一覧）以上の直線が続く所に置きます。ホームのある区間は曲線やポイントを避けます。部品の中央に置くので、長いホームは直線の並びのまんなかの部品を指定します。
- 島式ホームは、平行な2本の線路の間に置きます。2本の線路の中心の間隔を「島式ホームの幅＋約22mm」にし、内側の線路の部品を指定して side を外側の線路のある側にします。
- 対向式ホームは線路の外側（周回の外側）に置きます。駅舎・建物はホームや線路から離れた外側に置きます。
- 踏切・信号機は直線の上に置きます。「〜の代わり」と書いてあるパーツは、その部品IDの直線を置いた所に指定します。
${list}`;
}

export function exampleFor(maker: Maker): LayoutPlan {
  return MAKER_GUIDE[maker].example;
}

/** 立体交差の例（ある会社のみ） */
export function overpassExampleFor(maker: Maker): LayoutPlan | undefined {
  return MAKER_GUIDE[maker].overpass;
}

export type ProposeInput = {
  board: Board;
  request: string;
  maker?: Maker;
  /**
   * 所有パーツ（在庫キーごとの本数）。
   * mode="owned" ならこの本数を超えて使えない。mode="expand" なら活用を促すだけで、足りない分は買ってよい。
   */
  stock?: { counts: Map<string, number>; mode: "free" | "owned" | "expand" };
  /** パターンごとの方向づけ（複数案を出すとき） */
  hint?: string;
  /**
   * 追加で買う部品の合計（メーカー希望小売価格・税込）の上限（円）。
   * 所有パーツ（stock）がある分は費用に数えない。未指定なら制限なし。
   */
  budgetJpy?: number;
  /** 「再現してみた」: 再現する実在の路線・駅 */
  replica?: ReplicaTarget;
  /**
   * true ならボードの大きさを制限しない（再現度「忠実」）。
   * はみ出しを問題にせず、できたレイアウトに合わせてボードの大きさを決め直して返す。
   */
  unboundedBoard?: boolean;
  /**
   * この時刻（Date.now() の値）までに返す。出し直しの前に、前回と同じくらいかかると
   * 間に合わないなら、出し直さずにそれまでの一番よい案を返す（サーバーやブラウザの時間切れを防ぐ）。
   */
  deadline?: number;
};

const yenText = (n: number) => `${n.toLocaleString("ja-JP")}円`;

/** 予算を指定したときにAIへ渡す、部品1本あたりの価格表 */
function priceText(maker: Maker): string {
  const lines: string[] = [];
  for (const part of partsFor(maker)) {
    const keys = part.productsRight ? [stockKeyOf(part, false), stockKeyOf(part, true)] : [stockKeyOf(part, false)];
    const prices = keys.map((k) => unitPriceOf(k));
    if (prices.every((p) => p === null)) continue;
    const p = prices.find((x) => x !== null)!;
    const v = part.elevatedProducts ? unitPriceOf(stockKeyOf(part, false, true)) : null;
    lines.push(`- ${part.id}: 約${yenText(p)}/本${v !== null ? `（高架用 約${yenText(v)}/本）` : ""}`);
  }
  const pier = unitPriceOf(`${maker}:pier:S:${PIER_SYSTEMS[maker].standardHeight}`);
  if (pier !== null) lines.push(`- 橋脚（高架の線路1本あたり約1本）: 約${yenText(pier)}/本。勾配用の橋脚はセットで買う`);
  return lines.join("\n");
}

/** 予算の検査に使う、追加購入の合計金額 */
function extraCost(pieces: Parameters<typeof usageOf>[0], accessories: Accessory[], input: ProposeInput): ReturnType<typeof shortfall> {
  return shortfall(usageOf(pieces, accessories), input.stock?.counts ?? new Map());
}

function overBudget(pieces: Parameters<typeof usageOf>[0], accessories: Accessory[], input: ProposeInput): string | null {
  if (input.budgetJpy === undefined) return null;
  const sf = extraCost(pieces, accessories, input);
  if (sf.totalCostJpy <= input.budgetJpy) return null;
  const top = sf.rows
    .filter((r) => r.costJpy)
    .sort((a, b) => (b.costJpy ?? 0) - (a.costJpy ?? 0))
    .slice(0, 3)
    .map((r) => `${stockName(r.stockKey)} ${r.missing}本(${yenText(r.costJpy ?? 0)})`)
    .join("、");
  return `予算超過: 追加で買う部品が${yenText(sf.totalCostJpy)}で、上限${yenText(input.budgetJpy)}を${yenText(sf.totalCostJpy - input.budgetJpy)}超えている。費用の大きい部品: ${top}。部品を減らすか安い部品に替えて、上限内に収める`;
}

/** AIに見せる部品名（左右で品番が違う部品は dir も書く） */
function stockName(stockKey: string): string {
  if (isPierKey(stockKey) || isAccessoryKey(stockKey)) return stockKeyName(stockKey);
  const { partKey, right, elevated } = stockLabel(stockKey);
  const part = getPart(partKey);
  if (elevated) return `${part.id}（高架用。height>0 で置いたとき）`;
  if (part.productsRight) return `${part.id} dir=${right ? "R" : "L"}`;
  return part.handed ? `${part.id}（dir=L/Rどちらでも）` : part.id;
}

function stockText(counts: Map<string, number>): string {
  const lines = [...counts.entries()].filter(([, n]) => n > 0).map(([k, n]) => `- ${stockName(k)}: ${n}本`);
  return lines.length ? lines.join("\n") : "（なし）";
}

/** 所有数を超えて使っている部品（mode="owned" のときの検査） */
export function overStock(pieces: Parameters<typeof usageOf>[0], counts: Map<string, number>, accessories: Accessory[] = []): string[] {
  const out: string[] = [];
  for (const [k, used] of usageOf(pieces, accessories)) {
    const have = counts.get(k) ?? 0;
    if (used > have) out.push(`部品不足: ${stockName(k)} を${used}本使っているが、所有は${have}本。所有している部品だけで組み直す`);
  }
  return out;
}

export type ProposeResult = {
  plan: LayoutPlan;
  pieces: ReturnType<typeof evaluatePlan>["build"]["pieces"];
  accessories: Accessory[];
  /** シミュレーション上だけの仮オブジェクト（「再現してみた」のとき。製品ではない） */
  sims: SimObject[];
  /** 再現の内容（「再現してみた」のとき） */
  replica: ReplicaInfo | null;
  /** ボードの大きさを制限しなかったとき、できたレイアウトに合わせたボード（線路などはこの中に移してある） */
  board?: Board;
  attempts: number;
  remainingProblems: string | null;
  model: string;
  /** この案を作るのに使ったトークン（全試行の合計） */
  usage: TokenUsage;
};

function checkPlan(plan: LayoutPlan, input: ProposeInput, maker: Maker) {
  const result = evaluatePlan(plan, input.unboundedBoard ? UNBOUNDED_BOARD : input.board, maker);
  const over = input.stock?.mode === "owned" ? overStock(result.build.pieces, input.stock.counts, result.build.accessories) : [];
  if (input.replica) over.push(...lineProblems(plan, input.replica), ...undergroundProblems(plan, result.build, result.analysis.elevation));
  const budget = overBudget(result.build.pieces, result.build.accessories, input);
  if (budget) over.push(budget);
  if (!over.length) return result;
  const problems = [result.problems, ...over].filter(Boolean).join("\n");
  return { ...result, problems };
}

export class ProposeError extends Error {
  constructor(
    message: string,
    /** 失敗するまでに使ったトークン（集計用） */
    public readonly usage?: TokenUsage,
  ) {
    super(message);
  }
}

const sessionOptionsCache = new Map<string, SessionOptions>();

/**
 * 各プロバイダに渡すシステムプロンプトと出力スキーマ。
 * メーカーごとに常に同じ内容（プロンプトキャッシュが効くよう、日時や利用者ごとの値は入れない）。
 */
export function sessionOptions(maker: Maker = "kato", replica = false): SessionOptions {
  const key = `${maker}:${replica ? "replica" : "plan"}`;
  let opts = sessionOptionsCache.get(key);
  if (!opts) {
    const schema = planSchemaFor(maker, replica);
    opts = {
      system: systemPrompt(maker, replica),
      zodSchema: schema,
      jsonSchema: sanitizeSchema(z.toJSONSchema(schema)) as Record<string, unknown>,
      schemaName: "layout_plan",
    };
    sessionOptionsCache.set(key, opts);
  }
  return opts;
}

/**
 * AIに部品の並びを出させ、アプリで組み立てて検査し、問題があればその内容を返して直させる。
 * どのプロバイダでも同じ流れで、会話の保持はセッション側が行う。
 */
export async function proposeLayout(
  input: ProposeInput,
  session: ChatSession,
  model: string,
): Promise<ProposeResult> {
  const { board } = input;
  const maker = input.maker ?? "kato";
  const replica = input.replica;
  const request = replica ? replicaRequest(replica, input.request) : input.request;
  let prompt = `線路: ${MAKER_INFO[maker].label} ${MAKER_INFO[maker].system}
${
    input.unboundedBoard
      ? "ボードの大きさ: 制限なし（実物の配置を優先し、必要なだけ広く使ってよい。座標が負になってもかまわない）"
      : `ボードの大きさ: 幅${board.width}mm × 奥行${board.height}mm`
  }
要望: ${request.trim() || "ボードに収まる、楽しく運転できるレイアウト"}`;
  if (replica) {
    prompt += `\n再現モード: ${replica.kind === "line" ? "路線" : "駅"}「${replica.name}」、再現度「${REPLICA_LEVEL_LABELS[replica.level ?? "standard"]}」。replica を必ず出力してください。`;
  }
  if (input.hint) prompt += `\n今回の案の方向: ${input.hint}`;
  if (input.stock?.mode === "owned") {
    prompt += `\n\n## 使える部品（利用者の所有パーツ）\nこの本数を超えて使わないでください。全部使う必要はありません。端は車止めで終えてもかまいませんが、車止めも所有数の範囲で使います。\n${stockText(input.stock.counts)}`;
  } else if (input.stock?.mode === "expand") {
    prompt += `\n\n## 利用者の所有パーツ\n今あるレイアウトを広げる案です。これらをできるだけ活かし、足りない部品は追加で購入する前提で設計してください。description には何を買い足すと何ができるようになるかも書いてください。\n${stockText(input.stock.counts)}`;
  }
  if (input.stock?.mode === "free" && input.budgetJpy !== undefined && input.stock.counts.size) {
    prompt += `\n\n## 利用者の所有パーツ（使っても費用に数えない）\n${stockText(input.stock.counts)}`;
  }
  if (input.budgetJpy !== undefined) {
    const owned = input.stock?.counts.size ? "所有パーツの分は費用に数えません。" : "";
    prompt += `\n\n## 予算\n追加で買う部品の合計（メーカー希望小売価格・税込）を${yenText(input.budgetJpy)}以内にしてください。${owned}部品は箱単位で買うため、実際の費用は下の1本あたりの価格より少し高くなることがあります。余裕を持たせてください。\n${priceText(maker)}`;
  }

  let best: { plan: LayoutPlan; result: ReturnType<typeof checkPlan>; score: number } | null = null;
  let attempts = 0;
  let lastText = "";
  let lastTruncated = false;
  let usage = emptyUsage();
  /** 直前のAIの応答にかかった時間(ms) */
  let lastDuration = 0;

  let timedOut = false;
  for (; attempts < MAX_ATTEMPTS; ) {
    if (attempts > 0 && input.deadline !== undefined && Date.now() + lastDuration > input.deadline) {
      timedOut = true;
      break;
    }
    attempts++;
    const askStarted = Date.now();
    const answer = await session.ask(prompt);
    lastDuration = Date.now() - askStarted;
    usage = addUsage(usage, answer.usage);
    lastText = answer.text;
    lastTruncated = !!answer.truncated;
    if (answer.refused) {
      throw new ProposeError("AIがこの依頼への回答を控えました。要望の書き方を変えてお試しください。", usage);
    }

    const parsed = planSchemaFor(maker, !!replica).safeParse(answer.json);
    if (!parsed.success) {
      prompt = answer.truncated
        ? "出力が長すぎて途中で切れました。部品の並びを簡潔にして、計画全体をJSONで出し直してください。"
        : `出力が指定のJSON形式に合いませんでした。形式を守って計画全体を出し直してください。\n${z.prettifyError(
            parsed.error,
          ).slice(0, 1500)}`;
      continue;
    }

    const plan = parsed.data as LayoutPlan;
    const result = checkPlan(plan, input, maker);
    const score = result.problems ? result.problems.split("\n").length : 0;
    if (!best || score < best.score) best = { plan, result, score };
    if (!result.problems) break;
    prompt = `アプリで組み立てたところ、次の問題がありました。直した計画全体を出し直してください。\n${result.problems}`;
  }

  if (!best && timedOut) {
    throw new ProposeError(
      lastTruncated
        ? "AIの出力が長すぎて途中で切れ、時間内に作り直せませんでした。範囲を絞る（要望に「○○駅の構内だけ」などと書く）か、再現度を下げてお試しください。"
        : "時間内に作れませんでした。出す案の数を減らすか、再現度を下げる・要望を小さくしてお試しください。",
      usage,
    );
  }
  if (!best) {
    throw new ProposeError(
      `AIの出力をレイアウトとして読み取れませんでした（${model}）。より大きなモデルを選ぶと改善することがあります。${
        lastText ? `\n出力の先頭: ${lastText.slice(0, 200)}` : ""
      }`,
      usage,
    );
  }
  const fitted = input.unboundedBoard
    ? fitBoard(best.result.build.pieces, best.result.build.accessories, best.result.build.sims)
    : { pieces: best.result.build.pieces, accessories: best.result.build.accessories, sims: best.result.build.sims };
  return {
    plan: best.plan,
    pieces: fitted.pieces,
    accessories: fitted.accessories,
    sims: fitted.sims,
    ...("board" in fitted ? { board: fitted.board } : {}),
    replica:
      replica && best.plan.replica
        ? {
            kind: replica.kind,
            level: replica.level ?? "standard",
            target: best.plan.replica.target.trim() || replica.name,
            features: best.plan.replica.features.map((f) => f.trim()).filter(Boolean).slice(0, 10),
            ...(replica.kind === "station" && best.plan.replica.lines?.length
              ? { lines: best.plan.replica.lines.map((l) => l.trim().slice(0, 40)).filter(Boolean).slice(0, 12) }
              : {}),
          }
        : null,
    attempts,
    remainingProblems: best.result.problems,
    model,
    usage,
  };
}

/** ボードの大きさを制限しないときに、組み立てと検証に使うボード */
const UNBOUNDED_BOARD: Board = { width: Number.POSITIVE_INFINITY, height: Number.POSITIVE_INFINITY };
/** できたレイアウトのまわりに空けるボードの余白(mm) */
export const FIT_MARGIN_MM = 100;

/**
 * 線路・パーツ・仮オブジェクトがちょうど収まるボードを決め、全体をその中へ移す。
 * 大きさは 10mm 単位に切り上げる。
 */
export function fitBoard(pieces: Piece[], accessories: Accessory[], sims: SimObject[]) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const add = (x: number, y: number, r = 0) => {
    minX = Math.min(minX, x - r);
    minY = Math.min(minY, y - r);
    maxX = Math.max(maxX, x + r);
    maxY = Math.max(maxY, y + r);
  };
  for (const p of pieces) for (const pt of worldSamples(p)) add(pt.x, pt.y);
  for (const a of accessories) add(a.x, a.y, 20);
  for (const s of sims) add(s.x, s.y, Math.hypot(s.length, s.width) / 2);
  if (!Number.isFinite(minX)) return { pieces, accessories, sims, board: { width: 1200, height: 600 } };
  const dx = FIT_MARGIN_MM - minX;
  const dy = FIT_MARGIN_MM - minY;
  const shift = <T extends { x: number; y: number }>(o: T): T => ({ ...o, x: o.x + dx, y: o.y + dy });
  const round10 = (v: number) => Math.ceil(v / 10) * 10;
  return {
    pieces: pieces.map(shift),
    accessories: accessories.map(shift),
    sims: sims.map(shift),
    board: { width: round10(maxX - minX + FIT_MARGIN_MM * 2), height: round10(maxY - minY + FIT_MARGIN_MM * 2) },
  };
}

/**
 * 「再現してみた」の駅で、乗り入れる路線をまとめずに、路線ごとに線路を分けたかを確かめる。
 * replica.lines の路線それぞれに、その路線の区間（segments[].line）があること。
 */
export function lineProblems(plan: LayoutPlan, target: ReplicaTarget): string[] {
  if (target.kind !== "station") return [];
  const lines = (plan.replica?.lines ?? []).map((l) => l.trim()).filter(Boolean);
  const level = target.level ?? "standard";
  if (!lines.length) {
    return level === "faithful"
      ? ["乗り入れ路線: replica.lines に、この駅に乗り入れる路線をすべて書いてください（1路線だけの駅なら、その1路線）"]
      : [];
  }
  const labelled = new Set(plan.segments.map((s) => lineKey(s.line ?? "")).filter(Boolean));
  const missing = lines.filter((l) => !labelled.has(lineKey(l)));
  const problems: string[] = [];
  if (missing.length) {
    problems.push(
      `乗り入れ路線: ${missing.join("、")} の線路がありません。路線をまとめずに、路線ごとに別の線路（区間）を置き、各区間の line にその路線名を入れてください`,
    );
  }
  if (level === "faithful") {
    const keys = new Set(lines.map(lineKey));
    const extra = [...labelled].filter((k) => !keys.has(k));
    if (extra.length) {
      problems.push(`乗り入れ路線: 区間の line（${extra.join("、")}）が replica.lines にありません。名前をそろえてください`);
    }
  }
  return problems;
}

/**
 * 「再現してみた」で、路線全体を地下にしていないかを確かめる。
 * 一部だけが地下の路線をエンドレスごと地下にすると、地上との出入り（坑口）と立体交差が再現されない。
 * 全線が地下の路線（地下鉄など）は replica.undergroundLines に書いてあればよい。
 */
export function undergroundProblems(plan: LayoutPlan, build: BuildResult, elevation: Elevation): string[] {
  if (!plan.replica) return [];
  const declared = new Set((plan.replica.undergroundLines ?? []).map(lineKey));
  const byLine = new Map<string, { name: string; pieces: Piece[] }>();
  for (const p of build.pieces) {
    if (!p.line) continue;
    const k = lineKey(p.line);
    const g = byLine.get(k) ?? { name: p.line, pieces: [] };
    g.pieces.push(p);
    byLine.set(k, g);
  }
  const problems: string[] = [];
  for (const [k, g] of byLine) {
    if (declared.has(k)) continue;
    if (!g.pieces.every((p) => levelOf(p, elevation) === "underground")) continue;
    problems.push(
      `地下の路線: 「${g.name}」の線路がすべて地下です。実物で地下なのが駅の前後など一部の区間なら、その区間だけを地下にし、両端に勾配区間（height=null）を入れて地上に出してください。全線が地下で地上に出ない路線（地下鉄など）なら replica.undergroundLines にその路線名を書いてください`,
    );
  }
  return problems;
}
