import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { storedText } from "../src/lib/server/db";
import { loadStore, updateStore } from "../src/lib/server/store";

const KEY = "sk-ant-test-0123456789abcdef";

function env(extra: Record<string, string> = {}) {
  return { NINEGAGE_DATA_DIR: mkdtempSync(path.join(tmpdir(), "ng-")), NINEGAGE_SECRET_KEY: "k".repeat(40), ...extra };
}

describe("管理者のAPIキーの保存", () => {
  it("暗号化して保存し、読むときは元のキーに戻す", async () => {
    const e = env();
    await updateStore((d) => {
      d.ai.byProvider.anthropic = { apiKey: KEY, model: "m" };
    }, e);
    const text = storedText(e.NINEGAGE_DATA_DIR)!;
    expect(text).not.toContain(KEY);
    expect(JSON.parse(text).ai.byProvider.anthropic.apiKey).toMatch(/^v1\./);
    const data = await loadStore(e);
    expect(data.ai.byProvider.anthropic).toMatchObject({ apiKey: KEY, model: "m" });
  });

  it("鍵が変わって読めないキーは空として扱う", async () => {
    const e = env();
    await updateStore((d) => {
      d.ai.byProvider.gemini = { apiKey: KEY };
    }, e);
    const data = await loadStore({ ...e, NINEGAGE_SECRET_KEY: "x".repeat(40) });
    expect(data.ai.byProvider.gemini?.apiKey).toBeUndefined();
  });
});

describe("以前の版の store.json の取り込み", () => {
  it("最初に読んだときに SQLite へ取り込み、平文のキーは暗号化し、store.json は名前を変える", async () => {
    const e = env();
    const old = {
      version: 2,
      sessionSecret: "s".repeat(64),
      users: [{ id: "a", username: "owner", role: "admin", passwordHash: "x", sessionVersion: 1, createdAt: "2026-11-01T00:00:00Z" }],
      ai: { byProvider: { openai: { apiKey: KEY } } },
      notices: [],
    };
    const json = path.join(e.NINEGAGE_DATA_DIR, "store.json");
    writeFileSync(json, JSON.stringify(old));
    const data = await loadStore(e);
    expect(data.users.map((u) => u.username)).toEqual(["owner"]);
    expect(data.sessionSecret).toBe("s".repeat(64));
    expect(data.ai.byProvider.openai?.apiKey).toBe(KEY);
    expect(storedText(e.NINEGAGE_DATA_DIR)).not.toContain(KEY);
    expect(existsSync(json)).toBe(false);
    expect(existsSync(`${json}.migrated`)).toBe(true);
    expect((await loadStore(e)).ai.byProvider.openai?.apiKey).toBe(KEY);
  });
});
