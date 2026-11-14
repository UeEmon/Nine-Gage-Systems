import { z } from "zod";
import { listModels, toLlmError, type ResolvedAiSettings } from "@/lib/llm";
import { PROVIDERS } from "@/lib/llm/types";
import { previewSettings, ProviderPatch } from "@/lib/server/aiSettings";
import { requireUser } from "@/lib/server/auth";

export const runtime = "nodejs";

const Body = z.object({ provider: z.enum(PROVIDERS), change: ProviderPatch.optional() });

/** 選んだプロバイダで使えるモデルの一覧（管理者だけ）。保存前の入力も試せる */
export async function POST(req: Request) {
  const g = await requireUser(req, "admin");
  if (!g.ok) return g.response;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "入力が正しくありません" }, { status: 400 });
  let settings: ResolvedAiSettings | undefined;
  try {
    settings = previewSettings(g.data.ai, parsed.data.provider, parsed.data.change);
    const models = await listModels(settings);
    return Response.json({ models });
  } catch (err) {
    const e = toLlmError(err, settings);
    return Response.json({ error: e.message }, { status: e.status });
  }
}
