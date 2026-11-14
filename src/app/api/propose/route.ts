import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { proposeLayout, ProposeError } from "@/lib/ai";

export const runtime = "nodejs";
export const maxDuration = 300;

const BodySchema = z.object({
  board: z.object({
    width: z.number().min(200).max(10000),
    height: z.number().min(200).max(10000),
  }),
  request: z.string().max(2000),
});

export async function POST(req: Request) {
  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "入力が正しくありません（ボードは200〜10000mm、要望は2000文字まで）" }, { status: 400 });
  }
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    return Response.json({ error: "サーバーに ANTHROPIC_API_KEY が設定されていません。" }, { status: 503 });
  }

  try {
    const result = await proposeLayout(parsed.data);
    return Response.json(result);
  } catch (err) {
    if (err instanceof ProposeError) return Response.json({ error: err.message }, { status: 422 });
    if (err instanceof Anthropic.RateLimitError) {
      return Response.json({ error: "AIの利用が混み合っています。少し待ってからお試しください。" }, { status: 429 });
    }
    if (err instanceof Anthropic.AuthenticationError) {
      return Response.json({ error: "APIキーが無効です。" }, { status: 500 });
    }
    if (err instanceof Anthropic.APIError) {
      console.error("Claude API error", err.status, err.message);
      return Response.json({ error: `AIの呼び出しに失敗しました（${err.status ?? "接続エラー"}）` }, { status: 502 });
    }
    console.error(err);
    return Response.json({ error: "不明なエラーが発生しました。" }, { status: 500 });
  }
}
