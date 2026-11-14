"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/roles";
import { NoticeItem, type NoticeView } from "./NoticeBell";

/** お知らせの全件（更新履歴）。開いたら既読にする */
export function NoticeList() {
  const [notices, setNotices] = useState<NoticeView[] | null>(null);
  const [error, setError] = useState<string>();

  useEffect(() => {
    api<{ notices: NoticeView[]; unread: number }>("/api/notices", "GET")
      .then((r) => {
        setNotices(r.notices);
        if (r.unread > 0) api("/api/notices/read", "POST", {}).catch(() => {});
      })
      .catch((err) => setError(String(err.message ?? err)));
  }, []);

  return (
    <section className="card">
      <h2>新機能のお知らせ・更新履歴</h2>
      {error && <p className="error">{error}</p>}
      {!notices && !error && <p className="hint">読み込み中…</p>}
      {notices?.length === 0 && <p className="hint">お知らせはまだありません。</p>}
      <div className="notice-list">
        {notices?.map((n) => (
          <NoticeItem key={n.id} n={n} />
        ))}
      </div>
    </section>
  );
}
