import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { AskResult, ChatSession, ResolvedAiSettings, SessionOptions, TokenUsage } from "./types";

type Env = Record<string, string | undefined>;

/**
 * システムプロンプト（カタログ・例・設計のコツ）のキャッシュの保持時間。
 * 既定は5分。利用の間隔が5分を超えることが多いサーバーでは ANTHROPIC_CACHE_TTL=1h にすると
 * 書き込みは2倍になるが、1時間のあいだ読み直せる。
 */
export function systemCacheControl(env: Env = process.env): Anthropic.Beta.BetaCacheControlEphemeral {
  return env.ANTHROPIC_CACHE_TTL === "1h" ? { type: "ephemeral", ttl: "1h" } : { type: "ephemeral" };
}

export function usageFromAnthropic(u: Anthropic.Beta.BetaUsage | undefined): TokenUsage | undefined {
  if (!u) return undefined;
  return {
    inputTokens: u.input_tokens ?? 0,
    outputTokens: u.output_tokens ?? 0,
    cacheReadTokens: u.cache_read_input_tokens ?? 0,
    cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
    ...(u.cache_creation?.ephemeral_1h_input_tokens ? { cacheWrite1hTokens: u.cache_creation.ephemeral_1h_input_tokens } : {}),
  };
}

/**
 * Claude 用セッション。構造化出力（zod）で部品の並びを受け取る。
 * 会話は追記のみで、思考ブロックを含む応答をそのまま履歴に戻す。
 *
 * プロンプトキャッシュ:
 * - 変わらない大きな部分（システムプロンプト＝部品カタログ・例・コツ。メーカーごとに固定）に明示のブレークポイント。
 *   ここは会社ごとに全員・全リクエストで同じなので、別の人の提案でもキャッシュを読める。
 * - リクエスト全体の自動キャッシュ（最後のブロックに付く）。検査で問題が見つかって出し直すとき、
 *   それまでの会話（前の案と指摘）をキャッシュから読む。
 * 可変の部分（ボード・要望・所有パーツ・予算）はすべてユーザーメッセージに入れ、システムプロンプトには入れない。
 */
export function createAnthropicSession(
  settings: ResolvedAiSettings,
  opts: SessionOptions,
  client: Anthropic = new Anthropic({ apiKey: settings.apiKey, baseURL: settings.baseUrl || undefined }),
  env: Env = process.env,
): ChatSession {
  const messages: Anthropic.Beta.BetaMessageParam[] = [];
  // Claude 5 系以降のみサーバー側フォールバック（拒否時に別モデルで再実行）を付ける
  const supportsFallback = /^claude-(opus|sonnet|fable)-5/.test(settings.model);
  const system: Anthropic.Beta.BetaTextBlockParam[] = [
    { type: "text", text: opts.system, cache_control: systemCacheControl(env) },
  ];
  const format = betaZodOutputFormat(opts.zodSchema);

  return {
    async ask(userText: string): Promise<AskResult> {
      messages.push({ role: "user", content: userText });
      // ストリーミングで受け取り、応答の開始（＝キャッシュが読めるようになった時点）を知らせる
      const stream = client.beta.messages.stream({
        model: settings.model,
        max_tokens: 16000,
        ...(supportsFallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
        cache_control: { type: "ephemeral" },
        system,
        output_config: { effort: "high", format },
        messages,
      });
      let started = false;
      stream.on("streamEvent", (event) => {
        if (!started && event.type === "message_start") {
          started = true;
          opts.onResponseStart?.();
        }
      });
      const response = await stream.finalMessage();
      messages.push({ role: "assistant", content: response.content });
      const text = response.content.map((b) => (b.type === "text" ? b.text : "")).join("");
      return {
        json: response.parsed_output ?? null,
        text,
        refused: response.stop_reason === "refusal",
        truncated: response.stop_reason === "max_tokens",
        usage: usageFromAnthropic(response.usage),
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
