import { z } from "zod";
import { requireUser } from "@/lib/server/auth";
import { PAPERS, PapercraftError, PapercraftObjectSchema, papercraftConfig, requestNets } from "@/lib/server/papercraft";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 連携が使えるか（画面でボタンを出すかどうか） */
export async function GET(req: Request) {
  const g = await requireUser(req);
  if (!g.ok) return g.response;
  return Response.json({ enabled: papercraftConfig() !== null }, { headers: { "Cache-Control": "no-store" } });
}

const BodySchema = z.object({
  object: PapercraftObjectSchema,
  paper: z.enum(PAPERS).default("A4"),
});

/**
 * 仮オブジェクトの展開図を、別のコンテナのペーパークラフトジェネレーターに作ってもらう。
 * ログインした人だけ使える。ジェネレーターのURLとトークンはサーバーの環境変数だけで持つ。
 */
export async function POST(req: Request) {
  const g = await requireUser(req);
  if (!g.ok) return g.response;
  const config = papercraftConfig();
  if (!config) {
    return Response.json({ error: "ペーパークラフトジェネレーターがつながっていません（管理者の設定が必要です）。" }, { status: 503 });
  }
  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "入力が正しくありません" }, { status: 400 });
  try {
    const result = await requestNets(parsed.data.object, parsed.data.paper, config);
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof PapercraftError) return Response.json({ error: err.message }, { status: err.status });
    console.error("papercraft failed", err);
    return Response.json({ error: "展開図を作れませんでした。" }, { status: 502 });
  }
}
