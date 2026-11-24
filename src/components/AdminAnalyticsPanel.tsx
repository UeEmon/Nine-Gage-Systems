"use client";

import { useEffect, useState } from "react";
import { SITE_LABELS } from "@/lib/analytics";
import { api } from "@/lib/roles";
import { LineChart } from "./LineChart";
import type { AnalyticsPeriod, AnalyticsView, FunnelStep } from "@/lib/server/analytics";

const PERIOD_LABELS: Record<AnalyticsPeriod, string> = {
  "7d": "過去7日",
  "30d": "過去30日",
  "90d": "過去90日",
  all: "全期間",
};

const DETAIL_LABELS: Record<string, string> = {
  new: "新しく登録",
  overwrite: "上書き",
  ai: "AI提案から登録",
  "ai-history": "AIの履歴から登録",
  free: "自由に運転",
  plan: "運行計画の列車",
  owned: "所有パーツだけ",
  expand: "拡張案",
  replica: "再現してみた",
};

const num = (n: number) => n.toLocaleString("ja-JP");
const pct = (r: number | null) => (r === null ? "—" : `${Math.round(r * 100)}%`);
const date = (iso: string) => new Date(iso).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "numeric", day: "numeric" });
const days = (d: number | null | undefined) => (d === null || d === undefined ? "—" : d < 1 ? "1日以内" : `${d.toFixed(1)}日`);

/** 管理者向け: 訪問数・アクティブユーザー・到達率（ファネル）・機能別の利用状況 */
export function AdminAnalyticsPanel() {
  const [view, setView] = useState<AnalyticsView | null>(null);
  const [period, setPeriod] = useState<AnalyticsPeriod>("30d");
  const [state, setState] = useState<{ busy?: boolean; error?: string }>({});

  const load = async (p: AnalyticsPeriod = period) => {
    setState({ busy: true });
    try {
      setView(await api<AnalyticsView>(`/api/admin/analytics?period=${p}`, "GET"));
      setState({});
    } catch (err) {
      setState({ error: err instanceof Error ? err.message : String(err) });
    }
  };

  useEffect(() => {
    load(period);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period]);

  const t = view?.totals;
  const label = PERIOD_LABELS[period];

  return (
    <section className="card">
      <h2>アクセス解析</h2>
      <p className="hint">
        トップページ・プラットフォーム・ターミナルの訪問と、主な操作の記録です。外部の解析サービスは使わず、このサーバーにだけ残します。IPアドレス・ブラウザの種類・入力した内容・レイアウトの中身は残さず、訪問者は乱数のIDで数えます。管理者の操作は数えません。記録は{num(400)}日で消えます。
      </p>
      <div className="row wrap">
        {(Object.keys(PERIOD_LABELS) as AnalyticsPeriod[]).map((p) => (
          <button key={p} type="button" className={p === period ? "on" : ""} onClick={() => setPeriod(p)} disabled={state.busy}>
            {PERIOD_LABELS[p]}
          </button>
        ))}
        <button type="button" onClick={() => load()} disabled={state.busy}>
          更新
        </button>
      </div>
      {state.error && <p className="error">{state.error}</p>}
      {view && t && (
        <>
          <p className="hint">{view.measuredSince ? `計測の開始: ${date(view.measuredSince)}` : "まだ記録がありません（この版を公開すると数え始めます）。"}</p>
          <div className="stat-tiles">
            <Stat label={`訪問者（${label}）`} value={num(t.visitors)} sub={`ページ表示 ${num(t.views)}回`} />
            <Stat label="ログインして使った人" value={num(t.users)} sub={`訪問者の ${pct(t.visitors ? t.users / t.visitors : null)}`} />
            <Stat label="新規登録" value={num(t.signups)} sub="管理者が追加した人を含む" />
            <Stat label="スマホ・タブレット" value={pct(t.mobileRate)} sub="ページを見た人のうち" />
          </div>

          <h3>アクティブ（訪問者 ／ うちログインした人）</h3>
          <div className="stat-tiles">
            <Stat label="今日" value={`${num(view.active.today.visitors)} ／ ${num(view.active.today.users)}`} />
            <Stat label="過去7日" value={`${num(view.active.week.visitors)} ／ ${num(view.active.week.users)}`} />
            <Stat label="過去30日" value={`${num(view.active.month.visitors)} ／ ${num(view.active.month.users)}`} />
          </div>

          <h3>ユーザー登録数（累計）</h3>
          <LineChart
            data={view.daily}
            series={[{ key: "registered", label: "登録数", color: "var(--series-1)" }]}
            unit="人"
            ariaLabel="ユーザー登録数の累計の推移"
            extra={(d) => (d.signups ? `この日の新規登録 ${num(d.signups)}人` : "この日の新規登録なし")}
          />
          <h3>訪問者とログインした人（日別）</h3>
          <LineChart
            data={view.daily}
            series={[
              { key: "visitors", label: "訪問者", color: "var(--series-1)" },
              { key: "users", label: "ログイン", color: "var(--series-2)" },
            ]}
            unit="人"
            ariaLabel="日別の訪問者とログインした人の推移"
            extra={(d) => `ページ表示 ${num(d.views)}回・新規登録 ${num(d.signups)}人`}
          />

          <h3>到達率: 登録した人のその後（{label}に登録した人）</h3>
          <p className="hint">
            その期間に登録した人のうち、それぞれの操作を一度でもした人の数です（期間のあとの操作も数えます。前の段を飛ばした人も数えます）。日数は登録から初めてその操作をするまでの中央値です。登録前にログインせずに保存・運転した分も、同じブラウザなら数えます。
          </p>
          {view.cohortBeforeMeasure > 0 && (
            <p className="warn-text">このうち{num(view.cohortBeforeMeasure)}人は計測を始める前の登録で、それまでの操作は数えられていません。</p>
          )}
          <Funnel steps={view.signupFunnel} withDays />

          <h3>到達率: 訪問者の流れ（{label}）</h3>
          <p className="hint">その期間に訪問した人のうち、期間内にそれぞれの操作を一度でもした人の数です。ログインしなくても数えます。</p>
          <Funnel steps={view.visitorFunnel} />

          <h3>機能別の利用状況（{label}）</h3>
          <div className="table-scroll">
            <table className="bom usage-table">
              <thead>
                <tr>
                  <th>機能</th>
                  <th className="num">回数</th>
                  <th className="num">使った人</th>
                  <th className="num">うちログイン</th>
                  <th>内訳</th>
                </tr>
              </thead>
              <tbody>
                {view.features.map((f) => (
                  <tr key={f.id}>
                    <td>{f.label}</td>
                    <td className="num">{num(f.count)}</td>
                    <td className="num">{num(f.people)}</td>
                    <td className="num">{num(f.users)}</td>
                    <td className="muted">{f.details.map((d) => `${DETAIL_LABELS[d.detail] ?? d.detail} ${num(d.count)}`).join("・")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3>サイト別（{label}）</h3>
          <div className="table-scroll">
            <table className="bom usage-table">
              <thead>
                <tr>
                  <th>サイト</th>
                  <th className="num">ページ表示</th>
                  <th className="num">訪問者</th>
                </tr>
              </thead>
              <tbody>
                {view.bySite.map((s) => (
                  <tr key={s.site}>
                    <td>{SITE_LABELS[s.site]}</td>
                    <td className="num">{num(s.views)}</td>
                    <td className="num">{num(s.visitors)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3>よく見られたページ（{label}）</h3>
          {view.topPages.length ? (
            <div className="table-scroll">
              <table className="bom usage-table">
                <thead>
                  <tr>
                    <th>ページ</th>
                    <th className="num">表示</th>
                    <th className="num">訪問者</th>
                  </tr>
                </thead>
                <tbody>
                  {view.topPages.map((p) => (
                    <tr key={`${p.site} ${p.path}`}>
                      <td className="code">
                        {p.site} {p.path}
                      </td>
                      <td className="num">{num(p.views)}</td>
                      <td className="num">{num(p.visitors)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="hint">この期間はありません。</p>
          )}

          <h3>参照元（{label}、ほかのサイトから来た訪問者）</h3>
          {view.referrers.length ? (
            <p className="hint">{view.referrers.map((r) => `${r.host} ${num(r.visitors)}人`).join("、")}</p>
          ) : (
            <p className="hint">この期間はありません。</p>
          )}
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

function Funnel({ steps, withDays }: { steps: FunnelStep[]; withDays?: boolean }) {
  return (
    <div className="funnel">
      {steps.map((s, i) => (
        <div key={s.id} className="funnel-row">
          <span className="funnel-label">{s.label}</span>
          <span className="funnel-track">
            <span className="funnel-bar" style={{ width: `${Math.max((s.rate ?? 0) * 100, s.count > 0 ? 1 : 0)}%` }} />
          </span>
          <span className="funnel-num">
            {num(s.count)}人 <span className="muted">{pct(s.rate)}</span>
          </span>
          <span className="funnel-sub muted">
            {i > 0 && `前の段から ${pct(s.fromPrev)}`}
            {withDays && i > 1 && s.medianDays !== undefined && `・${days(s.medianDays)}`}
          </span>
        </div>
      ))}
    </div>
  );
}
