import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { publicBaseUrl, transportOptions } from "../src/lib/server/mailer";
import { clearSessionCookies, cookieDomain, createSessionToken, sessionCookie, userFromTokens } from "../src/lib/server/session";
import { loadStore, updateStore } from "../src/lib/server/store";
import { requestPasswordReset, resetMail, resetPassword, signupUser, updateUser, verifyEmail } from "../src/lib/server/users";
import { verifyPassword } from "../src/lib/server/password";
import { routeFor, safeNext, sitesFrom } from "../src/lib/sites";

const SITES = { home: "https://www.senrolab.com", app: "https://platform.senrolab.com" };
const HOME = "www.senrolab.com";
const APP = "platform.senrolab.com";

describe("トップページとプラットフォームの振り分け", () => {
  it("両方のアドレスがそろって違うときだけ振り分ける", () => {
    expect(sitesFrom({ NINEGAGE_HOME_URL: "https://www.senrolab.com/", NINEGAGE_PUBLIC_URL: "https://platform.senrolab.com" })).toEqual(SITES);
    expect(sitesFrom({ NINEGAGE_PUBLIC_URL: "https://platform.senrolab.com" })).toBeNull();
    expect(sitesFrom({ NINEGAGE_HOME_URL: "https://x.example", NINEGAGE_PUBLIC_URL: "https://x.example" })).toBeNull();
    expect(sitesFrom({ NINEGAGE_HOME_URL: "javascript:alert(1)", NINEGAGE_PUBLIC_URL: "https://x.example" })).toBeNull();
  });

  it("トップページのアドレスでは / がトップページ、ログインまわりはそのまま、ほかはプラットフォームへ", () => {
    expect(routeFor(HOME, "/", "", SITES)).toEqual({ kind: "rewrite", path: "/home" });
    for (const p of ["/login", "/signup", "/verify", "/forgot", "/reset", "/account", "/guide/api-key"]) {
      expect(routeFor(HOME, p, "", SITES)).toBeNull();
    }
    expect(routeFor(HOME, "/admin", "?tab=1", SITES)).toEqual({ kind: "redirect", url: "https://platform.senrolab.com/admin?tab=1" });
    expect(routeFor(HOME, "/terminal", "", SITES)).toEqual({ kind: "redirect", url: "https://platform.senrolab.com/terminal" });
    expect(routeFor(HOME, "/home", "", SITES)).toEqual({ kind: "redirect", url: "https://www.senrolab.com/" });
  });

  it("プラットフォームのアドレスでは、エディタはそのまま、ログインまわりはトップページへ（戻り先付き）", () => {
    expect(routeFor(APP, "/", "", SITES)).toBeNull();
    expect(routeFor(APP, "/admin", "", SITES)).toBeNull();
    expect(routeFor(APP, "/login", "", SITES)).toEqual({
      kind: "redirect",
      url: `https://www.senrolab.com/login?next=${encodeURIComponent("https://platform.senrolab.com/")}`,
    });
    const r = routeFor(APP, "/login", `?next=${encodeURIComponent("/api/terminal/handoff?state=abc")}`, SITES);
    expect(r?.kind === "redirect" && new URL(r.url).searchParams.get("next")).toBe("https://platform.senrolab.com/api/terminal/handoff?state=abc");
    // ほかのサイトへの戻り先は付け替える
    const evil = routeFor(APP, "/login", "?next=//evil.example/", SITES);
    expect(evil?.kind === "redirect" && new URL(evil.url).searchParams.get("next")).toBe("https://platform.senrolab.com/");
    expect(routeFor(APP, "/account", "?welcome=1", SITES)).toEqual({ kind: "redirect", url: "https://www.senrolab.com/account?welcome=1" });
  });

  it("/editor はどちらからでもプラットフォームのトップへ。1つのアドレスのときは / へ", () => {
    expect(routeFor(HOME, "/editor", "", SITES)).toEqual({ kind: "redirect", url: "https://platform.senrolab.com/" });
    expect(routeFor("localhost:3000", "/editor", "", null)).toEqual({ kind: "redirect", url: "/" });
    expect(routeFor("localhost:3000", "/login", "", null)).toBeNull();
    expect(routeFor("localhost:3000", "/", "", null)).toBeNull();
  });

  it("ログイン後の戻り先は、このサイトのパスか2つのアドレスだけ", () => {
    expect(safeNext("https://platform.senrolab.com/feedback", SITES)).toBe("https://platform.senrolab.com/feedback");
    expect(safeNext("https://www.senrolab.com/account", SITES)).toBe("https://www.senrolab.com/account");
    expect(safeNext("https://evil.example/", SITES)).toBe("/");
    expect(safeNext("https://platform.senrolab.com.evil.example/", SITES)).toBe("/");
    expect(safeNext("https://platform.senrolab.com/", null)).toBe("/");
    expect(safeNext("/feedback", SITES)).toBe("/feedback");
  });
});

describe("ログインの共有（Cookie）", () => {
  it("NINEGAGE_COOKIE_DOMAIN があれば、そのドメインの Cookie にする", () => {
    expect(cookieDomain({ NINEGAGE_COOKIE_DOMAIN: ".SenroLab.com" })).toBe("senrolab.com");
    expect(cookieDomain({ NINEGAGE_COOKIE_DOMAIN: "localhost" })).toBeUndefined();
    expect(cookieDomain({})).toBeUndefined();
    expect(sessionCookie("t", true, "senrolab.com")).toMatchObject({ domain: "senrolab.com", secure: true, httpOnly: true });
    expect(sessionCookie("t", true, undefined)).not.toHaveProperty("domain");
  });

  it("ログアウトでは共有の Cookie と、そのアドレスだけの Cookie の両方を消す", () => {
    const c = clearSessionCookies(true, "senrolab.com");
    expect(c).toHaveLength(2);
    expect(c[1]).toContain("Domain=senrolab.com");
    expect(c.every((v) => v.includes("Max-Age=0"))).toBe(true);
  });

  it("同じ名前の Cookie が複数あっても、有効なものでログインする", async () => {
    const e = { NINEGAGE_DATA_DIR: mkdtempSync(path.join(tmpdir(), "ng-sites-")), NINEGAGE_ADMIN_USER: "owner", NINEGAGE_ADMIN_PASSWORD: "first-password-123" };
    const data = await loadStore(e);
    const token = createSessionToken(data.users[0], data.sessionSecret);
    expect(userFromTokens(["stale.1.2.xxx", token], data)?.username).toBe("owner");
    expect(userFromTokens(["stale.1.2.xxx"], data)).toBeNull();
  });
});

describe("パスワードの再設定", () => {
  const ADMIN = { NINEGAGE_ADMIN_USER: "owner", NINEGAGE_ADMIN_PASSWORD: "first-password-123" };
  const env = () => ({ NINEGAGE_DATA_DIR: mkdtempSync(path.join(tmpdir(), "ng-reset-")), ...ADMIN });

  async function verified(e: Record<string, string>) {
    return updateStore(async (d) => {
      const r = await signupUser(d, { username: "rider", email: "Rider@Example.com", password: "rider-pass-12" }, e);
      if (r.kind !== "created") throw new Error("not created");
      return verifyEmail(d, r.token).id;
    }, e);
  }

  it("登録したメールアドレスにリンクを送り、新しいパスワードにするとほかのログインは切れる", async () => {
    const e = env();
    const id = await verified(e);
    const before = (await loadStore(e)).users.find((u) => u.id === id)!;
    const token = await updateStore((d) => requestPasswordReset(d, " rider@example.COM ")!.token, e);
    const user = await updateStore((d) => resetPassword(d, { token, password: "brand-new-pass-1" }), e);
    expect(await verifyPassword("brand-new-pass-1", user.passwordHash)).toBe(true);
    expect(user.sessionVersion).toBe(before.sessionVersion + 1);
    expect(user.passwordReset).toBeUndefined();
    // 1回だけ使える
    await expect(updateStore((d) => resetPassword(d, { token, password: "another-pass-12" }), e)).rejects.toThrow(/無効/);
  });

  it("知らないメールアドレスや確認待ちの登録には送らない", async () => {
    const e = env();
    await updateStore((d) => signupUser(d, { username: "waiting", email: "w@example.com", password: "waiting-pass-1" }, e), e);
    expect(await updateStore((d) => requestPasswordReset(d, "nobody@example.com"), e)).toBeNull();
    expect(await updateStore((d) => requestPasswordReset(d, "w@example.com"), e)).toBeNull();
  });

  it("期限切れ・短いパスワードは受け付けず、管理者がパスワードを変えるとリンクは無効になる", async () => {
    const e = env();
    const id = await verified(e);
    const t0 = Date.parse("2026-11-25T00:00:00Z");
    const old = await updateStore((d) => requestPasswordReset(d, "rider@example.com", t0)!.token, e);
    await expect(updateStore((d) => resetPassword(d, { token: old, password: "brand-new-pass-1" }, t0 + 61 * 60_000), e)).rejects.toThrow(/期限/);
    const token = await updateStore((d) => requestPasswordReset(d, "rider@example.com")!.token, e);
    await expect(updateStore((d) => resetPassword(d, { token, password: "short" }), e)).rejects.toThrow();
    await updateStore((d) => updateUser(d, id, { password: "admin-set-pass-1" }), e);
    await expect(updateStore((d) => resetPassword(d, { token, password: "brand-new-pass-1" }), e)).rejects.toThrow(/無効/);
  });

  it("保存し直しても再設定のリンクは残る", async () => {
    const e = env();
    await verified(e);
    await updateStore((d) => requestPasswordReset(d, "rider@example.com"), e);
    expect((await loadStore(e)).users.find((u) => u.username === "rider")?.passwordReset?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("メールのリンクはトップページのアドレスで、トークンは # の後ろ", () => {
    const base = publicBaseUrl(new Request("https://evil.example/"), {
      NODE_ENV: "production",
      NINEGAGE_HOME_URL: "https://www.senrolab.com",
      NINEGAGE_PUBLIC_URL: "https://platform.senrolab.com",
    });
    expect(base).toBe("https://www.senrolab.com");
    expect(resetMail(base!, "rider", "TOKEN").text).toContain("https://www.senrolab.com/reset#TOKEN");
  });
});

describe("メールの送信（OCI Email Delivery）", () => {
  it("smtp:// では STARTTLS を必ず使い、smtps:// と手元の試験用はそのまま", () => {
    expect(transportOptions("smtp://u:p@smtp.email.ap-tokyo-1.oci.oraclecloud.com:587")).toEqual({
      url: "smtp://u:p@smtp.email.ap-tokyo-1.oci.oraclecloud.com:587",
      requireTLS: true,
    });
    expect(transportOptions("smtps://u:p@smtp.gmail.com:465")).not.toHaveProperty("requireTLS");
    expect(transportOptions("smtp://localhost:1025")).not.toHaveProperty("requireTLS");
  });
});
