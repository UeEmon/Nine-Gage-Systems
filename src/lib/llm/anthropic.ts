import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { AskResult, ChatSession, ResolvedAiSettings, SessionOptions } from "./types";

/**
 * Claude 用セッション。構造化出力（zod）で部品の並びを受け取る。
 * 会話は追記のみで、思考ブロックを含む応答をそのまま履歴に戻す。
 */
export function createAnthropicSession(
  settings: ResolvedAiSettings,
  opts: SessionOptions,
  client: Anthropic = new Anthropic({ apiKey: settings.apiKey, baseURL: settings.baseUrl || undefined }),
): ChatSession {
  const messages: Anthropic.Beta.BetaMessageParam[] = [];
  // Claude 5 系以降のみサーバー側フォールバック（拒否時に別モデルで再実行）を付ける
  const supportsFallback = /^claude-(opus|sonnet|fable)-5/.test(settings.model);

  return {
    async ask(userText: string): Promise<AskResult> {
      messages.push({ role: "user", content: userText });
      const response = await client.beta.messages.parse({
        model: settings.model,
        max_tokens: 16000,
        ...(supportsFallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
        system: [{ type: "text", text: opts.system, cache_control: { type: "ephemeral" } }],
        output_config: { effort: "high", format: betaZodOutputFormat(opts.zodSchema) },
        messages,
      });
      messages.push({ role: "assistant", content: response.content });
      const text = response.content.map((b) => (b.type === "text" ? b.text : "")).join("");
      return {
        json: response.parsed_output ?? null,
        text,
        refused: response.stop_reason === "refusal",
        truncated: response.stop_reason === "max_tokens",
      };
    },
  };
}

export async function listAnthropicModels(settings: ResolvedAiSettings): Promise<string[]> {
  const client = new Anthropic({ apiKey: settings.apiKey, baseURL: settings.baseUrl || undefined });
  const ids: string[] = [];
  for await (const m of client.models.list()) ids.push(m.id);
  return ids;
}
