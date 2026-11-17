import { aiLayouts } from "@/lib/server/aiLayouts";
import { requireUser } from "@/lib/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const notFound = () => Response.json({ error: "見つかりませんでした（削除されたか、古いものから消えた可能性があります）。" }, { status: 404 });

/** 自分がAIで作ったレイアウト1件（提案の結果と、頼んだときの条件） */
export async function GET(req: Request, ctx: Ctx) {
  const g = await requireUser(req);
  if (!g.ok) return g.response;
  const { id } = await ctx.params;
  const e = aiLayouts.get(g.user.id, id);
  return e ? Response.json({ layout: e }) : notFound();
}

/** 自分がAIで作ったレイアウトを1件消す。同じ条件で頼むと、次はAIが作り直す */
export async function DELETE(req: Request, ctx: Ctx) {
  const g = await requireUser(req);
  if (!g.ok) return g.response;
  const { id } = await ctx.params;
  return aiLayouts.remove(g.user.id, id) ? Response.json({ ok: true }) : notFound();
}
