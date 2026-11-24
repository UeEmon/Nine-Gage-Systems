import nodemailer from "nodemailer";
import { homeUrl } from "../sites";
import type { Env } from "./store";

/**
 * メール送信（登録の確認メール）。SMTP の接続先は NINEGAGE_SMTP_URL、差出人は NINEGAGE_MAIL_FROM。
 * 例: smtps://you%40gmail.com:アプリパスワード@smtp.gmail.com:465
 *     OCI Email Delivery なら smtp://<SMTPユーザー名>:<SMTPパスワード>@smtp.email.ap-tokyo-1.oci.oraclecloud.com:587
 *     （ユーザー名とパスワードは URL エンコードする。差出人は承認済み送信者のアドレス）
 * 未設定のとき、本番では送れない（登録を受け付けない）。開発中はサーバーのログに本文を出す。
 */

export type Mail = { to: string; subject: string; text: string };

export function mailConfigured(env: Env = process.env): boolean {
  return !!env.NINEGAGE_SMTP_URL?.trim() && !!env.NINEGAGE_MAIL_FROM?.trim();
}

/** メールを送れる（または開発用にログへ出せる）か */
export function canSendMail(env: Env = process.env): boolean {
  return mailConfigured(env) || env.NODE_ENV !== "production";
}

/**
 * smtp://（587番など）では STARTTLS を必ず使う（暗号化できないサーバーには送らない）。
 * smtps:// は最初から暗号化。手元の試験用サーバー（localhost）だけは平文を許す。
 */
export function transportOptions(url: string): { url: string; requireTLS?: boolean } {
  try {
    const u = new URL(url);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
    if (u.protocol === "smtp:" && !local) return { url, requireTLS: true };
  } catch {
    /* nodemailer にそのまま渡して、形の誤りはそちらで知らせる */
  }
  return { url };
}

/** 登録の確認やパスワード再設定のメールを送れるか（送り方と、リンクの基点のアドレスがそろっている） */
export function mailLinksReady(env: Env = process.env): boolean {
  if (!canSendMail(env)) return false;
  return env.NODE_ENV !== "production" || !!(homeUrl(env) ?? env.NINEGAGE_PUBLIC_URL?.trim());
}

export type Sender = (mail: Mail) => Promise<void>;

export function mailSender(env: Env = process.env): Sender {
  if (!mailConfigured(env)) {
    return async (mail) => {
      if (env.NODE_ENV === "production") throw new Error("メール送信が設定されていません（NINEGAGE_SMTP_URL / NINEGAGE_MAIL_FROM）。");
      console.info(`[mail] (未設定のためログに出力) to=${mail.to} subject=${mail.subject}\n${mail.text}`);
    };
  }
  const transport = nodemailer.createTransport(transportOptions(env.NINEGAGE_SMTP_URL!.trim()));
  return async (mail) => {
    await transport.sendMail({ from: env.NINEGAGE_MAIL_FROM!.trim(), ...mail });
  };
}

/**
 * メールに書くリンクの基点。トップページ（NINEGAGE_HOME_URL）があればそこ、なければ NINEGAGE_PUBLIC_URL（例 https://nine-gage.example.com）を使う。
 * 本番で未設定なら送らない（Host ヘッダーを信じると、偽のリンクを送らされるおそれがある）。開発中は要求の URL から作る。
 */
export function publicBaseUrl(req: Request, env: Env = process.env): string | null {
  const fixed = (homeUrl(env) ?? env.NINEGAGE_PUBLIC_URL)?.trim().replace(/\/+$/, "");
  if (fixed) return /^https?:\/\//.test(fixed) ? fixed : null;
  if (env.NODE_ENV === "production") return null;
  return new URL(req.url).origin;
}
