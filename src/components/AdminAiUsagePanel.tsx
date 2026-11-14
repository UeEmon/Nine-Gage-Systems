"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/roles";
import type { UsageView } from "@/lib/server/aiUsage";

type View = UsageView & { savedResults: number };
type Totals = View["totals"];

const num = (n: number) => n.toLocaleString("ja-JP");
const pct = (r: number | null) => (r === null ? "—" : `${Math.round(r * 100)}%`);
const time = (iso: string) =>
  new Date(iso).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

/** 管理者向け: AI提案のトークン使用量と、キャッシュがどれだけ効いているか */
export function AdminAiUsagePanel() {
  const [view, setView] = useState<View | null>(null);
  const [state, setState] = useState<{ busy?: boolean; error?: string }>({});

  const load = async () => {
    setState({ busy: true });
    try {
      setView(await api<View>("/api/admin/ai-usage", "GET"));
      setState({});
    } catch (err) {
      setState({ error: err instanceof Error ? err.message : String(err) });
    }
  };

  const reset = async () => {
    setState({ busy: true });
    try {
      setView(await api<View>("/api/admin/ai-usage", "DELETE"));
      setState({});
    } catch (err) {
      setState({ error: err instanceof Error ? err.message : String(err) });
    }
  };

  useEffect(() => {
    load();
  }, []);

  const row = (label: string, t: Totals) => (
    <tr key={label}>
      <td>{label}</td>
      <td className="num">{num(t.proposals)}</td>
      <td className="num">{num(t.resultCacheHits)}</td>
      <td className="num">{num(t.apiCalls)}</td>
      <td className="num">{num(t.usage.inputTokens)}</td>
      <td className="num">{num(t.usage.cacheReadTokens)}</td>
      <td className="num">{num(t.usage.cacheWriteTokens)}</td>
      <td className="num">{num(t.usage.outputTokens)}</td>
      <td className="num">{pct(t.cacheHitRate)}</td>
    </tr>
  );

  return (
    <section className="card">
      <h2>AIの使用量とキャッシュ</h2>
      <p className="hint">
        AI提案で使ったトークンです。「キャッシュ読込」は部品カタログなどの共通部分を前回から再利用した分で、通常の入力より大幅に安く数えられます。
        同じ条件の提案は保存済みの結果を返し、AIを呼びません。サーバーを再起動すると0に戻ります。
      </p>
      {state.error && <p className="error">{state.error}</p>}
      {view && (
        <>
          <p className="hint">
            集計開始 {time(view.since)} ／ 保存済みの提案結果 {num(view.savedResults)}件
          </p>
          <div className="table-scroll">
            <table className="bom">
              <thead>
                <tr>
                  <th>モデル</th>
                  <th className="num">案</th>
                  <th className="num">結果の再利用</th>
                  <th className="num">AI呼び出し</th>
                  <th className="num">入力</th>
                  <th className="num">キャッシュ読込</th>
                  <th className="num">キャッシュ書込</th>
                  <th className="num">出力</th>
                  <th className="num">キャッシュ率</th>
                </tr>
              </thead>
              <tbody>
                {view.byModel.map((m) => row(m.model, m))}
                {view.byModel.length !== 1 && row("合計", view.totals)}
              </tbody>
            </table>
          </div>
          {view.recent.length > 0 && (
            <details>
              <summary>最近の提案（{view.recent.length}件）</summary>
              <div className="table-scroll">
                <table className="bom">
                  <thead>
                    <tr>
                      <th>日時</th>
                      <th>モデル</th>
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
                        <td>
                          {r.model}
                          {r.resultCached ? "（結果を再利用）" : r.ok ? "" : "（失敗）"}
                        </td>
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
        </>
      )}
      <div className="row wrap">
        <button type="button" onClick={load} disabled={state.busy}>
          更新
        </button>
        <button type="button" onClick={reset} disabled={state.busy}>
          集計を0に戻す
        </button>
      </div>
    </section>
  );
}
