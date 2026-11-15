// scripts/backup.mjs の出力を復号し、SQLite のファイルに戻す。中身を検査してから書く。
//   NINEGAGE_BACKUP_KEY=... node scripts/restore-backup.mjs ninegage.ngbak store.sqlite
// 本番に戻すときは、コンテナを止めてから、ボリュームの store.sqlite（と -wal・-shm）をこのファイルで置き換える。
import { createDecipheriv, createHash } from "node:crypto";
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const [input, output] = process.argv.slice(2);
const secret = process.env.NINEGAGE_BACKUP_KEY?.trim() ?? "";
if (!input || !output || secret.length < 32) {
  console.error("使い方: NINEGAGE_BACKUP_KEY=<鍵> node scripts/restore-backup.mjs <バックアップ> <書き出すsqlite>");
  process.exit(2);
}
if (existsSync(output)) {
  console.error(`${output} はすでにあります。上書きしないので、別の名前にしてください。`);
  process.exit(2);
}
const all = readFileSync(input);
const magic = Buffer.from("NGBAK1\n");
if (!all.subarray(0, magic.length).equals(magic)) {
  console.error("SenroLab（旧 Nine-Gage）のバックアップではありません。");
  process.exit(1);
}
const iv = all.subarray(magic.length, magic.length + 12);
const tag = all.subarray(all.length - 16);
const decipher = createDecipheriv("aes-256-gcm", createHash("sha256").update(secret).digest(), iv);
decipher.setAuthTag(tag);
let plain;
try {
  plain = Buffer.concat([decipher.update(all.subarray(magic.length + 12, all.length - 16)), decipher.final()]);
} catch {
  console.error("復号できません（鍵が違うか、ファイルが壊れています）。");
  process.exit(1);
}
const tmp = `${output}.tmp`;
writeFileSync(tmp, plain, { mode: 0o600 });
const db = new DatabaseSync(tmp);
const check = db.prepare("PRAGMA integrity_check").get();
const row = db.prepare("SELECT data FROM store WHERE id = 1").get();
db.close();
if (check?.integrity_check !== "ok" || !row) {
  rmSync(tmp, { force: true });
  console.error("中身の検査に失敗しました。");
  process.exit(1);
}
const users = JSON.parse(row.data).users?.length ?? 0;
renameSync(tmp, output);
console.error(`restored ${output}（ユーザー ${users} 人）`);
