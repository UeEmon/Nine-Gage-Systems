// 本体（SenroLab）と共有サイトのあいだのログインの受け渡し。
//
// 1. 共有サイトの「ログイン」で、乱数の state を Cookie に置いて、本体の /api/share/handoff?state=… へ移る
// 2. 本体はログイン中のユーザーを確かめ、ユーザーID・名前・ロール・state・期限（60秒）に署名した合図を作り、
//    共有サイトの /auth/callback?token=… へ戻す（戻り先は SENROLAB_SHARE_URL に固定）
// 3. 共有サイトは署名・期限・state を確かめて、自分のログインの Cookie を出す
//
// 署名の鍵は両方のコンテナに渡す SENROLAB_SHARE_SECRET（32文字以上）。共有サイトはパスワードを持たない。

import { createHmac, timingSafeEqual } from "node:crypto";

export type ShareIdentity = { sub: string; name: string; role: string };
type Payload = ShareIdentity & { state: string; exp: number; v: 1 };

export const HANDOFF_TTL_SEC = 60;
export const MIN_SECRET_LENGTH = 32;

function mac(body: string, secret: string) {
  return createHmac("sha256", `senrolab-share:${secret}`).update(body).digest("base64url");
}

export function signHandoff(id: ShareIdentity, state: string, secret: string, now = Date.now()): string {
  if (secret.length < MIN_SECRET_LENGTH) throw new Error("SENROLAB_SHARE_SECRET が短すぎます");
  const payload: Payload = { v: 1, sub: id.sub, name: id.name, role: id.role, state, exp: Math.floor(now / 1000) + HANDOFF_TTL_SEC };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${mac(body, secret)}`;
}

/** 署名・期限・state が合えば、本体のユーザーを返す */
export function verifyHandoff(token: string, state: string, secret: string, now = Date.now()): ShareIdentity | null {
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

/** 本体から共有サイトへ戻すURL。設定がなければ null（共有サイトを使わない） */
export function shareCallbackUrl(shareUrl: string, token: string): string {
  const u = new URL("/auth/callback", shareUrl);
  u.searchParams.set("token", token);
  return u.toString();
}
