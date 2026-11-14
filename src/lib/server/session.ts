import { createHmac, timingSafeEqual } from "node:crypto";
import type { Role, StoreData, StoredUser } from "./store";

/** ログイン状態を持つ Cookie。中身は「ユーザーID.版.期限.署名」 */
export const SESSION_COOKIE = "ng_session";
export const SESSION_DAYS = 14;

export type PublicUser = { id: string; username: string; role: Role };

export function publicUser(u: StoredUser): PublicUser {
  return { id: u.id, username: u.username, role: u.role };
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
  if (!user || String(user.sessionVersion) !== version) return null;
  return user;
}

export function sessionCookie(token: string, secure: boolean) {
  return {
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: "lax" as const,
    secure,
    path: "/",
    maxAge: SESSION_DAYS * 86400,
  };
}
