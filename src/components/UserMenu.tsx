"use client";

import Link from "next/link";
import { api, GUEST_LABEL, ROLE_LABELS, type SessionUser } from "@/lib/roles";
import { NoticeBell } from "./NoticeBell";

/** user が null ならログインなし */
export function UserMenu({ user }: { user: SessionUser | null }) {
  if (!user) {
    return (
      <nav className="user-menu">
        <span>
          <span className="role-badge guest">{GUEST_LABEL}</span>
        </span>
        <a href="/terminal">ターミナル</a>
        <Link href="/login">ログイン</Link>
        <Link href="/signup">ユーザー登録</Link>
      </nav>
    );
  }
  const logout = async () => {
    await api("/api/auth/logout", "POST").catch(() => {});
    window.location.href = "/login";
  };
  return (
    <nav className="user-menu">
      <NoticeBell />
      <span>
        {user.username}
        <span className={`role-badge ${user.role}`}>{ROLE_LABELS[user.role]}</span>
      </span>
      <a href="/terminal">ターミナル</a>
      <Link href="/feedback">改善リクエスト</Link>
      {user.role === "admin" && <Link href="/admin">管理</Link>}
      <Link href="/account">{user.role === "admin" ? "アカウント" : "アカウント・AI設定"}</Link>
      <button type="button" onClick={logout}>
        ログアウト
      </button>
    </nav>
  );
}
