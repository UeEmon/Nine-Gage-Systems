import { createHmac, timingSafeEqual } from "node:crypto";
import type { ShareIdentity } from "../../../src/lib/shareLink";

/** 共有サイトのログイン。中身は「本体のユーザーID・名前・ロール・期限」に署名したもの */
export const SESSION_COOKIE = "ls_session";
export const STATE_COOKIE = "ls_state";
export const SESSION_DAYS = 7;

export type ShareUser = ShareIdentity & { admin: boolean };

function mac(body: string, secret: string) {
  return createHmac("sha256", `share-session:${secret}`).update(body).digest("base64url");
}

export function createSession(id: ShareIdentity, secret: string, now = Date.now()): string {
  const body = Buffer.from(JSON.stringify({ ...id, exp: Math.floor(now / 1000) + SESSION_DAYS * 86400 })).toString("base64url");
  return `${body}.${mac(body, secret)}`;
}

export function readSession(token: string | undefined, secret: string, now = Date.now()): ShareUser | null {
  if (!token) return null;
  const [body, sig, extra] = token.split(".");
  if (!body || !sig || extra !== undefined) return null;
  const a = Buffer.from(sig);
  const b = Buffer.from(mac(body, secret));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (typeof p.sub !== "string" || typeof p.name !== "string" || typeof p.role !== "string" || !(p.exp * 1000 > now)) return null;
    return { sub: p.sub, name: p.name, role: p.role, admin: p.role === "admin" };
  } catch {
    return null;
  }
}

export function cookieValue(req: Request, name: string): string | undefined {
  for (const part of (req.headers.get("cookie") ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return undefined;
}

export function setCookie(name: string, value: string, opts: { maxAge: number; secure: boolean; path?: string }) {
  return [
    `${name}=${encodeURIComponent(value)}`,
    `Path=${opts.path ?? "/"}`,
    `Max-Age=${opts.maxAge}`,
    "HttpOnly",
    "SameSite=Lax",
    ...(opts.secure ? ["Secure"] : []),
  ].join("; ");
}
