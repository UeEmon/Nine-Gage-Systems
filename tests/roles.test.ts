import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { aiAccessOf } from "../src/lib/roles";
import { applyAiPatch } from "../src/lib/server/aiSettings";
import { recordSignup, signupBlocked } from "../src/lib/server/auth";
import { usageView, type UsageRecord } from "../src/lib/server/aiUsage";
import { aiStatusFor, applyOwnAi, ownAiView, OwnAiPatchSchema, ownSettings, settingsForUser } from "../src/lib/server/ownAi";
import { openSecret, sealSecret } from "../src/lib/server/secretBox";
import { loadStore, updateStore } from "../src/lib/server/store";
import { createUser, listUsers, signupUser, updateUser } from "../src/lib/server/users";

function env(extra: Record<string, string> = {}) {
  return { NINEGAGE_DATA_DIR: mkdtempSync(path.join(tmpdir(), "ng-roles-")), ...extra };
}

const ADMIN = { NINEGAGE_ADMIN_USER: "owner", NINEGAGE_ADMIN_PASSWORD: "first-password-123" };

describe("ロール", () => {
  it("管理者とAI利用可能はサーバーのキー、一般は自分のキー、ログインなしはAIなし", () => {
    expect(aiAccessOf("admin")).toBe("server");
    expect(aiAccessOf("ai")).toBe("server");
    expect(aiAccessOf("user")).toBe("own");
    expect(aiAccessOf(null)).toBe("none");
  });

  it("以前の保存形式の「一般」はAI利用可能に読み替え、管理者はそのまま", async () => {
    const e = env();
    const old = {
      version: 1,
      sessionSecret: "s".repeat(64),
      users: [
        { id: "a", username: "owner", role: "admin", passwordHash: "x", sessionVersion: 1, createdAt: "2026-11-01T00:00:00Z" },
        { id: "b", username: "member", role: "user", passwordHash: "x", sessionVersion: 1, createdAt: "2026-11-01T00:00:00Z" },
      ],
      ai: { byProvider: {} },
      notices: [],
    };
    writeFileSync(path.join(e.NINEGAGE_DATA_DIR, "store.json"), JSON.stringify(old));
    const data = await loadStore(e);
    expect(data.users.map((u) => u.role)).toEqual(["admin", "ai"]);
    // 保存し直した後は版2として読み、一般はそのまま一般
    await updateStore((d) => signupUser(d, { username: "newbie", password: "newbie-pass-1" }, e), e);
    const raw = JSON.parse(readFileSync(path.join(e.NINEGAGE_DATA_DIR, "store.json"), "utf8"));
    expect(raw.version).toBe(2);
    const again = await loadStore(e);
    expect(again.users.map((u) => [u.username, u.role])).toEqual([
      ["owner", "admin"],
      ["member", "ai"],
      ["newbie", "user"],
    ]);
  });

  it("一覧は管理者・AI利用可能・一般の順", async () => {
    const data = await loadStore(env(ADMIN));
    await createUser(data, { username: "zed", password: "password-12345", role: "ai" });
    await createUser(data, { username: "amy", password: "password-12345", role: "user" });
    expect(listUsers(data).map((u) => u.role)).toEqual(["admin", "ai", "user"]);
  });
});

describe("ユーザー登録", () => {
  it("自分で登録すると必ず一般になる。重複・短いパスワードは拒否", async () => {
    const e = env(ADMIN);
    const data = await loadStore(e);
    const u = await signupUser(data, { username: "rider", password: "rider-pass-12" }, e);
    expect(u).toMatchObject({ role: "user", selfRegistered: true });
    await expect(signupUser(data, { username: "Rider", password: "rider-pass-12" }, e)).rejects.toThrow(/すでに/);
    await expect(signupUser(data, { username: "other", password: "short" }, e)).rejects.toThrow(/10文字/);
  });

  it("NINEGAGE_SIGNUP=closed なら登録できない。最初の管理者がいないときも登録できない", async () => {
    const e = env(ADMIN);
    const data = await loadStore(e);
    await expect(signupUser(data, { username: "rider", password: "rider-pass-12" }, { ...e, NINEGAGE_SIGNUP: "closed" })).rejects.toThrow(
      /受け付けていません/,
    );
    const empty = await loadStore(env());
    await expect(signupUser(empty, { username: "rider", password: "rider-pass-12" }, e)).rejects.toThrow(/最初の管理者/);
  });

  it("同じ送信元からの登録は1時間に5件まで", () => {
    const key = `ip:test-${Math.random()}`;
    for (let i = 0; i < 4; i++) recordSignup(key);
    expect(signupBlocked(key)).toBe(false);
    recordSignup(key);
    expect(signupBlocked(key)).toBe(true);
    expect(signupBlocked(key, Date.now() + 61 * 60 * 1000)).toBe(false);
  });
});

describe("APIキーの暗号化", () => {
  it("暗号化して戻せる。平文は残らず、鍵ファイルは権限600", () => {
    const e = env();
    const sealed = sealSecret("sk-ant-very-secret-1234", e);
    expect(sealed).not.toContain("very-secret");
    expect(openSecret(sealed, e)).toBe("sk-ant-very-secret-1234");
    expect(statSync(path.join(e.NINEGAGE_DATA_DIR, "secret.key")).mode & 0o777).toBe(0o600);
    // 別の鍵では読めない
    expect(openSecret(sealed, env())).toBeNull();
    expect(openSecret(sealed.slice(0, -2) + "AA", e)).toBeNull();
  });

  it("NINEGAGE_SECRET_KEY を使い、あとから設定してもそれまでの分を読める", () => {
    const e = env();
    const before = sealSecret("old-key-value", e);
    const withEnv = { ...e, NINEGAGE_SECRET_KEY: "k".repeat(40) };
    const after = sealSecret("new-key-value", withEnv);
    expect(openSecret(before, withEnv)).toBe("old-key-value");
    expect(openSecret(after, withEnv)).toBe("new-key-value");
    expect(openSecret(after, e)).toBeNull();
    expect(() => sealSecret("x", { ...e, NINEGAGE_SECRET_KEY: "short" })).toThrow(/32文字/);
  });
});

describe("自分のAPIキー", () => {
  async function setup() {
    const e = env(ADMIN);
    const data = await loadStore(e);
    const general = await signupUser(data, { username: "rider", password: "rider-pass-12" }, e);
    await createUser(data, { username: "trusted", password: "trusted-pass-1", role: "ai" });
    const trusted = data.users.find((u) => u.username === "trusted")!;
    applyAiPatch(data.ai, { provider: "anthropic", byProvider: { anthropic: { apiKey: "server-key-0000" } } });
    return { e, data, general, trusted };
  }

  it("一般は自分のキー、AI利用可能はサーバーのキーを使う", async () => {
    const { e, data, general, trusted } = await setup();
    expect(() => settingsForUser(data, general, e)).toThrow(/自分のAPIキー/);
    applyOwnAi(general, OwnAiPatchSchema.parse({ provider: "openai", apiKey: "sk-own-key-9876" }), e);
    expect(settingsForUser(data, general, e)).toMatchObject({
      keySource: "own",
      settings: { provider: "openai", apiKey: "sk-own-key-9876", model: "gpt-5" },
    });
    expect(settingsForUser(data, trusted, e)).toMatchObject({ keySource: "server", settings: { apiKey: "server-key-0000" } });
    expect(JSON.stringify(general)).not.toContain("sk-own-key");
  });

  it("画面には末尾4文字だけ。プロバイダを変えると前のキーは消える", async () => {
    const { e, general } = await setup();
    applyOwnAi(general, { provider: "anthropic", apiKey: "sk-ant-abcdef-1234", model: "claude-x" }, e);
    const v = ownAiView(general, e);
    expect(v).toMatchObject({ provider: "anthropic", model: "claude-x", savedKey: "••••1234", unreadable: false });
    expect(JSON.stringify(v)).not.toContain("abcdef");
    // キーを省略すると据え置き
    applyOwnAi(general, { provider: "anthropic", model: "claude-y" }, e);
    expect(ownAiView(general, e).savedKey).toBe("••••1234");
    // 別のプロバイダにするとキーとモデルは引き継がない
    applyOwnAi(general, { provider: "gemini" }, e);
    expect(ownAiView(general, e)).toMatchObject({ provider: "gemini", model: "", savedKey: null });
    // 空文字で削除
    applyOwnAi(general, { provider: "gemini", apiKey: "g-key-5555" }, e);
    applyOwnAi(general, { provider: "gemini", apiKey: "" }, e);
    expect(ownAiView(general, e).savedKey).toBeNull();
  });

  it("サーバーの環境変数のキーや接続先は混ぜない。ローカルLLMは選べない", async () => {
    const { e, general } = await setup();
    applyOwnAi(general, { provider: "openai", apiKey: "sk-own-1111" }, e);
    const s = ownSettings(general, { ...e, OPENAI_BASE_URL: "http://internal:8080", OPENAI_API_KEY: "server-env" });
    expect(s.baseUrl).toBeUndefined();
    expect(s.apiKey).toBe("sk-own-1111");
    expect(OwnAiPatchSchema.safeParse({ provider: "local", apiKey: "x" }).success).toBe(false);
    expect(OwnAiPatchSchema.safeParse({ provider: "openai", baseUrl: "http://x" }).data).not.toHaveProperty("baseUrl");
  });

  it("管理者・AI利用可能は自分のキーを設定できない", async () => {
    const { e, trusted } = await setup();
    expect(() => applyOwnAi(trusted, { provider: "anthropic", apiKey: "x" }, e)).toThrow(/管理者が設定したAI/);
  });

  it("鍵が変わって読めないキーは、入れ直しを促す", async () => {
    const { e, data, general } = await setup();
    applyOwnAi(general, { provider: "anthropic", apiKey: "sk-ant-1234567890" }, e);
    const other = env();
    expect(ownAiView(general, other).unreadable).toBe(true);
    expect(() => ownSettings(general, other)).toThrow(/もう一度入力/);
    expect(aiStatusFor(data, general, other)).toMatchObject({ source: "own", ready: false });
    expect(aiStatusFor(data, general, e)).toMatchObject({ source: "own", ready: true, model: "claude-opus-5-5" });
  });

  it("管理者がロールを変えると、使うキーも変わる", async () => {
    const { e, data, general } = await setup();
    await updateUser(data, general.id, { role: "ai" });
    expect(settingsForUser(data, general, e).keySource).toBe("server");
  });
});

describe("使用量の別集計", () => {
  const rec = (over: Partial<UsageRecord>): UsageRecord => ({
    at: "2026-11-10T00:00:00Z",
    userId: "u1",
    username: "alice",
    provider: "anthropic",
    model: "claude-opus-5-5",
    maker: "kato",
    feature: "free",
    attempts: 1,
    resultCached: false,
    ok: true,
    usage: { inputTokens: 100, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0 },
    costUsd: 1,
    costWithoutCacheUsd: 1,
    ...over,
  });

  it("自分のキーの分はサーバーの料金に入れず、別に集計する", () => {
    const v = usageView(
      [rec({}), rec({ keySource: "server", costUsd: 2, costWithoutCacheUsd: 2 }), rec({ keySource: "own", userId: "u2", username: "bob", costUsd: 5 })],
      "all",
      new Date("2026-11-15T00:00:00Z"),
    );
    expect(v.totals.costUsd).toBe(3);
    expect(v.totals.proposals).toBe(2);
    expect(v.byUser.map((u) => u.label)).toEqual(["alice"]);
    expect(v.ownKey.totals).toMatchObject({ costUsd: 5, proposals: 1 });
    expect(v.ownKey.byUser.map((u) => u.label)).toEqual(["bob"]);
    expect(v.recent).toHaveLength(3);
  });
});
