// 共有サイトの設定（環境変数）
import { MIN_SECRET_LENGTH } from "../../../src/lib/shareLink";

export function dataDir() {
  return process.env.SHARE_DATA_DIR || "./share-data";
}

/** 本体（SenroLab）の公開URL。ログインとリンクに使う */
export function senrolabUrl(): string {
  return (process.env.SENROLAB_URL || "http://localhost:3000").replace(/\/+$/, "");
}

/** 本体と共有する、ログインの受け渡しの鍵 */
export function handoffSecret(): string {
  return process.env.SENROLAB_SHARE_SECRET ?? "";
}

/** 共有サイトのログインの Cookie の署名の鍵 */
export function sessionSecret(): string {
  const s = process.env.SHARE_SESSION_SECRET ?? "";
  if (s.length >= MIN_SECRET_LENGTH) return s;
  if (process.env.NODE_ENV === "production") throw new Error("SHARE_SESSION_SECRET（32文字以上）を設定してください");
  return "development-only-share-session-secret-0000";
}

export function secureCookies(req: Request): boolean {
  if (process.env.SHARE_INSECURE_COOKIE === "true") return false;
  const proto = req.headers.get("x-forwarded-proto");
  if (proto) return proto === "https";
  return process.env.NODE_ENV === "production";
}
