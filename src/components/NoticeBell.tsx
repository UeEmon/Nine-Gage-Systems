"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/roles";

export type NoticeView = {
  id: string;
  title: string;
  body: string;
  publishedAt: string;
  audience: "all" | "admin";
  source: "release" | "admin";
  unread: boolean;
};
type Feed = { notices: NoticeView[]; unread: number };

const POLL_MS = 5 * 60 * 1000;
const SHOWN = 8;

export function formatNoticeDate(iso: string) {
  return new Date(iso).toLocaleDateString("ja-JP", { year: "numeric", month: "long", day: "numeric" });
}

export function NoticeItem({ n }: { n: NoticeView }) {
  return (
    <article className={`notice${n.unread ? " unread" : ""}`}>
      <header>
        {n.unread && <span className="notice-new">NEW</span>}
        <strong>{n.title}</strong>
      </header>
      {n.body && <p>{n.body}</p>}
      <span className="muted">
        {formatNoticeDate(n.publishedAt)}
        {n.audience === "admin" && "・管理者向け"}
      </span>
    </article>
  );
}

/** ヘッダーのベル。未読数のバッジと、開くと出る最新のお知らせ（開いたら既読にする） */
export function NoticeBell() {
  const [feed, setFeed] = useState<Feed | null>(null);
  /** 開いたときの一覧（既読にした後も、開いている間は NEW の印を残す） */
  const [open, setOpen] = useState<NoticeView[] | null>(null);
  const box = useRef<HTMLDivElement>(null);

  const refresh = useCallback(() => {
    api<Feed>("/api/notices", "GET")
      .then(setFeed)
      .catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, POLL_MS);
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(null);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const toggle = () => {
    if (open) return setOpen(null);
    const list = feed?.notices ?? [];
    setOpen(list);
    if (feed && feed.unread > 0) {
      setFeed({ notices: list.map((n) => ({ ...n, unread: false })), unread: 0 });
      api<Feed>("/api/notices/read", "POST", {}).then(setFeed).catch(() => {});
    }
  };

  const unread = feed?.unread ?? 0;
  return (
    <div className="notice-bell" ref={box}>
      <button
        type="button"
        className={unread > 0 ? "has-unread" : undefined}
        onClick={toggle}
        aria-label={unread > 0 ? `お知らせ（未読${unread}件）` : "お知らせ"}
        aria-expanded={!!open}
        title="新機能のお知らせ"
      >
        <span aria-hidden="true">🔔</span>
        {unread > 0 && <span className="notice-badge">{unread > 99 ? "99+" : unread}</span>}
      </button>
      {open && (
        <div className="notice-pop" role="dialog" aria-label="新機能のお知らせ">
          <h2>新機能のお知らせ</h2>
          {open.length === 0 ? (
            <p className="hint">お知らせはまだありません。</p>
          ) : (
            open.slice(0, SHOWN).map((n) => <NoticeItem key={n.id} n={n} />)
          )}
          <Link href="/news" className="notice-all" onClick={() => setOpen(null)}>
            すべてのお知らせ
          </Link>
        </div>
      )}
    </div>
  );
}
