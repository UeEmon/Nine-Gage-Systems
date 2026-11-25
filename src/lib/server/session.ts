import { createHmac, timingSafeEqual } from "node:crypto";
import type { RoleId } from "@/lib/roles";
import { effectiveRole } from "./premium";
import type { StoreData, StoredUser } from "./store";

/** ログイン状態を持つ Cookie。中身は「ユーザーID.版.期限.署名」 */
export const SESSION_COOKIE = "ng_session";
export const SESSION_DAYS = 14;

export type PublicUser = { id: string; username: string; role: RoleId };

/** 画面に返すユーザー。ロールは支援の状態を反映したもの（一般で支援中ならプレミアムユーザー） */
export function publicUser(u: StoredUser, data: Pick<StoreData, "sponsorPlan" | "sponsors">): PublicUser {
  return { id: u.id, username: u.username, role: effectiveRole(u, data) };
}

function sign(body: string, secret: string) {
  return createHmac("sha256", secret).update(body).digest("base64url");
}

export function createSessionToken(user: StoredUser, secret: string, now = Date.now()): string {
  const exp = Math.floor(now / 1000) + SESSION_DAYS * 86400;
  const body = `${user.id}.${user.sessionVersion}.${exp}`;
  return `${body}.${sign(body, secret)}`;
}

/** 署名・期限・版（パスワードやロールの変更で無効になる）を確かめて、ユーザーを返す */
export function userFromToken(token: string | undefined, data: StoreData, now = Date.now()): StoredUser | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 4) return null;
  const [id, version, exp, mac] = parts;
  const expected = Buffer.from(sign(`${id}.${version}.${exp}`, data.sessionSecret));
  const given = Buffer.from(mac);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  if (!(Number(exp) * 1000 > now)) return null;
  const user = data.users.find((u) => u.id === id);
  if (!user || String(user.sessionVersion) !== version || user.pendingVerify) return null;
  return user;
}

/**
 * トップページ（www.）とプラットフォーム（platform.）でログインを共有するための Cookie のドメイン
 * （NINEGAGE_COOKIE_DOMAIN。例 senrolab.com）。なければ、そのアドレスだけの Cookie にする。
 */
export function cookieDomain(env: Record<string, string | undefined> = process.env): string | undefined {
  const d = env.NINEGAGE_COOKIE_DOMAIN?.trim().replace(/^\./, "").toLowerCase();
  return d && /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d) ? d : undefined;
}

export function sessionCookie(token: string, secure: boolean, domain = cookieDomain()) {
  return {
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: "lax" as const,
    secure,
    path: "/",
    maxAge: SESSION_DAYS * 86400,
    ...(domain ? { domain } : {}),
  };
}

/**
 * ログアウトで消す Cookie（Set-Cookie の値）。共有の Cookie と、以前のそのアドレスだけの Cookie の両方を消す。
 */
export function clearSessionCookies(secure: boolean, domain = cookieDomain()): string[] {
  const base = `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
  return domain ? [base, `${base}; Domain=${domain}`] : [base];
}

/**
 * 同じ名前の Cookie が複数届くことがある（共有の Cookie と、そのアドレスだけの Cookie）。
 * 有効なものを先に見つけた順で使う。
 */
export function userFromTokens(tokens: (string | undefined)[], data: StoreData, now = Date.now()): StoredUser | null {
  for (const t of tokens) {
    const user = userFromToken(t, data, now);
    if (user) return user;
  }
  return null;
}
