import { addUsage, emptyUsage, type ProviderId, type TokenUsage } from "@/lib/llm/types";

/**
 * AI提案で使ったトークンの集計（サーバーのメモリ内。再起動で0に戻る）。
 * 管理画面で、プロンプトキャッシュがどれだけ効いているかと、結果の再利用の回数を見られる。
 */

export type UsageRecord = {
  at: string;
  provider: ProviderId;
  model: string;
  maker: string;
  /** AIを呼んだ回数（検査で出し直した分を含む） */
  attempts: number;
  /** 保存済みの結果を返し、AIを呼ばなかった */
  resultCached: boolean;
  ok: boolean;
  usage: TokenUsage;
};

type Totals = {
  /** 提案した案の数（保存済みの結果を返した分を含む） */
  proposals: number;
  /** 保存済みの結果を返した案の数 */
  resultCacheHits: number;
  /** AIを呼んだ回数 */
  apiCalls: number;
  usage: TokenUsage;
};

const emptyTotals = (): Totals => ({ proposals: 0, resultCacheHits: 0, apiCalls: 0, usage: emptyUsage() });

const MAX_RECENT = 30;

export class UsageStats {
  since = new Date().toISOString();
  totals = emptyTotals();
  byModel = new Map<string, Totals>();
  recent: UsageRecord[] = [];

  record(r: UsageRecord) {
    for (const t of [this.totals, this.modelTotals(`${r.provider} / ${r.model}`)]) {
      t.proposals++;
      if (r.resultCached) t.resultCacheHits++;
      t.apiCalls += r.attempts;
      t.usage = addUsage(t.usage, r.usage);
    }
    this.recent.unshift(r);
    if (this.recent.length > MAX_RECENT) this.recent.length = MAX_RECENT;
  }

  private modelTotals(key: string) {
    let t = this.byModel.get(key);
    if (!t) this.byModel.set(key, (t = emptyTotals()));
    return t;
  }

  view() {
    return {
      since: this.since,
      totals: withRates(this.totals),
      byModel: [...this.byModel.entries()].map(([model, t]) => ({ model, ...withRates(t) })),
      recent: this.recent,
    };
  }

  reset() {
    this.since = new Date().toISOString();
    this.totals = emptyTotals();
    this.byModel.clear();
    this.recent = [];
  }
}

/** 入力のうちキャッシュから読んだ割合（0〜1。入力がなければ null） */
export function cacheHitRate(u: TokenUsage): number | null {
  const input = u.inputTokens + u.cacheReadTokens + u.cacheWriteTokens;
  return input > 0 ? u.cacheReadTokens / input : null;
}

function withRates(t: Totals) {
  return { ...t, cacheHitRate: cacheHitRate(t.usage) };
}

export type UsageView = ReturnType<UsageStats["view"]>;

const g = globalThis as unknown as { __ninegageUsageStats?: UsageStats };
export const usageStats: UsageStats = (g.__ninegageUsageStats ??= new UsageStats());

/** サーバーのログにも1行出す（キャッシュの効き具合を確かめるため） */
export function logUsage(r: UsageRecord) {
  const u = r.usage;
  const rate = cacheHitRate(u);
  console.info(
    `[ai-usage] ${r.provider}/${r.model} maker=${r.maker} ${r.resultCached ? "result-cache-hit" : `calls=${r.attempts}`} ok=${r.ok} ` +
      `in=${u.inputTokens} cache_read=${u.cacheReadTokens} cache_write=${u.cacheWriteTokens} out=${u.outputTokens}` +
      (rate === null ? "" : ` hit=${(rate * 100).toFixed(0)}%`),
  );
}
