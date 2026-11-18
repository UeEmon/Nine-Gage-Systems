import { requireUser } from "@/lib/server/auth";
import { adminFeedback, githubConfig } from "@/lib/server/feedback";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 管理画面: 届いた改善リクエスト（送った人と、Issue にできなかった理由つき） */
export async function GET(req: Request) {
  const g = await requireUser(req, "admin");
  if (!g.ok) return g.response;
  const config = githubConfig();
  return Response.json({ feedback: adminFeedback(g.data), repo: config?.repo ?? null });
}
