import { z } from "zod";
import { defaultProvider, resolveSettings, serverAiInfo, type ResolvedAiSettings } from "@/lib/llm";
import { DEFAULT_LOCAL_BASE_URL, LlmError, PROVIDERS, type ProviderId } from "@/lib/llm/types";
import type { Env, ProviderSettings, StoredAi } from "./store";

/**
 * AIの設定は管理者が画面で決め、サーバーに保存する。
 * 項目が空なら環境変数（ANTHROPIC_API_KEY など）を使う。一般ユーザーは設定を見たり変えたりできない。
 */

export function activeProvider(ai: StoredAi, env: Env = process.env): ProviderId {
  return ai.provider ?? defaultProvider(env);
}

/** 保存した設定と環境変数から、実際に使う設定を決める。接続先URLは管理者が決めたものなので許可する */
export function settingsForUse(ai: StoredAi, env: Env = process.env, provider = activeProvider(ai, env)): ResolvedAiSettings {
  const s = ai.byProvider[provider] ?? {};
  try {
    return resolveSettings({ provider, ...s }, { ...env, AI_ALLOW_CUSTOM_BASE_URL: "true" });
  } catch (err) {
    if (err instanceof LlmError && /APIキーがありません/.test(err.message)) {
      throw new LlmError("AIのAPIキーが設定されていません。管理者に「管理」画面のAI設定を依頼してください。", 503);
    }
    throw err;
  }
}

function mask(key?: string) {
  if (!key) return null;
  return key.length <= 8 ? "••••" : `••••${key.slice(-4)}`;
}

/** 管理画面向け。キーそのものは返さず、末尾4文字だけ見せる */
export function adminAiView(ai: StoredAi, env: Env = process.env) {
  const info = serverAiInfo(env);
  return {
    provider: activeProvider(ai, env),
    providers: Object.fromEntries(
      PROVIDERS.map((p) => {
        const s = ai.byProvider[p] ?? {};
        return [
          p,
          {
            model: s.model ?? "",
            baseUrl: s.baseUrl ?? "",
            savedKey: mask(s.apiKey),
            envKey: info.providers[p].hasServerKey,
            defaultModel: info.providers[p].defaultModel,
            defaultBaseUrl: p === "local" ? env.LOCAL_LLM_BASE_URL || DEFAULT_LOCAL_BASE_URL : "",
          },
        ];
      }),
    ) as Record<
      ProviderId,
      { model: string; baseUrl: string; savedKey: string | null; envKey: boolean; defaultModel: string; defaultBaseUrl: string }
    >,
  };
}

/** 全員向け。どのAIを使うかと、使える状態かだけ */
export function publicAiView(ai: StoredAi, env: Env = process.env) {
  const provider = activeProvider(ai, env);
  try {
    const s = settingsForUse(ai, env, provider);
    return { provider, model: s.model, ready: true };
  } catch {
    return { provider, model: ai.byProvider[provider]?.model || serverAiInfo(env).providers[provider].defaultModel, ready: false };
  }
}

export const ProviderPatch = z.object({
  model: z.string().trim().max(200).optional(),
  /** 省略=変えない、空文字=消す */
  apiKey: z.string().trim().max(500).optional(),
  baseUrl: z
    .string()
    .trim()
    .max(500)
    .refine((v) => v === "" || /^https?:\/\//.test(v), "接続先URLは http:// か https:// で始めてください。")
    .optional(),
});

export const AiPatchSchema = z.object({
  provider: z.enum(PROVIDERS).optional(),
  byProvider: z.partialRecord(z.enum(PROVIDERS), ProviderPatch).optional(),
});

export type AiPatch = z.infer<typeof AiPatchSchema>;

export function applyAiPatch(ai: StoredAi, patch: AiPatch) {
  if (patch.provider) ai.provider = patch.provider;
  for (const p of PROVIDERS) {
    const change = patch.byProvider?.[p];
    if (!change) continue;
    const cur: ProviderSettings = { ...(ai.byProvider[p] ?? {}) };
    if (change.model !== undefined) cur.model = change.model || undefined;
    if (change.apiKey !== undefined) cur.apiKey = change.apiKey || undefined;
    if (change.baseUrl !== undefined) cur.baseUrl = change.baseUrl || undefined;
    ai.byProvider[p] = cur;
  }
}

/** 管理画面の「一覧」用。保存前の入力（キー・URL）を保存済みの設定に重ねて使う */
export type ProviderPatchInput = z.infer<typeof ProviderPatch>;

export function previewSettings(ai: StoredAi, provider: ProviderId, change: ProviderPatchInput | undefined, env: Env = process.env) {
  const copy: StoredAi = structuredClone(ai);
  applyAiPatch(copy, { byProvider: { [provider]: change ?? {} } });
  return settingsForUse(copy, env, provider);
}
