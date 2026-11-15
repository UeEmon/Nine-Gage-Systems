import { cookies } from "next/headers";
import { clientKey, recordSignup, sameOrigin, secureCookies, signupBlocked } from "@/lib/server/auth";
import { createSessionToken, publicUser, sessionCookie } from "@/lib/server/session";
import { updateStore } from "@/lib/server/store";
import { signupUser, SignupSchema, UserError } from "@/lib/server/users";

export const runtime = "nodejs";

/** 自分でユーザー登録する（ロールは「一般」）。登録できたらそのままログインする */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return Response.json({ error: "別のサイトからの要求は受け付けません。" }, { status: 403 });
  const parsed = SignupSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "ユーザー名とパスワードを入力してください。" }, { status: 400 });
  const key = `ip:${clientKey(req)}`;
  if (signupBlocked(key)) {
    return Response.json({ error: "登録が続いたため、しばらく登録できません。1時間ほど待ってからお試しください。" }, { status: 429 });
  }
  try {
    const { user, secret } = await updateStore(async (d) => ({
      user: structuredClone(await signupUser(d, parsed.data)),
      secret: d.sessionSecret,
    }));
    recordSignup(key);
    (await cookies()).set(sessionCookie(createSessionToken(user, secret), secureCookies(req)));
    return Response.json({ user: publicUser(user) }, { status: 201 });
  } catch (err) {
    if (err instanceof UserError) return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
