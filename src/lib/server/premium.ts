import type { RoleId } from "@/lib/roles";
import { isOwnKey, jstDay, type UsageRecord } from "./aiUsage";
import type { StoreData, StoredSponsor, StoredSponsorPlan, StoredUser } from "./store";

/**
 * プレミアムユーザー（GitHub Sponsors で支援した人）とプレミアムプラス（管理者が指定した人）の、サーバーのAIの月の上限。
 *
 * - プレミアムユーザーは保存しない。一般のうち、毎月の支援をしている人か、1回きりの支援から oneTimeDays 日以内の人をそう扱う。
 * - 上限は円で数える。使った分は AI の使用記録（aiUsage.ts）のうち、サーバーのキーで使った料金（米ドル）を円換算して足す。
 * - 毎月の支援は日本時間の毎月1日に戻る。1回きりの支援は、その支援の日から数える（毎月の支援もあれば、早いほうから）。
 * - 上限はAIを呼ぶ前に確かめるので、最後の1回で少し超えることがある。単価が分からないモデルの分は数えない。
 */

const DAY_MS = 86_400_000;

/** 有効な1回きりの支援 */
export function activeOneTime(s: StoredSponsor | undefined, plan: StoredSponsorPlan, now: Date) {
  return (s?.oneTime ?? []).filter((o) => {
    const at = Date.parse(o.at);
    return at <= now.getTime() && now.getTime() < at + plan.oneTimeDays * DAY_MS;
  });
}

type SponsorData = Pick<StoreData, "sponsorPlan" | "sponsors">;

/** 結び付けた GitHub アカウントの支援 */
export function sponsorOf(u: StoredUser, data: Pick<StoreData, "sponsors">): StoredSponsor | undefined {
  return u.github ? data.sponsors[String(u.github.id)] : undefined;
}

/** 今、支援が有効か */
export function sponsorActive(s: StoredSponsor | undefined, plan: StoredSponsorPlan, now: Date = new Date()): boolean {
  return !!s && (s.monthlyUsd > 0 || activeOneTime(s, plan, now).length > 0);
}

/** 画面に出すロール。一般で支援が有効ならプレミアムユーザー */
export function effectiveRole(u: StoredUser, data: SponsorData, now: Date = new Date()): RoleId {
  if (u.role === "user" && sponsorActive(sponsorOf(u, data), data.sponsorPlan, now)) return "ai";
  return u.role;
}

/** 日本時間の今月1日 0時 */
export function jstMonthStart(now: Date): Date {
  return new Date(`${jstDay(now).slice(0, 7)}-01T00:00:00+09:00`);
}

/** 日本時間の来月1日 0時（毎月の上限が戻る日時） */
export function jstNextMonthStart(now: Date): Date {
  const [y, m] = jstDay(now).split("-").map(Number);
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return new Date(`${ny}-${String(nm).padStart(2, "0")}-01T00:00:00+09:00`);
}

export type AiLimit = {
  /** 月の上限（円）。null なら上限なし */
  limitJpy: number | null;
  /** 使った分を数え始める日時（ISO） */
  since: string;
  /** 上限が戻る日時（ISO。日本時間の来月1日）。上限なし・1回きりの支援だけなら null */
  resetsAt: string | null;
  /** 1回きりの支援だけのとき、プレミアムユーザーでなくなる日時（ISO） */
  expiresAt: string | null;
  /** 上限の内訳（画面に出す） */
  basis: string;
};

/** ロールに合わせた上限。管理者・一般（自分のキー）・ログインなしは null（上限を数えない） */
export function aiLimitFor(data: SponsorData & Pick<StoreData, "aiCost">, u: StoredUser, now: Date = new Date()): AiLimit | null {
  const role = effectiveRole(u, data, now);
  const monthStart = jstMonthStart(now);
  const nextMonth = jstNextMonthStart(now).toISOString();
  if (role === "plus") {
    return u.aiLimitJpy === undefined
      ? { limitJpy: null, since: monthStart.toISOString(), resetsAt: null, expiresAt: null, basis: "上限なし（管理者の設定）" }
      : { limitJpy: u.aiLimitJpy, since: monthStart.toISOString(), resetsAt: nextMonth, expiresAt: null, basis: "管理者の設定" };
  }
  const sponsor = sponsorOf(u, data);
  if (role !== "ai" || !sponsor) return null;
  const plan = data.sponsorPlan;
  const rate = data.aiCost.usdJpy * plan.multiplier;
  const oneTime = activeOneTime(sponsor, plan, now);
  const monthly = sponsor.monthlyUsd;
  const usd = monthly + oneTime.reduce((t, o) => t + o.usd, 0);
  // 1回きりの支援は、その日から数える。毎月の支援もあれば今月1日からも数える（早いほう）
  const starts = [...(monthly > 0 ? [monthStart.getTime()] : []), ...oneTime.map((o) => Date.parse(o.at))];
  const since = new Date(Math.min(...starts));
  const parts = [
    ...(monthly > 0 ? [`毎月 $${monthly}`] : []),
    ...oneTime.map((o) => `${jstDay(o.at)} に1回 $${o.usd}（${plan.oneTimeDays}日間）`),
  ];
  return {
    limitJpy: Math.floor(usd * rate),
    since: since.toISOString(),
    resetsAt: monthly > 0 ? nextMonth : null,
    expiresAt: monthly > 0 ? null : new Date(Math.max(...oneTime.map((o) => Date.parse(o.at) + plan.oneTimeDays * DAY_MS))).toISOString(),
    basis: `支援 ${parts.join("、")}`,
  };
}

/** サーバーのキーで since 以降に使った料金（円） */
export function usedJpy(records: Iterable<UsageRecord>, userId: string, since: string, usdJpy: number): number {
  const from = Date.parse(since);
  let usd = 0;
  for (const r of records) {
    if (r.userId !== userId || isOwnKey(r) || r.costUsd === null) continue;
    if (Date.parse(r.at) < from) continue;
    usd += r.costUsd;
  }
  return usd * usdJpy;
}

export type AiAllowance = AiLimit & { usedJpy: number; overLimit: boolean };

/** 上限と、使った分。上限を数えないロールは null */
export function aiAllowance(
  data: SponsorData & Pick<StoreData, "aiCost">,
  u: StoredUser,
  records: Iterable<UsageRecord>,
  now: Date = new Date(),
): AiAllowance | null {
  const limit = aiLimitFor(data, u, now);
  if (!limit) return null;
  const used = usedJpy(records, u.id, limit.since, data.aiCost.usdJpy);
  return { ...limit, usedJpy: used, overLimit: limit.limitJpy !== null && used >= limit.limitJpy };
}

const dateText = (iso: string) => {
  const [y, m, d] = jstDay(iso).split("-").map(Number);
  return `${y}年${m}月${d}日`;
};

/** 上限に達して、自分のキーもないときのメッセージ */
export function limitReachedMessage(a: AiAllowance): string {
  const when = a.resetsAt ? `（${dateText(a.resetsAt)}に戻ります）` : "";
  return (
    `AIの上限（¥${Math.floor(a.limitJpy ?? 0).toLocaleString("ja-JP")}）に達しました${when}。` +
    "続けて使うには、「アカウント」画面で自分のAPIキーを登録してください。"
  );
}
