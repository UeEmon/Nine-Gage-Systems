import { randomBytes, randomUUID } from "node:crypto";
import path from "node:path";
import { PROVIDERS, type ProviderId } from "@/lib/llm/types";
import { openDb, readDocument, writeDocument } from "./db";
import { hashPassword } from "./password";
import { openSecret, sealSecret } from "./secretBox";

/**
 * サーバーに保存するデータ（ユーザー・AI設定・お知らせ・改善リクエスト）。
 * 件数が少ないので、全体を JSON にして SQLite の1行に保存する（db.ts）。保存先は NINEGAGE_DATA_DIR（既定 ./data）の store.sqlite。
 */

/** admin=管理者、ai=プレミアムユーザー（サーバーのキー）、user=一般（自分のキー）。ログインなしは保存しない */
export const ROLES = ["admin", "ai", "user"] as const;
export type Role = (typeof ROLES)[number];

/** 一般ユーザーが自分で設定するAI（接続先URLは指定できない） */
export const OWN_AI_PROVIDERS = ["anthropic", "openai", "gemini"] as const;
export type OwnAiProvider = (typeof OWN_AI_PROVIDERS)[number];

export type StoredOwnAi = {
  provider: OwnAiProvider;
  model?: string;
  /** 暗号化したAPIキー（secretBox.ts の形式）。平文では保存しない */
  apiKeyEnc?: string;
};

export type StoredUser = {
  id: string;
  username: string;
  role: Role;
  passwordHash: string;
  /** パスワード変更・ロール変更で増やし、発行済みのログインを無効にする */
  sessionVersion: number;
  createdAt: string;
  /** 既読にしたお知らせのID（新しい順に最大 MAX_READ_IDS 件） */
  readNoticeIds?: string[];
  /** 自分で登録したか（管理者が追加したなら false/なし） */
  selfRegistered?: boolean;
  /** 一般ユーザーが自分で設定したAI */
  ownAi?: StoredOwnAi;
  /** メールアドレス（小文字）。自分で登録した人は必ず持つ */
  email?: string;
  /** メールの確認待ち（確認が済むと消す）。あるあいだはログインできない */
  pendingVerify?: { tokenHash: string; expiresAt: string };
};

export const AUDIENCES = ["all", "admin"] as const;
export type Audience = (typeof AUDIENCES)[number];

/** 管理者が画面から登録したお知らせ（リリースノートの分は src/data/releases.ts） */
export type StoredNotice = {
  id: string;
  title: string;
  body: string;
  /** 公開する日時（ISO）。未来なら予約 */
  publishedAt: string;
  audience: Audience;
  createdBy: string;
  createdAt: string;
};

/** 改善リクエスト（feedback.ts）。だれが送ったかはここにだけ残し、公開の Issue には載せない */
export type StoredFeedback = {
  id: string;
  userId: string;
  category: "feature" | "bug" | "other";
  /** 機能区分（.github/features.json の id） */
  feature?: string;
  title: string;
  body: string;
  createdAt: string;
  /** GitHub に作った Issue */
  issue?: { number: number; url: string };
  /** GitHub に登録できなかった理由（設定なし・通信の失敗など） */
  error?: string;
};

const FEEDBACK_CATEGORY_IDS = ["feature", "bug", "other"];

function feedbackOf(raw: unknown): StoredFeedback[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (f): f is StoredFeedback =>
      !!f &&
      typeof f.id === "string" &&
      typeof f.userId === "string" &&
      FEEDBACK_CATEGORY_IDS.includes(f.category) &&
      typeof f.title === "string" &&
      typeof f.body === "string" &&
      typeof f.createdAt === "string",
  );
}

/** apiKey はメモリ上では平文。ファイルには secretBox.ts の形式で暗号化して書く */
export type ProviderSettings = { model?: string; apiKey?: string; baseUrl?: string };

/** 管理者が画面で設定するAI。空の項目は環境変数を使う */
export type StoredAi = {
  provider?: ProviderId;
  byProvider: Partial<Record<ProviderId, ProviderSettings>>;
};

/** 管理画面の料金表示の設定 */
export type StoredAiCost = {
  /** 1米ドルあたりの円（料金の円換算に使う） */
  usdJpy: number;
};

export const DEFAULT_USD_JPY = 150;

/**
 * 保存形式の版。
 * 1: ロールは admin/user（user はサーバーのAIを使えた）
 * 2: ロールは admin/ai/user。版1の user は ai（プレミアムユーザー）に読み替える
 */
export const STORE_VERSION = 2;

export type StoreData = {
  version: typeof STORE_VERSION;
  sessionSecret: string;
  users: StoredUser[];
  ai: StoredAi;
  notices: StoredNotice[];
  aiCost: StoredAiCost;
  feedback: StoredFeedback[];
};

export type Env = Record<string, string | undefined>;

export function dataDir(env: Env = process.env) {
  return env.NINEGAGE_DATA_DIR || path.join(process.cwd(), "data");
}

function str(v: unknown, max: number): string | undefined {
  return typeof v === "string" && v.length > 0 && v.length <= max ? v : undefined;
}

function ownAiOf(v: unknown): StoredOwnAi | undefined {
  const o = v as Partial<StoredOwnAi> | undefined;
  if (!o || typeof o !== "object" || !OWN_AI_PROVIDERS.includes(o.provider as OwnAiProvider)) return undefined;
  return { provider: o.provider as OwnAiProvider, model: str(o.model, 200), apiKeyEnc: str(o.apiKeyEnc, 2000) };
}

function normalizeUsers(raw: unknown, version: unknown): StoredUser[] {
  if (!Array.isArray(raw)) return [];
  const old = version !== STORE_VERSION;
  const out: StoredUser[] = [];
  for (const u of raw as Partial<StoredUser>[]) {
    if (!u || typeof u.id !== "string" || typeof u.username !== "string" || typeof u.passwordHash !== "string") continue;
    // 版1の「一般」はサーバーのAIを使えていたので、そのまま使えるよう「プレミアムユーザー」にする
    const role = old && (u.role as string) === "user" ? "ai" : u.role;
    if (!ROLES.includes(role as Role)) continue;
    const user = { ...u, role } as StoredUser;
    if (typeof user.email !== "string" || user.email.length > 254) delete user.email;
    const pv = u.pendingVerify;
    if (!pv || typeof pv.tokenHash !== "string" || typeof pv.expiresAt !== "string") delete user.pendingVerify;
    const ownAi = ownAiOf(u.ownAi);
    if (ownAi) user.ownAi = ownAi;
    else delete user.ownAi;
    out.push(user);
  }
  return out;
}

/** 保存した管理者のAPIキーを読む。暗号化済みなら復号し（鍵が違えば捨てる）、以前の平文はそのまま読む */
function apiKeyOf(v: unknown, env: Env): string | undefined {
  if (typeof v !== "string") return undefined;
  if (v.startsWith("v1.")) return str(openSecret(v, env) ?? undefined, 500);
  return str(v, 500);
}

/** 管理者のAPIキーが平文のまま保存されているか（以前の版のファイル） */
function hasPlainApiKey(raw: unknown): boolean {
  const byProvider = (raw as { ai?: { byProvider?: Record<string, { apiKey?: unknown } | undefined> } } | null)?.ai?.byProvider;
  return Object.values(byProvider ?? {}).some((s) => typeof s?.apiKey === "string" && s.apiKey !== "" && !s.apiKey.startsWith("v1."));
}

function normalize(raw: unknown, env: Env = process.env): StoreData {
  const d = (raw ?? {}) as Partial<Omit<StoreData, "version">> & { version?: unknown };
  const ai = (d.ai ?? {}) as Partial<StoredAi>;
  const byProvider: StoredAi["byProvider"] = {};
  for (const p of PROVIDERS) {
    const s = (ai.byProvider as Record<string, ProviderSettings> | undefined)?.[p];
    if (s && typeof s === "object") {
      byProvider[p] = { model: str(s.model, 200), apiKey: apiKeyOf(s.apiKey, env), baseUrl: str(s.baseUrl, 500) };
    }
  }
  const usdJpy = (d.aiCost as Partial<StoredAiCost> | undefined)?.usdJpy;
  return {
    version: STORE_VERSION,
    sessionSecret:
      typeof d.sessionSecret === "string" && d.sessionSecret.length >= 32 ? d.sessionSecret : randomBytes(32).toString("hex"),
    users: normalizeUsers(d.users, raw ? d.version : STORE_VERSION),
    ai: { provider: ai.provider && PROVIDERS.includes(ai.provider) ? ai.provider : undefined, byProvider },
    notices: Array.isArray(d.notices)
      ? d.notices.filter(
          (n): n is StoredNotice =>
            !!n &&
            typeof n.id === "string" &&
            typeof n.title === "string" &&
            typeof n.body === "string" &&
            typeof n.publishedAt === "string" &&
            AUDIENCES.includes(n.audience),
        )
      : [],
    aiCost: { usdJpy: typeof usdJpy === "number" && usdJpy > 0 && usdJpy < 10000 ? usdJpy : DEFAULT_USD_JPY },
    feedback: feedbackOf(d.feedback),
  };
}

function readRaw(dir: string, env: Env): { data: StoreData; plainKeys: boolean } | null {
  const text = readDocument(openDb(dir));
  if (text === null) return null;
  const raw: unknown = JSON.parse(text);
  return { data: normalize(raw, env), plainKeys: hasPlainApiKey(raw) };
}

function writeRaw(dir: string, data: StoreData, env: Env) {
  const byProvider = Object.fromEntries(
    Object.entries(data.ai.byProvider).map(([p, s]) => [p, s && { ...s, apiKey: s.apiKey ? sealSecret(s.apiKey, env) : undefined }]),
  );
  writeDocument(openDb(dir), JSON.stringify({ ...data, ai: { ...data.ai, byProvider } }));
}

export function newUser(username: string, role: Role, passwordHash: string, selfRegistered = false): StoredUser {
  const u: StoredUser = { id: randomUUID(), username, role, passwordHash, sessionVersion: 1, createdAt: new Date().toISOString() };
  if (selfRegistered) u.selfRegistered = true;
  return u;
}

/**
 * 最初の管理者を環境変数から作る（ユーザーが1人もいないときだけ）。
 * NINEGAGE_ADMIN_USER と NINEGAGE_ADMIN_PASSWORD（10文字以上）。
 */
async function bootstrap(data: StoreData, env: Env) {
  if (data.users.length > 0) return;
  const username = env.NINEGAGE_ADMIN_USER?.trim();
  const password = env.NINEGAGE_ADMIN_PASSWORD ?? "";
  if (!username || password.length < 10) return;
  data.users.push(newUser(username, "admin", await hashPassword(password)));
}

/** 書き込みを1本ずつ順に行う（同時の更新で片方が消えないように） */
let queue: Promise<unknown> = Promise.resolve();

/** 読んで、変更して、変わっていれば保存する。fn が返した値を返す */
export function updateStore<T>(fn: (data: StoreData) => T | Promise<T>, env: Env = process.env): Promise<T> {
  const run = queue.then(async () => {
    const dir = dataDir(env);
    const stored = readRaw(dir, env);
    const data = stored?.data ?? normalize(null, env);
    // 平文のキーが残っていれば、変更がなくても暗号化して書き直す
    const before = stored && !stored.plainKeys ? JSON.stringify(stored.data) : "";
    await bootstrap(data, env);
    const result = await fn(data);
    if (JSON.stringify(data) !== before) writeRaw(dir, data, env);
    return result;
  });
  queue = run.catch(() => {});
  return run;
}

/** 読むだけ（初回はファイルを作る） */
export function loadStore(env: Env = process.env): Promise<StoreData> {
  return updateStore((d) => structuredClone(d), env);
}
