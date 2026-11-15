// Nine-Gage のデータ（NINEGAGE_DATA_DIR/store.sqlite）を、一貫した写しにしてから暗号化して標準出力に書く。
//   node scripts/backup.mjs > ninegage.ngbak
// 鍵は NINEGAGE_BACKUP_KEY（32文字以上）。戻すときは scripts/restore-backup.mjs と同じ鍵を使う。
// 形式: "NGBAK1\n" + IV(12バイト) + AES-256-GCM の暗号文 + 認証タグ(16バイト)
import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { backup, DatabaseSync } from "node:sqlite";

const secret = process.env.NINEGAGE_BACKUP_KEY?.trim() ?? "";
if (secret.length < 32) {
  console.error("NINEGAGE_BACKUP_KEY（32文字以上）がありません。");
  process.exit(2);
}
const dataDir = process.env.NINEGAGE_DATA_DIR || path.join(process.cwd(), "data");
const source = path.join(dataDir, "store.sqlite");
const copy = path.join(tmpdir(), `ngbak-${process.pid}-${Date.now()}.sqlite`);
try {
  const db = new DatabaseSync(source);
  await backup(db, copy);
  db.close();
  const plain = readFileSync(copy);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", createHash("sha256").update(secret).digest(), iv);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  process.stdout.write(Buffer.concat([Buffer.from("NGBAK1\n"), iv, body, cipher.getAuthTag()]));
  console.error(`backed up ${source} (${plain.length} bytes)`);
} finally {
  rmSync(copy, { force: true });
}
