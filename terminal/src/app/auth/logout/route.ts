import { secureCookies } from "../../../lib/config";
import { sameOrigin } from "../../../lib/server";
import { SESSION_COOKIE, setCookie } from "../../../lib/session";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!sameOrigin(req)) return new Response("forbidden", { status: 403 });
  const headers = new Headers({ Location: "/", "Cache-Control": "no-store" });
  headers.append("Set-Cookie", setCookie(SESSION_COOKIE, "", { maxAge: 0, secure: secureCookies(req) }));
  return new Response(null, { status: 303, headers });
}
