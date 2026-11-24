import { MIN_SECRET_LENGTH } from "../shareLink";

/** ターミナルの設定。URL と鍵の両方があるときだけ使う */
export function shareConfig(): { url: string; secret: string } | null {
  const url = process.env.SENROLAB_SHARE_URL?.trim();
  const secret = process.env.SENROLAB_SHARE_SECRET ?? "";
  if (!url || secret.length < MIN_SECRET_LENGTH) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return { url: u.origin, secret };
  } catch {
    return null;
  }
}

/** ログイン後に戻る先として受け付けるのは、このサイトの中のパスだけ */
export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return "/";
  return next;
}
