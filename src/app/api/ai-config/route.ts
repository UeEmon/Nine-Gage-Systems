import { publicAiView } from "@/lib/server/aiSettings";
import { requireUser } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

/** 使うAIの名前と、使える状態か（キーは返さない） */
export async function GET(req: Request) {
  const g = await requireUser(req);
  if (!g.ok) return g.response;
  return Response.json(publicAiView(g.data.ai));
}
