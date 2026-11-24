// ターミナルの設定（環境変数）
import { MIN_SECRET_LENGTH } from "../../../src/lib/terminalLink";

/** 環境変数を読む。旧名（SHARE_* / SENROLAB_SHARE_*。名称変更前のデプロイ設定）もしばらく受け付ける */
function env(name: string, oldName: string): string | undefined {
  return process.env[name] ?? process.env[oldName];
}

export function dataDir() {
  return env("TERMINAL_DATA_DIR", "SHARE_DATA_DIR") || "./terminal-data";
}

/** プラットフォームの公開URL。ログインとリンクに使う */
export function senrolabUrl(): string {
  return (process.env.SENROLAB_URL || "http://localhost:3000").replace(/\/+$/, "");
}

/** プラットフォームと共有する、ログインの受け渡しの鍵 */
export function handoffSecret(): string {
  return env("SENROLAB_TERMINAL_SECRET", "SENROLAB_SHARE_SECRET") ?? "";
}

/** ターミナルのログインの Cookie の署名の鍵 */
export function sessionSecret(): string {
  const s = env("TERMINAL_SESSION_SECRET", "SHARE_SESSION_SECRET") ?? "";
  if (s.length >= MIN_SECRET_LENGTH) return s;
  if (process.env.NODE_ENV === "production") throw new Error("TERMINAL_SESSION_SECRET（32文字以上）を設定してください");
  return "development-only-terminal-session-secret-0000";
}

export function secureCookies(req: Request): boolean {
  if (env("TERMINAL_INSECURE_COOKIE", "SHARE_INSECURE_COOKIE") === "true") return false;
  const proto = req.headers.get("x-forwarded-proto");
  if (proto) return proto === "https";
  return process.env.NODE_ENV === "production";
}
