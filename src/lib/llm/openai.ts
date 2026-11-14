import OpenAI from "openai";
import { extractJson } from "./json";
import { DEFAULT_LOCAL_BASE_URL, type AskResult, type ChatSession, type ResolvedAiSettings, type SessionOptions } from "./types";

type Msg = OpenAI.Chat.Completions.ChatCompletionMessageParam;

function makeClient(settings: ResolvedAiSettings): OpenAI {
  const isLocal = settings.provider === "local";
  return new OpenAI({
    // ローカルLLMはキー不要のことが多いが、SDKは空文字を受け付けないため仮の値を入れる
    apiKey: settings.apiKey || (isLocal ? "local" : undefined),
    baseURL: settings.baseUrl || (isLocal ? DEFAULT_LOCAL_BASE_URL : undefined),
    timeout: isLocal ? 10 * 60 * 1000 : undefined,
  });
}

/**
 * OpenAI と、OpenAI互換APIを持つローカルLLM（Ollama, LM Studio, vLLM, llama.cpp server など）用セッション。
 * まず JSON Schema 付きの構造化出力を試し、サーバーが対応していなければ
 * 「JSONだけを出力して」という指示に切り替えてテキストから取り出す。
 */
export function createOpenAiSession(
  settings: ResolvedAiSettings,
  opts: SessionOptions,
  client: OpenAI = makeClient(settings),
): ChatSession {
  const messages: Msg[] = [{ role: "system", content: opts.system }];
  let structured = true;

  const call = () =>
    client.chat.completions.create({
      model: settings.model,
      messages,
      ...(structured
        ? {
            response_format: {
              type: "json_schema" as const,
              json_schema: { name: opts.schemaName, schema: opts.jsonSchema, strict: settings.provider === "openai" },
            },
          }
        : {}),
    });

  return {
    async ask(userText: string): Promise<AskResult> {
      messages.push({ role: "user", content: userText });
      let completion: OpenAI.Chat.Completions.ChatCompletion;
      try {
        completion = await call();
      } catch (err) {
        // 構造化出力に未対応のサーバー（主にローカルLLM）は、指示文での JSON 出力に切り替える
        if (structured && settings.provider === "local" && err instanceof OpenAI.BadRequestError) {
          structured = false;
          messages[messages.length - 1] = {
            role: "user",
            content: `${userText}\n\n出力は次の JSON Schema に従う JSON オブジェクト1つだけにしてください。説明文やコードフェンスは不要です。\n${JSON.stringify(opts.jsonSchema)}`,
          };
          completion = await call();
        } else {
          throw err;
        }
      }
      const choice = completion.choices[0];
      const text = choice?.message?.content ?? "";
      messages.push({ role: "assistant", content: text });
      return {
        json: extractJson(text),
        text,
        refused: Boolean(choice?.message?.refusal),
        truncated: choice?.finish_reason === "length",
        usage: completion.usage
          ? {
              // prompt_tokens には自動キャッシュから読んだ分も含まれるので分けて数える
              inputTokens: completion.usage.prompt_tokens - (completion.usage.prompt_tokens_details?.cached_tokens ?? 0),
              outputTokens: completion.usage.completion_tokens,
              cacheReadTokens: completion.usage.prompt_tokens_details?.cached_tokens ?? 0,
              cacheWriteTokens: 0,
            }
          : undefined,
      };
    },
  };
}

export async function listOpenAiModels(settings: ResolvedAiSettings): Promise<string[]> {
  const client = makeClient(settings);
  const ids: string[] = [];
  for await (const m of client.models.list()) ids.push(m.id);
  return ids.sort();
}
