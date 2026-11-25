"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ROLE_LABELS, SPONSORS_URL, type RoleId } from "@/lib/roles";
import { allowanceText, type Allowance } from "./AiStatus";

type View = {
  configured: boolean;
  sponsorable: string;
  github: { login: string; linkedAt: string } | null;
  role: RoleId;
  sponsor: { monthlyUsd: number; oneTime: { at: string; usd: number }[] } | null;
  oneTimeDays: number;
  allowance: Allowance | null;
};

const day = (iso: string) => new Date(iso).toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo" });

/**
 * GitHub 連携と GitHub Sponsors の支援（管理者以外）。
 * 支援した GitHub アカウントを結び付けるとプレミアムユーザーになり、サーバーのAIを支援額に応じた上限まで使える
 */
export function GithubSponsorCard({ result, message }: { result?: string; message?: string }) {
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState<string>();
  const load = useCallback(() => {
    api<View>("/api/account/github", "GET")
      .then(setView)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);
  useEffect(load, [load]);

  const unlink = async () => {
    if (!window.confirm("GitHub との連携を外しますか？（支援によるプレミアムユーザーの扱いも外れます）")) return;
    try {
      await api("/api/account/github", "DELETE");
      window.location.href = "/account#github";
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  if (!view) return error ? <p className="error">{error}</p> : null;
  const s = view.sponsor;
  const parts = s ? [...(s.monthlyUsd > 0 ? [`毎月 $${s.monthlyUsd}`] : []), ...s.oneTime.map((o) => `${day(o.at)} に1回 $${o.usd}`)] : [];
  return (
    <section className="card" id="github">
      <h2>GitHub Sponsors で支援する</h2>
      <p className="hint">
        <a href={SPONSORS_URL} target="_blank" rel="noreferrer">
          GitHub Sponsors（{view.sponsorable}）
        </a>
        で支援してくださった方は、支援した GitHub アカウントをここで連携すると{ROLE_LABELS.ai}になり、管理者が用意したAIを支援額に応じた月の上限まで使えます（1回きりの支援は{view.oneTimeDays}日間）。
      </p>
      {result === "linked" && <p className="ok-text">GitHub と連携しました。</p>}
      {result === "cancelled" && <p className="hint">GitHub との連携をやめました。</p>}
      {result === "error" && <p className="error">{message ?? "GitHub との連携に失敗しました。"}</p>}
      {view.github ? (
        <>
          <p>
            連携中の GitHub: <strong>{view.github.login}</strong>{" "}
            <button type="button" className="small" onClick={unlink}>
              連携を外す
            </button>
          </p>
          {parts.length > 0 ? (
            <p>支援: {parts.join("、")}。ありがとうございます。</p>
          ) : (
            <p className="hint">このアカウントからの有効な支援は見つかりませんでした。支援すると、数分で反映されます。</p>
          )}
        </>
      ) : view.configured ? (
        <p>
          <a className="button primary" href="/api/account/github/link">
            GitHub と連携
          </a>
        </p>
      ) : (
        <p className="hint">GitHub との連携は準備中です。</p>
      )}
      {view.allowance && (
        <p>
          {ROLE_LABELS[view.role]}のAIの利用: <strong>{allowanceText(view.allowance)}</strong>
        </p>
      )}
      {error && <p className="error">{error}</p>}
    </section>
  );
}
