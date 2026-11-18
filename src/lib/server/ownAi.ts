import { z } from "zod";
import { resolveSettings, type ResolvedAiSettings } from "@/lib/llm";
import { DEFAULT_MODELS, LlmError } from "@/lib/llm/types";
import { aiAccessOf, canSetOwnKey } from "@/lib/roles";
import { publicAiView, settingsForRole } from "./aiSettings";
import { openSecret, sealSecret } from "./secretBox";
import { OWN_AI_PROVIDERS, type Env, type OwnAiProvider, type StoreData, type StoredUser } from "./store";

/**
 * 一般ユーザー・プレミアムユーザーが自分で設定するAI（自分のAPIキー）。
 * 一般は必ず自分のキー、プレミアムユーザーはキーを登録したときだけ自分のキー（なければサーバーのキー）を使う。
 * - キーは暗号化して保存し、画面には末尾4文字しか返さない
 * - 接続先URLは指定できない（サーバーから任意の宛先へ通信させない）。環境変数のキーやURLも使わない
 */

export const OwnAiPatchSchema = z.object({
  provider: z.enum(OWN_AI_PROVIDERS),
  model: z.string().trim().max(200).optional(),
  /** 省略=変えない、空文字=消す */
  apiKey: z.string().trim().max(500).optional(),
});

export type OwnAiPatch = z.infer<typeof OwnAiPatchSchema>;

export class OwnAiError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
  ) {
    super(message);
  }
}

function mask(key: string | null) {
  if (!key) return null;
  return key.length <= 8 ? "••••" : `••••${key.slice(-4)}`;
}

export function ownApiKey(user: StoredUser, env: Env = process.env): string | null {
  const enc = user.ownAi?.apiKeyEnc;
  return enc ? openSecret(enc, env) : null;
}

export type OwnAiView = {
  provider: OwnAiProvider;
  model: string;
  defaultModels: Record<OwnAiProvider, string>;
  savedKey: string | null;
  /** 保存したキーを読めない（サーバーの鍵が変わった）ので、入れ直しが必要 */
  unreadable: boolean;
};

/** 画面向け。キーそのものは返さない */
export function ownAiView(user: StoredUser, env: Env = process.env): OwnAiView {
  const o = user.ownAi;
  const key = ownApiKey(user, env);
  return {
    provider: o?.provider ?? "anthropic",
    model: o?.model ?? "",
    defaultModels: Object.fromEntries(OWN_AI_PROVIDERS.map((p) => [p, DEFAULT_MODELS[p]])) as Record<OwnAiProvider, string>,
    savedKey: mask(key),
    unreadable: !!o?.apiKeyEnc && key === null,
  };
}

/** 保存する。プロバイダを変えたときに新しいキーがなければ、前のキーは消す（別の会社のキーを送らない） */
export function applyOwnAi(user: StoredUser, patch: OwnAiPatch, env: Env = process.env) {
  if (!canSetOwnKey(user.role)) {
    throw new OwnAiError("このアカウントは管理者が設定したAIを使います。自分のAPIキーは設定できません。", 403);
  }
  const cur = user.ownAi;
  let apiKeyEnc = cur?.provider === patch.provider ? cur.apiKeyEnc : undefined;
  if (patch.apiKey !== undefined) apiKeyEnc = patch.apiKey ? sealSecret(patch.apiKey, env) : undefined;
  const model = patch.model !== undefined ? patch.model || undefined : cur?.provider === patch.provider ? cur.model : undefined;
  user.ownAi = { provider: patch.provider, model, apiKeyEnc };
}

/** 自分のキーで実際に使う設定。環境変数（サーバーのキー・接続先）は混ぜない */
export function ownSettings(user: StoredUser, env: Env = process.env): ResolvedAiSettings {
  const o = user.ownAi;
  if (!o?.apiKeyEnc) {
    throw new LlmError("AIを使うには、「アカウント」画面で自分のAPIキーを設定してください。", 400);
  }
  const apiKey = ownApiKey(user, env);
  if (!apiKey) throw new LlmError("保存したAPIキーを読めませんでした。「アカウント」画面でもう一度入力してください。", 400);
  return resolveSettings({ provider: o.provider, model: o.model, apiKey }, { NODE_ENV: env.NODE_ENV });
}

export type KeySource = "server" | "own";

/** どちらのキーを使うか。一般は自分のキー、プレミアムユーザーは自分のキーを登録していればそれ、管理者はサーバーのキー */
export function keySourceOf(user: StoredUser): KeySource | null {
  const access = aiAccessOf(user.role);
  if (access === "own") return "own";
  if (access === "server") return user.role === "ai" && user.ownAi?.apiKeyEnc ? "own" : "server";
  return null;
}

/** ロールに合わせて、AIの設定と、どちらのキーを使うかを決める */
export function settingsForUser(data: StoreData, user: StoredUser, env: Env = process.env): { settings: ResolvedAiSettings; keySource: KeySource } {
  const source = keySourceOf(user);
  if (source === "own") return { settings: ownSettings(user, env), keySource: "own" };
  if (source === "server") return { settings: settingsForRole(data.ai, user.role === "admin" ? "admin" : "ai", env), keySource: "server" };
  throw new LlmError("AIを使うにはログインしてください。", 401);
}

/** 画面のAI欄の表示（使うAIの名前と、使える状態か） */
export function aiStatusFor(data: StoreData, user: StoredUser, env: Env = process.env) {
  if (keySourceOf(user) === "own") {
    const v = ownAiView(user, env);
    let ready = true;
    try {
      ownSettings(user, env);
    } catch {
      ready = false;
    }
    return { provider: v.provider, model: v.model || v.defaultModels[v.provider], ready, source: "own" as const };
  }
  return { ...publicAiView(data.ai, env, user.role === "admin" ? "admin" : "ai"), source: "server" as const };
}
