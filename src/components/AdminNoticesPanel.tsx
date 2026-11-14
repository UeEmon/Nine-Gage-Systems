"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/roles";
import { formatNoticeDate } from "./NoticeBell";

type AdminNotice = {
  id: string;
  title: string;
  body: string;
  publishedAt: string;
  audience: "all" | "admin";
  source: "release" | "admin";
  scheduled: boolean;
  createdBy?: string;
};

type Draft = { id?: string; title: string; body: string; audience: "all" | "admin"; publishedAt: string };

const empty: Draft = { title: "", body: "", audience: "all", publishedAt: "" };

/** ISO → <input type="datetime-local"> の値（ブラウザの時刻） */
function toLocalInput(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 管理者がお知らせを登録・編集・削除する。リリースノートの分は表示だけ */
export function AdminNoticesPanel() {
  const [notices, setNotices] = useState<AdminNotice[] | null>(null);
  const [draft, setDraft] = useState<Draft>(empty);
  const [state, setState] = useState<{ busy?: boolean; error?: string; saved?: string }>({});

  useEffect(() => {
    api<{ notices: AdminNotice[] }>("/api/admin/notices", "GET")
      .then((r) => setNotices(r.notices))
      .catch((err) => setState({ error: String(err.message ?? err) }));
  }, []);

  const set = (patch: Partial<Draft>) => {
    setDraft({ ...draft, ...patch });
    setState({});
  };

  const run = async (fn: () => Promise<{ notices: AdminNotice[] }>, saved: string) => {
    setState({ busy: true });
    try {
      const r = await fn();
      setNotices(r.notices);
      setDraft(empty);
      setState({ saved });
    } catch (err) {
      setState({ error: err instanceof Error ? err.message : String(err) });
    }
  };

  const save = () => {
    const body = {
      title: draft.title,
      body: draft.body,
      audience: draft.audience,
      ...(draft.publishedAt ? { publishedAt: new Date(draft.publishedAt).toISOString() } : {}),
    };
    return draft.id
      ? run(() => api(`/api/admin/notices/${encodeURIComponent(draft.id!)}`, "PUT", body), "保存しました。")
      : run(() => api("/api/admin/notices", "POST", body), "登録しました。公開日時になると、対象のユーザーのベルに未読として出ます。");
  };

  const remove = (n: AdminNotice) => {
    if (!window.confirm(`「${n.title}」を削除しますか？`)) return;
    return run(() => api(`/api/admin/notices/${encodeURIComponent(n.id)}`, "DELETE"), "削除しました。");
  };

  const edit = (n: AdminNotice) => {
    setDraft({ id: n.id, title: n.title, body: n.body, audience: n.audience, publishedAt: toLocalInput(n.publishedAt) });
    setState({});
  };

  return (
    <section className="card form">
      <h2>お知らせ</h2>
      <p className="hint">
        登録したお知らせは、対象のユーザーの画面右上のベルに未読として出ます。アプリの更新で追加された機能のお知らせ（リリースノート）は、デプロイ時に自動で出ます。
      </p>
      <label>
        タイトル
        <input value={draft.title} maxLength={100} onChange={(e) => set({ title: e.target.value })} placeholder="例: 年末年始のメンテナンスについて" />
      </label>
      <label>
        本文
        <textarea value={draft.body} maxLength={2000} rows={4} onChange={(e) => set({ body: e.target.value })} />
      </label>
      <div className="row">
        <label>
          対象
          <select value={draft.audience} onChange={(e) => set({ audience: e.target.value as Draft["audience"] })}>
            <option value="all">全員</option>
            <option value="admin">管理者だけ</option>
          </select>
        </label>
        <label>
          公開日時（空欄なら今すぐ）
          <input type="datetime-local" value={draft.publishedAt} onChange={(e) => set({ publishedAt: e.target.value })} />
        </label>
      </div>
      {state.error && <p className="error">{state.error}</p>}
      {state.saved && <p className="ok-text">{state.saved}</p>}
      <div className="input-row">
        <button className="primary" type="button" onClick={save} disabled={state.busy || !draft.title.trim()}>
          {draft.id ? "保存" : "登録"}
        </button>
        {draft.id && (
          <button type="button" onClick={() => setDraft(empty)} disabled={state.busy}>
            編集をやめる
          </button>
        )}
      </div>

      <h3>登録済み</h3>
      {!notices ? (
        <p className="hint">読み込み中…</p>
      ) : notices.length === 0 ? (
        <p className="hint">まだありません。</p>
      ) : (
        <table className="notice-table">
          <tbody>
            {notices.map((n) => (
              <tr key={n.id}>
                <td>
                  <strong>{n.title}</strong>
                  <div className="muted">
                    {formatNoticeDate(n.publishedAt)}
                    {n.scheduled && "（予約）"}・{n.audience === "admin" ? "管理者だけ" : "全員"}・
                    {n.source === "release" ? "リリースノート（自動）" : `登録: ${n.createdBy}`}
                  </div>
                </td>
                <td className="actions">
                  {n.source === "admin" && (
                    <>
                      <button type="button" onClick={() => edit(n)} disabled={state.busy}>
                        編集
                      </button>
                      <button type="button" className="danger" onClick={() => remove(n)} disabled={state.busy}>
                        削除
                      </button>
                    </>
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
