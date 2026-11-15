import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { costUsd, costWithoutCacheUsd, priceFor, priceTable } from "@/lib/llm/pricing";
import { addUsage, emptyUsage, type ProviderId, type TokenUsage } from "@/lib/llm/types";

/**
 * AI提案で使ったトークンと料金の記録。
 * 1件ずつ NINEGAGE_DATA_DIR/ai-usage.jsonl に追記して残し（再起動しても消えない）、
 * 管理画面で日別・月別、ユーザー別・機能別に集計して見せる。
 * 料金は記録したときの単価で計算して保存する（あとで単価が変わっても過去の金額は変えない）。
 */

type Env = Record<string, string | undefined>;

/** AIを使う機能（レイアウト提案の3つのモードと、運行計画の提案） */
export const FEATURES = ["free", "owned", "expand", "operation"] as const;
export type Feature = (typeof FEATURES)[number];
export const FEATURE_LABELS: Record<Feature, string> = {
  free: "AI提案（自由に設計）",
  owned: "AI提案（所有パーツだけ）",
  expand: "AI提案（拡張案）",
  operation: "AI提案（運行計画）",
};

export type UsageRecord = {
  at: string;
  userId: string;
  username: string;
  provider: ProviderId;
  model: string;
  maker: string;
  feature: Feature;
  /** どちらのAPIキーで呼んだか。server=サーバー（管理者が設定）、own=利用者が自分で設定。古い記録にはない（=server） */
  keySource?: "server" | "own";
  /** AIを呼んだ回数（検査で出し直した分を含む） */
  attempts: number;
  /** 保存済みの結果を返し、AIを呼ばなかった */
  resultCached: boolean;
  ok: boolean;
  usage: TokenUsage;
  /** 料金（米ドル）。単価が分からないモデルは null */
  costUsd: number | null;
  /** キャッシュがなかった場合の料金（米ドル） */
  costWithoutCacheUsd: number | null;
};

export type NewUsage = Omit<UsageRecord, "at" | "costUsd" | "costWithoutCacheUsd"> & { at?: string };

/** 単価表で料金を付けて記録の形にする */
export function priced(r: NewUsage, env: Env = process.env): UsageRecord {
  const price = priceFor(r.model, priceTable(env));
  return {
    ...r,
    at: r.at ?? new Date().toISOString(),
    costUsd: costUsd(r.usage, price),
    costWithoutCacheUsd: costWithoutCacheUsd(r.usage, price),
  };
}

// ---- 集計 ----

export type Totals = {
  /** 案の数（保存済みの結果を返した分を含む） */
  proposals: number;
  resultCacheHits: number;
  apiCalls: number;
  usage: TokenUsage;
  costUsd: number;
  costWithoutCacheUsd: number;
  /** 単価が分からず料金に入っていない案の数 */
  unpriced: number;
  /** 入力のうちキャッシュから読んだ割合（0〜1。入力がなければ null） */
  cacheHitRate: number | null;
};

export function cacheHitRate(u: TokenUsage): number | null {
  const input = u.inputTokens + u.cacheReadTokens + u.cacheWriteTokens;
  return input > 0 ? u.cacheReadTokens / input : null;
}

export function summarize(records: Iterable<UsageRecord>): Totals {
  const t = { proposals: 0, resultCacheHits: 0, apiCalls: 0, usage: emptyUsage(), costUsd: 0, costWithoutCacheUsd: 0, unpriced: 0 };
  for (const r of records) {
    t.proposals++;
    if (r.resultCached) t.resultCacheHits++;
    t.apiCalls += r.attempts;
    t.usage = addUsage(t.usage, r.usage);
    if (r.costUsd === null) {
      if (!r.resultCached) t.unpriced++;
    } else {
      t.costUsd += r.costUsd;
      t.costWithoutCacheUsd += r.costWithoutCacheUsd ?? r.costUsd;
    }
  }
  return { ...t, cacheHitRate: cacheHitRate(t.usage) };
}

const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" });

/** 日本時間の日付 "YYYY-MM-DD" */
export function jstDay(d: Date | string): string {
  return dayFmt.format(typeof d === "string" ? new Date(d) : d);
}

const DAY_MS = 86_400_000;

function lastDays(now: Date, n: number): string[] {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) out.push(jstDay(new Date(now.getTime() - i * DAY_MS)));
  return out;
}

function lastMonths(now: Date, n: number): string[] {
  const [y, m] = jstDay(now).split("-").map(Number);
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const idx = y * 12 + (m - 1) - i;
    out.push(`${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`);
  }
  return out;
}

export const PERIODS = ["this-month", "last-month", "30d", "all"] as const;
export type Period = (typeof PERIODS)[number];

function inPeriod(r: UsageRecord, period: Period, now: Date): boolean {
  if (period === "all") return true;
  const day = jstDay(r.at);
  if (period === "30d") return day >= lastDays(now, 30)[0];
  const [prev, cur] = lastMonths(now, 2);
  return day.slice(0, 7) === (period === "this-month" ? cur : prev);
}

function groupBy(records: UsageRecord[], key: (r: UsageRecord) => string) {
  const map = new Map<string, UsageRecord[]>();
  for (const r of records) {
    const k = key(r);
    let list = map.get(k);
    if (!list) map.set(k, (list = []));
    list.push(r);
  }
  return map;
}

const byCost = (a: Totals, b: Totals) => b.costUsd - a.costUsd || b.proposals - a.proposals;

export const isOwnKey = (r: UsageRecord) => r.keySource === "own";

/**
 * 管理画面に出す集計。
 * 合計・日別・月別・内訳はサーバーのキーで使った分だけ（サーバーが払う料金）。
 * 利用者が自分のキーで使った分は ownKey に別に集計する。
 */
export function usageView(all: UsageRecord[], period: Period, now: Date = new Date()) {
  const records = all.filter((r) => !isOwnKey(r));
  const own = all.filter((r) => isOwnKey(r) && inPeriod(r, period, now));
  const inP = records.filter((r) => inPeriod(r, period, now));
  const daily = groupBy(records, (r) => jstDay(r.at));
  const monthly = groupBy(records, (r) => jstDay(r.at).slice(0, 7));
  const series = (keys: string[], map: Map<string, UsageRecord[]>) =>
    keys.map((k) => {
      const t = summarize(map.get(k) ?? []);
      return { key: k, costUsd: t.costUsd, proposals: t.proposals, tokens: totalTokens(t.usage) };
    });

  return {
    period,
    since: all[0]?.at ?? null,
    totals: summarize(inP),
    overview: Object.fromEntries(PERIODS.map((p) => [p, summarize(records.filter((r) => inPeriod(r, p, now)))])) as Record<
      Period,
      Totals
    >,
    daily: series(lastDays(now, 30), daily),
    monthly: series(lastMonths(now, 12), monthly),
    byUser: [...groupBy(inP, (r) => r.userId).entries()]
      .map(([id, rs]) => ({ id, label: rs[rs.length - 1].username, ...summarize(rs) }))
      .sort(byCost),
    byFeature: [...groupBy(inP, (r) => r.feature).entries()]
      .map(([id, rs]) => ({ id, label: FEATURE_LABELS[id as Feature] ?? id, ...summarize(rs) }))
      .sort(byCost),
    byModel: [...groupBy(inP, (r) => `${r.provider} / ${r.model}`).entries()]
      .map(([id, rs]) => ({ id, label: id, ...summarize(rs) }))
      .sort(byCost),
    recent: all.slice(-30).reverse(),
    ownKey: {
      totals: summarize(own),
      byUser: [...groupBy(own, (r) => r.userId).entries()]
        .map(([id, rs]) => ({ id, label: rs[rs.length - 1].username, ...summarize(rs) }))
        .sort(byCost),
    },
  };
}

export type UsageView = ReturnType<typeof usageView>;

export const totalTokens = (u: TokenUsage) => u.inputTokens + u.outputTokens + u.cacheReadTokens + u.cacheWriteTokens;

// ---- 保存 ----

export function usageFile(env: Env = process.env) {
  return path.join(env.NINEGAGE_DATA_DIR || path.join(process.cwd(), "data"), "ai-usage.jsonl");
}

function isRecord(v: unknown): v is UsageRecord {
  const r = v as UsageRecord;
  return !!r && typeof r.at === "string" && typeof r.model === "string" && !!r.usage && typeof r.usage.inputTokens === "number";
}

/** ファイルに追記し、メモリにも持つ。最初に使うときにファイルを読む */
export class UsageLog {
  private records: UsageRecord[] | null = null;
  private loading: Promise<UsageRecord[]> | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly file: () => string) {}

  private async load(): Promise<UsageRecord[]> {
    if (this.records) return this.records;
    this.loading ??= (async () => {
      let text = "";
      try {
        text = await readFile(this.file(), "utf8");
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      }
      const list: UsageRecord[] = [];
      for (const line of text.split("\n")) {
        if (!line.trim()) continue;
        try {
          const r = JSON.parse(line);
          if (isRecord(r)) list.push(r);
        } catch {
          // 書きかけの行などは飛ばす
        }
      }
      this.records = list;
      return list;
    })();
    return this.loading;
  }

  async all(): Promise<UsageRecord[]> {
    return this.load();
  }

  /** 1件追加する。保存に失敗しても提案そのものは止めない */
  append(r: UsageRecord): Promise<void> {
    const run = this.queue.then(async () => {
      const list = await this.load();
      list.push(r);
      const file = this.file();
      await mkdir(path.dirname(file), { recursive: true });
      await appendFile(file, `${JSON.stringify(r)}\n`, { mode: 0o600 });
    });
    this.queue = run.catch((err) => console.error("AIの使用記録を保存できませんでした", err));
    return this.queue as Promise<void>;
  }
}

const g = globalThis as unknown as { __ninegageUsageLog?: UsageLog };
export const usageLog: UsageLog = (g.__ninegageUsageLog ??= new UsageLog(() => usageFile()));

/** サーバーのログにも1行出す */
export function logUsage(r: UsageRecord) {
  const u = r.usage;
  const rate = cacheHitRate(u);
  console.info(
    `[ai-usage] ${r.provider}/${r.model} user=${r.username} feature=${r.feature} key=${r.keySource ?? "server"} ${r.resultCached ? "result-cache-hit" : `calls=${r.attempts}`} ok=${r.ok} ` +
      `in=${u.inputTokens} cache_read=${u.cacheReadTokens} cache_write=${u.cacheWriteTokens} out=${u.outputTokens}` +
      (rate === null ? "" : ` hit=${(rate * 100).toFixed(0)}%`) +
      (r.costUsd === null ? "" : ` cost=$${r.costUsd.toFixed(4)}`),
  );
}
