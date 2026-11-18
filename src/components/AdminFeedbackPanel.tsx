"use client";

import { useEffect, useState } from "react";
import { FEEDBACK_CATEGORIES, FEEDBACK_FEATURES, type FeedbackView } from "@/lib/feedback";
import { api } from "@/lib/roles";
import { formatNoticeDate } from "./NoticeBell";

/** 管理画面: 届いた改善リクエスト。だれが送ったかはここでだけ見られる（Issue には載せない） */
export function AdminFeedbackPanel() {
  const [list, setList] = useState<FeedbackView[] | null>(null);
  const [repo, setRepo] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [state, setState] = useState<{ busy?: boolean; error?: string }>({});

  useEffect(() => {
    api<{ feedback: FeedbackView[]; repo: string | null }>("/api/admin/feedback", "GET")
      .then((r) => {
        setList(r.feedback);
        setRepo(r.repo);
      })
      .catch((err) => setState({ error: String(err.message ?? err) }));
  }, []);

  const retry = async (f: FeedbackView) => {
    setState({ busy: true });
    try {
      const r = await api<{ feedback: FeedbackView[] }>(`/api/admin/feedback/${encodeURIComponent(f.id)}`, "POST");
      setList(r.feedback);
      setState({});
    } catch (err) {
      setState({ error: err instanceof Error ? err.message : String(err) });
    }
  };

  const featureName = (id?: string) => FEEDBACK_FEATURES.find((x) => x.id === id)?.name ?? "わからない・複数";

  return (
    <section className="card">
      <h2>改善リクエスト</h2>
      <p className="hint">
        利用者が「改善リクエスト」から送った内容です。
        {repo ? (
          <>
            GitHub の{" "}
            <a href={`https://github.com/${repo}/issues?q=label%3A${encodeURIComponent("改善リクエスト")}`} target="_blank" rel="noreferrer">
              {repo} の Issues
            </a>{" "}
            に自動で登録します（送った人の名前は載せません）。
          </>
        ) : (
          <>GitHub への登録は設定されていないので、ここに保存するだけです（環境変数 NINEGAGE_FEEDBACK_GITHUB_TOKEN）。</>
        )}
      </p>
      {state.error && <p className="error">{state.error}</p>}
      {!list ? (
        <p className="hint">読み込み中…</p>
      ) : list.length === 0 ? (
        <p className="hint">まだありません。</p>
      ) : (
        <table className="notice-table">
          <tbody>
            {list.map((f) => (
              <tr key={f.id}>
                <td>
                  <button type="button" className="link-button" onClick={() => setOpen(open === f.id ? null : f.id)}>
                    <strong>{f.title}</strong>
                  </button>
                  <div className="muted">
                    {formatNoticeDate(f.createdAt)}・{f.username}・{FEEDBACK_CATEGORIES[f.category]}・{featureName(f.feature)}
                  </div>
                  {f.error && !f.issueUrl && <div className="error">Issue にできませんでした: {f.error}</div>}
                  {open === f.id && <p className="feedback-body">{f.body}</p>}
                </td>
                <td className="actions">
                  {f.issueUrl ? (
                    <a href={f.issueUrl} target="_blank" rel="noreferrer">
                      #{f.issueNumber}
                    </a>
                  ) : (
                    repo && (
                      <button type="button" onClick={() => retry(f)} disabled={state.busy}>
                        Issue にする
                      </button>
                    )
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
