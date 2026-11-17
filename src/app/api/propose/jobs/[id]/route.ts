import { requireUser } from "@/lib/server/auth";
import { getProposeJob } from "@/lib/server/proposeJobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** バックグラウンドで作っているAI提案の状態。終わっていれば /api/propose と同じ応答を返す */
export async function GET(req: Request, ctx: Ctx) {
  const g = await requireUser(req);
  if (!g.ok) return g.response;
  const { id } = await ctx.params;
  const job = getProposeJob(g.user.id, id);
  if (!job) {
    return Response.json(
      {
        error:
          "AI提案の作業が見つかりませんでした（サーバーが更新・再起動された可能性があります）。作れた案は「AIで作ったレイアウト」の履歴に残っていることがあります。",
      },
      { status: 404 },
    );
  }
  if (job.status === "running") {
    return Response.json({ status: "running", elapsedMs: Date.now() - job.startedAt });
  }
  return Response.json(job.body, { status: job.httpStatus });
}
