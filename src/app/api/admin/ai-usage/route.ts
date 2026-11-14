import { usageStats } from "@/lib/server/aiUsage";
import { requireUser } from "@/lib/server/auth";
import { proposeCache } from "@/lib/server/proposeCache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** AI提案のトークン使用量とキャッシュの効き具合（管理者だけ） */
export async function GET(req: Request) {
  const g = await requireUser(req, "admin");
  if (!g.ok) return g.response;
  return Response.json({ ...usageStats.view(), savedResults: proposeCache.size });
}

/** 集計を0に戻す（管理者だけ）。clearResults=true なら保存済みの提案結果も消す */
export async function DELETE(req: Request) {
  const g = await requireUser(req, "admin");
  if (!g.ok) return g.response;
  usageStats.reset();
  if (new URL(req.url).searchParams.get("clearResults") === "true") proposeCache.clear();
  return Response.json({ ...usageStats.view(), savedResults: proposeCache.size });
}
