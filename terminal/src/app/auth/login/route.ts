import { randomBytes } from "node:crypto";
import { secureCookies, senrolabUrl } from "../../../lib/config";
import { setCookie, STATE_COOKIE } from "../../../lib/session";
import { safePath } from "../../../lib/paths";

export const dynamic = "force-dynamic";

/** SenroLab のアカウントでログインする（プラットフォームでログインを確かめて戻ってくる） */
export async function GET(req: Request) {
  const next = safePath(new URL(req.url).searchParams.get("next"));
  const state = randomBytes(24).toString("base64url");
  const secure = secureCookies(req);
  const headers = new Headers({ Location: `${senrolabUrl()}/api/terminal/handoff?state=${state}`, "Cache-Control": "no-store" });
  headers.append("Set-Cookie", setCookie(STATE_COOKIE, `${state}|${next}`, { maxAge: 600, secure, path: "/auth" }));
  return new Response(null, { status: 303, headers });
}
