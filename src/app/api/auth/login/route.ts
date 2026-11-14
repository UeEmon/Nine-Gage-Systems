import { z } from "zod";
import { clearLoginFailures, clientKey, loginBlocked, recordLoginFailure, sameOrigin, secureCookies } from "@/lib/server/auth";
import { DUMMY_HASH, verifyPassword } from "@/lib/server/password";
import { createSessionToken, publicUser, sessionCookie } from "@/lib/server/session";
import { loadStore } from "@/lib/server/store";
import { cookies } from "next/headers";

export const runtime = "nodejs";

const Body = z.object({ username: z.string().trim().max(100), password: z.string().max(200) });

export async function POST(req: Request) {
  if (!sameOrigin(req)) return Response.json({ error: "別のサイトからの要求は受け付けません。" }, { status: 403 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "ユーザー名とパスワードを入力してください。" }, { status: 400 });
  const { username, password } = parsed.data;
  const keys = [`ip:${clientKey(req)}`, `user:${username.toLowerCase()}`];
  if (loginBlocked(keys)) {
    return Response.json({ error: "失敗が続いたため、しばらくログインできません。15分ほど待ってからお試しください。" }, { status: 429 });
  }

  const data = await loadStore();
  if (data.users.length === 0) {
    return Response.json(
      { error: "ユーザーがまだいません。サーバーに NINEGAGE_ADMIN_USER と NINEGAGE_ADMIN_PASSWORD を設定して再起動してください。" },
      { status: 503 },
    );
  }
  const user = data.users.find((u) => u.username.toLowerCase() === username.toLowerCase());
  const ok = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !ok) {
    recordLoginFailure(keys);
    return Response.json({ error: "ユーザー名かパスワードが違います。" }, { status: 401 });
  }
  clearLoginFailures(keys);
  (await cookies()).set(sessionCookie(createSessionToken(user, data.sessionSecret), secureCookies(req)));
  return Response.json({ user: publicUser(user) });
}
