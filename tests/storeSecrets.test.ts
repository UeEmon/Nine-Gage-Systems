import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadStore, updateStore } from "../src/lib/server/store";

const KEY = "sk-ant-test-0123456789abcdef";

function env(extra: Record<string, string> = {}) {
  return { NINEGAGE_DATA_DIR: mkdtempSync(path.join(tmpdir(), "ng-")), NINEGAGE_SECRET_KEY: "k".repeat(40), ...extra };
}

function fileOf(e: { NINEGAGE_DATA_DIR: string }) {
  return path.join(e.NINEGAGE_DATA_DIR, "store.json");
}

describe("管理者のAPIキーの保存", () => {
  it("ファイルには暗号化して書き、読むときは元のキーに戻す", async () => {
    const e = env();
    await updateStore((d) => {
      d.ai.byProvider.anthropic = { apiKey: KEY, model: "m" };
    }, e);
    const text = readFileSync(fileOf(e), "utf8");
    expect(text).not.toContain(KEY);
    expect(JSON.parse(text).ai.byProvider.anthropic.apiKey).toMatch(/^v1\./);
    const data = await loadStore(e);
    expect(data.ai.byProvider.anthropic).toMatchObject({ apiKey: KEY, model: "m" });
  });

  it("以前の版の平文のキーは読めて、次に読んだときに暗号化して書き直す", async () => {
    const e = env();
    await loadStore(e);
    const raw = JSON.parse(readFileSync(fileOf(e), "utf8"));
    raw.ai.byProvider = { openai: { apiKey: KEY } };
    writeFileSync(fileOf(e), JSON.stringify(raw));
    const data = await loadStore(e);
    expect(data.ai.byProvider.openai?.apiKey).toBe(KEY);
    expect(readFileSync(fileOf(e), "utf8")).not.toContain(KEY);
    expect((await loadStore(e)).ai.byProvider.openai?.apiKey).toBe(KEY);
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
