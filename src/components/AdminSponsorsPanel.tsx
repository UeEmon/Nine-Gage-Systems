"use client";

import { useEffect, useState } from "react";
import { api, ROLE_LABELS } from "@/lib/roles";

type View = {
  plan: { multiplier: number; oneTimeDays: number };
  usdJpy: number;
  sponsorable: string;
  configured: { oauth: boolean; webhook: boolean; token: boolean };
  sponsors: {
    login: string;
    username: string | null;
    active: boolean;
    monthlyUsd: number;
    oneTime: { at: string; usd: number }[];
    updatedAt: string;
  }[];
  synced?: number;
};

const day = (iso: string) => new Date(iso).toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo" });

/** 管理者向け: GitHub Sponsors の支援と、プレミアムユーザーの上限の決め方 */
export function AdminSponsorsPanel() {
  const [view, setView] = useState<View | null>(null);
  const [form, setForm] = useState({ multiplier: "", oneTimeDays: "" });
  const [state, setState] = useState<{ busy?: boolean; error?: string; notice?: string }>({});

  const run = async (method: string, body?: unknown, notice?: (v: View) => string) => {
    setState({ busy: true });
    try {
      const v = await api<View>("/api/admin/sponsors", method, body);
      setView(v);
      setForm({ multiplier: String(v.plan.multiplier), oneTimeDays: String(v.plan.oneTimeDays) });
      setState({ notice: notice?.(v) });
    } catch (err) {
      setState({ error: err instanceof Error ? err.message : String(err) });
    }
  };

  useEffect(() => {
    run("GET");
  }, []);

  if (!view) return null;
  const multiplier = Number(form.multiplier);
  const days = Number(form.oneTimeDays);
  const valid = form.multiplier !== "" && multiplier >= 0 && multiplier <= 100 && Number.isInteger(days) && days >= 1 && days <= 366;
  const example = Math.floor(5 * view.usdJpy * (valid ? multiplier : view.plan.multiplier));
  const missing = [
    !view.configured.oauth && "NINEGAGE_GITHUB_CLIENT_ID / NINEGAGE_GITHUB_CLIENT_SECRET（GitHub 連携）",
    !view.configured.webhook && "NINEGAGE_SPONSORS_WEBHOOK_SECRET（支援の変化を受け取る Webhook）",
  ].filter(Boolean);

  return (
    <section className="card">
      <h2>GitHub Sponsors と{ROLE_LABELS.ai}</h2>
      <p className="hint">
        GitHub Sponsors（{view.sponsorable}）で支援した人が、アカウント画面で GitHub を連携すると{ROLE_LABELS.ai}になります。月の上限（円）は「支援額（ドル）× 円換算のレート（{view.usdJpy}円）× 倍率」です。毎月の支援は日本時間の毎月1日に戻り、1回きりの支援は支援した日から決めた日数のあいだ有効です。
      </p>
      {missing.length > 0 && <p className="warn-text">サーバーに設定がありません: {missing.join("、")}</p>}
      <form
        className="input-row"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) run("PUT", { multiplier, oneTimeDays: days }, () => "保存しました。");
        }}
      >
        <label>
          倍率
          <input
            type="number"
            min={0}
            max={100}
            step="0.05"
            value={form.multiplier}
            onChange={(e) => setForm({ ...form, multiplier: e.target.value })}
            style={{ width: "6em" }}
          />
        </label>
        <label>
          1回きりの支援の日数
          <input
            type="number"
            min={1}
            max={366}
            value={form.oneTimeDays}
            onChange={(e) => setForm({ ...form, oneTimeDays: e.target.value })}
            style={{ width: "5em" }}
          />
          日
        </label>
        <button disabled={state.busy || !valid}>保存</button>
        <span className="muted">例: $5 の支援で月 ¥{example.toLocaleString("ja-JP")} まで</span>
      </form>

      <h3>支援してくれた人</h3>
      {view.sponsors.length === 0 ? (
        <p className="hint">まだ記録がありません。</p>
      ) : (
        <div className="table-scroll">
          <table className="bom">
            <thead>
              <tr>
                <th>GitHub</th>
                <th>SenroLab</th>
                <th>支援</th>
                <th>状態</th>
              </tr>
            </thead>
            <tbody>
              {view.sponsors.map((s) => (
                <tr key={s.login}>
                  <td>{s.login}</td>
                  <td>{s.username ?? <span className="muted">未連携</span>}</td>
                  <td>
                    {[...(s.monthlyUsd > 0 ? [`毎月 $${s.monthlyUsd}`] : []), ...s.oneTime.map((o) => `${day(o.at)} 1回 $${o.usd}`)].join("、") ||
                      "—"}
                  </td>
                  <td>{s.active ? "有効" : <span className="muted">終了</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p>
        <button
          type="button"
          disabled={state.busy || !view.configured.token}
          onClick={() => run("POST", undefined, (v) => `GitHub から${v.synced ?? 0}件の支援を読み直しました。`)}
        >
          GitHub から読み直す
        </button>{" "}
        <span className="hint">
          {view.configured.token
            ? "Webhook を取りこぼしたときや、連携の前からの支援を反映します。"
            : "読み直すには NINEGAGE_SPONSORS_TOKEN（支援先のアカウントのトークン）が要ります。"}
        </span>
      </p>
      {state.error && <p className="error">{state.error}</p>}
      {state.notice && <p className="ok-text">{state.notice}</p>}
    </section>
  );
}
