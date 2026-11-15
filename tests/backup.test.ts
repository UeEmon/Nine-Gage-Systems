import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { loadStore } from "../src/lib/server/store";

const KEY = "b".repeat(40);
const run = (script: string, args: string[], env: Record<string, string>) =>
  spawnSync(process.execPath, ["--no-warnings", path.join("scripts", script), ...args], { env: { ...process.env, ...env } });

describe("バックアップと復元", () => {
  it("暗号化して書き出し、同じ鍵で元の中身に戻せる", async () => {
    const e = { NINEGAGE_DATA_DIR: mkdtempSync(path.join(tmpdir(), "ng-")), NINEGAGE_ADMIN_USER: "owner", NINEGAGE_ADMIN_PASSWORD: "first-password-123" };
    const before = await loadStore(e);
    const out = mkdtempSync(path.join(tmpdir(), "ngbak-"));
    const made = run("backup.mjs", [], { NINEGAGE_DATA_DIR: e.NINEGAGE_DATA_DIR, NINEGAGE_BACKUP_KEY: KEY });
    expect(made.status).toBe(0);
    expect(made.stdout.includes(Buffer.from("owner"))).toBe(false);
    const file = path.join(out, "x.ngbak");
    writeFileSync(file, made.stdout);

    const restored = path.join(out, "store.sqlite");
    const back = run("restore-backup.mjs", [file, restored], { NINEGAGE_BACKUP_KEY: KEY });
    expect(back.status).toBe(0);
    const db = new DatabaseSync(restored);
    const row = db.prepare("SELECT data FROM store WHERE id = 1").get() as { data: string };
    db.close();
    expect(JSON.parse(row.data).users[0].username).toBe("owner");
    expect(JSON.parse(row.data).sessionSecret).toBe(before.sessionSecret);
  });

  it("鍵が違えば戻さない。鍵がなければ書き出さない", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ng-"));
    expect(run("backup.mjs", [], { NINEGAGE_DATA_DIR: dir, NINEGAGE_BACKUP_KEY: "" }).status).toBe(2);
    const made = run("backup.mjs", [], { NINEGAGE_DATA_DIR: dir, NINEGAGE_BACKUP_KEY: KEY });
    const file = path.join(dir, "x.ngbak");
    writeFileSync(file, made.stdout);
    const back = run("restore-backup.mjs", [file, path.join(dir, "out.sqlite")], { NINEGAGE_BACKUP_KEY: "c".repeat(40) });
    expect(back.status).toBe(1);
    expect(readFileSync(file).subarray(0, 7).toString()).toBe("NGBAK1\n");
  });
});
