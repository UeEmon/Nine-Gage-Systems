import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { openDb } from "./db";
import { dataDir } from "./store";

/**
 * AIで作ったレイアウトの自動保存（ユーザーごと）。
 * 提案が出来上がるたびに store.sqlite の ai_layouts に1案1行で残し、再起動しても消えない。
 * - 同じ人が同じ条件で頼んだときは、AIを呼ばずにここから返す（トークンを使わない）
 * - 画面の「AIで作ったレイアウト」の一覧から、いつでも開き直せる
 * 1人あたり MAX_PER_USER 件まで。超えたら古いものから消す。
 */

type Env = Record<string, string | undefined>;

export const MAX_PER_USER = 100;

/** 一覧に出す要約（レイアウトの中身は含まない） */
export type AiLayoutSummary = {
  id: string;
  createdAt: string;
  title: string;
  mode: string;
  maker: string;
  /** 再現した路線名・駅名（再現してみたのとき） */
  target: string | null;
  board: { width: number; height: number };
  pieces: number;
  model: string;
  hint: string | null;
};

export type AiLayoutEntry<T = unknown> = AiLayoutSummary & {
  /** 頼んだときの条件（要望・所有パーツ・予算など） */
  input: unknown;
  /** 提案の結果（/api/propose の1案と同じ形） */
  value: T;
};

type Row = { id: string; created_at: string; summary: string; input: string; value: string };

function init(db: DatabaseSync) {
  db.exec(`CREATE TABLE IF NOT EXISTS ai_layouts (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    input_key TEXT NOT NULL,
    created_at TEXT NOT NULL,
    summary TEXT NOT NULL,
    input TEXT NOT NULL,
    value TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS ai_layouts_user ON ai_layouts (user_id, created_at);
  CREATE INDEX IF NOT EXISTS ai_layouts_key ON ai_layouts (user_id, input_key);`);
}

const toSummary = (r: Row): AiLayoutSummary => ({ ...(JSON.parse(r.summary) as Omit<AiLayoutSummary, "id" | "createdAt">), id: r.id, createdAt: r.created_at });
const toEntry = <T>(r: Row): AiLayoutEntry<T> => ({ ...toSummary(r), input: JSON.parse(r.input), value: JSON.parse(r.value) as T });

export class AiLayoutStore {
  private ready = new WeakSet<DatabaseSync>();

  constructor(
    private readonly dir: () => string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private db(): DatabaseSync {
    const db = openDb(this.dir());
    if (!this.ready.has(db)) {
      init(db);
      this.ready.add(db);
    }
    return db;
  }

  /** 同じ条件でいちばん新しく作ったもの */
  find<T>(userId: string, inputKey: string): AiLayoutEntry<T> | undefined {
    const r = this.db()
      .prepare("SELECT id, created_at, summary, input, value FROM ai_layouts WHERE user_id = ? AND input_key = ? ORDER BY created_at DESC, rowid DESC LIMIT 1")
      .get(userId, inputKey) as Row | undefined;
    return r ? toEntry<T>(r) : undefined;
  }

  add<T>(userId: string, inputKey: string, summary: Omit<AiLayoutSummary, "id" | "createdAt">, input: unknown, value: T): AiLayoutEntry<T> {
    const db = this.db();
    const id = `ail_${randomUUID()}`;
    const createdAt = this.now().toISOString();
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare("INSERT INTO ai_layouts (id, user_id, input_key, created_at, summary, input, value) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
        id,
        userId,
        inputKey,
        createdAt,
        JSON.stringify(summary),
        JSON.stringify(input),
        JSON.stringify(value),
      );
      // 1人あたりの上限を超えた分を古い順に消す
      db.prepare(
        "DELETE FROM ai_layouts WHERE user_id = ? AND id NOT IN (SELECT id FROM ai_layouts WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?)",
      ).run(userId, userId, MAX_PER_USER);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
    return { ...summary, id, createdAt, input, value };
  }

  /** 新しい順の一覧 */
  list(userId: string): AiLayoutSummary[] {
    const rows = this.db()
      .prepare("SELECT id, created_at, summary, '' AS input, '' AS value FROM ai_layouts WHERE user_id = ? ORDER BY created_at DESC, rowid DESC")
      .all(userId) as Row[];
    return rows.map(toSummary);
  }

  get<T>(userId: string, id: string): AiLayoutEntry<T> | undefined {
    const r = this.db()
      .prepare("SELECT id, created_at, summary, input, value FROM ai_layouts WHERE user_id = ? AND id = ?")
      .get(userId, id) as Row | undefined;
    return r ? toEntry<T>(r) : undefined;
  }

  /** 消した件数（他の人のものは消さない） */
  remove(userId: string, id: string): number {
    return Number(this.db().prepare("DELETE FROM ai_layouts WHERE user_id = ? AND id = ?").run(userId, id).changes);
  }

  /** ユーザーを削除したとき */
  removeUser(userId: string): number {
    return Number(this.db().prepare("DELETE FROM ai_layouts WHERE user_id = ?").run(userId).changes);
  }

  /** 全員の件数（管理画面用） */
  count(): number {
    return (this.db().prepare("SELECT COUNT(*) AS n FROM ai_layouts").get() as { n: number }).n;
  }
}

export function aiLayoutStoreFor(env: Env = process.env) {
  return new AiLayoutStore(() => dataDir(env));
}

/** Next.js の開発サーバーで読み直されても同じものを使う */
const g = globalThis as unknown as { __ninegageAiLayouts?: AiLayoutStore };
export const aiLayouts: AiLayoutStore = (g.__ninegageAiLayouts ??= new AiLayoutStore(() => dataDir()));
