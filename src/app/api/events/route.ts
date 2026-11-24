import { z } from "zod";
import { CLIENT_EVENTS, DETAIL_RE, normalizePath, referrerHost, SITES, type Site } from "@/lib/analytics";
import {
  eventAllowed,
  newVisitorId,
  recordEvent,
  visitorCookie,
  visitorIdFrom,
} from "@/lib/server/analytics";
import { clientKey, secureCookies, sessionTokensFrom } from "@/lib/server/auth";
import { cookieDomain, userFromTokens } from "@/lib/server/session";
import { loadStore } from "@/lib/server/store";
import { terminalConfig } from "@/lib/server/terminal";
import { isAccountPath, sitesFrom } from "@/lib/sites";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  name: z.enum(CLIENT_EVENTS),
  path: z.string().max(500),
  detail: z.string().regex(DETAIL_RE).optional(),
  referrer: z.string().max(2000).optional(),
  mobile: z.boolean().optional(),
  site: z.enum(SITES).optional(),
});

const hostOf = (url: string | null | undefined) => {
  try {
    return url ? new URL(url).host : null;
  } catch {
    return null;
  }
};

/**
 * 画面からのアクセス解析のイベント（src/lib/analytics.ts の track()）。
 * 自分のサイト（トップページ・プラットフォーム・ターミナル）からだけ受け付け、返事は中身なしの 204。
 */
export async function POST(req: Request) {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const sites = sitesFrom();
  const terminalHost = hostOf(terminalConfig()?.url);
  const originHost = hostOf(req.headers.get("origin"));
  const allowed = [host, hostOf(sites?.home), hostOf(sites?.app), terminalHost].filter(Boolean);
  if (req.headers.get("origin") && !allowed.includes(originHost)) return new Response(null, { status: 403 });

  const text = await req.text().catch(() => "");
  if (text.length > 4000) return new Response(null, { status: 413 });
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return new Response(null, { status: 400 });
  }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) return new Response(null, { status: 400 });
  const b = parsed.data;

  const cookie = req.headers.get("cookie") ?? "";
  let vid = visitorIdFrom(cookie);
  const headers = new Headers({ "Cache-Control": "no-store" });
  if (!vid) {
    vid = newVisitorId();
    headers.append("Set-Cookie", visitorCookie(vid, secureCookies(req), cookieDomain()));
  }
  if (!eventAllowed(`v:${vid}`) || !eventAllowed(`ip:${clientKey(req)}`)) return new Response(null, { status: 204, headers });

  const path = normalizePath(b.path);
  let site: Site;
  if (b.site === "terminal" && terminalHost && originHost === terminalHost) site = "terminal";
  else if (sites) site = host === hostOf(sites.home) ? "www" : "platform";
  else site = path === "/" ? "platform" : path === "/home" || isAccountPath(path) ? "www" : "platform";

  const own = [host, hostOf(sites?.home), hostOf(sites?.app), terminalHost, cookieDomain()]
    .filter((h): h is string => !!h)
    .map((h) => h.split(":")[0].toLowerCase());
  const user = userFromTokens(sessionTokensFrom(req), await loadStore());

  recordEvent({
    name: b.name,
    site,
    path,
    detail: b.detail ?? null,
    vid,
    uid: user?.id ?? null,
    ref: b.name === "view" && b.referrer ? referrerHost(b.referrer, own) : null,
    mobile: b.mobile ?? false,
  });
  return new Response(null, { status: 204, headers });
}
