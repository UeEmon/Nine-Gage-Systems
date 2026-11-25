import { createHmac } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { UsageRecord } from "../src/lib/server/aiUsage";
import { aiAllowance, aiLimitFor, effectiveRole, jstMonthStart, jstNextMonthStart, usedJpy } from "../src/lib/server/premium";
import { publicUser } from "../src/lib/server/session";
import {
  applyAllSponsorships,
  applyWebhook,
  linkGithub,
  verifySignature,
  viewerSponsorship,
  type Sponsorship,
} from "../src/lib/server/sponsors";
import { loadStore, newUser, updateStore, type StoreData } from "../src/lib/server/store";
import { createUser, listUsers, updateUser } from "../src/lib/server/users";

const NOW = new Date("2026-11-25T12:00:00Z"); // 日本時間 11月25日 21時

function store(): StoreData {
  return {
    version: 3,
    sessionSecret: "s".repeat(64),
    users: [],
    ai: { byProvider: {} },
    notices: [],
    aiCost: { usdJpy: 150 },
    sponsorPlan: { multiplier: 0.75, oneTimeDays: 30 },
    sponsors: {},
    feedback: [],
  };
}

function sponsored(data: StoreData, s: Partial<Sponsorship> = {}) {
  const u = newUser("rider", "user", "x");
  data.users.push(u);
  linkGithub(data, u, { id: 42, login: "rider-gh" }, null, NOW);
  applySponsor(data, s);
  return u;
}

function applySponsor(data: StoreData, s: Partial<Sponsorship>) {
  applyAllSponsorships(data, [
    { sponsor: { id: 42, login: "rider-gh" }, usd: 5, oneTime: false, active: true, createdAt: "2026-10-01T00:00:00Z", ...s },
  ], NOW);
}

function rec(userId: string, at: string, costUsd: number | null, keySource: "server" | "own" = "server"): UsageRecord {
  return {
    at,
    userId,
    username: userId,
    provider: "anthropic",
    model: "m",
    maker: "kato",
    feature: "free",
    keySource,
    attempts: 1,
    resultCached: false,
    ok: true,
    usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
    costUsd,
    costWithoutCacheUsd: costUsd,
  };
}

describe("プレミアムユーザー（GitHub Sponsors）", () => {
  it("GitHub を連携した一般ユーザーが支援中ならプレミアムユーザー。連携していなければ一般のまま", () => {
    const data = store();
    const u = sponsored(data);
    expect(effectiveRole(u, data, NOW)).toBe("ai");
    expect(publicUser(u, data).role).toBe("ai");
    const other = newUser("other", "user", "x");
    expect(effectiveRole(other, data, NOW)).toBe("user");
    // 管理者・プレミアムプラスはそのまま
    const admin = newUser("owner", "admin", "x");
    admin.github = { id: 42, login: "rider-gh", linkedAt: NOW.toISOString() };
    expect(effectiveRole(admin, data, NOW)).toBe("admin");
  });

  it("毎月の支援: 上限は 支援額×レート×倍率、日本時間の今月1日から数えて来月1日に戻る", () => {
    const data = store();
    const u = sponsored(data);
    expect(jstMonthStart(NOW).toISOString()).toBe("2026-10-31T15:00:00.000Z");
    expect(jstNextMonthStart(new Date("2026-12-20T00:00:00Z")).toISOString()).toBe("2026-12-31T15:00:00.000Z");
    expect(aiLimitFor(data, u, NOW)).toMatchObject({
      limitJpy: 562,
      since: "2026-10-31T15:00:00.000Z",
      resetsAt: "2026-11-30T15:00:00.000Z",
      expiresAt: null,
    });
  });

  it("1回きりの支援: その日から決めた日数だけ有効。過ぎたら一般に戻る", () => {
    const data = store();
    const u = sponsored(data, { oneTime: true, usd: 10, createdAt: "2026-11-10T00:00:00Z" });
    expect(effectiveRole(u, data, NOW)).toBe("ai");
    expect(aiLimitFor(data, u, NOW)).toMatchObject({
      limitJpy: 1125,
      since: "2026-11-10T00:00:00.000Z",
      resetsAt: null,
      expiresAt: "2026-12-10T00:00:00.000Z",
    });
    expect(effectiveRole(u, data, new Date("2026-12-10T00:00:00Z"))).toBe("user");
    expect(aiLimitFor(data, u, new Date("2026-12-10T00:00:00Z"))).toBeNull();
  });

  it("使った分はサーバーのキーで、数え始めより後の、その人の分だけ（円換算）", () => {
    const records = [
      rec("u", "2026-11-01T00:00:00Z", 1),
      rec("u", "2026-11-02T00:00:00Z", 2, "own"),
      rec("u", "2026-10-30T00:00:00Z", 4),
      rec("v", "2026-11-03T00:00:00Z", 8),
      rec("u", "2026-11-04T00:00:00Z", null),
    ];
    expect(usedJpy(records, "u", "2026-10-31T15:00:00.000Z", 150)).toBe(150);
  });

  it("上限に達したら overLimit", () => {
    const data = store();
    const u = sponsored(data);
    const under = aiAllowance(data, u, [rec(u.id, "2026-11-20T00:00:00Z", 3)], NOW)!;
    expect(under).toMatchObject({ limitJpy: 562, usedJpy: 450, overLimit: false });
    const over = aiAllowance(data, u, [rec(u.id, "2026-11-20T00:00:00Z", 3.75)], NOW)!;
    expect(over.overLimit).toBe(true);
  });
});

describe("プレミアムプラス", () => {
  it("管理者が上限を決める。空なら上限なし。ほかのロールには設定できず、ロールを変えると消える", async () => {
    const data = await loadStore({ NINEGAGE_DATA_DIR: mkdtempSync(path.join(tmpdir(), "ng-plus-")) });
    const amy = await createUser(data, { username: "amy", password: "password-12345", role: "user" });
    await expect(updateUser(data, amy.id, { aiLimitJpy: 1000 })).rejects.toThrow(/プレミアムプラスだけ/);
    await updateUser(data, amy.id, { role: "plus" });
    const u = data.users.find((x) => x.id === amy.id)!;
    expect(aiLimitFor(data, u, NOW)).toMatchObject({ limitJpy: null, resetsAt: null });
    expect(await updateUser(data, amy.id, { aiLimitJpy: 1000 })).toMatchObject({ role: "plus", aiLimitJpy: 1000 });
    expect(aiLimitFor(data, u, NOW)).toMatchObject({ limitJpy: 1000, resetsAt: "2026-11-30T15:00:00.000Z" });
    await updateUser(data, amy.id, { aiLimitJpy: null });
    expect(u.aiLimitJpy).toBeUndefined();
    await updateUser(data, amy.id, { aiLimitJpy: 500 });
    await updateUser(data, amy.id, { role: "user" });
    expect(u.aiLimitJpy).toBeUndefined();
    expect(listUsers(data).find((r) => r.id === amy.id)).toMatchObject({ storedRole: "user", aiLimitJpy: null });
  });

  it("版2の保存形式のプレミアムユーザーは上限なしのプレミアムプラスに読み替える", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ng-plus-"));
    const old = {
      version: 2,
      sessionSecret: "s".repeat(64),
      users: [
        { id: "a", username: "owner", role: "admin", passwordHash: "x", sessionVersion: 1, createdAt: "2026-11-01T00:00:00Z" },
        { id: "b", username: "member", role: "ai", passwordHash: "x", sessionVersion: 1, createdAt: "2026-11-01T00:00:00Z" },
        { id: "c", username: "general", role: "user", passwordHash: "x", sessionVersion: 1, createdAt: "2026-11-01T00:00:00Z", aiLimitJpy: 5 },
      ],
      ai: { byProvider: {} },
      notices: [],
    };
    writeFileSync(path.join(dir, "store.json"), JSON.stringify(old));
    const data = await loadStore({ NINEGAGE_DATA_DIR: dir });
    expect(data.users.map((u) => [u.username, u.role, u.aiLimitJpy])).toEqual([
      ["owner", "admin", undefined],
      ["member", "plus", undefined],
      ["general", "user", undefined],
    ]);
    expect(data.sponsorPlan).toEqual({ multiplier: 0.75, oneTimeDays: 30 });
  });

  it("支援の記録と連携は保存し直しても残る", async () => {
    const e = { NINEGAGE_DATA_DIR: mkdtempSync(path.join(tmpdir(), "ng-plus-")) };
    await updateStore((d) => {
      sponsored(d);
    }, e);
    const data = await loadStore(e);
    expect(data.sponsors["42"]).toMatchObject({ login: "rider-gh", monthlyUsd: 5 });
    expect(data.users[0].github).toMatchObject({ id: 42, login: "rider-gh" });
  });
});

describe("GitHub Sponsors", () => {
  const SECRET = "hook-secret";
  const sign = (body: string) => `sha256=${createHmac("sha256", SECRET).update(body).digest("hex")}`;
  const event = (action: string, tier: { monthly_price_in_dollars: number; is_one_time: boolean }, login = "UeEmon") => ({
    action,
    sponsorship: {
      created_at: "2026-11-01T00:00:00Z",
      sponsor: { id: 42, login: "rider-gh" },
      sponsorable: { login },
      tier,
    },
  });

  it("Webhook の署名を確かめる", () => {
    const body = JSON.stringify({ a: 1 });
    expect(verifySignature(body, sign(body), SECRET)).toBe(true);
    expect(verifySignature(body, sign("other"), SECRET)).toBe(false);
    expect(verifySignature(body, null, SECRET)).toBe(false);
  });

  it("毎月の支援の開始・変更・終了を反映する。連携の前に届いた分も残る", () => {
    const data = store();
    expect(applyWebhook(data, event("created", { monthly_price_in_dollars: 5, is_one_time: false }), {}, NOW)).toBe(true);
    expect(data.sponsors["42"]).toMatchObject({ login: "rider-gh", monthlyUsd: 5 });
    applyWebhook(data, event("tier_changed", { monthly_price_in_dollars: 10, is_one_time: false }), {}, NOW);
    expect(data.sponsors["42"].monthlyUsd).toBe(10);
    // あとから連携すると効く
    const u = newUser("rider", "user", "x");
    data.users.push(u);
    linkGithub(data, u, { id: 42, login: "rider-gh" }, null, NOW);
    expect(effectiveRole(u, data, NOW)).toBe("ai");
    expect(applyWebhook(data, event("pending_cancellation", { monthly_price_in_dollars: 10, is_one_time: false }), {}, NOW)).toBe(false);
    applyWebhook(data, event("cancelled", { monthly_price_in_dollars: 10, is_one_time: false }), {}, NOW);
    expect(effectiveRole(u, data, NOW)).toBe("user");
  });

  it("1回きりの支援は届いた日から数える。ほかの支援先あての Webhook は無視する", () => {
    const data = store();
    applyWebhook(data, event("created", { monthly_price_in_dollars: 5, is_one_time: true }), {}, NOW);
    expect(data.sponsors["42"]).toMatchObject({ monthlyUsd: 0, oneTime: [{ at: NOW.toISOString(), usd: 5 }] });
    expect(applyWebhook(data, event("created", { monthly_price_in_dollars: 5, is_one_time: false }, "someone-else"), {}, NOW)).toBe(false);
    expect(data.sponsors["42"].monthlyUsd).toBe(0);
  });

  it("同じ GitHub アカウントは1人にしか連携できない", () => {
    const data = store();
    const a = newUser("a", "user", "x");
    const b = newUser("b", "user", "x");
    data.users.push(a, b);
    linkGithub(data, a, { id: 7, login: "gh" }, null, NOW);
    expect(() => linkGithub(data, b, { id: 7, login: "gh" }, null, NOW)).toThrow(/ほかの SenroLab アカウント/);
  });

  it("読み直しで見つからない毎月の支援は終わったものとして 0 にする", () => {
    const data = store();
    const u = sponsored(data);
    applyAllSponsorships(data, [], NOW);
    expect(effectiveRole(u, data, NOW)).toBe("user");
  });

  it("連携したときに、その人のトークンで支援を読む", async () => {
    let sent: { query: string; variables: { login: string } } | null = null;
    const fake = (async (_url: string, init: RequestInit) => {
      sent = JSON.parse(String(init.body));
      return new Response(
        JSON.stringify({
          data: {
            user: {
              sponsorshipForViewerAsSponsor: {
                createdAt: "2026-11-20T00:00:00Z",
                isActive: true,
                isOneTimePayment: true,
                tier: { monthlyPriceInDollars: 5 },
              },
            },
          },
        }),
      );
    }) as unknown as typeof fetch;
    const s = await viewerSponsorship("tok", { id: 42, login: "rider-gh" }, {}, fake);
    expect(sent!.variables.login).toBe("UeEmon");
    expect(s).toEqual({ sponsor: { id: 42, login: "rider-gh" }, usd: 5, oneTime: true, active: true, createdAt: "2026-11-20T00:00:00Z" });
  });
});
