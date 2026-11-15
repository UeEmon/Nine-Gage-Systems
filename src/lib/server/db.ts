import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * サーバーのデータを SQLite（NINEGAGE_DATA_DIR/store.sqlite、権限600）に保存する。
 * 中身は store.ts の StoreData を JSON にした1行。書き込みはトランザクションで行い、途中で落ちても前の状態が残る（WAL）。
 * 以前の版の store.json があれば、最初に開いたときに取り込み、store.json.migrated に名前を変える。
 */

const dbs = new Map<string, DatabaseSync>();

export function dbPath(dataDir: string) {
  return path.join(dataDir, "store.sqlite");
}

export function openDb(dataDir: string): DatabaseSync {
  const file = dbPath(dataDir);
  const cached = dbs.get(file);
  if (cached) return cached;
  mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(file);
  // -wal と -shm はこのファイルと同じ権限で作られる
  chmodSync(file, 0o600);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;");
  db.exec("CREATE TABLE IF NOT EXISTS store (id INTEGER PRIMARY KEY CHECK (id = 1), data TEXT NOT NULL, updated_at TEXT NOT NULL)");
  importJson(db, dataDir);
  dbs.set(file, db);
  return db;
}

/** 以前の版の store.json を取り込む（中身がまだ空のときだけ） */
function importJson(db: DatabaseSync, dataDir: string) {
  const json = path.join(dataDir, "store.json");
  if (!existsSync(json) || readDocument(db) !== null) return;
  const text = readFileSync(json, "utf8");
  JSON.parse(text); // 壊れていれば取り込まない（例外のまま起動を止める）
  writeDocument(db, text);
  renameSync(json, `${json}.migrated`);
}

export function readDocument(db: DatabaseSync): string | null {
  const row = db.prepare("SELECT data FROM store WHERE id = 1").get() as { data: string } | undefined;
  return row?.data ?? null;
}

export function writeDocument(db: DatabaseSync, text: string) {
  db.prepare(
    "INSERT INTO store (id, data, updated_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at",
  ).run(text, new Date().toISOString());
}

/** テストと移行の確認用: 保存されている JSON をそのまま返す */
export function storedText(dataDir: string): string | null {
  return readDocument(openDb(dataDir));
}

/** 開いている接続を閉じる（テストで同じフォルダを開き直すとき） */
export function closeDb(dataDir: string) {
  const file = dbPath(dataDir);
  dbs.get(file)?.close();
  dbs.delete(file);
}
