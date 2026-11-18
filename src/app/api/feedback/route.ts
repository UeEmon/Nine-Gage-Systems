import { requireUser } from "@/lib/server/auth";
import {
  addFeedback,
  checkFeedbackLimit,
  createGithubIssue,
  FeedbackError,
  FeedbackInputSchema,
  feedbackFor,
  githubConfig,
  newFeedback,
  recordIssueResult,
} from "@/lib/server/feedback";
import { updateStore } from "@/lib/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 自分が送った改善リクエスト */
export async function GET(req: Request) {
  const g = await requireUser(req);
  if (!g.ok) return g.response;
  return Response.json({ feedback: feedbackFor(g.data, g.user), github: githubConfig() !== null });
}

/** 改善リクエストを送る。先に保存してから GitHub の Issue にする（GitHub に届かなくても受け付けたものは残る） */
export async function POST(req: Request) {
  const g = await requireUser(req);
  if (!g.ok) return g.response;
  const parsed = FeedbackInputSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? "入力が正しくありません。" }, { status: 400 });
  }
  let saved;
  try {
    saved = await updateStore((d) => {
      checkFeedbackLimit(d, g.user.id);
      const f = newFeedback(g.user.id, parsed.data);
      addFeedback(d, f);
      return structuredClone(f);
    });
  } catch (err) {
    if (err instanceof FeedbackError) return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }
  const config = githubConfig();
  const result = config
    ? await createGithubIssue(saved, config).catch((err: unknown) => ({ error: err instanceof Error ? err.message : String(err) }))
    : { error: "GitHub への登録が設定されていません（NINEGAGE_FEEDBACK_GITHUB_TOKEN）。" };
  if ("error" in result) console.error(`改善リクエスト ${saved.id} を Issue にできませんでした: ${result.error}`);
  const feedback = await updateStore((d) => {
    recordIssueResult(d, saved.id, result);
    return feedbackFor(d, g.user);
  });
  return Response.json({ feedback, issueUrl: "error" in result ? undefined : result.url }, { status: 201 });
}
