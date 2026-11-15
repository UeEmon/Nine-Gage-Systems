import { clientKey, recordSignup, sameOrigin, signupBlocked } from "@/lib/server/auth";
import { canSendMail, mailSender, publicBaseUrl } from "@/lib/server/mailer";
import { updateStore } from "@/lib/server/store";
import { alreadyMail, signupMail, signupUser, SignupSchema, UserError } from "@/lib/server/users";

export const runtime = "nodejs";

const SENT = "確認メールを送りました。メールのリンクを開くと登録が完了し、ログインできるようになります。";

/** 自分でユーザー登録する（ロールは「一般」）。確認メールのリンクを開くまではログインできない */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return Response.json({ error: "別のサイトからの要求は受け付けません。" }, { status: 403 });
  const parsed = SignupSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "ユーザー名・メールアドレス・パスワードを入力してください。" }, { status: 400 });
  const base = publicBaseUrl(req);
  if (!base || !canSendMail()) {
    return Response.json({ error: "このサーバーはメールを送れないため、いまはユーザー登録できません。管理者に連絡してください。" }, { status: 503 });
  }
  const keys = [`ip:${clientKey(req)}`, `email:${parsed.data.email.trim().toLowerCase()}`];
  if (keys.some((k) => signupBlocked(k))) {
    return Response.json({ error: "登録が続いたため、しばらく登録できません。1時間ほど待ってからお試しください。" }, { status: 429 });
  }
  try {
    const result = await updateStore((d) => signupUser(d, parsed.data));
    for (const k of keys) recordSignup(k);
    const to = parsed.data.email.trim().toLowerCase();
    const mail =
      result.kind === "created" ? signupMail(base, result.user.username, result.token) : alreadyMail(base, result.username);
    try {
      await mailSender()({ to, ...mail });
    } catch (err) {
      console.error("確認メールを送れませんでした", err);
      return Response.json({ error: "確認メールを送れませんでした。時間をおいてもう一度お試しください。" }, { status: 502 });
    }
    return Response.json({ ok: true, message: SENT }, { status: 202 });
  } catch (err) {
    if (err instanceof UserError) return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
