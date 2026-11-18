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
 * 1回の応答の出力上限（モデルの上限が分からないとき）。思考（effort: high）もここに含まれる。
 * 「再現してみた」の忠実モードなど部品が多い案では 16000 で切れることがあったため広げた。
 * 上限は使った分だけ課金されるので、広げても普段の費用は変わらない。
 */
export const MAX_TOKENS = 32000;
/**
 * モデルが受け付ける出力上限がこれより大きくても、ここまでにとどめる。
 * 忠実モードの駅などは 32000 でも思考と出力の合計が切れることがあるため、モデルが許す限り広げる。
 */
export const MAX_TOKENS_CAP = 128000;

/** モデルごとの出力上限（Models API の max_tokens）。分からなければ null */
const modelLimitCache = new Map<string, Promise<number | null>>();

export function modelMaxTokens(client: Anthropic, model: string, cacheKey = model): Promise<number | null> {
  let p = modelLimitCache.get(cacheKey);
  if (!p) {
    p = (async () => {
      try {
        const info = (await client.models.retrieve(model)) as { max_tokens?: number | null };
        return typeof info.max_tokens === "number" && info.max_tokens > 0 ? info.max_tokens : null;
      } catch {
        return null;
      }
    })();
    modelLimitCache.set(cacheKey, p);
    // 失敗（null）はキャッシュに残さず、次の依頼で聞き直す
    void p.then((v) => {
      if (v === null) modelLimitCache.delete(cacheKey);
    });
  }
  return p;
}

/** 1回の応答に指定する max_tokens。モデルの上限が分かればそこまで広げる */
export function maxTokensFor(modelLimit: number | null): number {
  if (!modelLimit) return MAX_TOKENS;
  return Math.max(Math.min(modelLimit, MAX_TOKENS_CAP), Math.min(MAX_TOKENS, modelLimit));
}

function parseJson(text: string): unknown | null {
  if (!text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
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
  // JSONの解釈はこちらで行う。SDKに任せる（parse 付きで渡す）と、出力が上限で途中で切れたときや
  // 空のときに finalMessage() が例外を投げ、出し直しの処理まで届かない。
  const { parse: _parse, ...format } = betaZodOutputFormat(opts.zodSchema);
  // 途中で切れた応答は履歴に残さず、その依頼を次の依頼の前に付けて送り直す
  let carryOver = "";
  // 出力が上限で切れたあとは思考を控えめにして、出力（部品の並び）に回す
  let effort: "high" | "medium" = "high";

  return {
    async ask(userText: string): Promise<AskResult> {
      const content = carryOver ? `${carryOver}\n\n${userText}` : userText;
      carryOver = "";
      const maxTokens = maxTokensFor(await modelMaxTokens(client, settings.model, `${settings.baseUrl ?? ""}|${settings.model}`));
      messages.push({ role: "user", content });
      // ストリーミングで受け取り、応答の開始（＝キャッシュが読めるようになった時点）を知らせる
      const stream = client.beta.messages.stream({
        model: settings.model,
        max_tokens: maxTokens,
        ...(supportsFallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
        cache_control: { type: "ephemeral" },
        system,
        output_config: { effort, format },
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
      const text = response.content.map((b) => (b.type === "text" ? b.text : "")).join("");
      const truncated = response.stop_reason === "max_tokens";
      if (truncated) {
        // 途中で切れた思考・出力を履歴に戻すと次の呼び出しが拒否されることがあり、入力も無駄に増える
        messages.pop();
        carryOver = content;
        effort = "medium";
      } else {
        messages.push({ role: "assistant", content: response.content });
      }
      return {
        json: truncated ? null : parseJson(text),
        text,
        refused: response.stop_reason === "refusal",
        truncated,
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
