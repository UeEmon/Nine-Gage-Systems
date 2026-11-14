import { GoogleGenAI, type Content } from "@google/genai";
import { extractJson } from "./json";
import type { AskResult, ChatSession, ResolvedAiSettings, SessionOptions } from "./types";

function makeClient(settings: ResolvedAiSettings): GoogleGenAI {
  return new GoogleGenAI({
    apiKey: settings.apiKey,
    ...(settings.baseUrl ? { httpOptions: { baseUrl: settings.baseUrl } } : {}),
  });
}

/** Gemini 用セッション。responseJsonSchema で構造化出力を受け取る */
export function createGeminiSession(
  settings: ResolvedAiSettings,
  opts: SessionOptions,
  client: GoogleGenAI = makeClient(settings),
): ChatSession {
  const contents: Content[] = [];
  return {
    async ask(userText: string): Promise<AskResult> {
      contents.push({ role: "user", parts: [{ text: userText }] });
      const response = await client.models.generateContent({
        model: settings.model,
        contents,
        config: {
          systemInstruction: opts.system,
          responseMimeType: "application/json",
          responseJsonSchema: opts.jsonSchema,
        },
      });
      const candidate = response.candidates?.[0];
      const text = response.text ?? "";
      // 思考の署名などを保つため、モデルの応答は受け取った形のまま履歴へ戻す
      contents.push(candidate?.content ?? { role: "model", parts: [{ text }] });
      const reason = candidate?.finishReason ?? "";
      return {
        json: extractJson(text),
        text,
        refused: reason === "SAFETY" || reason === "PROHIBITED_CONTENT" || Boolean(response.promptFeedback?.blockReason),
        truncated: reason === "MAX_TOKENS",
      };
    },
  };
}

export async function listGeminiModels(settings: ResolvedAiSettings): Promise<string[]> {
  const pager = await makeClient(settings).models.list();
  const ids: string[] = [];
  for await (const m of pager) {
    if (!m.name) continue;
    if (m.supportedActions && !m.supportedActions.includes("generateContent")) continue;
    ids.push(m.name.replace(/^models\//, ""));
  }
  return ids.sort();
}
