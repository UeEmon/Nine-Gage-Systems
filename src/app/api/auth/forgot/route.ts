import { clientKey, recordSignup, sameOrigin, signupBlocked } from "@/lib/server/auth";
import { canSendMail, mailSender, publicBaseUrl } from "@/lib/server/mailer";
import { updateStore } from "@/lib/server/store";
import { ForgotSchema, requestPasswordReset, resetMail, UserError } from "@/lib/server/users";

export const runtime = "nodejs";

const SENT =
  "そのメールアドレスで登録があれば、パスワード再設定のメールを送りました。メールのリンクから新しいパスワードを決めてください。届かないときは、迷惑メールのフォルダーもご確認ください。";

/** パスワードを忘れたとき。登録の有無にかかわらず同じ答えを返す（登録の有無を漏らさない） */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return Response.json({ error: "別のサイトからの要求は受け付けません。" }, { status: 403 });
  const parsed = ForgotSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "メールアドレスを入力してください。" }, { status: 400 });
  const base = publicBaseUrl(req);
  if (!base || !canSendMail()) {
    return Response.json({ error: "このサーバーはメールを送れないため、いまはパスワードを再設定できません。管理者に連絡してください。" }, { status: 503 });
  }
  const email = parsed.data.email.trim().toLowerCase();
  // 同じ送信元・同じメールアドレスで1時間に5回まで（メールの送りつけを防ぐ）
  const keys = [`forgot-ip:${clientKey(req)}`, `forgot-email:${email}`];
  if (keys.some((k) => signupBlocked(k))) {
    return Response.json({ error: "続けて頼まれたため、しばらく受け付けられません。1時間ほど待ってからお試しください。" }, { status: 429 });
  }
  try {
    const result = await updateStore((d) => {
      const r = requestPasswordReset(d, email);
      return r ? { username: r.user.username, token: r.token } : null;
    });
    for (const k of keys) recordSignup(k);
    if (result) {
      try {
        await mailSender()({ to: email, ...resetMail(base, result.username, result.token) });
      } catch (err) {
        console.error("パスワード再設定のメールを送れませんでした", err);
        return Response.json({ error: "メールを送れませんでした。時間をおいてもう一度お試しください。" }, { status: 502 });
      }
    }
    return Response.json({ ok: true, message: SENT }, { status: 202 });
  } catch (err) {
    if (err instanceof UserError) return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
