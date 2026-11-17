import { aiLayouts } from "@/lib/server/aiLayouts";
import { requireUser } from "@/lib/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 自分がAIで作ったレイアウトの一覧（新しい順。中身は含まない） */
export async function GET(req: Request) {
  const g = await requireUser(req);
  if (!g.ok) return g.response;
  return Response.json({ layouts: aiLayouts.list(g.user.id) });
}
