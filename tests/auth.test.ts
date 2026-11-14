import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { adminAiView, AiPatchSchema, applyAiPatch, publicAiView, settingsForUse } from "../src/lib/server/aiSettings";
import { loginBlocked, recordLoginFailure, sameOrigin } from "../src/lib/server/auth";
import { hashPassword, verifyPassword } from "../src/lib/server/password";
import { createSessionToken, userFromToken } from "../src/lib/server/session";
import { loadStore, updateStore, type StoreData } from "../src/lib/server/store";
import { changeOwnPassword, createUser, deleteUser, updateUser, UserError } from "../src/lib/server/users";

function env(extra: Record<string, string> = {}) {
  return { NINEGAGE_DATA_DIR: mkdtempSync(path.join(tmpdir(), "ng-")), ...extra };
}

const ADMIN = { NINEGAGE_ADMIN_USER: "owner", NINEGAGE_ADMIN_PASSWORD: "first-password-123" };

describe("パスワード", () => {
  it("同じパスワードだけが通る", async () => {
    const h = await hashPassword("correct horse battery");
    expect(await verifyPassword("correct horse battery", h)).toBe(true);
    expect(await verifyPassword("wrong", h)).toBe(false);
    expect(h).not.toContain("correct");
  });
});

describe("保存と最初の管理者", () => {
  it("環境変数から最初の管理者を作り、ファイルに保存する（権限600）", async () => {
    const e = env(ADMIN);
    const data = await loadStore(e);
    expect(data.users).toHaveLength(1);
    expect(data.users[0]).toMatchObject({ username: "owner", role: "admin" });
    const file = path.join(e.NINEGAGE_DATA_DIR, "store.json");
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(readFileSync(file, "utf8")).not.toContain(ADMIN.NINEGAGE_ADMIN_PASSWORD);
  });

  it("ユーザーがいれば環境変数のパスワードを変えても上書きしない", async () => {
    const e = env(ADMIN);
    const first = await loadStore(e);
    const again = await loadStore({ ...e, NINEGAGE_ADMIN_PASSWORD: "another-password-456" });
    expect(again.users[0].passwordHash).toBe(first.users[0].passwordHash);
  });

  it("環境変数がなければユーザーは作らない", async () => {
    expect((await loadStore(env())).users).toHaveLength(0);
  });

  it("同時の更新でどちらも残る", async () => {
    const e = env(ADMIN);
    await Promise.all(
      ["alice", "bob", "carol"].map((name) =>
        updateStore((d) => createUser(d, { username: name, password: "password-12345", role: "user" }), e),
      ),
    );
    expect((await loadStore(e)).users.map((u) => u.username).sort()).toEqual(["alice", "bob", "carol", "owner"]);
  });
});

describe("ログイン状態", () => {
  it("署名・期限・版を確かめる", async () => {
    const data = await loadStore(env(ADMIN));
    const user = data.users[0];
    const token = createSessionToken(user, data.sessionSecret);
    expect(userFromToken(token, data)?.id).toBe(user.id);
    expect(userFromToken(token.slice(0, -2) + "xx", data)).toBeNull();
    expect(userFromToken(token, data, Date.now() + 15 * 86400 * 1000)).toBeNull();
    // ロールを変えると(管理者が1人のときは変えられないので)版を上げた場合を確かめる
    user.sessionVersion += 1;
    expect(userFromToken(token, data)).toBeNull();
  });

  it("別サイトからの書き換え要求を拒否する", () => {
    const req = (origin?: string) =>
      new Request("http://x/api/admin/users", {
        method: "POST",
        headers: { host: "nine-gage.example", ...(origin ? { origin } : {}) },
      });
    expect(sameOrigin(req("https://nine-gage.example"))).toBe(true);
    expect(sameOrigin(req("https://evil.example"))).toBe(false);
    expect(sameOrigin(new Request("http://x/", { headers: { origin: "https://evil.example" } }))).toBe(true); // GET
  });

  it("失敗が続くとしばらく止める", () => {
    const keys = [`ip:test-${Math.random()}`];
    for (let i = 0; i < 9; i++) recordLoginFailure(keys);
    expect(loginBlocked(keys)).toBe(false);
    recordLoginFailure(keys);
    expect(loginBlocked(keys)).toBe(true);
  });
});

describe("ユーザー管理", () => {
  async function setup() {
    const data = await loadStore(env(ADMIN));
    const admin = data.users[0];
    const user = await createUser(data, { username: "member", password: "member-pass-1", role: "user" });
    return { data, admin, user };
  }

  it("ユーザー名の重複と短いパスワードを拒否する", async () => {
    const { data } = await setup();
    await expect(createUser(data, { username: "Member", password: "member-pass-1", role: "user" })).rejects.toThrow(/すでに/);
    await expect(createUser(data, { username: "new", password: "short", role: "user" })).rejects.toThrow(/10文字/);
    await expect(createUser(data, { username: "a b", password: "long-enough-1", role: "user" })).rejects.toThrow(/ユーザー名/);
  });

  it("最後の管理者は一般にも削除にもできない", async () => {
    const { data, admin, user } = await setup();
    await expect(updateUser(data, admin.id, { role: "user" })).rejects.toThrow(/管理者が1人も/);
    expect(() => deleteUser(data, admin.id, user.id)).toThrow(/管理者が1人も/);
    expect(() => deleteUser(data, admin.id, admin.id)).toThrow(/自分自身/);
    // 2人目の管理者がいれば変えられる
    await updateUser(data, user.id, { role: "admin" });
    await updateUser(data, admin.id, { role: "user" });
    expect(data.users.find((u) => u.id === admin.id)?.role).toBe("user");
  });

  it("ロール変更・パスワード再設定でそのユーザーのログインが切れる", async () => {
    const { data, user } = await setup();
    const stored = data.users.find((u) => u.id === user.id)!;
    const token = createSessionToken(stored, data.sessionSecret);
    await updateUser(data, user.id, { password: "reset-password-1" });
    expect(userFromToken(token, data)).toBeNull();
    expect(await verifyPassword("reset-password-1", stored.passwordHash)).toBe(true);
  });

  it("自分のパスワード変更には今のパスワードが要る", async () => {
    const { data, user } = await setup();
    await expect(changeOwnPassword(data, user.id, { current: "wrong", next: "next-password-1" })).rejects.toBeInstanceOf(UserError);
    await changeOwnPassword(data, user.id, { current: "member-pass-1", next: "next-password-1" });
    const stored = data.users.find((u) => u.id === user.id)!;
    expect(await verifyPassword("next-password-1", stored.passwordHash)).toBe(true);
  });
});

describe("AI設定", () => {
  const blank = (): StoreData["ai"] => ({ byProvider: {} });

  it("保存した設定が環境変数より優先され、キーは末尾だけ見せる", () => {
    const ai = blank();
    applyAiPatch(ai, AiPatchSchema.parse({ provider: "openai", byProvider: { openai: { apiKey: "sk-secret-abcd", model: "m1" } } }));
    const e = { OPENAI_API_KEY: "env-key", OPENAI_MODEL: "env-model" };
    expect(settingsForUse(ai, e)).toMatchObject({ provider: "openai", apiKey: "sk-secret-abcd", model: "m1" });
    const view = adminAiView(ai, e);
    expect(view.providers.openai.savedKey).toBe("••••abcd");
    expect(JSON.stringify(view)).not.toContain("sk-secret");
    expect(JSON.stringify(publicAiView(ai, e))).not.toContain("sk-secret");
  });

  it("キーは省略で据え置き、空文字で削除し、削除後は環境変数を使う", () => {
    const ai = blank();
    applyAiPatch(ai, { byProvider: { anthropic: { apiKey: "saved" } } });
    applyAiPatch(ai, { byProvider: { anthropic: { model: "x" } } });
    expect(ai.byProvider.anthropic?.apiKey).toBe("saved");
    applyAiPatch(ai, { byProvider: { anthropic: { apiKey: "" } } });
    expect(settingsForUse(ai, { ANTHROPIC_API_KEY: "env" }).apiKey).toBe("env");
  });

  it("キーがなければ一般向けに分かる言葉で止める", () => {
    expect(() => settingsForUse(blank(), {})).toThrow(/管理者/);
    expect(publicAiView(blank(), {}).ready).toBe(false);
  });

  it("管理者が決めた接続先URLは本番でも使える。http(s)以外は拒否", () => {
    const ai = blank();
    applyAiPatch(ai, AiPatchSchema.parse({ provider: "local", byProvider: { local: { baseUrl: "http://ollama:11434/v1" } } }));
    expect(settingsForUse(ai, { NODE_ENV: "production" }).baseUrl).toBe("http://ollama:11434/v1");
    expect(AiPatchSchema.safeParse({ byProvider: { local: { baseUrl: "file:///etc/passwd" } } }).success).toBe(false);
  });
});
