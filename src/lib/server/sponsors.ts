import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { Env, StoreData, StoredSponsor, StoredUser } from "./store";

/**
 * GitHub Sponsors との連携。
 *
 * - 利用者は「アカウント」画面から GitHub のアカウントを結び付ける（OAuth App。NINEGAGE_GITHUB_CLIENT_ID / _SECRET）。
 *   結び付けたときに、その人のトークンで支援の状態を1回だけ読む（トークンは保存しない）。
 * - そのあとの変化は GitHub Sponsors の Webhook（NINEGAGE_SPONSORS_WEBHOOK_SECRET）で受け取る。
 * - 管理者は「今すぐ確かめる」で、支援先（NINEGAGE_SPONSORS_LOGIN、既定 UeEmon）のトークン（NINEGAGE_SPONSORS_TOKEN）から
 *   全員の支援を読み直せる（Webhook を取りこぼしたときや、連携の前からの支援）。
 * - 支援は GitHub のユーザーIDごとに StoreData.sponsors に残す。SenroLab に連携する前の支援も、連携したときに効く。
 */

export const DEFAULT_SPONSORABLE = "UeEmon";

export function sponsorable(env: Env = process.env): string {
  const v = env.NINEGAGE_SPONSORS_LOGIN?.trim();
  return v && /^[A-Za-z0-9-]{1,39}$/.test(v) ? v : DEFAULT_SPONSORABLE;
}

export function githubOAuth(env: Env = process.env): { clientId: string; clientSecret: string } | null {
  const clientId = env.NINEGAGE_GITHUB_CLIENT_ID?.trim();
  const clientSecret = env.NINEGAGE_GITHUB_CLIENT_SECRET?.trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export function webhookSecret(env: Env = process.env): string | null {
  return env.NINEGAGE_SPONSORS_WEBHOOK_SECRET?.trim() || null;
}

export function maintainerToken(env: Env = process.env): string | null {
  return env.NINEGAGE_SPONSORS_TOKEN?.trim() || null;
}

export class SponsorsError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
  ) {
    super(message);
  }
}

// ---- 支援の記録 ----

function entry(data: StoreData, id: number, login: string, now: Date): StoredSponsor {
  const key = String(id);
  const cur = data.sponsors[key] ?? { login, monthlyUsd: 0, oneTime: [], updatedAt: now.toISOString() };
  cur.login = login;
  cur.updatedAt = now.toISOString();
  data.sponsors[key] = cur;
  return cur;
}

/** 1回きりの支援を足す（同じ日時のものは1回だけ） */
function addOneTime(s: StoredSponsor, at: string, usd: number) {
  const t = Date.parse(at);
  if (Number.isNaN(t) || s.oneTime.some((o) => Date.parse(o.at) === t)) return;
  s.oneTime.push({ at: new Date(t).toISOString(), usd });
  s.oneTime.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  if (s.oneTime.length > 100) s.oneTime.splice(0, s.oneTime.length - 100);
}

/** 1件の支援（GitHub から読んだもの）を記録に反映する */
export type Sponsorship = {
  sponsor: { id: number; login: string };
  usd: number;
  oneTime: boolean;
  active: boolean;
  createdAt: string;
};

export function applySponsorship(data: StoreData, s: Sponsorship, now: Date = new Date()) {
  const e = entry(data, s.sponsor.id, s.sponsor.login, now);
  if (s.oneTime) addOneTime(e, s.createdAt, s.usd);
  else e.monthlyUsd = s.active ? s.usd : 0;
}

// ---- Webhook ----

/** X-Hub-Signature-256 を確かめる */
export function verifySignature(body: string, header: string | null, secret: string): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const expected = Buffer.from(`sha256=${createHmac("sha256", secret).update(body).digest("hex")}`);
  const given = Buffer.from(header);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

const WebhookSchema = z.object({
  action: z.string(),
  sponsorship: z.object({
    created_at: z.string(),
    sponsor: z.object({ id: z.number().int(), login: z.string() }).nullable(),
    sponsorable: z.object({ login: z.string() }).nullable().optional(),
    tier: z.object({ monthly_price_in_dollars: z.number(), is_one_time: z.boolean() }).nullable(),
  }),
});

/**
 * sponsorship イベントを反映する。反映したら true。
 * created: 新しい支援（1回きりなら、その日から数える）。tier_changed: 毎月の額が変わった。cancelled: 毎月の支援が終わった。
 * pending_* と edited は、実際に変わったときに別のイベントが届くので何もしない
 */
export function applyWebhook(data: StoreData, payload: unknown, env: Env = process.env, now: Date = new Date()): boolean {
  const parsed = WebhookSchema.safeParse(payload);
  if (!parsed.success) return false;
  const { action, sponsorship: sp } = parsed.data;
  if (!sp.sponsor || !sp.tier) return false;
  const target = sp.sponsorable?.login;
  if (target && target.toLowerCase() !== sponsorable(env).toLowerCase()) return false;
  const oneTime = sp.tier.is_one_time;
  const usd = sp.tier.monthly_price_in_dollars;
  if (action === "created" || action === "tier_changed") {
    applySponsorship(data, { sponsor: sp.sponsor, usd, oneTime, active: true, createdAt: oneTime ? now.toISOString() : sp.created_at }, now);
    return true;
  }
  if (action === "cancelled") {
    // 1回きりの支援は期間が過ぎれば切れるので、ここでは毎月の支援だけ止める
    if (!oneTime) applySponsorship(data, { sponsor: sp.sponsor, usd, oneTime: false, active: false, createdAt: sp.created_at }, now);
    return !oneTime;
  }
  return false;
}

// ---- GitHub API ----

type Fetch = typeof fetch;

async function graphql<T>(token: string, query: string, variables: Record<string, unknown>, fetchImpl: Fetch): Promise<T> {
  const res = await fetchImpl("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "User-Agent": "SenroLab" },
    body: JSON.stringify({ query, variables }),
  });
  const body = (await res.json().catch(() => ({}))) as { data?: T; errors?: { message: string }[] };
  if (!res.ok || !body.data) {
    throw new SponsorsError(`GitHub から支援の状態を読めませんでした（${body.errors?.[0]?.message ?? `HTTP ${res.status}`}）。`, 502);
  }
  return body.data;
}

type Node = {
  createdAt: string;
  isActive: boolean;
  isOneTimePayment: boolean;
  tier: { monthlyPriceInDollars: number } | null;
};

function toSponsorship(n: Node, sponsor: { id: number; login: string }): Sponsorship | null {
  if (!n.tier) return null;
  return { sponsor, usd: n.tier.monthlyPriceInDollars, oneTime: n.isOneTimePayment, active: n.isActive, createdAt: n.createdAt };
}

/** 結び付けたときに、その人のトークンで支援先への支援を読む。支援したことがなければ null */
export async function viewerSponsorship(
  token: string,
  sponsor: { id: number; login: string },
  env: Env = process.env,
  fetchImpl: Fetch = fetch,
): Promise<Sponsorship | null> {
  const data = await graphql<{ user: { sponsorshipForViewerAsSponsor: Node | null } | null }>(
    token,
    `query($login: String!) {
      user(login: $login) {
        sponsorshipForViewerAsSponsor(activeOnly: false) { createdAt isActive isOneTimePayment tier { monthlyPriceInDollars } }
      }
    }`,
    { login: sponsorable(env) },
    fetchImpl,
  );
  const n = data.user?.sponsorshipForViewerAsSponsor;
  return n ? toSponsorship(n, sponsor) : null;
}

/** 支援先のトークンで全員の支援を GitHub から読む */
export async function fetchAllSponsorships(env: Env = process.env, fetchImpl: Fetch = fetch): Promise<Sponsorship[]> {
  const token = maintainerToken(env);
  if (!token) throw new SponsorsError("NINEGAGE_SPONSORS_TOKEN が設定されていません。", 400);
  type Page = {
    viewer: {
      login: string;
      sponsorshipsAsMaintainer: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        nodes: (Node & { sponsorEntity: { databaseId?: number; login?: string } | null })[];
      };
    };
  };
  const found: Sponsorship[] = [];
  let after: string | null = null;
  for (let i = 0; i < 50; i++) {
    const page: Page = await graphql<Page>(
      token,
      `query($after: String) {
        viewer {
          login
          sponsorshipsAsMaintainer(first: 100, after: $after, activeOnly: false, includePrivate: true) {
            pageInfo { hasNextPage endCursor }
            nodes {
              createdAt isActive isOneTimePayment tier { monthlyPriceInDollars }
              sponsorEntity { ... on User { databaseId login } ... on Organization { databaseId login } }
            }
          }
        }
      }`,
      { after },
      fetchImpl,
    );
    if (page.viewer.login.toLowerCase() !== sponsorable(env).toLowerCase()) {
      throw new SponsorsError(`NINEGAGE_SPONSORS_TOKEN が ${sponsorable(env)} のトークンではありません（${page.viewer.login}）。`, 400);
    }
    for (const n of page.viewer.sponsorshipsAsMaintainer.nodes) {
      const e = n.sponsorEntity;
      if (!e?.databaseId || !e.login) continue;
      const s = toSponsorship(n, { id: e.databaseId, login: e.login });
      if (s) found.push(s);
    }
    const info = page.viewer.sponsorshipsAsMaintainer.pageInfo;
    if (!info.hasNextPage || !info.endCursor) break;
    after = info.endCursor;
  }
  return found;
}

/** 読み直した支援を記録に反映する。毎月の支援が見つからない人は 0 にする */
export function applyAllSponsorships(data: StoreData, found: Sponsorship[], now: Date = new Date()) {
  const monthly = new Set(found.filter((s) => !s.oneTime && s.active).map((s) => String(s.sponsor.id)));
  for (const [id, s] of Object.entries(data.sponsors)) {
    if (!monthly.has(id) && s.monthlyUsd > 0) {
      s.monthlyUsd = 0;
      s.updatedAt = now.toISOString();
    }
  }
  for (const s of found) applySponsorship(data, s, now);
}

// ---- OAuth（アカウントの結び付け） ----

export const GITHUB_STATE_COOKIE = "ng_github_state";
export const GITHUB_CALLBACK_PATH = "/api/account/github/callback";

export function authorizeUrl(clientId: string, redirectUri: string, state: string): string {
  const q = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, state, scope: "read:user", allow_signup: "false" });
  return `https://github.com/login/oauth/authorize?${q}`;
}

/** 認可コードをトークンに替え、GitHub のアカウントを読む */
export async function exchangeCode(
  code: string,
  redirectUri: string,
  env: Env = process.env,
  fetchImpl: Fetch = fetch,
): Promise<{ token: string; id: number; login: string }> {
  const cfg = githubOAuth(env);
  if (!cfg) throw new SponsorsError("GitHub 連携が設定されていません。", 503);
  const res = await fetchImpl("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json", "User-Agent": "SenroLab" },
    body: JSON.stringify({ client_id: cfg.clientId, client_secret: cfg.clientSecret, code, redirect_uri: redirectUri }),
  });
  const tok = (await res.json().catch(() => ({}))) as { access_token?: string; error_description?: string };
  if (!tok.access_token) throw new SponsorsError(`GitHub の認証に失敗しました（${tok.error_description ?? `HTTP ${res.status}`}）。`, 502);
  const ures = await fetchImpl("https://api.github.com/user", {
    headers: { Authorization: `Bearer ${tok.access_token}`, Accept: "application/vnd.github+json", "User-Agent": "SenroLab" },
  });
  const u = (await ures.json().catch(() => ({}))) as { id?: number; login?: string };
  if (!ures.ok || typeof u.id !== "number" || typeof u.login !== "string") {
    throw new SponsorsError("GitHub のアカウントを読めませんでした。", 502);
  }
  return { token: tok.access_token, id: u.id, login: u.login };
}

/** GitHub のアカウントを結び付ける。ほかの人がすでに結び付けていればエラー */
export function linkGithub(data: StoreData, user: StoredUser, gh: { id: number; login: string }, sponsorship: Sponsorship | null, now: Date = new Date()) {
  const other = data.users.find((u) => u.id !== user.id && u.github?.id === gh.id);
  if (other) throw new SponsorsError(`GitHub の ${gh.login} は、ほかの SenroLab アカウントに連携済みです。`, 409);
  user.github = { id: gh.id, login: gh.login, linkedAt: now.toISOString() };
  if (sponsorship) applySponsorship(data, sponsorship, now);
}

export function unlinkGithub(user: StoredUser) {
  delete user.github;
}
