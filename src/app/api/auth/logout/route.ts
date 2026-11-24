import { sameOrigin, secureCookies } from "@/lib/server/auth";
import { clearSessionCookies } from "@/lib/server/session";

/** ログアウト。トップページとプラットフォームで共有の Cookie も、以前のそのアドレスだけの Cookie も消す */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return Response.json({ error: "別のサイトからの要求は受け付けません。" }, { status: 403 });
  const headers = new Headers({ "Content-Type": "application/json", "Cache-Control": "no-store" });
  for (const c of clearSessionCookies(secureCookies(req))) headers.append("Set-Cookie", c);
  return new Response(JSON.stringify({ ok: true }), { headers });
}
