import { shareConfig } from "@/lib/server/share";

export const dynamic = "force-dynamic";

/** 「みんなのレイアウト」（共有サイト）へ移る */
export async function GET() {
  const cfg = shareConfig();
  if (!cfg) return new Response("共有サイトはまだ用意されていません。", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  return new Response(null, { status: 303, headers: { Location: cfg.url } });
}
