import { randomBytes } from "node:crypto";
import { chmodSync, mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { FEATURE_EVENTS, SITES, type EventName, type Site } from "@/lib/analytics";
import { dataDir, type Env, type StoredUser } from "./store";

/**
 * アクセス解析の記録（NINEGAGE_DATA_DIR/analytics.sqlite、権限600）と、管理画面に出す集計。
 * 何を残し何を残さないかは src/lib/analytics.ts の説明のとおり。記録は RETENTION_DAYS 日で消す。
 * ユーザーやお知らせの store.sqlite とは別のファイルにする（数が多く、バックアップに入れなくてよいので）。
 */

export const RETENTION_DAYS = 400;
export const VISITOR_COOKIE = "sl_vid";
export const VISITOR_COOKIE_DAYS = 400;

export type StoredEvent = {
  at: string;
  name: EventName;
  site: Site;
  path: string | null;
  detail: string | null;
  vid: string | null;
  uid: string | null;
  ref: string | null;
  mobile: boolean;
};

const dbs = new Map<string, DatabaseSync>();

export function analyticsDbPath(dir: string) {
  return path.join(dir, "analytics.sqlite");
}

export function openAnalytics(dir: string): DatabaseSync {
  const file = analyticsDbPath(dir);
  const cached = dbs.get(file);
  if (cached) return cached;
  mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(file);
  chmodSync(file, 0o600);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY,
      at TEXT NOT NULL,
      name TEXT NOT NULL,
      site TEXT NOT NULL,
      path TEXT,
      detail TEXT,
      vid TEXT,
      uid TEXT,
      ref TEXT,
      mobile INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS events_at ON events (at);
    CREATE INDEX IF NOT EXISTS events_vid_uid ON events (vid, uid);
  `);
  dbs.set(file, db);
  return db;
}

export function closeAnalytics(dir: string) {
  const file = analyticsDbPath(dir);
  dbs.get(file)?.close();
  dbs.delete(file);
}

const lastPrune = new Map<string, number>();

/** 1件残す。古い記録はときどき消す。保存に失敗しても画面の操作は止めない */
export function recordEvent(e: Omit<StoredEvent, "at"> & { at?: string }, env: Env = process.env) {
  try {
    const dir = dataDir(env);
    const db = openAnalytics(dir);
    const at = e.at ?? new Date().toISOString();
    db.prepare("INSERT INTO events (at, name, site, path, detail, vid, uid, ref, mobile) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
      at,
      e.name,
      e.site,
      e.path,
      e.detail,
      e.vid,
      e.uid,
      e.ref,
      e.mobile ? 1 : 0,
    );
    const now = Date.now();
    if (now - (lastPrune.get(dir) ?? 0) > 3_600_000) {
      lastPrune.set(dir, now);
      db.prepare("DELETE FROM events WHERE at < ?").run(new Date(now - RETENTION_DAYS * DAY_MS).toISOString());
    }
  } catch (err) {
    console.error("アクセス解析の記録を保存できませんでした", err);
  }
}

type Row = { at: string; name: string; site: string; path: string | null; detail: string | null; vid: string | null; uid: string | null; ref: string | null; mobile: number };

const toEvent = (r: Row): StoredEvent => ({ ...r, name: r.name as EventName, site: r.site as Site, mobile: r.mobile === 1 });

/** その日時より後の記録（古い順） */
export function eventsSince(since: string | null, env: Env = process.env): StoredEvent[] {
  const db = openAnalytics(dataDir(env));
  const rows = (
    since
      ? db.prepare("SELECT at, name, site, path, detail, vid, uid, ref, mobile FROM events WHERE at >= ? ORDER BY at").all(since)
      : db.prepare("SELECT at, name, site, path, detail, vid, uid, ref, mobile FROM events ORDER BY at").all()
  ) as Row[];
  return rows.map(toEvent);
}

/** 訪問者ID とユーザーID の組（ログイン前の操作をその人に結びつける） */
export function visitorLinks(env: Env = process.env): { vid: string; uid: string }[] {
  const db = openAnalytics(dataDir(env));
  return db.prepare("SELECT DISTINCT vid, uid FROM events WHERE vid IS NOT NULL AND uid IS NOT NULL").all() as { vid: string; uid: string }[];
}

// ---- 訪問者の Cookie と送りすぎの制限 ----

export function newVisitorId() {
  return randomBytes(16).toString("base64url");
}

export function visitorIdFrom(cookieHeader: string): string | null {
  for (const part of cookieHeader.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === VISITOR_COOKIE) {
      const id = v.join("=");
      if (/^[A-Za-z0-9_-]{16,64}$/.test(id)) return id;
    }
  }
  return null;
}

export function visitorCookie(id: string, secure: boolean, domain?: string): string {
  return (
    `${VISITOR_COOKIE}=${id}; Path=/; Max-Age=${VISITOR_COOKIE_DAYS * 86400}; HttpOnly; SameSite=Lax` +
    (secure ? "; Secure" : "") +
    (domain ? `; Domain=${domain}` : "")
  );
}

const sent = new Map<string, { count: number; until: number }>();
export const MAX_EVENTS_PER_HOUR = 600;

/** 同じ送り元から1時間に MAX_EVENTS_PER_HOUR 件まで */
export function eventAllowed(key: string, now = Date.now()): boolean {
  const s = sent.get(key);
  if (!s || s.until <= now) {
    sent.set(key, { count: 1, until: now + 3_600_000 });
    if (sent.size > 20000) for (const [k, v] of sent) if (v.until <= now) sent.delete(k);
    return true;
  }
  s.count += 1;
  return s.count <= MAX_EVENTS_PER_HOUR;
}

// ---- 集計 ----

export const ANALYTICS_PERIODS = ["7d", "30d", "90d", "all"] as const;
export type AnalyticsPeriod = (typeof ANALYTICS_PERIODS)[number];
const PERIOD_DAYS: Record<AnalyticsPeriod, number | null> = { "7d": 7, "30d": 30, "90d": 90, all: null };

const DAY_MS = 86_400_000;
const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" });
export const jstDay = (d: Date | string) => dayFmt.format(typeof d === "string" ? new Date(d) : d);

/** 日本時間で n 日前の 0時（今日を含めて n 日） */
function startOfDays(now: Date, n: number): Date {
  const day = jstDay(new Date(now.getTime() - (n - 1) * DAY_MS));
  return new Date(`${day}T00:00:00+09:00`);
}

/** 期間の始まり（全期間は null） */
export function periodStart(period: AnalyticsPeriod, now = new Date()): string | null {
  const n = PERIOD_DAYS[period];
  return n === null ? null : startOfDays(now, n).toISOString();
}

function lastDays(now: Date, n: number): string[] {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) out.push(jstDay(new Date(now.getTime() - i * DAY_MS)));
  return out;
}

const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export type FunnelStep = {
  id: string;
  label: string;
  count: number;
  /** 最初の段に対する割合（0〜1） */
  rate: number | null;
  /** 1つ前の段に対する割合 */
  fromPrev: number | null;
  /** 登録から初めてその操作をするまでの日数の中央値（登録した人の流れだけ） */
  medianDays?: number | null;
};

type Input = {
  /** 期間の始まり以降の記録（古い順） */
  events: StoredEvent[];
  /** 過去30日の記録（アクティブユーザーの計算用。events に含まれていてもよい） */
  recent: StoredEvent[];
  /** 登録した人のその後を見るための、全期間の記録 */
  lifetime: StoredEvent[];
  links: { vid: string; uid: string }[];
  users: Pick<StoredUser, "id" | "role" | "createdAt" | "pendingVerify">[];
  period: AnalyticsPeriod;
  measuredSince: string | null;
  now?: Date;
};

const rate = (n: number, of: number) => (of > 0 ? n / of : null);

/** 管理画面に出す集計。管理者の操作（ログイン前のものも含む）は数えない */
export function analyticsView(input: Input) {
  const now = input.now ?? new Date();
  const since = periodStart(input.period, now);
  const alias = new Map<string, string>();
  for (const l of input.links) if (!alias.has(l.vid)) alias.set(l.vid, l.uid);
  const admins = new Set(input.users.filter((u) => u.role === "admin").map((u) => u.id));
  const knownUsers = new Set(input.users.map((u) => u.id));

  /** その記録をした人（ユーザーIDか、ログイン前なら訪問者ID） */
  const person = (e: StoredEvent): string | null => {
    const uid = e.uid ?? (e.vid ? alias.get(e.vid) : undefined);
    if (uid) return `u:${uid}`;
    return e.vid ? `v:${e.vid}` : null;
  };
  const counted = (e: StoredEvent) => {
    const p = person(e);
    return p !== null && !(p.startsWith("u:") && admins.has(p.slice(2)));
  };
  const isUser = (p: string) => p.startsWith("u:") && knownUsers.has(p.slice(2));

  const events = input.events.filter((e) => counted(e) && (!since || e.at >= since));
  const views = events.filter((e) => e.name === "view");

  const uniq = (list: StoredEvent[]) => new Set(list.map((e) => person(e)!));
  const visitors = uniq(events);
  const loggedIn = [...visitors].filter(isUser);
  const mobileVisitors = uniq(views.filter((e) => e.mobile));
  const cohort = input.users.filter((u) => u.role !== "admin" && (!since || u.createdAt >= since));

  // アクティブ（今日・7日・30日）
  const recent = input.recent.filter(counted);
  const active = (days: number) => {
    const from = startOfDays(now, days).toISOString();
    const ps = uniq(recent.filter((e) => e.at >= from));
    return { visitors: ps.size, users: [...ps].filter(isUser).length };
  };

  // 日別
  // 全期間は、最初の登録（か計測の開始）から今日まで（30〜365日）
  const members = input.users.filter((u) => u.role !== "admin");
  const earliest = [input.measuredSince, ...members.map((u) => u.createdAt)].filter((x): x is string => !!x).sort()[0];
  const nDays =
    PERIOD_DAYS[input.period] ??
    Math.min(365, Math.max(30, earliest ? Math.floor((now.getTime() - new Date(earliest).getTime()) / DAY_MS) + 2 : 30));
  const byDay = new Map<string, StoredEvent[]>();
  for (const e of events) {
    const d = jstDay(e.at);
    let l = byDay.get(d);
    if (!l) byDay.set(d, (l = []));
    l.push(e);
  }
  const signupsByDay = new Map<string, number>();
  for (const u of members) signupsByDay.set(jstDay(u.createdAt), (signupsByDay.get(jstDay(u.createdAt)) ?? 0) + 1);
  const days = lastDays(now, nDays);
  /** グラフの最初の日より前に登録した人（累計の出発点） */
  let registered = members.filter((u) => jstDay(u.createdAt) < days[0]).length;
  const daily = days.map((day) => {
    const l = byDay.get(day) ?? [];
    const ps = uniq(l);
    return {
      day,
      views: l.filter((e) => e.name === "view").length,
      visitors: ps.size,
      users: [...ps].filter(isUser).length,
      signups: signupsByDay.get(day) ?? 0,
      /** その日の終わりまでに登録した人の累計（管理者を除く） */
      registered: (registered += signupsByDay.get(day) ?? 0),
    };
  });

  // サイト別・ページ別・参照元
  const bySite = SITES.map((site) => {
    const l = views.filter((e) => e.site === site);
    return { site, views: l.length, visitors: uniq(l).size };
  });
  const pageMap = new Map<string, StoredEvent[]>();
  for (const e of views) {
    const k = `${e.site} ${e.path ?? "/"}`;
    let l = pageMap.get(k);
    if (!l) pageMap.set(k, (l = []));
    l.push(e);
  }
  const topPages = [...pageMap.entries()]
    .map(([k, l]) => ({ site: l[0].site, path: k.slice(k.indexOf(" ") + 1), views: l.length, visitors: uniq(l).size }))
    .sort((a, b) => b.views - a.views)
    .slice(0, 20);
  const refMap = new Map<string, Set<string>>();
  for (const e of views) {
    if (!e.ref) continue;
    let s = refMap.get(e.ref);
    if (!s) refMap.set(e.ref, (s = new Set()));
    s.add(person(e)!);
  }
  const referrers = [...refMap.entries()]
    .map(([host, s]) => ({ host, visitors: s.size }))
    .sort((a, b) => b.visitors - a.visitors)
    .slice(0, 10);

  // 機能別
  const features = FEATURE_EVENTS.map(({ id, label }) => {
    const l = events.filter((e) => e.name === id);
    const ps = uniq(l);
    const details = new Map<string, number>();
    for (const e of l) if (e.detail) details.set(e.detail, (details.get(e.detail) ?? 0) + 1);
    return {
      id,
      label,
      count: l.length,
      people: ps.size,
      users: [...ps].filter(isUser).length,
      details: [...details.entries()].map(([detail, count]) => ({ detail, count })).sort((a, b) => b.count - a.count),
    };
  });

  // 訪問者の流れ（期間内に、その人がその操作を一度でもしたか）
  const did = (list: StoredEvent[], test: (e: StoredEvent) => boolean) => new Set(list.filter(test).map((e) => person(e)!));
  const registeredPeople = new Set(cohort.map((u) => `u:${u.id}`));
  const visitorSteps: { id: string; label: string; people: Set<string> }[] = [
    { id: "visit", label: "訪問した", people: visitors },
    { id: "editor", label: "エディタを開いた", people: did(views, (e) => e.site === "platform") },
    { id: "save", label: "保存・書き出しをした", people: did(events, (e) => e.name === "save" || e.name === "export") },
    { id: "drive", label: "運転席で走った", people: did(events, (e) => e.name === "drive") },
    { id: "signup", label: "ユーザー登録した", people: new Set([...visitors].filter((p) => registeredPeople.has(p))) },
    { id: "post", label: "ターミナルに投稿した", people: did(events, (e) => e.name === "terminal_post") },
  ];
  const toSteps = (steps: { id: string; label: string; count: number; medianDays?: number | null }[]): FunnelStep[] =>
    steps.map((s, i) => ({ ...s, rate: rate(s.count, steps[0].count), fromPrev: i === 0 ? null : rate(s.count, steps[i - 1].count) }));
  const visitorFunnel = toSteps(visitorSteps.map((s) => ({ id: s.id, label: s.label, count: s.people.size })));

  // 登録した人のその後（期間内に登録した人が、いつまでにその操作を一度でもしたか。期間の後の操作も数える）
  const firstAt = new Map<string, Map<string, string>>();
  for (const e of input.lifetime) {
    const p = person(e);
    if (!p || !p.startsWith("u:")) continue;
    const step = e.name === "save" || e.name === "export" ? "save" : e.name;
    let m = firstAt.get(p);
    if (!m) firstAt.set(p, (m = new Map()));
    if (!m.has(step)) m.set(step, e.at);
    if (e.uid && e.name !== "signup" && !m.has("auth")) m.set("auth", e.at);
  }
  const userStep = (id: string, label: string, test: (u: Input["users"][number]) => string | null) => {
    const days: number[] = [];
    let count = 0;
    for (const u of cohort) {
      const at = test(u);
      if (at === null) continue;
      count++;
      if (at !== u.createdAt) days.push(Math.max(0, (new Date(at).getTime() - new Date(u.createdAt).getTime()) / DAY_MS));
    }
    return { id, label, count, medianDays: id === "signup" ? undefined : median(days) };
  };
  const first = (u: { id: string }, step: string) => firstAt.get(`u:${u.id}`)?.get(step) ?? null;
  const signupFunnel = toSteps([
    userStep("signup", "登録した", (u) => u.createdAt),
    userStep("verify", "メールの確認を済ませた", (u) => (u.pendingVerify ? null : u.createdAt)),
    userStep("login", "ログインして使った", (u) => first(u, "auth")),
    userStep("save", "最初の保存・書き出し", (u) => first(u, "save")),
    userStep("drive", "運転席で走った", (u) => first(u, "drive")),
    userStep("post", "ターミナルに投稿した", (u) => first(u, "terminal_post")),
  ]);

  return {
    period: input.period,
    since,
    measuredSince: input.measuredSince,
    /** 期間内に登録したのに、計測を始める前だった人（その人の操作は一部しか数えられない） */
    cohortBeforeMeasure: input.measuredSince ? cohort.filter((u) => u.createdAt < input.measuredSince!).length : cohort.length,
    totals: {
      views: views.length,
      visitors: visitors.size,
      users: loggedIn.length,
      signups: cohort.length,
      mobileRate: rate(mobileVisitors.size, uniq(views).size),
    },
    active: { today: active(1), week: active(7), month: active(30) },
    daily,
    bySite,
    topPages,
    referrers,
    features,
    visitorFunnel,
    signupFunnel,
  };
}

export type AnalyticsView = ReturnType<typeof analyticsView>;

/** 保存された記録と現在のユーザーから集計する */
export function loadAnalyticsView(period: AnalyticsPeriod, users: Input["users"], env: Env = process.env, now = new Date()) {
  const since = periodStart(period, now);
  const recentFrom = startOfDays(now, 30).toISOString();
  const lifetime = eventsSince(null, env);
  const from = (iso: string | null) => (iso ? lifetime.filter((e) => e.at >= iso) : lifetime);
  return analyticsView({
    events: from(since),
    recent: from(recentFrom),
    lifetime,
    links: visitorLinks(env),
    users,
    period,
    measuredSince: lifetime[0]?.at ?? null,
    now,
  });
}

/** サーバーで起きたこと（登録・ログイン）を残す。ログイン前の訪問者ID と結びつける */
export function recordServerEvent(req: Request, name: "signup" | "login", uid: string, env: Env = process.env) {
  recordEvent(
    { name, site: "www", path: null, detail: null, vid: visitorIdFrom(req.headers.get("cookie") ?? ""), uid, ref: null, mobile: false },
    env,
  );
}
