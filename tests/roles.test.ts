import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { aiAccessOf, canSetOwnKey } from "../src/lib/roles";
import { AiPatchSchema, adminAiView, applyAiPatch } from "../src/lib/server/aiSettings";
import { recordSignup, signupBlocked } from "../src/lib/server/auth";
import { usageView, type UsageRecord } from "../src/lib/server/aiUsage";
import { aiStatusFor, applyOwnAi, ownAiView, OwnAiPatchSchema, ownSettings, previewOwnSettings, settingsForUser } from "../src/lib/server/ownAi";
import { storedText } from "../src/lib/server/db";
import { openSecret, sealSecret } from "../src/lib/server/secretBox";
import { loadStore, updateStore } from "../src/lib/server/store";
import { createSessionToken, userFromToken } from "../src/lib/server/session";
import { createUser, listUsers, purgeExpiredSignups, signupMail, signupUser, updateUser, verifyEmail } from "../src/lib/server/users";
import type { StoreData } from "../src/lib/server/store";

/** 登録してメールの確認まで済ませる */
async function signupVerified(data: StoreData, username: string, e: Record<string, string>) {
  const r = await signupUser(data, { username, email: `${username}@example.com`, password: `${username}-pass-12` }, e);
  if (r.kind !== "created") throw new Error("not created");
  return verifyEmail(data, r.token);
}

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
    await updateStore((d) => signupVerified(d, "newbie", e), e);
    const raw = JSON.parse(storedText(e.NINEGAGE_DATA_DIR)!);
    expect(raw.version).toBe(2);
    const again = await loadStore(e);
    expect(again.users.map((u) => [u.username, u.role])).toEqual([
      ["owner", "admin"],
      ["member", "ai"],
      ["newbie", "user"],
    ]);
  });

  it("AI利用可能は追加では作れず、一般ユーザーから変える。確認待ちの人は変えられない", async () => {
    const e = env(ADMIN);
    const data = await loadStore(e);
    await expect(createUser(data, { username: "zed", password: "password-12345", role: "ai" })).rejects.toThrow(/一般ユーザーの中から/);
    const amy = await createUser(data, { username: "amy", password: "password-12345", role: "user" });
    await updateUser(data, amy.id, { role: "ai" });
    const r = await signupUser(data, { username: "rider", email: "r@example.com", password: "rider-pass-12" }, e);
    if (r.kind !== "created") throw new Error();
    await expect(updateUser(data, r.user.id, { role: "ai" })).rejects.toThrow(/確認/);
    expect(listUsers(data).find((u) => u.username === "rider")).toMatchObject({ pending: true, email: "r@example.com" });
  });

  it("一覧は管理者・AI利用可能・一般の順", async () => {
    const data = await loadStore(env(ADMIN));
    const zed = await createUser(data, { username: "zed", password: "password-12345", role: "user" });
    await updateUser(data, zed.id, { role: "ai" });
    await createUser(data, { username: "amy", password: "password-12345", role: "user" });
    expect(listUsers(data).map((u) => u.role)).toEqual(["admin", "ai", "user"]);
  });
});

describe("ユーザー登録", () => {
  it("自分で登録すると必ず一般になる。重複・短いパスワードは拒否", async () => {
    const e = env(ADMIN);
    const data = await loadStore(e);
    const u = await signupVerified(data, "rider", e);
    expect(u).toMatchObject({ role: "user", selfRegistered: true, email: "rider@example.com" });
    await expect(signupUser(data, { username: "Rider", email: "x@example.com", password: "rider-pass-12" }, e)).rejects.toThrow(/すでに/);
    await expect(signupUser(data, { username: "other", email: "o@example.com", password: "short" }, e)).rejects.toThrow(/10文字/);
    await expect(signupUser(data, { username: "other", email: "not-mail", password: "other-pass-12" }, e)).rejects.toThrow(/メールアドレス/);
  });

  it("NINEGAGE_SIGNUP=closed なら登録できない。最初の管理者がいないときも登録できない", async () => {
    const e = env(ADMIN);
    const data = await loadStore(e);
    await expect(signupUser(data, { username: "rider", email: "r@example.com", password: "rider-pass-12" }, { ...e, NINEGAGE_SIGNUP: "closed" })).rejects.toThrow(
      /受け付けていません/,
    );
    const empty = await loadStore(env());
    await expect(signupUser(empty, { username: "rider", email: "r@example.com", password: "rider-pass-12" }, e)).rejects.toThrow(/最初の管理者/);
  });

  it("メールのリンクを開くまではログインできず、開くとログインできる", async () => {
    const e = env(ADMIN);
    const data = await loadStore(e);
    const r = await signupUser(data, { username: "rider", email: "Rider@Example.com", password: "rider-pass-12" }, e);
    if (r.kind !== "created") throw new Error();
    expect(r.user.email).toBe("rider@example.com");
    expect(r.user.pendingVerify).toBeDefined();
    expect(JSON.stringify(data)).not.toContain(r.token);
    expect(userFromToken(createSessionToken(r.user, data.sessionSecret), data)).toBeNull();
    expect(signupMail("https://ng.example", "rider", r.token).text).toContain(`https://ng.example/verify#${r.token}`);
    expect(() => verifyEmail(data, "wrong-token-value")).toThrow(/無効/);
    const u = verifyEmail(data, r.token);
    expect(u.pendingVerify).toBeUndefined();
    expect(userFromToken(createSessionToken(u, data.sessionSecret), data)?.id).toBe(u.id);
    expect(() => verifyEmail(data, r.token)).toThrow(/無効/);
  });

  it("確認リンクは24時間で切れ、切れた登録は消えてユーザー名が空く", async () => {
    const e = env(ADMIN);
    const data = await loadStore(e);
    const t0 = Date.now();
    const r = await signupUser(data, { username: "rider", email: "r@example.com", password: "rider-pass-12" }, e, t0);
    if (r.kind !== "created") throw new Error();
    expect(() => verifyEmail(data, r.token, t0 + 25 * 3600_000)).toThrow(/期限/);
    purgeExpiredSignups(data, t0 + 25 * 3600_000);
    expect(data.users.some((u) => u.username === "rider")).toBe(false);
  });

  it("確認待ちのメールアドレスで登録し直すと前の登録は消え、確認済みのアドレスなら登録済みとして扱う", async () => {
    const e = env(ADMIN);
    const data = await loadStore(e);
    await signupUser(data, { username: "first", email: "r@example.com", password: "rider-pass-12" }, e);
    const again = await signupUser(data, { username: "second", email: "r@example.com", password: "rider-pass-12" }, e);
    expect(data.users.map((u) => u.username)).toEqual(["owner", "second"]);
    if (again.kind !== "created") throw new Error();
    verifyEmail(data, again.token);
    const third = await signupUser(data, { username: "third", email: "R@example.com", password: "rider-pass-12" }, e);
    expect(third).toEqual({ kind: "already", username: "second" });
    expect(data.users).toHaveLength(2);
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
    const general = await signupVerified(data, "rider", e);
    const t = await createUser(data, { username: "trusted", password: "trusted-pass-1", role: "user" });
    await updateUser(data, t.id, { role: "ai" });
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

  it("プレミアムユーザーも自分のキーを登録でき、登録したときだけそれを使う", async () => {
    const { e, data, trusted } = await setup();
    expect(canSetOwnKey("ai")).toBe(true);
    expect(canSetOwnKey("user")).toBe(true);
    expect(canSetOwnKey("admin")).toBe(false);
    expect(canSetOwnKey(null)).toBe(false);
    applyOwnAi(trusted, OwnAiPatchSchema.parse({ provider: "openai", apiKey: "sk-premium-own-4321", model: "gpt-x" }), e);
    expect(settingsForUser(data, trusted, e)).toMatchObject({
      keySource: "own",
      settings: { provider: "openai", apiKey: "sk-premium-own-4321", model: "gpt-x" },
    });
    expect(aiStatusFor(data, trusted, e)).toMatchObject({ source: "own", ready: true, provider: "openai", model: "gpt-x" });
    // 削除するとサーバーのAIに戻る
    applyOwnAi(trusted, { provider: "openai", apiKey: "" }, e);
    expect(settingsForUser(data, trusted, e)).toMatchObject({ keySource: "server", settings: { apiKey: "server-key-0000" } });
    expect(aiStatusFor(data, trusted, e)).toMatchObject({ source: "server", ready: true });
  });

  it("モデルの一覧は、入力中のキーか同じプロバイダの保存済みのキーで取る", async () => {
    const { e, data, general, trusted } = await setup();
    expect(() => previewOwnSettings(general, "openai", undefined, e)).toThrow(/APIキーを入力/);
    expect(previewOwnSettings(general, "openai", "sk-typed-1111", e)).toMatchObject({ provider: "openai", apiKey: "sk-typed-1111" });
    applyOwnAi(trusted, { provider: "gemini", apiKey: "g-saved-2222" }, e);
    expect(previewOwnSettings(trusted, "gemini", undefined, e).apiKey).toBe("g-saved-2222");
    // 別のプロバイダには保存済みのキーを送らない
    expect(() => previewOwnSettings(trusted, "anthropic", undefined, e)).toThrow(/APIキーを入力/);
    const owner = data.users.find((u) => u.role === "admin")!;
    expect(() => previewOwnSettings(owner, "openai", "x", e)).toThrow(/管理者が設定したAI/);
  });

  it("管理者は自分のキーを設定できない", async () => {
    const { e, data } = await setup();
    const owner = data.users.find((u) => u.role === "admin")!;
    expect(() => applyOwnAi(owner, { provider: "anthropic", apiKey: "x" }, e)).toThrow(/管理者が設定したAI/);
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

describe("管理者用とプレミアムユーザー用のモデル", () => {
  async function setup() {
    const e = env(ADMIN);
    const data = await loadStore(e);
    const t = await createUser(data, { username: "premium", password: "premium-pass-1", role: "user" });
    await updateUser(data, t.id, { role: "ai" });
    const premium = data.users.find((u) => u.username === "premium")!;
    const owner = data.users.find((u) => u.role === "admin")!;
    applyAiPatch(
      data.ai,
      AiPatchSchema.parse({
        provider: "anthropic",
        byProvider: { anthropic: { apiKey: "ant-server-0000", model: "claude-admin" }, openai: { apiKey: "oa-server-1111" } },
      }),
    );
    return { e, data, premium, owner };
  }

  it("決めていなければ、プレミアムユーザーも管理者と同じAIを使う", async () => {
    const { e, data, premium, owner } = await setup();
    expect(settingsForUser(data, premium, e).settings).toMatchObject({ provider: "anthropic", model: "claude-admin" });
    expect(settingsForUser(data, owner, e).settings).toMatchObject({ provider: "anthropic", model: "claude-admin" });
    expect(adminAiView(data.ai, e).premium).toEqual({ provider: null, model: "", savedKey: null });
  });

  it("プレミアムユーザー用に別のプロバイダとモデルを選べる。キーはプロバイダごとに共通", async () => {
    const { e, data, premium, owner } = await setup();
    applyAiPatch(data.ai, AiPatchSchema.parse({ premium: { provider: "openai", model: "gpt-premium" } }));
    expect(settingsForUser(data, premium, e)).toMatchObject({
      keySource: "server",
      settings: { provider: "openai", model: "gpt-premium", apiKey: "oa-server-1111" },
    });
    expect(settingsForUser(data, owner, e).settings).toMatchObject({ provider: "anthropic", model: "claude-admin" });
    expect(aiStatusFor(data, premium, e)).toMatchObject({ provider: "openai", model: "gpt-premium", ready: true, source: "server" });
    expect(aiStatusFor(data, owner, e)).toMatchObject({ provider: "anthropic", model: "claude-admin" });

    // 同じプロバイダでモデルが空なら、そのプロバイダの管理者用のモデル（なければ既定）
    applyAiPatch(data.ai, AiPatchSchema.parse({ premium: { provider: "anthropic", model: "" } }));
    expect(settingsForUser(data, premium, e).settings).toMatchObject({ provider: "anthropic", model: "claude-admin" });
    applyAiPatch(data.ai, AiPatchSchema.parse({ premium: { provider: "anthropic", model: "claude-premium" } }));
    expect(settingsForUser(data, premium, e).settings.model).toBe("claude-premium");

    // プロバイダだけ変えたら、前のモデル名は引き継がない
    applyAiPatch(data.ai, AiPatchSchema.parse({ premium: { provider: "openai" } }));
    expect(settingsForUser(data, premium, e).settings).toMatchObject({ provider: "openai", model: "gpt-5" });

    // null で「管理者用と同じ」に戻す
    applyAiPatch(data.ai, AiPatchSchema.parse({ premium: { provider: null } }));
    expect(data.ai.premium).toBeUndefined();
    expect(settingsForUser(data, premium, e).settings).toMatchObject({ provider: "anthropic", model: "claude-admin" });
  });

  it("プレミアムユーザー用のプロバイダのキーがなければ、使えない状態として出す", async () => {
    const { e, data, premium } = await setup();
    applyAiPatch(data.ai, AiPatchSchema.parse({ premium: { provider: "gemini", model: "gem-x" } }));
    expect(() => settingsForUser(data, premium, e)).toThrow(/管理者/);
    expect(aiStatusFor(data, premium, e)).toMatchObject({ provider: "gemini", model: "gem-x", ready: false });
  });

  it("プレミアムユーザー専用のAPIキーを設定でき、なければ共通のキーを使う", async () => {
    const { e, data, premium, owner } = await setup();
    applyAiPatch(data.ai, AiPatchSchema.parse({ premium: { provider: "anthropic", apiKey: "ant-premium-9876" } }));
    expect(settingsForUser(data, premium, e).settings).toMatchObject({ provider: "anthropic", apiKey: "ant-premium-9876", model: "claude-admin" });
    expect(settingsForUser(data, owner, e).settings.apiKey).toBe("ant-server-0000");
    const view = adminAiView(data.ai, e);
    expect(view.premium).toEqual({ provider: "anthropic", model: "", savedKey: "••••9876" });
    expect(JSON.stringify(view)).not.toContain("ant-premium");
    // モデルだけ変えてもキーは据え置き
    applyAiPatch(data.ai, AiPatchSchema.parse({ premium: { provider: "anthropic", model: "claude-premium" } }));
    expect(settingsForUser(data, premium, e).settings.apiKey).toBe("ant-premium-9876");
    // 別のプロバイダにするとキーは引き継がない（共通のキーになる）
    applyAiPatch(data.ai, AiPatchSchema.parse({ premium: { provider: "openai" } }));
    expect(settingsForUser(data, premium, e).settings.apiKey).toBe("oa-server-1111");
    // 共通のキーがないプロバイダでも、専用のキーがあれば使える
    applyAiPatch(data.ai, AiPatchSchema.parse({ premium: { provider: "gemini", apiKey: "gem-premium-5555" } }));
    expect(settingsForUser(data, premium, e).settings).toMatchObject({ provider: "gemini", apiKey: "gem-premium-5555" });
    // 空文字で削除
    applyAiPatch(data.ai, AiPatchSchema.parse({ premium: { provider: "gemini", apiKey: "" } }));
    expect(() => settingsForUser(data, premium, e)).toThrow(/管理者/);
  });

  it("専用のキーは暗号化して保存し、読み直しても使える", async () => {
    const e = env(ADMIN);
    await loadStore(e);
    await updateStore((d) => applyAiPatch(d.ai, AiPatchSchema.parse({ premium: { provider: "openai", apiKey: "sk-premium-secret-1234" } })), e);
    expect(storedText(e.NINEGAGE_DATA_DIR)).not.toContain("sk-premium-secret");
    expect((await loadStore(e)).ai.premium?.apiKey).toBe("sk-premium-secret-1234");
  });

  it("保存して読み直しても残る", async () => {
    const e = env(ADMIN);
    await loadStore(e);
    await updateStore((d) => applyAiPatch(d.ai, AiPatchSchema.parse({ premium: { provider: "openai", model: "gpt-premium" } })), e);
    expect((await loadStore(e)).ai.premium).toEqual({ provider: "openai", model: "gpt-premium" });
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
