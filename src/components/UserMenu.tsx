"use client";

import Link from "next/link";
import { api, ROLE_LABELS, type SessionUser } from "@/lib/roles";
import { NoticeBell } from "./NoticeBell";

export function UserMenu({ user }: { user: SessionUser }) {
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
      {user.role === "admin" && <Link href="/admin">管理</Link>}
      <Link href="/account">パスワード変更</Link>
      <button type="button" onClick={logout}>
        ログアウト
      </button>
    </nav>
  );
}
