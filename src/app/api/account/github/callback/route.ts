import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { publicBaseUrl } from "@/lib/server/mailer";
import { cookieDomain } from "@/lib/server/session";
import { updateStore } from "@/lib/server/store";
import {
  exchangeCode,
  GITHUB_CALLBACK_PATH,
  GITHUB_STATE_COOKIE,
  linkGithub,
  SponsorsError,
  viewerSponsorship,
} from "@/lib/server/sponsors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function stateFrom(req: Request): string | null {
  for (const part of (req.headers.get("cookie") ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === GITHUB_STATE_COOKIE) return decodeURIComponent(v.join("="));
  }
  return null;
}

/** GitHub の認可画面から戻ってくる。アカウントを結び付け、支援の状態を1回読んで、アカウント画面へ戻す */
export async function GET(req: Request) {
  const g = await requireUser(req);
  if (!g.ok) return g.response;
  const base = publicBaseUrl(req) ?? new URL(req.url).origin;
  const done = (result: string, message?: string) => {
    const q = new URLSearchParams({ github: result, ...(message ? { message } : {}) });
    const res = NextResponse.redirect(`${base}/account?${q}#github`, 302);
    const domain = cookieDomain();
    res.cookies.set({ name: GITHUB_STATE_COOKIE, value: "", path: "/api/account/github", maxAge: 0, ...(domain ? { domain } : {}) });
    return res;
  };
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const expected = stateFrom(req);
  if (url.searchParams.get("error")) return done("cancelled");
  if (!code || !state || !expected || expected !== `${g.user.id}.${state}`) {
    return done("error", "連携の確認に失敗しました。もう一度「GitHub と連携」を押してください。");
  }
  try {
    const gh = await exchangeCode(code, `${base}${GITHUB_CALLBACK_PATH}`);
    const sponsorship = await viewerSponsorship(gh.token, { id: gh.id, login: gh.login }).catch((err) => {
      console.error("sponsors: viewer sponsorship failed", err);
      return null;
    });
    await updateStore((d) => {
      const user = d.users.find((u) => u.id === g.user.id);
      if (!user) throw new SponsorsError("ユーザーが見つかりません。", 404);
      linkGithub(d, user, gh, sponsorship);
    });
    return done("linked");
  } catch (err) {
    if (err instanceof SponsorsError) return done("error", err.message);
    console.error("sponsors: link failed", err);
    return done("error", "GitHub との連携に失敗しました。時間をおいてもう一度お試しください。");
  }
}
