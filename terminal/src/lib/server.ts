// API と画面で使う共通の処理（サーバー側だけ）
import { cookies } from "next/headers";
import type { DatabaseSync } from "node:sqlite";
import { dataDir, sessionSecret } from "./config";
import { cookieValue, readSession, SESSION_COOKIE, type TerminalUser } from "./session";
import { openStore } from "./store";

export function db(): DatabaseSync {
  return openStore(dataDir());
}

export function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

export function userFrom(req: Request): TerminalUser | null {
  return readSession(cookieValue(req, SESSION_COOKIE), sessionSecret());
}

/** 画面（サーバーコンポーネント）で使う */
export async function currentUser(): Promise<TerminalUser | null> {
  return readSession((await cookies()).get(SESSION_COOKIE)?.value, sessionSecret());
}

/** 書き換えの要求は同じサイトの画面からだけ受け付ける（CSRF対策） */
export function sameOrigin(req: Request): boolean {
  if (req.method === "GET" || req.method === "HEAD") return true;
  const origin = req.headers.get("origin");
  if (!origin) return true;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

type Guard = { ok: true; user: TerminalUser } | { ok: false; response: Response };

export function requireUser(req: Request): Guard {
  if (!sameOrigin(req)) return { ok: false, response: json({ error: "別のサイトからの要求は受け付けません。" }, 403) };
  const user = userFrom(req);
  if (!user) return { ok: false, response: json({ error: "ログインしてください。" }, 401) };
  return { ok: true, user };
}

/** 本文を JSON として読む（大きすぎるものは断る） */
export async function readJson(req: Request, maxBytes: number): Promise<{ ok: true; body: unknown } | { ok: false; response: Response }> {
  const text = await req.text();
  if (Buffer.byteLength(text) > maxBytes) return { ok: false, response: json({ error: "データが大きすぎます。" }, 413) };
  try {
    return { ok: true, body: JSON.parse(text) };
  } catch {
    return { ok: false, response: json({ error: "JSONとして読めませんでした。" }, 400) };
  }
}

export function canEdit(user: TerminalUser | null, ownerId: string) {
  return !!user && (user.sub === ownerId || user.admin);
}
