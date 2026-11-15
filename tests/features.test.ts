import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "..");

describe("機能マップ（.github/features.json）", () => {
  it("全ファイルがどれか1つの機能に入り、CODEOWNERS などが機能マップと一致している", () => {
    const r = spawnSync(process.execPath, ["scripts/features.mjs", "--check"], { cwd: root, encoding: "utf8" });
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
  });
});
