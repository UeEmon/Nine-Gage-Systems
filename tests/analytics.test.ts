import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { normalizePath, referrerHost } from "../src/lib/analytics";
import {
  analyticsView,
  eventAllowed,
  eventsSince,
  MAX_EVENTS_PER_HOUR,
  periodStart,
  recordEvent,
  visitorIdFrom,
  visitorLinks,
  type StoredEvent,
} from "../src/lib/server/analytics";

const NOW = new Date("2026-11-25T12:00:00+09:00");

const ev = (over: Partial<StoredEvent> & Pick<StoredEvent, "name" | "at">): StoredEvent => ({
  site: "platform",
  path: "/",
  detail: null,
  vid: null,
  uid: null,
  ref: null,
  mobile: false,
  ...over,
});

describe("アクセス解析: 残す形", () => {
  it("パスの ? 以降とIDらしい部分を落とす", () => {
    expect(normalizePath("/login?next=/x")).toBe("/login");
    expect(normalizePath("/l/p_ab3xKq9ZzQ")).toBe("/l/:id");
    expect(normalizePath("/s/abc")).toBe("/s/:id");
    expect(normalizePath("/news/2026-11-25-official-release-v1")).toBe("/news/:id");
    expect(normalizePath("/guide/api-key")).toBe("/guide/api-key");
    expect(normalizePath("/")).toBe("/");
    expect(normalizePath("/admin/")).toBe("/admin");
    expect(normalizePath("/a/%E6%97%A5%E6%9C%AC")).toBe("/a/:id");
  });

  it("参照元はホスト名だけで、自分のサイトは残さない", () => {
    expect(referrerHost("https://www.google.com/search?q=senrolab", ["senrolab.com"])).toBe("www.google.com");
    expect(referrerHost("https://platform.senrolab.com/", ["senrolab.com"])).toBeNull();
    expect(referrerHost("android-app://x", [])).toBeNull();
    expect(referrerHost("", [])).toBeNull();
  });

  it("訪問者IDの Cookie を読む（形が違えば使わない）", () => {
    expect(visitorIdFrom("a=1; sl_vid=abcdefghijklmnopqrstuv; b=2")).toBe("abcdefghijklmnopqrstuv");
    expect(visitorIdFrom("sl_vid=short")).toBeNull();
    expect(visitorIdFrom("sl_vid=<script>xxxxxxxxxxxxxxxxx")).toBeNull();
  });

  it("同じ送り元から1時間に送れる数を制限する", () => {
    const t = Date.parse("2026-11-25T00:00:00Z");
    for (let i = 0; i < MAX_EVENTS_PER_HOUR; i++) expect(eventAllowed("k-limit", t)).toBe(true);
    expect(eventAllowed("k-limit", t)).toBe(false);
    expect(eventAllowed("k-limit", t + 3_600_001)).toBe(true);
  });
});

describe("アクセス解析: 保存", () => {
  const env = { NINEGAGE_DATA_DIR: "" };
  beforeEach(() => {
    env.NINEGAGE_DATA_DIR = mkdtempSync(path.join(tmpdir(), "ng-an-"));
  });

  it("記録を残して読み出し、訪問者IDとユーザーIDの組を返す", () => {
    recordEvent({ name: "view", site: "www", path: "/", detail: null, vid: "v1", uid: null, ref: "www.google.com", mobile: true, at: "2026-11-20T00:00:00Z" }, env);
    recordEvent({ name: "signup", site: "www", path: null, detail: null, vid: "v1", uid: "u1", ref: null, mobile: false, at: "2026-11-21T00:00:00Z" }, env);
    const all = eventsSince(null, env);
    expect(all.map((e) => e.name)).toEqual(["view", "signup"]);
    expect(all[0].mobile).toBe(true);
    expect(eventsSince("2026-11-20T12:00:00Z", env).map((e) => e.name)).toEqual(["signup"]);
    expect(visitorLinks(env)).toEqual([{ vid: "v1", uid: "u1" }]);
  });
});

describe("アクセス解析: 集計", () => {
  const users = [
    { id: "admin", role: "admin" as const, createdAt: "2026-01-01T00:00:00Z" },
    { id: "u1", role: "user" as const, createdAt: "2026-11-20T01:00:00Z" },
    { id: "u2", role: "user" as const, createdAt: "2026-11-22T01:00:00Z", pendingVerify: { tokenHash: "x", expiresAt: "2026-11-23T00:00:00Z" } },
    { id: "old", role: "plus" as const, createdAt: "2026-05-01T00:00:00Z" },
  ];
  const events: StoredEvent[] = [
    // u1: ログイン前にトップページとエディタを見て保存し、そのあと登録・ログインして運転・投稿
    ev({ name: "view", at: "2026-11-20T00:00:00Z", site: "www", vid: "v1", ref: "x.com", mobile: true }),
    ev({ name: "view", at: "2026-11-20T00:10:00Z", vid: "v1" }),
    ev({ name: "save", at: "2026-11-20T00:20:00Z", vid: "v1", detail: "new" }),
    ev({ name: "signup", at: "2026-11-20T01:00:00Z", site: "www", path: null, vid: "v1", uid: "u1" }),
    ev({ name: "login", at: "2026-11-21T01:00:00Z", site: "www", path: null, vid: "v1", uid: "u1" }),
    ev({ name: "drive", at: "2026-11-22T01:00:00Z", vid: "v1", uid: "u1", detail: "free" }),
    ev({ name: "view", at: "2026-11-23T01:00:00Z", site: "terminal", path: "/post", vid: "v1", uid: "u1" }),
    ev({ name: "terminal_post", at: "2026-11-23T01:05:00Z", site: "terminal", path: "/post", vid: "v1", uid: "u1" }),
    // 登録していない訪問者
    ev({ name: "view", at: "2026-11-24T00:00:00Z", vid: "v2" }),
    ev({ name: "drive", at: "2026-11-24T00:01:00Z", vid: "v2" }),
    ev({ name: "view", at: "2026-11-25T01:00:00Z", site: "www", vid: "v3" }),
    // 管理者（ログイン前の分も数えない）
    ev({ name: "view", at: "2026-11-24T00:00:00Z", vid: "va" }),
    ev({ name: "login", at: "2026-11-24T00:01:00Z", vid: "va", uid: "admin" }),
    ev({ name: "save", at: "2026-11-24T00:02:00Z", vid: "va", uid: "admin" }),
  ];
  const links = [
    { vid: "v1", uid: "u1" },
    { vid: "va", uid: "admin" },
  ];
  const view = (period: "7d" | "30d" | "all" = "7d") =>
    analyticsView({ events, recent: events, lifetime: events, links, users, period, measuredSince: events[0].at, now: NOW });

  it("期間の始まりは日本時間の0時", () => {
    expect(periodStart("7d", NOW)).toBe("2026-11-18T15:00:00.000Z");
    expect(periodStart("all", NOW)).toBeNull();
  });

  it("訪問者・ログインした人・登録を数え、管理者は数えない", () => {
    const v = view();
    expect(v.totals.visitors).toBe(3);
    expect(v.totals.users).toBe(1);
    expect(v.totals.views).toBe(5);
    expect(v.totals.signups).toBe(2);
    expect(v.totals.mobileRate).toBeCloseTo(1 / 3);
    expect(v.active.today).toEqual({ visitors: 1, users: 0 });
    expect(v.active.week).toEqual({ visitors: 3, users: 1 });
    expect(v.daily).toHaveLength(7);
    expect(v.daily.find((d) => d.day === "2026-11-20")).toMatchObject({ visitors: 1, views: 2, signups: 1, registered: 2 });
    // 累計は期間の前の登録（old）から始まり、管理者は入れない
    expect(v.daily[0].registered).toBe(1);
    expect(v.daily[v.daily.length - 1].registered).toBe(3);
    expect(v.referrers).toEqual([{ host: "x.com", visitors: 1 }]);
  });

  it("機能別に回数と使った人を数え、内訳を付ける", () => {
    const v = view();
    const drive = v.features.find((f) => f.id === "drive")!;
    expect(drive).toMatchObject({ count: 2, people: 2, users: 1 });
    expect(drive.details).toEqual([{ detail: "free", count: 1 }]);
    const save = v.features.find((f) => f.id === "save")!;
    expect(save).toMatchObject({ count: 1, people: 1, users: 1 }); // ログイン前の保存も、登録したあとの本人に結びつく
  });

  it("登録した人のその後: ログイン前の保存も数え、メールの確認待ちは確認の段に入らない", () => {
    const f = view().signupFunnel;
    expect(f.map((s) => [s.id, s.count])).toEqual([
      ["signup", 2],
      ["verify", 1],
      ["login", 1],
      ["save", 1],
      ["drive", 1],
      ["post", 1],
    ]);
    expect(f[1].rate).toBe(0.5);
    expect(f[4].medianDays).toBeCloseTo(2);
    expect(f[3].medianDays).toBe(0); // 登録より前の保存は0日
  });

  it("訪問者の流れ: 期間内に訪問した人のうち、それぞれの操作をした人", () => {
    const f = view().visitorFunnel;
    expect(f.map((s) => [s.id, s.count])).toEqual([
      ["visit", 3],
      ["editor", 2],
      ["save", 1],
      ["drive", 2],
      ["signup", 1],
      ["post", 1],
    ]);
    expect(f[1].fromPrev).toBeCloseTo(2 / 3);
  });

  it("全期間なら以前に登録した人も入り、計測前の登録として数える", () => {
    const v = view("all");
    expect(v.totals.signups).toBe(3);
    expect(v.cohortBeforeMeasure).toBe(1);
    // 全期間のグラフは最初の登録（old、2026-05-01）から今日まで
    expect(v.daily[0].day).toBe("2026-04-30");
    expect(v.daily[0].registered).toBe(0);
    expect(v.daily[v.daily.length - 1]).toMatchObject({ day: "2026-11-25", registered: 3 });
  });
});

describe("アクセス解析: 受け口（/api/events）", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    process.env.NINEGAGE_DATA_DIR = mkdtempSync(path.join(tmpdir(), "ng-ev-"));
    delete process.env.NINEGAGE_HOME_URL;
    delete process.env.NINEGAGE_PUBLIC_URL;
    process.env.SENROLAB_TERMINAL_URL = "https://terminal.example.jp";
    process.env.SENROLAB_TERMINAL_SECRET = "t".repeat(40);
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  const post = async (body: unknown, headers: Record<string, string> = {}) => {
    const { POST } = await import("../src/app/api/events/route");
    return POST(
      new Request("http://localhost:3000/api/events", {
        method: "POST",
        headers: { host: "localhost:3000", origin: "http://localhost:3000", ...headers },
        body: typeof body === "string" ? body : JSON.stringify(body),
      }),
    );
  };

  it("記録して訪問者の Cookie を出す（IP・クエリは残さない）", async () => {
    const res = await post({ name: "view", path: "/login?next=/admin", referrer: "https://www.google.com/search?q=a", mobile: false });
    expect(res.status).toBe(204);
    expect(res.headers.get("set-cookie")).toMatch(/^sl_vid=[A-Za-z0-9_-]{16,}; .*HttpOnly; SameSite=Lax/);
    const [e] = eventsSince(null, process.env);
    expect(e).toMatchObject({ name: "view", site: "www", path: "/login", ref: "www.google.com", uid: null });
    expect(e.vid).toBeTruthy();
  });

  it("Cookie があればその訪問者IDを使い、新しく出さない", async () => {
    const res = await post({ name: "drive", path: "/", detail: "free" }, { cookie: "sl_vid=abcdefghijklmnopqrstuv" });
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(eventsSince(null, process.env)[0]).toMatchObject({ name: "drive", site: "platform", detail: "free", vid: "abcdefghijklmnopqrstuv" });
  });

  it("ターミナルからの送信はターミナルとして数える", async () => {
    const res = await post({ name: "terminal_post", path: "/post", site: "terminal" }, { origin: "https://terminal.example.jp" });
    expect(res.status).toBe(204);
    expect(eventsSince(null, process.env)[0]).toMatchObject({ name: "terminal_post", site: "terminal" });
  });

  it("ほかのサイトからの送信・知らないイベント・壊れた中身は受け付けない", async () => {
    expect((await post({ name: "view", path: "/" }, { origin: "https://evil.example" })).status).toBe(403);
    expect((await post({ name: "signup", path: "/" })).status).toBe(400);
    expect((await post({ name: "view", path: "/", detail: "<b>" })).status).toBe(400);
    expect((await post("not json")).status).toBe(400);
    expect(eventsSince(null, process.env)).toEqual([]);
  });
});
