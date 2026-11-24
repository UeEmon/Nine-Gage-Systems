import { ANALYTICS_PERIODS, loadAnalyticsView, type AnalyticsPeriod } from "@/lib/server/analytics";
import { requireUser } from "@/lib/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** アクセス解析の集計（管理者だけ）。?period=7d|30d|90d|all */
export async function GET(req: Request) {
  const g = await requireUser(req, "admin");
  if (!g.ok) return g.response;
  const p = new URL(req.url).searchParams.get("period");
  const period = (ANALYTICS_PERIODS as readonly string[]).includes(p ?? "") ? (p as AnalyticsPeriod) : "30d";
  return Response.json(loadAnalyticsView(period, g.data.users));
}
