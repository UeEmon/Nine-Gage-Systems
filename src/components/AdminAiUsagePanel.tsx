"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/roles";
import type { Period, Totals, UsageView } from "@/lib/server/aiUsage";

type View = UsageView & { usdJpy: number; pricesAsOf: string; unpricedModels: string[]; savedResults: number };
type Row = Totals & { id: string; label: string };

const PERIOD_LABELS: Record<Period, string> = {
  "this-month": "今月",
  "last-month": "先月",
  "30d": "過去30日",
  all: "全期間",
};

const num = (n: number) => n.toLocaleString("ja-JP");
const pct = (r: number | null) => (r === null ? "—" : `${Math.round(r * 100)}%`);
const usd = (n: number) => `$${n < 1 ? n.toFixed(3) : n.toFixed(2)}`;
const time = (iso: string) =>
  new Date(iso).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
const tokens = (t: Totals["usage"]) => t.inputTokens + t.outputTokens + t.cacheReadTokens + t.cacheWriteTokens;

/** 管理者向け: AIのトークン使用量と料金（ドル・円）、日別・月別、ユーザー別・機能別 */
export function AdminAiUsagePanel() {
  const [view, setView] = useState<View | null>(null);
  const [period, setPeriod] = useState<Period>("this-month");
  const [rate, setRate] = useState("");
  const [state, setState] = useState<{ busy?: boolean; error?: string; saved?: boolean }>({});

  const run = async (method: string, body?: unknown, p: Period = period) => {
    setState({ busy: true });
    try {
      const v = await api<View>(`/api/admin/ai-usage?period=${p}`, method, body);
      setView(v);
      setRate(String(v.usdJpy));
      setState({ saved: method === "PUT" });
    } catch (err) {
      setState({ error: err instanceof Error ? err.message : String(err) });
    }
  };

  useEffect(() => {
    run("GET", undefined, period);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period]);

  const yen = (u: number) => `${Math.round(u * (view?.usdJpy ?? 150)).toLocaleString("ja-JP")}円`;
  const money = (u: number) => `${yen(u)}（${usd(u)}）`;

  const table = (title: string, rows: Row[]) => (
    <div className="table-scroll">
      <table className="bom usage-table">
        <thead>
          <tr>
            <th>{title}</th>
            <th className="num">料金</th>
            <th className="num">案</th>
            <th className="num">再利用</th>
            <th className="num">AI呼び出し</th>
            <th className="num">入力</th>
            <th className="num">キャッシュ読込</th>
            <th className="num">キャッシュ書込</th>
            <th className="num">出力</th>
            <th className="num">キャッシュ率</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={10} className="muted">
                この期間の記録はありません
              </td>
            </tr>
          )}
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{r.label}</td>
              <td className="num">
                {yen(r.costUsd)}
                {r.unpriced > 0 && <span className="muted">＋単価不明{r.unpriced}件</span>}
              </td>
              <td className="num">{num(r.proposals)}</td>
              <td className="num">{num(r.resultCacheHits)}</td>
              <td className="num">{num(r.apiCalls)}</td>
              <td className="num">{num(r.usage.inputTokens)}</td>
              <td className="num">{num(r.usage.cacheReadTokens)}</td>
              <td className="num">{num(r.usage.cacheWriteTokens)}</td>
              <td className="num">{num(r.usage.outputTokens)}</td>
              <td className="num">{pct(r.cacheHitRate)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  const t = view?.totals;
  const saved = t ? t.costWithoutCacheUsd - t.costUsd : 0;

  return (
    <section className="card">
      <h2>AIの使用量と料金</h2>
      <p className="hint">
        AI提案で使ったトークンと料金です。料金は記録したときのモデルの公表単価（{view?.pricesAsOf ?? "—"}時点、税抜）で計算し、円は下のレートで換算します。実際の請求額とは少しずれることがあります。
      </p>
      <div className="row wrap">
        {(Object.keys(PERIOD_LABELS) as Period[]).map((p) => (
          <button key={p} type="button" className={p === period ? "on" : ""} onClick={() => setPeriod(p)} disabled={state.busy}>
            {PERIOD_LABELS[p]}
          </button>
        ))}
        <button type="button" onClick={() => run("GET")} disabled={state.busy}>
          更新
        </button>
      </div>
      {state.error && <p className="error">{state.error}</p>}
      {view && t && (
        <>
          <div className="stat-tiles">
            <Stat label={`料金（${PERIOD_LABELS[period]}）`} value={yen(t.costUsd)} sub={usd(t.costUsd)} />
            <Stat label="キャッシュで節約" value={yen(Math.max(saved, 0))} sub={`キャッシュなしなら ${yen(t.costWithoutCacheUsd)}`} />
            <Stat label="トークン" value={num(tokens(t.usage))} sub={`出力 ${num(t.usage.outputTokens)}`} />
            <Stat label="キャッシュ率" value={pct(t.cacheHitRate)} sub="入力のうちキャッシュから読んだ割合" />
            <Stat label="案" value={num(t.proposals)} sub={`AI呼び出し ${num(t.apiCalls)}回・再利用 ${num(t.resultCacheHits)}件`} />
          </div>
          {view.unpricedModels.length > 0 && (
            <p className="warn-text">
              単価が分からないモデルがあり、その分は料金に入っていません: {view.unpricedModels.join("、")}（環境変数 AI_PRICING_JSON で単価を設定できます）
            </p>
          )}

          <h3>日別（過去30日）</h3>
          <Bars data={view.daily} label={(k) => k.slice(5).replace("-", "/")} money={money} />
          <h3>月別（過去12か月）</h3>
          <Bars data={view.monthly} label={(k) => `${Number(k.slice(5))}月`} money={money} />

          <h3>ユーザー別（{PERIOD_LABELS[period]}）</h3>
          {table("ユーザー", view.byUser)}
          <h3>機能別（{PERIOD_LABELS[period]}）</h3>
          {table("機能", view.byFeature)}
          <h3>モデル別（{PERIOD_LABELS[period]}）</h3>
          {table("モデル", view.byModel)}

          {view.recent.length > 0 && (
            <details>
              <summary>最近の記録（{view.recent.length}件）</summary>
              <div className="table-scroll">
                <table className="bom usage-table">
                  <thead>
                    <tr>
                      <th>日時</th>
                      <th>ユーザー</th>
                      <th>機能・モデル</th>
                      <th className="num">料金</th>
                      <th className="num">呼び出し</th>
                      <th className="num">入力</th>
                      <th className="num">キャッシュ読込</th>
                      <th className="num">キャッシュ書込</th>
                      <th className="num">出力</th>
                    </tr>
                  </thead>
                  <tbody>
                    {view.recent.map((r, i) => (
                      <tr key={i}>
                        <td className="code">{time(r.at)}</td>
                        <td>{r.username}</td>
                        <td>
                          {r.feature} / {r.model}
                          {r.resultCached ? "（結果を再利用）" : r.ok ? "" : "（失敗）"}
                        </td>
                        <td className="num">{r.costUsd === null ? "—" : yen(r.costUsd)}</td>
                        <td className="num">{r.attempts}</td>
                        <td className="num">{num(r.usage.inputTokens)}</td>
                        <td className="num">{num(r.usage.cacheReadTokens)}</td>
                        <td className="num">{num(r.usage.cacheWriteTokens)}</td>
                        <td className="num">{num(r.usage.outputTokens)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}

          <div className="row wrap usage-settings">
            <label className="inline">
              1ドル =
              <input
                type="number"
                min={1}
                max={9999}
                step="0.01"
                value={rate}
                onChange={(e) => {
                  setRate(e.target.value);
                  setState({});
                }}
                aria-label="円換算のレート"
              />
              円
            </label>
            <button type="button" onClick={() => run("PUT", { usdJpy: Number(rate) })} disabled={state.busy || !(Number(rate) > 0)}>
              レートを保存
            </button>
            {state.saved && <span className="ok-text">保存しました</span>}
          </div>
          <p className="hint">
            記録はサーバーのデータフォルダ（ai-usage.jsonl）に残り、再起動しても消えません。同じ条件の提案の保存済み結果は{num(view.savedResults)}件です。
            <button type="button" className="link-button" onClick={() => run("DELETE")} disabled={state.busy}>
              保存済みの結果を消す
            </button>
          </p>
        </>
      )}
    </section>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="stat-tile">
      <span className="muted">{label}</span>
      <strong>{value}</strong>
      {sub && <span className="muted">{sub}</span>}
    </div>
  );
}

/** 1系列の棒グラフ（料金）。棒にマウスを乗せると内訳を出す */
function Bars({
  data,
  label,
  money,
}: {
  data: { key: string; costUsd: number; proposals: number; tokens: number }[];
  label: (key: string) => string;
  money: (usd: number) => string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(...data.map((d) => d.costUsd), 0);
  const shown = hover === null ? null : data[hover];
  const step = Math.ceil(data.length / 6);
  return (
    <div className="usage-bars-wrap">
      <p className="hint usage-bars-caption">
        {shown
          ? `${label(shown.key)}: ${money(shown.costUsd)} ／ ${num(shown.proposals)}案 ／ ${num(shown.tokens)}トークン`
          : `最大 ${money(max)}`}
      </p>
      <div className="usage-bars" role="img" aria-label="料金の推移" onMouseLeave={() => setHover(null)}>
        {data.map((d, i) => (
          <div
            key={d.key}
            className={`usage-bar${i === hover ? " on" : ""}`}
            onMouseEnter={() => setHover(i)}
            onFocus={() => setHover(i)}
            tabIndex={0}
            title={`${label(d.key)}: ${money(d.costUsd)}`}
          >
            <span style={{ height: max > 0 ? `${Math.max((d.costUsd / max) * 100, d.costUsd > 0 ? 2 : 0)}%` : 0 }} />
          </div>
        ))}
      </div>
      <div className="usage-bars-axis">
        {data.map((d, i) => (
          <span key={d.key}>{i % step === 0 || i === data.length - 1 ? label(d.key) : ""}</span>
        ))}
      </div>
    </div>
  );
}
