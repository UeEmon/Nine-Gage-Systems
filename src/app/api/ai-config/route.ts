import { requireUser } from "@/lib/server/auth";
import { aiStatusFor } from "@/lib/server/ownAi";

export const dynamic = "force-dynamic";

/** 自分が使うAIの名前と、使える状態か（キーは返さない）。source: server=サーバーのキー、own=自分のキー */
export async function GET(req: Request) {
  const g = await requireUser(req);
  if (!g.ok) return g.response;
  return Response.json(aiStatusFor(g.data, g.user));
}
