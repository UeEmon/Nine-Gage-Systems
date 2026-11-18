import { requireUser } from "@/lib/server/auth";
import { adminFeedback, createGithubIssue, githubConfig, recordIssueResult } from "@/lib/server/feedback";
import { updateStore } from "@/lib/server/store";

export const runtime = "nodejs";

/** 管理画面: Issue にできなかった改善リクエストを、もう一度 GitHub に送る */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await requireUser(req, "admin");
  if (!g.ok) return g.response;
  const { id } = await ctx.params;
  const f = g.data.feedback.find((x) => x.id === id);
  if (!f) return Response.json({ error: "見つかりません。" }, { status: 404 });
  if (f.issue) return Response.json({ error: "すでに Issue になっています。" }, { status: 409 });
  const config = githubConfig();
  if (!config) return Response.json({ error: "GitHub への登録が設定されていません（NINEGAGE_FEEDBACK_GITHUB_TOKEN）。" }, { status: 400 });
  const result = await createGithubIssue(f, config).catch((err: unknown) => ({ error: err instanceof Error ? err.message : String(err) }));
  const feedback = await updateStore((d) => {
    // 同時に押されて先に Issue になっていたら、上書きしない
    if (!d.feedback.find((x) => x.id === id)?.issue) recordIssueResult(d, id, result);
    return adminFeedback(d);
  });
  if ("error" in result) return Response.json({ error: result.error, feedback }, { status: 502 });
  return Response.json({ feedback });
}
