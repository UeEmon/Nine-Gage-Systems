import { z } from "zod";
import { proposeLayout, ProposeError, sessionOptions, type ProposeInput } from "@/lib/ai";
import { usageOf } from "@/lib/bom";
import { createSession, toLlmError, type ResolvedAiSettings } from "@/lib/llm";
import { emptyUsage } from "@/lib/llm/types";
import { logUsage, priced, usageLog, type NewUsage } from "@/lib/server/aiUsage";
import { cacheKey, proposeCache } from "@/lib/server/proposeCache";
import { requireUser } from "@/lib/server/auth";
import { settingsForUser, type KeySource } from "@/lib/server/ownAi";
import { MAKERS } from "@/lib/parts";
import { REPLICA_LEVELS, type ReplicaLevel } from "@/lib/replica";
import { shortfall, stockFromInventory } from "@/lib/productDb";

export const runtime = "nodejs";
export const maxDuration = 300;

const BodySchema = z.object({
  board: z.object({
    width: z.number().min(200).max(10000),
    height: z.number().min(200).max(10000),
  }),
  request: z.string().max(2000),
  maker: z.enum(MAKERS).default("kato"),
  /** free=自由に設計, owned=所有パーツだけで組む, expand=所有パーツを広げる拡張案, replica=実在の路線・駅を再現 */
  mode: z.enum(["free", "owned", "expand", "replica"]).default("free"),
  /** replica のときに再現する実在の路線名・駅名 */
  replica: z
    .object({
      kind: z.enum(["line", "station"]),
      name: z.string().trim().min(1).max(60),
      /** 再現度。light=雰囲気, standard=標準, faithful=忠実 */
      level: z.enum(REPLICA_LEVELS).default("standard"),
    })
    .optional(),
  /** 所有パーツ（"メーカー:品番" → 箱数） */
  inventory: z.record(z.string().max(40), z.number().int().min(0).max(999)).default({}),
  /** 出す案の数 */
  patterns: z.number().int().min(1).max(3).default(1),
  /** 追加で買う部品の合計金額の上限（円・税込）。自由・拡張案のみ。未指定なら制限なし */
  budgetJpy: z.number().int().min(0).max(10_000_000).optional(),
  /** true なら保存済みの結果を使わず、AIに作り直してもらう */
  fresh: z.boolean().default(false),
});

/** 2つ目以降の案を送る前に、1つ目の応答の開始（＝プロンプトキャッシュの書き込み）を待つ上限 */
const STAGGER_MAX_WAIT_MS = 60_000;

type ProposedValue = Awaited<ReturnType<typeof proposeLayout>> & {
  hint: string | null;
  shortfall: ReturnType<typeof shortfall>;
  budgetJpy: number | null;
};

const yen = (n: number) => `${n.toLocaleString("ja-JP")}円`;

/** 予算があるときの拡張案の方向づけ（規模を予算に合わせる） */
function expandHints(budget: number): string[] {
  return [
    `追加購入を少なめ（${yen(Math.round(budget * 0.3))}程度）に抑えた小さな拡張案`,
    `待避線や引き込み線を加える中くらいの拡張案（${yen(Math.round(budget * 0.6))}程度）`,
    `予算${yen(budget)}をいっぱいまで使って大きく発展させる案`,
  ];
}

/** 複数案を出すときの方向づけ */
const HINTS: Record<"free" | "owned" | "expand" | "replica", string[]> = {
  free: ["要望にいちばん素直な基本の案", "分岐や待避線を多めにして、運転の変化を楽しめる案", "線路の長さを長くとり、周回を楽しめる案"],
  owned: [
    "所有パーツで確実に組める、シンプルな周回の案",
    "所有しているポイントなどの分岐をできるだけ活かした案",
    "所有パーツをなるべく多く使った、変化のある案",
  ],
  expand: [
    "追加購入を少なめ（5,000円程度まで）に抑えた小さな拡張案",
    "待避線や引き込み線を加える中くらいの拡張案（1万5,000円程度まで）",
    "複線化や駅の拡張など、大きく発展させる案（3万円程度まで）",
  ],
  replica: [
    "いちばん目立つ特徴に絞って、ボードに素直に収めた案",
    "線路の形（複線・分岐・高架など）をできるだけ実物に近づけた案",
    "沿線や駅のまわりの建物・名所を多めに置いた、情景重視の案",
  ],
};

/** 再現度「雰囲気」「忠実」のときの複数案の方向づけ（標準は HINTS.replica） */
const REPLICA_LEVEL_HINTS: Record<Exclude<ReplicaLevel, "standard">, string[]> = {
  light: [
    "いちばん目立つ特徴1つを中心にした、小さくまとまる案",
    "特徴を2〜3個入れて、周回して楽しめる案",
    "線路はシンプルにして、名所の仮オブジェクトで雰囲気を出す案",
  ],
  faithful: [
    "線路の配置と駅の配線を、いちばん実物どおりにした案",
    "配線は実物どおりにしつつ、端をつないで周回運転もできるようにした案",
    "沿線の構造物・名所の並びと大きさまで実物に合わせた、情景重視の案",
  ],
};

/**
 * ログインした人だけ使える（ログインなしは使えない）。
 * 管理者・プレミアムユーザーは管理者が設定したAI、一般ユーザーは自分で設定したAPIキーを使う。
 * 画面からキーやURLは送れない。
 */
export async function POST(req: Request) {
  const g = await requireUser(req);
  if (!g.ok) return g.response;
  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: "入力が正しくありません（ボードは200〜10000mm、要望は2000文字まで、路線名・駅名は60文字まで）" },
      { status: 400 },
    );
  }
  const { board, request, maker, mode, inventory, patterns, fresh } = parsed.data;
  const replica = mode === "replica" ? parsed.data.replica : undefined;
  if (mode === "replica" && !replica) {
    return Response.json({ error: "再現する路線名か駅名を入力してください。" }, { status: 400 });
  }
  // 手持ちだけの案は買い足しがないので予算は使わない
  const budgetJpy = mode === "owned" ? undefined : parsed.data.budgetJpy;
  const counts = stockFromInventory(inventory, maker);
  if (mode === "owned" && counts.size === 0) {
    return Response.json({ error: "所有パーツが登録されていません。先に所有パーツを登録してください。" }, { status: 400 });
  }

  let settings: ResolvedAiSettings;
  let keySource: KeySource;
  try {
    ({ settings, keySource } = settingsForUser(g.data, g.user));
  } catch (err) {
    const e = toLlmError(err, undefined);
    return Response.json({ error: e.message }, { status: e.status });
  }

  const hintList =
    mode === "expand" && budgetJpy !== undefined
      ? expandHints(budgetJpy)
      : replica && replica.level !== "standard"
        ? REPLICA_LEVEL_HINTS[replica.level]
        : HINTS[mode];
  const hints = patterns > 1 ? hintList.slice(0, patterns) : [undefined];
  // 再現は部品の制限なし（自由に設計と同じ）。所有パーツは予算の計算にだけ使う
  const stockMode = mode === "replica" ? "free" : mode;
  const stock = stockMode === "free" && counts.size === 0 ? undefined : { counts, mode: stockMode };
  const opts = sessionOptions(maker, !!replica);

  // 同じ人・同じAI設定・同じ条件なら、前の結果をそのまま返す（AIを呼ばない）
  const keyFor = (hint: string | undefined) =>
    cacheKey({
      user: g.user.id,
      ai: { provider: settings.provider, model: settings.model, baseUrl: settings.baseUrl, keySource },
      prompt: opts.system,
      board,
      request: request.trim(),
      maker,
      mode,
      stock: stock?.counts,
      budgetJpy,
      replica,
      hint,
    });
  const tasks = hints.map((hint) => {
    const key = keyFor(hint);
    return { hint, key, cached: fresh ? undefined : (proposeCache.get(key) as ProposedValue | undefined) };
  });

  // Claude は応答が始まるまでキャッシュを読めないので、複数案のときは1つ目の応答が始まってから残りを送る
  const misses = tasks.filter((t) => !t.cached);
  const stagger = settings.provider === "anthropic" && misses.length > 1;
  let releaseRest: () => void = () => {};
  const firstStarted = new Promise<void>((resolve) => {
    releaseRest = resolve;
    if (stagger) setTimeout(resolve, STAGGER_MAX_WAIT_MS).unref?.();
  });

  const record = (r: Pick<NewUsage, "attempts" | "resultCached" | "ok" | "usage">) => {
    const rec = priced({
      userId: g.user.id,
      username: g.user.username,
      provider: settings.provider,
      model: settings.model,
      maker,
      feature: mode,
      keySource,
      ...r,
    });
    logUsage(rec);
    return usageLog.append(rec);
  };

  const runs = await Promise.allSettled(
    tasks.map(async (t) => {
      if (t.cached) {
        await record({ attempts: 0, resultCached: true, ok: true, usage: emptyUsage() });
        return { ...t.cached, cached: true };
      }
      const isFirst = t === misses[0];
      if (stagger && !isFirst) await firstStarted;
      const input: ProposeInput = { board, request, maker, hint: t.hint, stock, budgetJpy, replica };
      const session = createSession(settings, isFirst ? { ...opts, onResponseStart: releaseRest } : opts);
      try {
        const result = await proposeLayout(input, session, settings.model);
        const sf = shortfall(usageOf(result.pieces, result.accessories), counts);
        const overBudget = budgetJpy !== undefined && sf.totalCostJpy > budgetJpy;
        await record({ attempts: result.attempts, resultCached: false, ok: !overBudget, usage: result.usage });
        if (budgetJpy !== undefined && overBudget) {
          // 上限を入れたときは、上限内に収まった案だけを出す
          throw new ProposeError(
            `予算${yen(budgetJpy)}以内の案を作れませんでした（いちばん近い案で追加${yen(sf.totalCostJpy)}）。上限を上げるか、要望を小さくしてお試しください。`,
          );
        }
        const value = { ...result, hint: t.hint ?? null, shortfall: sf, budgetJpy: budgetJpy ?? null };
        proposeCache.set(t.key, value);
        return { ...value, cached: false };
      } catch (err) {
        if (err instanceof ProposeError && err.usage) {
          await record({ attempts: 0, resultCached: false, ok: false, usage: err.usage });
        } else if (!(err instanceof ProposeError)) {
          await record({ attempts: 0, resultCached: false, ok: false, usage: emptyUsage() });
        }
        throw err;
      } finally {
        if (isFirst) releaseRest();
      }
    }),
  );

  const results = runs.map((r) =>
    r.status === "fulfilled"
      ? { ok: true as const, ...r.value }
      : {
          ok: false as const,
          error: r.reason instanceof ProposeError ? r.reason.message : toLlmError(r.reason, settings).message,
        },
  );
  const firstFailure = runs.find((r) => r.status === "rejected");
  if (results.every((r) => !r.ok) && firstFailure?.status === "rejected") {
    const err = firstFailure.reason;
    console.error("propose failed", settings.provider, settings.model, err);
    if (err instanceof ProposeError) return Response.json({ error: err.message }, { status: 422 });
    const e = toLlmError(err, settings);
    return Response.json({ error: e.message }, { status: e.status });
  }
  return Response.json({ provider: settings.provider, keySource, mode, budgetJpy: budgetJpy ?? null, patterns: results });
}
