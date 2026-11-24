// プラットフォームとターミナルのあいだのログインの受け渡し。
//
// 1. ターミナルの「ログイン」で、乱数の state を Cookie に置いて、プラットフォームの /api/terminal/handoff?state=… へ移る
// 2. プラットフォームはログイン中のユーザーを確かめ、ユーザーID・名前・ロール・state・期限（60秒）に署名した合図を作り、
//    ターミナルの /auth/callback?token=… へ戻す（戻り先は SENROLAB_TERMINAL_URL に固定）
// 3. ターミナルは署名・期限・state を確かめて、自分のログインの Cookie を出す
//
// 署名の鍵は両方のコンテナに渡す SENROLAB_TERMINAL_SECRET（32文字以上）。ターミナルはパスワードを持たない。

import { createHmac, timingSafeEqual } from "node:crypto";

export type TerminalIdentity = { sub: string; name: string; role: string };
type Payload = TerminalIdentity & { state: string; exp: number; v: 1 };

export const HANDOFF_TTL_SEC = 60;
export const MIN_SECRET_LENGTH = 32;

function mac(body: string, secret: string) {
  return createHmac("sha256", `senrolab-terminal:${secret}`).update(body).digest("base64url");
}

export function signHandoff(id: TerminalIdentity, state: string, secret: string, now = Date.now()): string {
  if (secret.length < MIN_SECRET_LENGTH) throw new Error("SENROLAB_TERMINAL_SECRET が短すぎます");
  const payload: Payload = { v: 1, sub: id.sub, name: id.name, role: id.role, state, exp: Math.floor(now / 1000) + HANDOFF_TTL_SEC };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${mac(body, secret)}`;
}

/** 署名・期限・state が合えば、プラットフォームのユーザーを返す */
export function verifyHandoff(token: string, state: string, secret: string, now = Date.now()): TerminalIdentity | null {
  if (secret.length < MIN_SECRET_LENGTH || !state) return null;
  const [body, sig, extra] = token.split(".");
  if (!body || !sig || extra !== undefined) return null;
  const expected = Buffer.from(mac(body, secret));
  const given = Buffer.from(sig);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  let p: Payload;
  try {
    p = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (p.v !== 1 || typeof p.sub !== "string" || typeof p.name !== "string" || typeof p.role !== "string") return null;
  if (!(p.exp * 1000 > now)) return null;
  const a = Buffer.from(String(p.state));
  const b = Buffer.from(state);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return { sub: p.sub, name: p.name, role: p.role };
}

/** プラットフォームからターミナルへ戻すURL。設定がなければ null（ターミナルを使わない） */
export function terminalCallbackUrl(terminalUrl: string, token: string): string {
  const u = new URL("/auth/callback", terminalUrl);
  u.searchParams.set("token", token);
  return u.toString();
}
