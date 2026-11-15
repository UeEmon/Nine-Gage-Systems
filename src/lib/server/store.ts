import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { PROVIDERS, type ProviderId } from "@/lib/llm/types";
import { hashPassword } from "./password";

/**
 * サーバーに保存するデータ（ユーザー・AI設定・お知らせ）。
 * 件数が少ないので JSON ファイル1つに保存する。保存先は NINEGAGE_DATA_DIR（既定 ./data）。
 */

/** admin=管理者、ai=AI利用可能（サーバーのキー）、user=一般（自分のキー）。ログインなしは保存しない */
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
 * 2: ロールは admin/ai/user。版1の user は ai（AI利用可能）に読み替える
 */
export const STORE_VERSION = 2;

export type StoreData = {
  version: typeof STORE_VERSION;
  sessionSecret: string;
  users: StoredUser[];
  ai: StoredAi;
  notices: StoredNotice[];
  aiCost: StoredAiCost;
};

export type Env = Record<string, string | undefined>;

export function dataFile(env: Env = process.env) {
  return path.join(env.NINEGAGE_DATA_DIR || path.join(process.cwd(), "data"), "store.json");
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
    // 版1の「一般」はサーバーのAIを使えていたので、そのまま使えるよう「AI利用可能」にする
    const role = old && (u.role as string) === "user" ? "ai" : u.role;
    if (!ROLES.includes(role as Role)) continue;
    const user = { ...u, role } as StoredUser;
    const ownAi = ownAiOf(u.ownAi);
    if (ownAi) user.ownAi = ownAi;
    else delete user.ownAi;
    out.push(user);
  }
  return out;
}

function normalize(raw: unknown): StoreData {
  const d = (raw ?? {}) as Partial<Omit<StoreData, "version">> & { version?: unknown };
  const ai = (d.ai ?? {}) as Partial<StoredAi>;
  const byProvider: StoredAi["byProvider"] = {};
  for (const p of PROVIDERS) {
    const s = (ai.byProvider as Record<string, ProviderSettings> | undefined)?.[p];
    if (s && typeof s === "object") {
      byProvider[p] = { model: str(s.model, 200), apiKey: str(s.apiKey, 500), baseUrl: str(s.baseUrl, 500) };
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
  };
}

async function readRaw(file: string): Promise<StoreData | null> {
  try {
    return normalize(JSON.parse(await readFile(file, "utf8")));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

async function writeRaw(file: string, data: StoreData) {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  await rename(tmp, file);
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
    const file = dataFile(env);
    const stored = await readRaw(file);
    const data = stored ?? normalize(null);
    const before = stored ? JSON.stringify(stored) : "";
    await bootstrap(data, env);
    const result = await fn(data);
    if (JSON.stringify(data) !== before) await writeRaw(file, data);
    return result;
  });
  queue = run.catch(() => {});
  return run;
}

/** 読むだけ（初回はファイルを作る） */
export function loadStore(env: Env = process.env): Promise<StoreData> {
  return updateStore((d) => structuredClone(d), env);
}
