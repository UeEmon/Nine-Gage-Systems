import { verifyHandoff } from "../../../../../src/lib/terminalLink";
import { handoffSecret, secureCookies, sessionSecret } from "../../../lib/config";
import { cookieValue, createSession, SESSION_COOKIE, SESSION_DAYS, setCookie, STATE_COOKIE } from "../../../lib/session";
import { safePath } from "../../../lib/paths";

export const dynamic = "force-dynamic";

/** プラットフォームからの合図を確かめて、ターミナルのログインの Cookie を出す */
export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token") ?? "";
  const [state = "", next = "/"] = (cookieValue(req, STATE_COOKIE) ?? "").split("|");
  const id = verifyHandoff(token, state, handoffSecret());
  const secure = secureCookies(req);
  const headers = new Headers({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
  headers.append("Set-Cookie", setCookie(STATE_COOKIE, "", { maxAge: 0, secure, path: "/auth" }));
  if (!id) {
    headers.set("Content-Type", "text/plain; charset=utf-8");
    return new Response("ログインを確かめられませんでした。もう一度「ログイン」からやり直してください。", { status: 400, headers });
  }
  headers.append("Set-Cookie", setCookie(SESSION_COOKIE, createSession(id, sessionSecret()), { maxAge: SESSION_DAYS * 86400, secure }));
  headers.set("Location", safePath(next));
  return new Response(null, { status: 303, headers });
}
