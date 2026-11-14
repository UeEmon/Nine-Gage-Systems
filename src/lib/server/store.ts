import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { PROVIDERS, type ProviderId } from "@/lib/llm/types";
import { hashPassword } from "./password";

/**
 * サーバーに保存するデータ（ユーザーとAI設定）。
 * 件数が少ないので JSON ファイル1つに保存する。保存先は NINEGAGE_DATA_DIR（既定 ./data）。
 */

export const ROLES = ["admin", "user"] as const;
export type Role = (typeof ROLES)[number];

export type StoredUser = {
  id: string;
  username: string;
  role: Role;
  passwordHash: string;
  /** パスワード変更・ロール変更で増やし、発行済みのログインを無効にする */
  sessionVersion: number;
  createdAt: string;
};

export type ProviderSettings = { model?: string; apiKey?: string; baseUrl?: string };

/** 管理者が画面で設定するAI。空の項目は環境変数を使う */
export type StoredAi = {
  provider?: ProviderId;
  byProvider: Partial<Record<ProviderId, ProviderSettings>>;
};

export type StoreData = {
  version: 1;
  sessionSecret: string;
  users: StoredUser[];
  ai: StoredAi;
};

export type Env = Record<string, string | undefined>;

export function dataFile(env: Env = process.env) {
  return path.join(env.NINEGAGE_DATA_DIR || path.join(process.cwd(), "data"), "store.json");
}

function str(v: unknown, max: number): string | undefined {
  return typeof v === "string" && v.length > 0 && v.length <= max ? v : undefined;
}

function normalize(raw: unknown): StoreData {
  const d = (raw ?? {}) as Partial<StoreData>;
  const ai = (d.ai ?? {}) as Partial<StoredAi>;
  const byProvider: StoredAi["byProvider"] = {};
  for (const p of PROVIDERS) {
    const s = (ai.byProvider as Record<string, ProviderSettings> | undefined)?.[p];
    if (s && typeof s === "object") {
      byProvider[p] = { model: str(s.model, 200), apiKey: str(s.apiKey, 500), baseUrl: str(s.baseUrl, 500) };
    }
  }
  return {
    version: 1,
    sessionSecret:
      typeof d.sessionSecret === "string" && d.sessionSecret.length >= 32 ? d.sessionSecret : randomBytes(32).toString("hex"),
    users: Array.isArray(d.users)
      ? d.users.filter(
          (u): u is StoredUser =>
            !!u && typeof u.id === "string" && typeof u.username === "string" && typeof u.passwordHash === "string" && ROLES.includes(u.role),
        )
      : [],
    ai: { provider: ai.provider && PROVIDERS.includes(ai.provider) ? ai.provider : undefined, byProvider },
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

export function newUser(username: string, role: Role, passwordHash: string): StoredUser {
  return { id: randomUUID(), username, role, passwordHash, sessionVersion: 1, createdAt: new Date().toISOString() };
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
