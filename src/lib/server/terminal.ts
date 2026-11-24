import { MIN_SECRET_LENGTH } from "../terminalLink";

/** ターミナルの設定。URL と鍵の両方があるときだけ使う。旧名の SENROLAB_SHARE_*（名称変更前のデプロイ設定）もしばらく受け付ける */
export function terminalConfig(): { url: string; secret: string } | null {
  const url = (process.env.SENROLAB_TERMINAL_URL ?? process.env.SENROLAB_SHARE_URL)?.trim();
  const secret = process.env.SENROLAB_TERMINAL_SECRET ?? process.env.SENROLAB_SHARE_SECRET ?? "";
  if (!url || secret.length < MIN_SECRET_LENGTH) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return { url: u.origin, secret };
  } catch {
    return null;
  }
}

/** ログイン後に戻る先（トップページとプラットフォームのアドレスも受け付ける） */
export { safeNext } from "../sites";
