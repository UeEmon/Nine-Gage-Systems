import { z } from "zod";
import { listModels, toLlmError, type ResolvedAiSettings } from "@/lib/llm";
import { requireUser } from "@/lib/server/auth";
import { OwnAiError, previewOwnSettings } from "@/lib/server/ownAi";
import { OWN_AI_PROVIDERS } from "@/lib/server/store";

export const runtime = "nodejs";

const Body = z.object({ provider: z.enum(OWN_AI_PROVIDERS), apiKey: z.string().trim().max(500).optional() });

/** 自分のAPIキーで使えるモデルの一覧（一般・プレミアムユーザー）。保存前に入力したキーでも試せる */
export async function POST(req: Request) {
  const g = await requireUser(req);
  if (!g.ok) return g.response;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "入力が正しくありません。" }, { status: 400 });
  let settings: ResolvedAiSettings | undefined;
  try {
    settings = previewOwnSettings(g.user, parsed.data.provider, parsed.data.apiKey);
    return Response.json({ models: await listModels(settings) });
  } catch (err) {
    if (err instanceof OwnAiError) return Response.json({ error: err.message }, { status: err.status });
    const e = toLlmError(err, settings);
    return Response.json({ error: e.message }, { status: e.status });
  }
}
