import { requireUser } from "@/lib/server/auth";
import { noticesFor } from "@/lib/server/notices";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 自分あてのお知らせ（公開済み、新しい順）と未読数 */
export async function GET(req: Request) {
  const g = await requireUser(req);
  if (!g.ok) return g.response;
  return Response.json(noticesFor(g.data, g.user));
}
