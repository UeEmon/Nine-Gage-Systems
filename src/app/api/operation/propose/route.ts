import { z } from "zod";
import { createSession, toLlmError, type ResolvedAiSettings } from "@/lib/llm";
import { emptyUsage } from "@/lib/llm/types";
import { OperationProposeError, operationSessionOptions, proposeOperation } from "@/lib/operation/ai";
import { MAKERS } from "@/lib/parts";
import { TrackLayoutSchema } from "@/lib/plan";
import { logUsage, priced, usageLog, type NewUsage } from "@/lib/server/aiUsage";
import { requireUser } from "@/lib/server/auth";
import { settingsForUserNow, type KeySource } from "@/lib/server/ownAi";

export const runtime = "nodejs";
export const maxDuration = 300;

const BodySchema = TrackLayoutSchema.extend({
  maker: z.enum(MAKERS).default("kato"),
  stationNames: z.record(z.string().max(64), z.string().max(40)).default({}),
  /** 「再現してみた」で再現した路線・駅（列車の路線名に使う） */
  replica: z
    .object({
      kind: z.enum(["line", "station"]),
      target: z.string().max(200),
      lines: z.array(z.string().max(100)).max(20).optional(),
    })
    .nullish(),
  request: z.string().max(2000).default(""),
});

/**
 * 今のレイアウトに合わせて、AIに運行計画（列車の一覧）を提案させる。
 * ログインした人だけ使える。AIの設定・APIキーの扱いはレイアウトの提案（/api/propose）と同じ。
 */
export async function POST(req: Request) {
  const g = await requireUser(req);
  if (!g.ok) return g.response;
  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "入力が正しくありません（レイアウトの線路が読めないか、要望が2000文字を超えています）" }, { status: 400 });
  }
  const { maker, pieces, accessories, stationNames, replica, request } = parsed.data;

  let settings: ResolvedAiSettings;
  let keySource: KeySource;
  try {
    ({ settings, keySource } = await settingsForUserNow(g.data, g.user));
  } catch (err) {
    const e = toLlmError(err, undefined);
    return Response.json({ error: e.message }, { status: e.status });
  }

  const record = (r: Pick<NewUsage, "attempts" | "resultCached" | "ok" | "usage">) => {
    const rec = priced({
      userId: g.user.id,
      username: g.user.username,
      provider: settings.provider,
      model: settings.model,
      maker,
      feature: "operation",
      keySource,
      ...r,
    });
    logUsage(rec);
    return usageLog.append(rec);
  };

  try {
    const session = createSession(settings, operationSessionOptions());
    const result = await proposeOperation({ pieces, accessories, stationNames, replica, request }, session, settings.model);
    await record({ attempts: result.attempts, resultCached: false, ok: true, usage: result.usage });
    return Response.json({ provider: settings.provider, keySource, ...result });
  } catch (err) {
    if (err instanceof OperationProposeError) {
      await record({ attempts: 0, resultCached: false, ok: false, usage: err.usage ?? emptyUsage() });
      return Response.json({ error: err.message }, { status: 422 });
    }
    await record({ attempts: 0, resultCached: false, ok: false, usage: emptyUsage() });
    console.error("operation propose failed", settings.provider, settings.model, err);
    const e = toLlmError(err, settings);
    return Response.json({ error: e.message }, { status: e.status });
  }
}
