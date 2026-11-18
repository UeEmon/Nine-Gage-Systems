"use client";

import { useEffect, useState } from "react";
import {
  FEEDBACK_BODY_MAX,
  FEEDBACK_CATEGORIES,
  FEEDBACK_CATEGORY_IDS,
  FEEDBACK_FEATURES,
  FEEDBACK_TITLE_MAX,
  type FeedbackCategory,
  type FeedbackView,
} from "@/lib/feedback";
import { api } from "@/lib/roles";
import { formatNoticeDate } from "./NoticeBell";

const PLACEHOLDER: Record<FeedbackCategory, string> = {
  feature: "どんなことができるとうれしいか、どんな場面で困っているかを書いてください。",
  bug: "どの画面で何をしたら、どうなったか。期待していた動きと、使っているブラウザも書いてもらえると助かります。",
  other: "気づいたこと・質問など、自由に書いてください。",
};

/** 改善リクエストを送る画面と、自分が送った分の一覧 */
export function FeedbackForm() {
  const [category, setCategory] = useState<FeedbackCategory>("feature");
  const [feature, setFeature] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [list, setList] = useState<FeedbackView[] | null>(null);
  const [state, setState] = useState<{ busy?: boolean; error?: string; done?: { issueUrl?: string } }>({});

  useEffect(() => {
    api<{ feedback: FeedbackView[] }>("/api/feedback", "GET")
      .then((r) => setList(r.feedback))
      .catch((err) => setState({ error: String(err.message ?? err) }));
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setState({ busy: true });
    try {
      const r = await api<{ feedback: FeedbackView[]; issueUrl?: string }>("/api/feedback", "POST", {
        category,
        ...(feature ? { feature } : {}),
        title,
        body,
      });
      setList(r.feedback);
      setTitle("");
      setBody("");
      setState({ done: { issueUrl: r.issueUrl } });
    } catch (err) {
      setState({ error: err instanceof Error ? err.message : String(err) });
    }
  };

  return (
    <>
      <form className="card form" onSubmit={submit}>
        <h2>改善リクエストを送る</h2>
        <p className="hint">
          ほしい機能や、使いにくいところ・不具合を教えてください。送った内容は開発の課題として
          <strong>公開の GitHub（Issues）に載ります</strong>。ユーザー名やメールアドレスは載せませんが、本文に個人情報やパスワードは書かないでください。
        </p>
        <label>
          種類
          <select value={category} onChange={(e) => setCategory(e.target.value as FeedbackCategory)}>
            {FEEDBACK_CATEGORY_IDS.map((c) => (
              <option key={c} value={c}>
                {FEEDBACK_CATEGORIES[c]}
              </option>
            ))}
          </select>
        </label>
        <label>
          どの機能について
          <select value={feature} onChange={(e) => setFeature(e.target.value)}>
            <option value="">わからない・複数にまたがる</option>
            {FEEDBACK_FEATURES.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          件名
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={FEEDBACK_TITLE_MAX} required placeholder="例: 曲線ポイントを左右反転したい" />
        </label>
        <label>
          内容
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={FEEDBACK_BODY_MAX}
            rows={8}
            required
            placeholder={PLACEHOLDER[category]}
          />
          <span className="hint">
            {body.length} / {FEEDBACK_BODY_MAX}文字
          </span>
        </label>
        {state.error && <p className="error">{state.error}</p>}
        {state.done && (
          <p className="ok-text">
            送りました。ありがとうございます。
            {state.done.issueUrl ? (
              <>
                {" "}
                <a href={state.done.issueUrl} target="_blank" rel="noreferrer">
                  GitHub の Issue
                </a>
                で進み具合を見られます。
              </>
            ) : (
              " 管理者が確認して課題に登録します。"
            )}
          </p>
        )}
        <button className="primary" disabled={state.busy}>
          {state.busy ? "送信中…" : "送る"}
        </button>
      </form>

      <section className="card">
        <h2>送ったリクエスト</h2>
        {list === null ? (
          <p className="hint">読み込み中…</p>
        ) : list.length === 0 ? (
          <p className="hint">まだありません。</p>
        ) : (
          <ul className="feedback-list">
            {list.map((f) => (
              <li key={f.id}>
                <div className="feedback-head">
                  <span className="feedback-cat">{FEEDBACK_CATEGORIES[f.category]}</span>
                  <strong>{f.title}</strong>
                </div>
                <div className="hint">
                  {formatNoticeDate(f.createdAt)}・
                  {f.issueUrl ? (
                    <a href={f.issueUrl} target="_blank" rel="noreferrer">
                      Issue #{f.issueNumber}
                    </a>
                  ) : (
                    "受付済み（課題への登録待ち）"
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
