// ターミナルのデータ（SQLite: TERMINAL_DATA_DIR/terminal.sqlite、権限600）。
// 投稿したレイアウト（posts）と、投稿をつないだレイアウト（sets）。

import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, renameSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Layout } from "../../../src/lib/geometry";
import { findConnectors, layoutMaker, type Connector, type PlacedModule } from "../../../src/lib/modules";
import type { Maker } from "../../../src/lib/parts";

export type PostSummary = {
  id: string;
  ownerId: string;
  ownerName: string;
  title: string;
  description: string;
  maker: Maker;
  width: number;
  height: number;
  pieceCount: number;
  /** 運行計画の列車の本数（0 は運行計画なし） */
  trainCount: number;
  connectors: Connector[];
  createdAt: string;
  updatedAt: string;
};
export type Post = PostSummary & { layout: Layout };

export type SetModule = { postId: string; placement: PlacedModule["placement"] };
export type LayoutSet = {
  id: string;
  ownerId: string;
  ownerName: string;
  title: string;
  description: string;
  modules: SetModule[];
  createdAt: string;
  updatedAt: string;
};

const dbs = new Map<string, DatabaseSync>();

export function openStore(dir: string): DatabaseSync {
  const file = path.join(dir, "terminal.sqlite");
  const cached = dbs.get(file);
  if (cached) return cached;
  mkdirSync(dir, { recursive: true });
  renameOldFile(dir, file);
  const db = new DatabaseSync(file);
  chmodSync(file, 0o600);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS posts (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      owner_name TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      maker TEXT NOT NULL,
      width REAL NOT NULL,
      height REAL NOT NULL,
      piece_count INTEGER NOT NULL,
      connector_count INTEGER NOT NULL,
      connectors TEXT NOT NULL,
      layout TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS posts_created ON posts (created_at DESC);
    CREATE INDEX IF NOT EXISTS posts_owner ON posts (owner_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS sets (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      owner_name TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      modules TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sets_created ON sets (created_at DESC);
    CREATE TABLE IF NOT EXISTS set_posts (
      set_id TEXT NOT NULL REFERENCES sets (id) ON DELETE CASCADE,
      post_id TEXT NOT NULL,
      PRIMARY KEY (set_id, post_id)
    );
    CREATE INDEX IF NOT EXISTS set_posts_post ON set_posts (post_id);
  `);
  migrate(db);
  dbs.set(file, db);
  return db;
}

/** 前の版で作ったデータベースに、足した列を加える */
/** 名称変更前のファイル（share.sqlite と WAL・共有メモリ）があれば、新しい名前に移す */
function renameOldFile(dir: string, file: string) {
  const old = path.join(dir, "share.sqlite");
  if (existsSync(file) || !existsSync(old)) return;
  for (const suffix of ["-wal", "-shm"]) if (existsSync(old + suffix)) renameSync(old + suffix, file + suffix);
  renameSync(old, file);
}

function migrate(db: DatabaseSync) {
  const cols = new Set((db.prepare("PRAGMA table_info(posts)").all() as { name: string }[]).map((c) => c.name));
  if (!cols.has("train_count")) {
    db.exec("ALTER TABLE posts ADD COLUMN train_count INTEGER NOT NULL DEFAULT 0");
    db.exec("UPDATE posts SET train_count = COALESCE(json_array_length(json_extract(layout, '$.operation.trains')), 0)");
  }
}

export function closeStore(dir: string) {
  const file = path.join(dir, "terminal.sqlite");
  dbs.get(file)?.close();
  dbs.delete(file);
}

function newId(prefix: string) {
  return `${prefix}${randomBytes(8).toString("base64url").replace(/[-_]/g, "x").slice(0, 10)}`;
}

type PostRow = {
  id: string;
  owner_id: string;
  owner_name: string;
  title: string;
  description: string;
  maker: string;
  width: number;
  height: number;
  piece_count: number;
  train_count: number;
  connectors: string;
  layout?: string;
  created_at: string;
  updated_at: string;
};

function toSummary(r: PostRow): PostSummary {
  return {
    id: r.id,
    ownerId: r.owner_id,
    ownerName: r.owner_name,
    title: r.title,
    description: r.description,
    maker: r.maker as Maker,
    width: r.width,
    height: r.height,
    pieceCount: r.piece_count,
    trainCount: r.train_count,
    connectors: JSON.parse(r.connectors),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

const SUMMARY_COLS = "id, owner_id, owner_name, title, description, maker, width, height, piece_count, train_count, connectors, created_at, updated_at";

export function createPost(
  db: DatabaseSync,
  owner: { id: string; name: string },
  input: { title: string; description: string; layout: Layout },
  now = new Date(),
): Post {
  const layout = { ...input.layout, title: input.title };
  const connectors = findConnectors(layout);
  const at = now.toISOString();
  const post: Post = {
    id: newId("l"),
    ownerId: owner.id,
    ownerName: owner.name,
    title: input.title,
    description: input.description,
    maker: layoutMaker(layout),
    width: layout.board.width,
    height: layout.board.height,
    pieceCount: layout.pieces.length,
    trainCount: layout.operation?.trains.length ?? 0,
    connectors,
    createdAt: at,
    updatedAt: at,
    layout,
  };
  db.prepare(
    `INSERT INTO posts (id, owner_id, owner_name, title, description, maker, width, height, piece_count, train_count, connector_count, connectors, layout, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    post.id,
    post.ownerId,
    post.ownerName,
    post.title,
    post.description,
    post.maker,
    post.width,
    post.height,
    post.pieceCount,
    post.trainCount,
    connectors.length,
    JSON.stringify(connectors),
    JSON.stringify(layout),
    at,
    at,
  );
  return post;
}

export function getPost(db: DatabaseSync, id: string): Post | null {
  const r = db.prepare(`SELECT ${SUMMARY_COLS}, layout FROM posts WHERE id = ?`).get(id) as PostRow | undefined;
  if (!r) return null;
  return { ...toSummary(r), layout: JSON.parse(r.layout!) };
}

export function getPosts(db: DatabaseSync, ids: string[]): Post[] {
  return [...new Set(ids)].map((id) => getPost(db, id)).filter((p): p is Post => !!p);
}

export type PostQuery = { q?: string; maker?: Maker; connectable?: boolean; withOperation?: boolean; owner?: string; limit?: number; offset?: number };

export function listPosts(db: DatabaseSync, query: PostQuery = {}): { posts: PostSummary[]; total: number } {
  const where: string[] = [];
  const args: (string | number)[] = [];
  if (query.q?.trim()) {
    for (const word of query.q.trim().split(/\s+/).slice(0, 5)) {
      where.push("(title LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\' OR owner_name LIKE ? ESCAPE '\\')");
      const like = `%${word.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      args.push(like, like, like);
    }
  }
  if (query.maker) {
    where.push("maker = ?");
    args.push(query.maker);
  }
  if (query.connectable) where.push("connector_count > 0");
  if (query.withOperation) where.push("train_count > 0");
  if (query.owner) {
    where.push("owner_id = ?");
    args.push(query.owner);
  }
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM posts ${w}`).get(...args) as { n: number }).n;
  const limit = Math.min(Math.max(query.limit ?? 24, 1), 200);
  const offset = Math.max(query.offset ?? 0, 0);
  const rows = db.prepare(`SELECT ${SUMMARY_COLS} FROM posts ${w} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...args, limit, offset) as PostRow[];
  return { posts: rows.map(toSummary), total };
}

/** つなぐ相手を探すときの候補（端子のある、同じメーカーの投稿。新しい順に上限まで） */
export function connectablePosts(db: DatabaseSync, maker: Maker, limit = 500): Post[] {
  const rows = db
    .prepare(`SELECT ${SUMMARY_COLS}, layout FROM posts WHERE maker = ? AND connector_count > 0 ORDER BY created_at DESC LIMIT ?`)
    .all(maker, limit) as PostRow[];
  return rows.map((r) => ({ ...toSummary(r), layout: JSON.parse(r.layout!) }));
}

export function updatePost(db: DatabaseSync, id: string, input: { title: string; description: string }, now = new Date()) {
  const post = getPost(db, id);
  if (!post) return null;
  const layout = { ...post.layout, title: input.title };
  db.prepare("UPDATE posts SET title = ?, description = ?, layout = ?, updated_at = ? WHERE id = ?").run(
    input.title,
    input.description,
    JSON.stringify(layout),
    now.toISOString(),
    id,
  );
  return getPost(db, id);
}

export function deletePost(db: DatabaseSync, id: string) {
  db.prepare("DELETE FROM posts WHERE id = ?").run(id);
}

/** 直近 hours 時間の投稿数（連続投稿の制限） */
export function recentCount(db: DatabaseSync, table: "posts" | "sets", ownerId: string, hours = 24, now = new Date()): number {
  const since = new Date(now.getTime() - hours * 3600_000).toISOString();
  return (db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE owner_id = ? AND created_at >= ?`).get(ownerId, since) as { n: number }).n;
}

// ---- つないだレイアウト ----

type SetRow = {
  id: string;
  owner_id: string;
  owner_name: string;
  title: string;
  description: string;
  modules: string;
  created_at: string;
  updated_at: string;
};

function toSet(r: SetRow): LayoutSet {
  return {
    id: r.id,
    ownerId: r.owner_id,
    ownerName: r.owner_name,
    title: r.title,
    description: r.description,
    modules: JSON.parse(r.modules),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function linkPosts(db: DatabaseSync, setId: string, modules: SetModule[]) {
  db.prepare("DELETE FROM set_posts WHERE set_id = ?").run(setId);
  const ins = db.prepare("INSERT OR IGNORE INTO set_posts (set_id, post_id) VALUES (?, ?)");
  for (const m of modules) ins.run(setId, m.postId);
}

export function createSet(
  db: DatabaseSync,
  owner: { id: string; name: string },
  input: { title: string; description: string; modules: SetModule[] },
  now = new Date(),
): LayoutSet {
  const at = now.toISOString();
  const set: LayoutSet = { id: newId("s"), ownerId: owner.id, ownerName: owner.name, ...input, createdAt: at, updatedAt: at };
  db.exec("BEGIN");
  try {
    db.prepare(
      "INSERT INTO sets (id, owner_id, owner_name, title, description, modules, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(set.id, set.ownerId, set.ownerName, set.title, set.description, JSON.stringify(set.modules), at, at);
    linkPosts(db, set.id, set.modules);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return set;
}

export function updateSet(
  db: DatabaseSync,
  id: string,
  input: { title: string; description: string; modules: SetModule[] },
  now = new Date(),
): LayoutSet | null {
  if (!getSet(db, id)) return null;
  db.exec("BEGIN");
  try {
    db.prepare("UPDATE sets SET title = ?, description = ?, modules = ?, updated_at = ? WHERE id = ?").run(
      input.title,
      input.description,
      JSON.stringify(input.modules),
      now.toISOString(),
      id,
    );
    linkPosts(db, id, input.modules);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return getSet(db, id);
}

export function getSet(db: DatabaseSync, id: string): LayoutSet | null {
  const r = db.prepare("SELECT * FROM sets WHERE id = ?").get(id) as SetRow | undefined;
  return r ? toSet(r) : null;
}

export function listSets(db: DatabaseSync, opts: { limit?: number; offset?: number; postId?: string } = {}): LayoutSet[] {
  const limit = Math.min(Math.max(opts.limit ?? 24, 1), 200);
  const offset = Math.max(opts.offset ?? 0, 0);
  const rows = opts.postId
    ? (db
        .prepare("SELECT s.* FROM sets s JOIN set_posts p ON p.set_id = s.id WHERE p.post_id = ? ORDER BY s.created_at DESC LIMIT ? OFFSET ?")
        .all(opts.postId, limit, offset) as SetRow[])
    : (db.prepare("SELECT * FROM sets ORDER BY created_at DESC LIMIT ? OFFSET ?").all(limit, offset) as SetRow[]);
  return rows.map(toSet);
}

export function deleteSet(db: DatabaseSync, id: string) {
  db.prepare("DELETE FROM sets WHERE id = ?").run(id);
}
