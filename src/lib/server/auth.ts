import { headers } from "next/headers";
import { publicUser, SESSION_COOKIE, userFromTokens, type PublicUser } from "./session";
import { loadStore, type Role, type StoreData, type StoredUser } from "./store";

/** ログインの Cookie の値（同じ名前が複数届くことがあるので全部） */
export function sessionTokensFrom(req: Request): string[] {
  return sessionTokensIn(req.headers.get("cookie") ?? "");
}

function sessionTokensIn(header: string): string[] {
  const out: string[] = [];
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k !== SESSION_COOKIE) continue;
    try {
      out.push(decodeURIComponent(v.join("=")));
    } catch {
      /* 壊れた値は使わない */
    }
  }
  return out;
}

/**
 * 書き換えの要求は同じサイトの画面からだけ受け付ける（CSRF対策）。
 * ブラウザは別サイトからの送信に Origin を付けるので、Host と比べる。
 */
export function sameOrigin(req: Request): boolean {
  if (req.method === "GET" || req.method === "HEAD") return true;
  const origin = req.headers.get("origin");
  if (!origin) return true; // ブラウザ以外（curl など）。Cookie は SameSite=Lax で守る
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

type Guard =
  | { ok: true; user: StoredUser; data: StoreData }
  | { ok: false; response: Response };

/** APIの入口で使う。ログインと（指定があれば）ロールを確かめる */
export async function requireUser(req: Request, role?: Role): Promise<Guard> {
  if (!sameOrigin(req)) return { ok: false, response: Response.json({ error: "別のサイトからの要求は受け付けません。" }, { status: 403 }) };
  const data = await loadStore();
  const user = userFromTokens(sessionTokensFrom(req), data);
  if (!user) return { ok: false, response: Response.json({ error: "ログインしてください。" }, { status: 401 }) };
  if (role && user.role !== role) {
    return { ok: false, response: Response.json({ error: "管理者だけが使える機能です。" }, { status: 403 }) };
  }
  return { ok: true, user, data };
}

/** 画面（サーバーコンポーネント）で使う */
export async function currentUser(): Promise<PublicUser | null> {
  // cookies() は同じ名前の Cookie を1つにまとめてしまうので、ヘッダーをそのまま読む
  const tokens = sessionTokensIn((await headers()).get("cookie") ?? "");
  const user = userFromTokens(tokens, await loadStore());
  return user ? publicUser(user) : null;
}

/** 本番（HTTPS の後ろ）では Secure 付きの Cookie にする */
export function secureCookies(req: Request): boolean {
  if (process.env.NINEGAGE_INSECURE_COOKIE === "true") return false;
  const proto = req.headers.get("x-forwarded-proto");
  if (proto) return proto === "https";
  return process.env.NODE_ENV === "production";
}

/** ログインの総当たりを遅らせる（同じ送信元またはユーザー名で15分に10回まで） */
const failures = new Map<string, { count: number; until: number }>();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 10;

export function clientKey(req: Request): string {
  return (req.headers.get("x-forwarded-for")?.split(",")[0] ?? "local").trim();
}

export function loginBlocked(keys: string[], now = Date.now()): boolean {
  return keys.some((k) => {
    const f = failures.get(k);
    return !!f && f.until > now && f.count >= MAX_FAILURES;
  });
}

export function recordLoginFailure(keys: string[], now = Date.now()) {
  for (const k of keys) {
    const f = failures.get(k);
    if (!f || f.until <= now) failures.set(k, { count: 1, until: now + WINDOW_MS });
    else f.count += 1;
  }
  if (failures.size > 10000) {
    for (const [k, f] of failures) if (f.until <= now) failures.delete(k);
  }
}

export function clearLoginFailures(keys: string[]) {
  for (const k of keys) failures.delete(k);
}

/** ユーザー登録の連続作成を止める（同じ送信元から1時間に5件まで） */
const signups = new Map<string, { count: number; until: number }>();
const SIGNUP_WINDOW_MS = 60 * 60 * 1000;
export const MAX_SIGNUPS = 5;

export function signupBlocked(key: string, now = Date.now()): boolean {
  const s = signups.get(key);
  return !!s && s.until > now && s.count >= MAX_SIGNUPS;
}

export function recordSignup(key: string, now = Date.now()) {
  const s = signups.get(key);
  if (!s || s.until <= now) signups.set(key, { count: 1, until: now + SIGNUP_WINDOW_MS });
  else s.count += 1;
  if (signups.size > 10000) {
    for (const [k, v] of signups) if (v.until <= now) signups.delete(k);
  }
}
