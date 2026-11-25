import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { requireUser, secureCookies } from "@/lib/server/auth";
import { publicBaseUrl } from "@/lib/server/mailer";
import { cookieDomain } from "@/lib/server/session";
import { authorizeUrl, GITHUB_CALLBACK_PATH, GITHUB_STATE_COOKIE, githubOAuth } from "@/lib/server/sponsors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GitHub の認可画面へ送る。戻り先は callback。なりすまし防止の state は Cookie に持つ（10分） */
export async function GET(req: Request) {
  const g = await requireUser(req);
  if (!g.ok) return g.response;
  const cfg = githubOAuth();
  const base = publicBaseUrl(req);
  if (!cfg || !base) return Response.json({ error: "GitHub 連携はまだ使えません（サーバーの設定がありません）。" }, { status: 503 });
  const state = randomBytes(24).toString("base64url");
  const res = NextResponse.redirect(authorizeUrl(cfg.clientId, `${base}${GITHUB_CALLBACK_PATH}`, state), 302);
  const domain = cookieDomain();
  res.cookies.set({
    name: GITHUB_STATE_COOKIE,
    value: `${g.user.id}.${state}`,
    httpOnly: true,
    sameSite: "lax",
    secure: secureCookies(req),
    path: "/api/account/github",
    maxAge: 600,
    ...(domain ? { domain } : {}),
  });
  return res;
}
