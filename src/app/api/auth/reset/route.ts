import { cookies } from "next/headers";
import { sameOrigin, secureCookies } from "@/lib/server/auth";
import { createSessionToken, publicUser, sessionCookie } from "@/lib/server/session";
import { updateStore } from "@/lib/server/store";
import { resetPassword, ResetSchema, UserError } from "@/lib/server/users";

export const runtime = "nodejs";

/** パスワード再設定のメールのリンクで新しいパスワードにして、そのままログインする */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return Response.json({ error: "別のサイトからの要求は受け付けません。" }, { status: 403 });
  const parsed = ResetSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "リンクが正しくないか、パスワードが入っていません。" }, { status: 400 });
  try {
    const { user, secret } = await updateStore(async (d) => ({
      user: structuredClone(await resetPassword(d, parsed.data)),
      secret: d.sessionSecret,
    }));
    (await cookies()).set(sessionCookie(createSessionToken(user, secret), secureCookies(req)));
    return Response.json({ user: publicUser(user) });
  } catch (err) {
    if (err instanceof UserError) return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
