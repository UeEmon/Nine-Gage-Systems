import { createAnthropicSession, listAnthropicModels } from "./anthropic";
import { createGeminiSession, listGeminiModels } from "./gemini";
import { createOpenAiSession, listOpenAiModels } from "./openai";
import {
  DEFAULT_LOCAL_BASE_URL,
  DEFAULT_MODELS,
  LlmError,
  PROVIDERS,
  type AiSettings,
  type ChatSession,
  type ProviderId,
  type ResolvedAiSettings,
  type SessionOptions,
} from "./types";

export * from "./types";

type Env = Record<string, string | undefined>;

const ENV_KEYS: Record<ProviderId, { key: string; model: string; baseUrl: string }> = {
  anthropic: { key: "ANTHROPIC_API_KEY", model: "ANTHROPIC_MODEL", baseUrl: "ANTHROPIC_BASE_URL" },
  openai: { key: "OPENAI_API_KEY", model: "OPENAI_MODEL", baseUrl: "OPENAI_BASE_URL" },
  gemini: { key: "GEMINI_API_KEY", model: "GEMINI_MODEL", baseUrl: "GEMINI_BASE_URL" },
  local: { key: "LOCAL_LLM_API_KEY", model: "LOCAL_LLM_MODEL", baseUrl: "LOCAL_LLM_BASE_URL" },
};

/** そのプロバイダのAPIキーを入れる環境変数の名前 */
export function envKeyName(provider: ProviderId): string {
  return ENV_KEYS[provider].key;
}

/**
 * 画面から接続先URLを指定してよいか。
 * 公開サーバーで任意のURLへ通信させない（SSRF対策）よう、本番では明示的に許可したときだけ。
 */
export function customBaseUrlAllowed(env: Env = process.env): boolean {
  if (env.AI_ALLOW_CUSTOM_BASE_URL) return env.AI_ALLOW_CUSTOM_BASE_URL === "true";
  return env.NODE_ENV !== "production";
}

export function defaultProvider(env: Env = process.env): ProviderId {
  const p = env.AI_DEFAULT_PROVIDER as ProviderId | undefined;
  return p && PROVIDERS.includes(p) ? p : "anthropic";
}

/** 画面の設定と環境変数を合わせて、実際に使う設定を決める（画面の入力が優先） */
export function resolveSettings(input: AiSettings, env: Env = process.env): ResolvedAiSettings {
  const keys = ENV_KEYS[input.provider];
  const model = input.model?.trim() || env[keys.model] || DEFAULT_MODELS[input.provider];
  const apiKey = input.apiKey?.trim() || env[keys.key] || undefined;

  let baseUrl = env[keys.baseUrl] || undefined;
  const requested = input.baseUrl?.trim();
  if (requested) {
    if (!customBaseUrlAllowed(env)) {
      throw new LlmError("このサーバーでは接続先URLの変更は許可されていません（AI_ALLOW_CUSTOM_BASE_URL）。", 400);
    }
    if (!/^https?:\/\//.test(requested)) throw new LlmError("接続先URLは http:// か https:// で始めてください。", 400);
    baseUrl = requested;
  }
  if (input.provider === "local" && !baseUrl) baseUrl = DEFAULT_LOCAL_BASE_URL;

  if (!apiKey && input.provider !== "local") {
    throw new LlmError(`${input.provider} のAPIキーがありません。AI設定で入力するか、サーバーに ${keys.key} を設定してください。`, 400);
  }
  return { provider: input.provider, model, apiKey, baseUrl };
}

/** 画面向け: サーバー側にどのプロバイダのキーが設定されているか（キーそのものは返さない） */
export function serverAiInfo(env: Env = process.env) {
  return {
    defaultProvider: defaultProvider(env),
    allowCustomBaseUrl: customBaseUrlAllowed(env),
    providers: Object.fromEntries(
      PROVIDERS.map((p) => [
        p,
        {
          hasServerKey: Boolean(env[ENV_KEYS[p].key]),
          defaultModel: env[ENV_KEYS[p].model] || DEFAULT_MODELS[p],
          hasServerBaseUrl: Boolean(env[ENV_KEYS[p].baseUrl]) || p === "local",
        },
      ]),
    ) as Record<ProviderId, { hasServerKey: boolean; defaultModel: string; hasServerBaseUrl: boolean }>,
  };
}

export function createSession(settings: ResolvedAiSettings, opts: SessionOptions): ChatSession {
  switch (settings.provider) {
    case "anthropic":
      return createAnthropicSession(settings, opts);
    case "gemini":
      return createGeminiSession(settings, opts);
    case "openai":
    case "local":
      return createOpenAiSession(settings, opts);
  }
}

export async function listModels(settings: ResolvedAiSettings): Promise<string[]> {
  switch (settings.provider) {
    case "anthropic":
      return listAnthropicModels(settings);
    case "gemini":
      return listGeminiModels(settings);
    case "openai":
    case "local":
      return listOpenAiModels(settings);
  }
}

/** 各社SDKのエラーを、画面に出す日本語メッセージとHTTPステータスに変換する */
export function toLlmError(err: unknown, settings?: Pick<ResolvedAiSettings, "provider" | "model" | "baseUrl">): LlmError {
  if (err instanceof LlmError) return err;
  const e = err as { status?: number; code?: number | string; message?: string; cause?: { code?: string } };
  const status = typeof e?.status === "number" ? e.status : typeof e?.code === "number" ? e.code : undefined;
  const causeCode = e?.cause?.code ?? (typeof e?.code === "string" ? e.code : undefined);
  const where = settings ? `${settings.provider} / ${settings.model}` : "AI";

  if (status === 401 || status === 403) return new LlmError(`APIキーが無効か、権限がありません（${where}）。`, 401);
  if (status === 404) return new LlmError(`モデルが見つかりません（${where}）。モデル名を確認してください。`, 404);
  if (status === 429) return new LlmError("AIの利用制限に達しました。少し待ってからお試しください。", 429);
  if (status === 400) return new LlmError(`AIが要求を受け付けませんでした（${where}）: ${short(e?.message)}`, 400);
  if (causeCode === "ECONNREFUSED" || causeCode === "ENOTFOUND" || /Connection error|fetch failed/i.test(e?.message ?? "")) {
    return new LlmError(
      `AIサーバーに接続できません（${settings?.baseUrl ?? where}）。URLとサーバーが起動しているかを確認してください。`,
      502,
    );
  }
  return new LlmError(`AIの呼び出しに失敗しました（${where}${status ? `, ${status}` : ""}）: ${short(e?.message)}`, 502);
}

function short(s?: string) {
  if (!s) return "";
  return s.length > 200 ? `${s.slice(0, 200)}…` : s;
}
