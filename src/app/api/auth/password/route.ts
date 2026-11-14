import { cookies } from "next/headers";
import { requireUser, secureCookies } from "@/lib/server/auth";
import { createSessionToken, sessionCookie } from "@/lib/server/session";
import { updateStore } from "@/lib/server/store";
import { changeOwnPassword, ChangePasswordSchema, UserError } from "@/lib/server/users";

export const runtime = "nodejs";

/** 自分のパスワードを変える（全員）。この端末はログインしたまま、ほかの端末はログアウトされる */
export async function POST(req: Request) {
  const g = await requireUser(req);
  if (!g.ok) return g.response;
  const parsed = ChangePasswordSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "入力が正しくありません。" }, { status: 400 });
  try {
    const { user, secret } = await updateStore(async (d) => ({
      user: structuredClone(await changeOwnPassword(d, g.user.id, parsed.data)),
      secret: d.sessionSecret,
    }));
    (await cookies()).set(sessionCookie(createSessionToken(user, secret), secureCookies(req)));
    return Response.json({ ok: true });
  } catch (err) {
    if (err instanceof UserError) return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
