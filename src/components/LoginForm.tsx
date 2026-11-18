"use client";

import Link from "next/link";
import { useState } from "react";
import { api } from "@/lib/roles";

/** next: ログイン後に移る、このサイトの中のパス（サーバーで確かめたもの） */
export function LoginForm({ signup, next = "/" }: { signup: boolean; next?: string }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [state, setState] = useState<{ busy: boolean; error?: string }>({ busy: false });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setState({ busy: true });
    try {
      await api("/api/auth/login", "POST", { username, password });
      window.location.href = next;
    } catch (err) {
      setState({ busy: false, error: err instanceof Error ? err.message : String(err) });
    }
  };

  return (
    <form className="card form" onSubmit={submit}>
      <h2>ログイン</h2>
      <label>
        ユーザー名またはメールアドレス
        <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoFocus required />
      </label>
      <label>
        パスワード
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
        />
      </label>
      {state.error && <p className="error">{state.error}</p>}
      <button className="primary" disabled={state.busy}>
        {state.busy ? "確認中…" : "ログイン"}
      </button>
      <p className="hint">
        {signup ? (
          <>
            はじめての方は<Link href="/signup">ユーザー登録</Link>。
          </>
        ) : (
          "アカウントは管理者が発行します。"
        )}{" "}
        <Link href="/">ログインせずに使う</Link>（AI提案なし）
      </p>
    </form>
  );
}
