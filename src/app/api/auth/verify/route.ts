import { cookies } from "next/headers";
import { z } from "zod";
import { recordServerEvent } from "@/lib/server/analytics";
import { sameOrigin, secureCookies } from "@/lib/server/auth";
import { createSessionToken, publicUser, sessionCookie } from "@/lib/server/session";
import { updateStore } from "@/lib/server/store";
import { UserError, verifyEmail } from "@/lib/server/users";

export const runtime = "nodejs";

const Body = z.object({ token: z.string().min(10).max(200) });

/** 確認メールのリンクで登録を完了し、そのままログインする */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return Response.json({ error: "別のサイトからの要求は受け付けません。" }, { status: 403 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "リンクが正しくありません。メールのリンクをそのまま開いてください。" }, { status: 400 });
  try {
    const { user, secret, plan } = await updateStore((d) => ({
      user: structuredClone(verifyEmail(d, parsed.data.token)),
      secret: d.sessionSecret,
      plan: { sponsorPlan: d.sponsorPlan, sponsors: d.sponsors },
    }));
    (await cookies()).set(sessionCookie(createSessionToken(user, secret), secureCookies(req)));
    recordServerEvent(req, "login", user.id);
    return Response.json({ user: publicUser(user, plan) });
  } catch (err) {
    if (err instanceof UserError) return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
