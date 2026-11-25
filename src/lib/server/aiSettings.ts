import { z } from "zod";
import { defaultProvider, envKeyName, resolveSettings, serverAiInfo, type ResolvedAiSettings } from "@/lib/llm";
import { DEFAULT_LOCAL_BASE_URL, LlmError, PROVIDERS, type ProviderId } from "@/lib/llm/types";
import type { Env, ProviderSettings, StoredAi } from "./store";

/**
 * AIの設定は管理者が画面で決め、サーバーに保存する。
 * 項目が空なら環境変数（ANTHROPIC_API_KEY など）を使う。一般ユーザーは設定を見たり変えたりできない。
 * 「管理者用」と「プレミアムユーザー用」（プレミアムプラスも同じものを使う）は、プロバイダ・モデル・APIキーを別々に設定する。
 * プレミアムユーザー用は管理者用のキー（画面で保存したもの・環境変数のどちらも）を使わない。接続先URLだけはプロバイダごとに共通。
 */

/** サーバーのAIを使うロール */
export type ServerAiRole = "admin" | "ai";

export function activeProvider(ai: StoredAi, env: Env = process.env): ProviderId {
  return ai.provider ?? defaultProvider(env);
}

/** プレミアムユーザー用のプロバイダ。まだ設定していなければ、管理者用と同じプロバイダを初期値にする */
export function premiumProvider(ai: StoredAi, env: Env = process.env): ProviderId {
  return ai.premium?.provider ?? activeProvider(ai, env);
}

/** 保存した設定と環境変数から、実際に使う設定を決める。接続先URLは管理者が決めたものなので許可する */
export function settingsForUse(
  ai: StoredAi,
  env: Env = process.env,
  provider = activeProvider(ai, env),
  override: { model?: string; apiKey?: string } = {},
): ResolvedAiSettings {
  const s = ai.byProvider[provider] ?? {};
  try {
    return resolveSettings(
      { provider, ...s, ...(override.model ? { model: override.model } : {}), ...(override.apiKey ? { apiKey: override.apiKey } : {}) },
      { ...env, AI_ALLOW_CUSTOM_BASE_URL: "true" },
    );
  } catch (err) {
    if (err instanceof LlmError && /APIキーがありません/.test(err.message)) {
      throw new LlmError("AIのAPIキーが設定されていません。管理者に「管理」画面のAI設定を依頼してください。", 503);
    }
    throw err;
  }
}

/** プレミアムユーザー用のAPIキーがないときのエラー */
export const PREMIUM_KEY_MISSING = "プレミアムユーザー・プレミアムプラス用のAPIキーが設定されていません。管理者に「管理」画面のAI設定（プレミアムユーザー・プレミアムプラス用のAI）を依頼してください。";

/**
 * プレミアムユーザー用のAI。プロバイダ・モデル・APIキーはプレミアムユーザー用の設定だけを使い、
 * 管理者用のキー（画面で保存したもの・環境変数）には頼らない。接続先URLはプロバイダごとの設定を使う
 */
export function premiumSettings(ai: StoredAi, env: Env = process.env): ResolvedAiSettings {
  const provider = premiumProvider(ai, env);
  const p = ai.premium?.provider === provider ? ai.premium : undefined;
  if (!p?.apiKey && provider !== "local") throw new LlmError(PREMIUM_KEY_MISSING, 503);
  // 環境変数のキーを混ぜないよう、キーの変数だけ外して渡す
  const { [envKeyName(provider)]: _serverKey, ...rest } = env;
  void _serverKey;
  return resolveSettings(
    { provider, model: p?.model, apiKey: p?.apiKey, baseUrl: ai.byProvider[provider]?.baseUrl },
    { ...rest, AI_ALLOW_CUSTOM_BASE_URL: "true" },
  );
}

/** ロールに合わせたサーバーのAI。管理者は管理者用、プレミアムユーザーはプレミアムユーザー用の設定を使う */
export function settingsForRole(ai: StoredAi, role: ServerAiRole, env: Env = process.env): ResolvedAiSettings {
  return role === "admin" ? settingsForUse(ai, env) : premiumSettings(ai, env);
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
    /** プレミアムユーザー用。provider が null なら管理者用と同じ */
    /** プレミアムユーザー用。provider が null ならまだ設定していない（管理者用のプロバイダを初期値として見せる） */
    premium: { provider: ai.premium?.provider ?? null, model: ai.premium?.model ?? "", savedKey: mask(ai.premium?.apiKey) },
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

/** 全員向け。そのロールがどのAIを使うかと、使える状態かだけ */
export function publicAiView(ai: StoredAi, env: Env = process.env, role: ServerAiRole = "admin") {
  const premium = role === "ai";
  const provider = premium ? premiumProvider(ai, env) : activeProvider(ai, env);
  try {
    const s = settingsForRole(ai, role, env);
    return { provider, model: s.model, ready: true };
  } catch {
    const own = premium ? (ai.premium?.provider === provider ? ai.premium.model : undefined) : ai.byProvider[provider]?.model;
    return { provider, model: own || serverAiInfo(env).providers[provider].defaultModel, ready: false };
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
  /** プレミアムユーザー用。provider: null で「管理者用と同じ」に戻す（モデル・キーも消す） */
  premium: z
    .object({
      provider: z.enum(PROVIDERS).nullable(),
      model: z.string().trim().max(200).optional(),
      /** 省略=変えない、空文字=消す */
      apiKey: z.string().trim().max(500).optional(),
    })
    .optional(),
});

export type AiPatch = z.infer<typeof AiPatchSchema>;

export function applyAiPatch(ai: StoredAi, patch: AiPatch) {
  if (patch.provider) ai.provider = patch.provider;
  if (patch.premium) {
    const { provider, model, apiKey } = patch.premium;
    if (!provider) delete ai.premium;
    else {
      // 別のプロバイダに変えたのに指定がなければ、前のモデル名・キーは引き継がない（別の会社にキーを送らない）
      const same = ai.premium?.provider === provider;
      ai.premium = {
        provider,
        model: model !== undefined ? model || undefined : same ? ai.premium?.model : undefined,
        apiKey: apiKey !== undefined ? apiKey || undefined : same ? ai.premium?.apiKey : undefined,
      };
    }
  }
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

/** プレミアムユーザー用の「一覧」。保存前のキーを保存済みの設定に重ねて使う（管理者用のキーは使わない） */
export function previewPremiumSettings(ai: StoredAi, provider: ProviderId, apiKey: string | undefined, env: Env = process.env) {
  const copy: StoredAi = structuredClone(ai);
  applyAiPatch(copy, { premium: { provider, ...(apiKey ? { apiKey } : {}) } });
  return settingsForRole(copy, "ai", env);
}
