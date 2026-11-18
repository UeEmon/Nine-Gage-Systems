import { currentUser } from "@/lib/server/auth";
import { shareConfig } from "@/lib/server/share";
import { shareCallbackUrl, signHandoff } from "@/lib/shareLink";

export const dynamic = "force-dynamic";

/**
 * 共有サイトのログイン。ログイン中なら署名した合図を付けて共有サイトへ戻し、
 * ログインしていなければログイン画面へ（ログイン後にここへ戻る）。
 */
export async function GET(req: Request) {
  const cfg = shareConfig();
  if (!cfg) return Response.json({ error: "共有サイトは設定されていません。" }, { status: 404 });
  const url = new URL(req.url);
  const state = url.searchParams.get("state") ?? "";
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(state)) return Response.json({ error: "要求の形が正しくありません。" }, { status: 400 });
  const user = await currentUser();
  const headers = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };
  if (!user) {
    const next = `/api/share/handoff?state=${state}`;
    return new Response(null, { status: 303, headers: { ...headers, Location: `/login?next=${encodeURIComponent(next)}` } });
  }
  const token = signHandoff({ sub: user.id, name: user.username, role: user.role }, state, cfg.secret);
  return new Response(null, { status: 303, headers: { ...headers, Location: shareCallbackUrl(cfg.url, token) } });
}
