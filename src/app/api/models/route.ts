import { z } from "zod";
import { listModels, resolveSettings, toLlmError, type ResolvedAiSettings } from "@/lib/llm";
import { AiSettingsSchema } from "@/lib/llm/request";

export const runtime = "nodejs";

/** 選んだプロバイダで使えるモデルの一覧 */
export async function POST(req: Request) {
  const parsed = z.object({ ai: AiSettingsSchema }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "入力が正しくありません" }, { status: 400 });
  let settings: ResolvedAiSettings | undefined;
  try {
    settings = resolveSettings(parsed.data.ai);
    const models = await listModels(settings);
    return Response.json({ models });
  } catch (err) {
    const e = toLlmError(err, settings);
    return Response.json({ error: e.message }, { status: e.status });
  }
}
