import { z } from "zod";
import { proposeLayout, ProposeError, sessionOptions } from "@/lib/ai";
import { createSession, defaultProvider, resolveSettings, toLlmError, type ResolvedAiSettings } from "@/lib/llm";
import { AiSettingsSchema } from "@/lib/llm/request";
import { MAKERS } from "@/lib/parts";

export const runtime = "nodejs";
export const maxDuration = 300;

const BodySchema = z.object({
  board: z.object({
    width: z.number().min(200).max(10000),
    height: z.number().min(200).max(10000),
  }),
  request: z.string().max(2000),
  ai: AiSettingsSchema.optional(),
  maker: z.enum(MAKERS).default("kato"),
});

export async function POST(req: Request) {
  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "入力が正しくありません（ボードは200〜10000mm、要望は2000文字まで）" }, { status: 400 });
  }
  const { board, request, ai, maker } = parsed.data;

  let settings: ResolvedAiSettings | undefined;
  try {
    settings = resolveSettings(ai ?? { provider: defaultProvider() });
    const session = createSession(settings, sessionOptions(maker));
    const result = await proposeLayout({ board, request, maker }, session, settings.model);
    return Response.json({ ...result, provider: settings.provider });
  } catch (err) {
    if (err instanceof ProposeError) return Response.json({ error: err.message }, { status: 422 });
    const e = toLlmError(err, settings);
    console.error("propose failed", settings?.provider, settings?.model, err);
    return Response.json({ error: e.message }, { status: e.status });
  }
}
