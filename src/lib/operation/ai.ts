// AIに運行計画（ダイヤ）を提案させる。
//
// レイアウトの駅・番線・駅間の所要時間をアプリで計算してAIに渡し、AIには列車の一覧（停車駅・発車時刻など）だけを出させる。
// 出てきた計画をアプリで時刻計算・支障チェックし、問題があればその内容を返して直させる（レイアウト提案と同じ流れ）。

import { z } from "zod";
import type { Accessory } from "../accessories";
import { computeElevation } from "../elevation";
import { findConnections, type Piece } from "../geometry";
import { sanitizeSchema } from "../llm/json";
import { addUsage, emptyUsage, type ChatSession, type SessionOptions, type TokenUsage } from "../llm/types";
import { getPart } from "../parts";
import { routeSamples } from "../shapes";
import { LIMITS, newTrainId, TRAIN_KINDS, type OperationPlan, type Train, type TrainKind } from "./model";
import { carsFitting, fitCarsToPlatforms } from "./consist";
import { computeSchedule, type ScheduleResult } from "./schedule";
import { detectStations, type Station } from "./stations";
import { layoutLines, stationLines, trackLines, type LineSource } from "./lines";
import { canonicalLine } from "../replica";

const MAX_ATTEMPTS = 4;
const MAX_TRAINS = 12;
/** 所要時間の表を作るときの速度 */
const PROBE_KMH = 80;

const KIND_VALUES = TRAIN_KINDS.map((k) => k.value) as [TrainKind, ...TrainKind[]];

const AiStopSchema = z.object({
  station: z.string().describe("駅の記号（S1, S2 …）"),
  track: z.number().int().nullable().describe("番線（1始まり）。null はアプリにまかせる（行き違い・待避では番線を必ず指定する）"),
  pass: z.boolean().describe("true で通過（始発駅は false）"),
  dwellSec: z.number().int().describe("停車時間(秒)。通過なら0。始発駅は発車前に止まっている時間"),
  turnback: z.boolean().describe("true でこの駅で向きを変えて次の駅へ（行き止まりの線や、来た道を戻るとき）"),
});

const AiTrainSchema = z.object({
  name: z.string().describe("列車名（例: 101M、特急1号）"),
  line: z.string().default("").describe("走る路線の名前。「## 路線」の一覧があればその書き方で書く。一覧がなければ空文字"),
  kind: z.enum(KIND_VALUES).describe("種別。local=普通, rapid=快速, express=特急, freight=貨物, deadhead=回送"),
  cars: z.number().int().describe("両数（1〜16）。停車するすべての駅の番線のホームの長さを基準に、いちばん短いホームに収まる両数にする"),
  speedKmh: z.number().describe("縮尺の最高速度(km/h)。普通60〜90、特急100〜130、貨物50〜80くらい"),
  departSec: z.number().int().describe("始発駅を出る時刻（運転開始からの秒）"),
  laps: z.number().int().describe("停車駅の並びを何回くり返すか（エンドレスを周回する列車）。1=1回だけ"),
  stops: z.array(AiStopSchema).describe("始発駅から順に、立ち寄る駅（停車・通過）"),
});

export const OperationProposalSchema = z.object({
  summary: z.string().describe("運行計画の説明（どんな運転が楽しめるか、行き違い・待避の見どころ）。2〜4文"),
  trains: z.array(AiTrainSchema),
});
export type OperationProposal = z.input<typeof OperationProposalSchema>;

export function operationSystemPrompt(): string {
  return `あなたはNゲージ（1/150）の鉄道模型レイアウトの運行計画（ダイヤ）を考える専門家です。
利用者のレイアウトの駅・番線・駅間の所要時間が与えられるので、要望に合わせて、模型で運転して楽しい列車の運行計画を作ってください。

## 出力
- JSON で、summary（説明）と trains（列車の一覧）を出します。
- 列車ごとに、種別・両数・速度・始発駅を出る時刻（運転開始からの秒）・周回数・停車駅の並びを決めます。
- 駅は与えられた記号（S1, S2 …）で書きます。番線は各駅の番線の数の範囲で書きます。

## アプリの計算のしかた（これに合わせて計画する）
- 列車は停車駅の番線から次の駅の番線へ、線路のつながりをたどったいちばん短い経路で走ります。走る向きはそのままで、向きを変えるのは turnback=true の駅だけです。
- 時間は「距離 ÷ 最高速度」で計算します（加減速なし）。所要時間の表は ${PROBE_KMH}km/h のときの値なので、速度が違えば比例して変わります（120km/h なら 2/3 倍）。
- 終着駅に着いた列車は、その番線にずっと止まっているものとして扱います。後から来る列車がその番線を使うと支障になります。
- 2本の列車が同じ線路（ポイントを含む）を同じ時間に使うと「支障」になります。支障のない計画にしてください。

## よい運行計画
- 単線のエンドレスで列車を複数走らせるなら、2線以上ある駅で行き違い・待避をさせ、番線を指定して分けます。
- 速い列車（特急など）が遅い列車を追い越すなら、遅い列車を2線以上の駅の別の番線に止めて待たせ、その間に速い列車を通過させます。
- 同じ方向へ続けて走る列車は、前の列車が十分に離れてから出します（前の列車の駅間の所要時間以上あける）。
- 両数（編成の長さ）はホームの長さを基準に決めます。列車が停車する（通過しない）すべての駅の番線のうち、いちばん短いホームの「何両まで」を上限にし、ふつうはその上限いっぱいの両数にします（要望があればそれより短くしてもよい）。
- 長い編成を走らせたいときは、長いホームのある番線を指定して停車させ、短いホームの駅は通過にします。
- ホームからはみ出す両数にすると、アプリが自動でホームに収まる両数まで減らします。
- 列車の本数は、要望になければ駅や番線の数に合わせて2〜5本くらい、全体で数分〜10分くらいの運転にします。最大${MAX_TRAINS}本。
- 列車名は日本の鉄道らしく（例: 普通 101M・102M、特急「〇〇」1号）。

## 路線（実在の路線を再現したレイアウト）
- 「## 路線」の一覧があるときは、各列車の line にその列車が走る路線の名前を書きます。番線の後ろの［］がその番線の路線です。
- 列車は、その路線の番線に停車させます（直通運転でほかの路線の番線を使うときは、主に走る路線を line にします）。
- 複数の路線があるときは、路線ごとに列車を走らせ、summary にどの路線にどんな列車を走らせたかを書きます。
- 列車名もその路線らしくします（例: 山手線なら 普通 501G、東海道線なら 快速アクティー・普通 1520E）。鉄道会社のロゴ・商標は使いません。`;
}

let optsCache: SessionOptions | null = null;
export function operationSessionOptions(): SessionOptions {
  if (!optsCache) {
    optsCache = {
      system: operationSystemPrompt(),
      zodSchema: OperationProposalSchema,
      jsonSchema: sanitizeSchema(z.toJSONSchema(OperationProposalSchema)) as Record<string, unknown>,
      schemaName: "operation_plan",
    };
  }
  return optsCache;
}

/** 線路の長さ(mm, 部品の経路0の長さの合計) */
function trackLengthMm(pieces: Map<string, Piece>, uids: string[]): number {
  let total = 0;
  for (const uid of uids) {
    const p = pieces.get(uid);
    if (!p) continue;
    const pts = routeSamples(getPart(p.partId).routes[0], 5);
    for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  }
  return total;
}

const code = (i: number) => `S${i + 1}`;

function probeTrain(stops: { stationId: string; turnback?: boolean }[], laps = 1): Train {
  return {
    id: "probe",
    name: "probe",
    kind: "local",
    color: "#000000",
    cars: 1,
    speedKmh: PROBE_KMH,
    departSec: 0,
    laps,
    stops: stops.map((s) => ({ stationId: s.stationId, track: null, pass: false, dwellSec: 0, ...(s.turnback ? { turnback: true } : {}) })),
  };
}

/** AIに渡すレイアウトの説明（駅・番線・所要時間） */
export function describeLayout(
  pieces: Piece[],
  stations: Station[],
  stationNames: Record<string, string>,
  replica?: LineSource["replica"],
): string {
  const byUid = new Map(pieces.map((p) => [p.uid, p]));
  const name = (s: Station) => stationNames[s.id] || s.defaultName;
  const routeNames = layoutLines({ pieces, replica });
  const tl = trackLines(stations, { pieces, replica });
  const lines: string[] = [];
  if (routeNames.length) {
    lines.push("## 路線（実在の路線を再現したレイアウト。列車の line はこの書き方で）");
    for (const l of routeNames) {
      const at = stations.filter((s) => stationLines(s.id, tl).includes(l)).map((s) => `${code(stations.indexOf(s))} ${name(s)}`);
      lines.push(`- ${l}${at.length ? `（駅: ${at.join("、")}）` : ""}`);
    }
    lines.push("");
  }
  lines.push("## 駅と番線（ホームの長さと、そのホームに収まる両数）");
  stations.forEach((s, i) => {
    const tracks = s.tracks.map((t) => {
      const len = trackLengthMm(byUid, t.pieces);
      const line = tl.get(s.id)?.[t.number - 1];
      return `${t.number}番線${line ? `［${line}］` : ""}（ホーム約${Math.round(t.platformLength)}mm・${carsFitting(t.platformLength)}両まで／線路約${Math.round(len)}mm）`;
    });
    lines.push(`- ${code(i)} ${name(s)}: ${tracks.join("、")}`);
  });
  if (stations.length) {
    const fit = (s: Station) => Math.max(0, ...s.tracks.map((t) => carsFitting(t.platformLength)));
    const shortest = stations.reduce((a, b) => (fit(b) < fit(a) ? b : a));
    const n = fit(shortest);
    const where = `${code(stations.indexOf(shortest))} ${name(shortest)}`;
    lines.push(
      n > 0
        ? `- 全部の駅に停車する列車は${n}両まで（長いほうの番線を使っても、${where}のホームが${n}両まで）`
        : `- ${where}のホームは1両でもはみ出す短さ（停車させるなら1両）`,
    );
  }

  const time = (stops: { stationId: string; turnback?: boolean }[], laps = 1) => {
    const r = computeSchedule(pieces, stations, { stationNames: {}, trains: [probeTrain(stops, laps)] }).trains[0];
    if (r.errors.length) return null;
    const last = r.events[r.events.length - 1];
    return last.arr ?? last.dep;
  };
  lines.push("", `## 駅間の所要時間（${PROBE_KMH}km/h、秒。始発駅を出る向きはアプリが短いほうを選ぶ）`);
  for (let i = 0; i < stations.length; i++) {
    for (let j = 0; j < stations.length; j++) {
      if (i === j) continue;
      const t = time([{ stationId: stations[i].id }, { stationId: stations[j].id }]);
      lines.push(`- ${code(i)}→${code(j)}: ${t === null ? "行けない（向きを変える必要がある）" : `${Math.round(t)}秒`}`);
    }
  }
  lines.push("", "## 同じ駅に戻ってくるまで（向きを変えずに。エンドレスの1周）");
  stations.forEach((s, i) => {
    const t = time([{ stationId: s.id }, { stationId: s.id }]);
    lines.push(`- ${code(i)}: ${t === null ? "戻れない（行き止まりがある。折り返しが必要）" : `${Math.round(t)}秒`}`);
  });
  return lines.join("\n");
}

/** AIの出力を運行計画に。駅の記号を駅IDに直し、値を範囲内に収める */
export function toOperationPlan(
  p: OperationProposal,
  stations: Station[],
  stationNames: Record<string, string>,
  routeNames: string[] = [],
): { plan: OperationPlan; problems: string[] } {
  const problems: string[] = [];
  const clamp = (v: number, r: { min: number; max: number }) => Math.min(r.max, Math.max(r.min, Math.round(v)));
  const trains: Train[] = p.trains.slice(0, MAX_TRAINS).map((t, ti) => {
    const kind = TRAIN_KINDS.find((k) => k.value === t.kind) ?? TRAIN_KINDS[0];
    const stops = t.stops.flatMap((s, si) => {
      const m = s.station.trim().match(/^S(\d+)$/i);
      const st = m ? stations[Number(m[1]) - 1] : undefined;
      if (!st) {
        problems.push(`列車${ti + 1}（${t.name}）の${si + 1}番目の駅「${s.station}」はありません。S1〜${code(stations.length - 1)} で書く`);
        return [];
      }
      let track = s.track;
      if (track !== null && (track < 1 || track > st.tracks.length)) {
        problems.push(`列車${ti + 1}（${t.name}）: ${code(stations.indexOf(st))}に${track}番線はありません（${st.tracks.length}線）`);
        track = null;
      }
      return [{ stationId: st.id, track, pass: si === 0 ? false : s.pass, dwellSec: clamp(s.pass ? 0 : s.dwellSec, LIMITS.dwellSec), ...(s.turnback && !s.pass ? { turnback: true } : {}) }];
    });
    let line = routeNames.length ? canonicalLine(t.line, routeNames) : undefined;
    if (line && !routeNames.includes(line)) {
      problems.push(`列車${ti + 1}（${t.name}）: 路線「${line}」はありません。${routeNames.join("、")} から選ぶ`);
      line = undefined;
    }
    return {
      id: newTrainId(),
      name: t.name.slice(0, 40) || `${ti + 1}列車`,
      ...(line ? { line } : {}),
      kind: kind.value,
      color: kind.color,
      cars: clamp(t.cars, LIMITS.cars),
      speedKmh: clamp(t.speedKmh, LIMITS.speedKmh),
      departSec: clamp(t.departSec, LIMITS.departSec),
      laps: clamp(t.laps, LIMITS.laps),
      stops,
    };
  });
  if (p.trains.length > MAX_TRAINS) problems.push(`列車は${MAX_TRAINS}本までにする`);
  if (trains.length === 0) problems.push("列車が1本もない");
  return { plan: { stationNames: { ...stationNames }, trains }, problems };
}

/** アプリで時刻計算した結果の問題と、直すときの参考の時刻表（AIへのフィードバック用） */
export function scheduleProblems(plan: OperationPlan, result: ScheduleResult, stations: Station[]): { problems: string[]; reference: string[] } {
  const label = (id: string) => {
    const i = stations.findIndex((s) => s.id === id);
    return i < 0 ? "?" : code(i);
  };
  const trainLabel = (id: string) => {
    const i = plan.trains.findIndex((t) => t.id === id);
    return `列車${i + 1}（${plan.trains[i]?.name ?? ""}）`;
  };
  const out: string[] = [];
  for (const s of result.trains) {
    for (const e of s.errors) out.push(`${trainLabel(s.trainId)}: ${e}`);
    for (const w of s.warnings) out.push(`${trainLabel(s.trainId)}: ${w}。両数を減らすか、長い番線を使う`);
  }
  for (const c of result.conflicts.slice(0, 15)) {
    out.push(`支障: ${Math.round(c.time)}秒ごろ、${trainLabel(c.trainA)}と${trainLabel(c.trainB)}が「${c.location}」を同時に使う。発車時刻をずらすか、行き違い・待避の番線を分ける`);
  }
  // 時刻表の要約（AIが直しやすいように）
  const reference: string[] = [];
  if (out.length) {
    for (const s of result.trains) {
      const ev = s.events.map((e) => `${label(e.stationId)}${e.track}番線 ${e.pass ? `通過${Math.round(e.dep!)}` : `${e.arr === null ? "" : `着${Math.round(e.arr)}`}${e.dep === null ? "" : ` 発${Math.round(e.dep)}`}`}`);
      reference.push(`- ${trainLabel(s.trainId)}: ${ev.join(" → ")}`);
    }
  }
  return { problems: out, reference };
}

export type OperationProposeInput = {
  pieces: Piece[];
  accessories: Accessory[];
  stationNames: Record<string, string>;
  /** 「再現してみた」で再現した路線・駅（路線名を列車に反映する） */
  replica?: LineSource["replica"];
  request: string;
};

export type OperationProposeResult = {
  plan: OperationPlan;
  summary: string;
  attempts: number;
  remainingProblems: string | null;
  model: string;
  usage: TokenUsage;
};

export class OperationProposeError extends Error {
  constructor(
    message: string,
    public readonly usage?: TokenUsage,
  ) {
    super(message);
  }
}

export function stationsFor(pieces: Piece[], accessories: Accessory[]): Station[] {
  const elevation = computeElevation(pieces, findConnections(pieces).connections);
  return detectStations(pieces, accessories, elevation);
}

export async function proposeOperation(input: OperationProposeInput, session: ChatSession, model: string): Promise<OperationProposeResult> {
  const stations = stationsFor(input.pieces, input.accessories);
  if (stations.length === 0) throw new OperationProposeError("駅がありません。線路の横にホームを置いてから、もう一度お試しください。");

  const routeNames = layoutLines({ pieces: input.pieces, replica: input.replica });
  let prompt = `${describeLayout(input.pieces, stations, input.stationNames, input.replica)}

## 要望
${input.request.trim() || "このレイアウトで楽しく運転できる運行計画"}`;

  let best: { plan: OperationPlan; summary: string; problems: string[] } | null = null;
  let attempts = 0;
  let lastText = "";
  let usage = emptyUsage();
  for (; attempts < MAX_ATTEMPTS; ) {
    attempts++;
    const answer = await session.ask(prompt);
    usage = addUsage(usage, answer.usage);
    lastText = answer.text;
    if (answer.refused) throw new OperationProposeError("AIがこの依頼への回答を控えました。要望の書き方を変えてお試しください。", usage);
    const parsed = OperationProposalSchema.safeParse(answer.json);
    if (!parsed.success) {
      prompt = answer.truncated
        ? "出力が長すぎて途中で切れました。列車の数を減らして、計画全体をJSONで出し直してください。"
        : `出力が指定のJSON形式に合いませんでした。形式を守って計画全体を出し直してください。\n${z.prettifyError(parsed.error).slice(0, 1500)}`;
      continue;
    }
    const converted = toOperationPlan(parsed.data, stations, input.stationNames, routeNames);
    const problems = converted.problems;
    // 両数はホームの長さを基準にする：止まる駅のいちばん短いホームに収まるまで減らす
    let schedule = computeSchedule(input.pieces, stations, converted.plan);
    const fitted = fitCarsToPlatforms(converted.plan, schedule, stations);
    const plan = fitted.plan;
    if (fitted.changed.length) schedule = computeSchedule(input.pieces, stations, plan);
    const checked = scheduleProblems(plan, schedule, stations);
    const all = [...problems, ...checked.problems];
    if (!best || all.length < best.problems.length) best = { plan, summary: parsed.data.summary, problems: all };
    if (all.length === 0) break;
    prompt = `アプリで時刻を計算したところ、次の問題がありました。直した計画全体を出し直してください。\n${all.join("\n")}`;
    if (checked.reference.length) prompt += `\n\n参考: アプリで計算した時刻（秒）\n${checked.reference.join("\n")}`;
  }
  if (!best) {
    throw new OperationProposeError(
      `AIの出力を運行計画として読み取れませんでした（${model}）。より大きなモデルを選ぶと改善することがあります。${lastText ? `\n出力の先頭: ${lastText.slice(0, 200)}` : ""}`,
      usage,
    );
  }
  return {
    plan: best.plan,
    summary: best.summary,
    attempts,
    remainingProblems: best.problems.length ? best.problems.join("\n") : null,
    model,
    usage,
  };
}
