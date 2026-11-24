"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/roles";

/**
 * パスワード再設定のメールのリンク（/reset#トークン）から開く。
 * トークンはURLの # の後ろにあるのでサーバーのログに残らない。
 */
export function ResetForm() {
  const [token, setToken] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [state, setState] = useState<{ busy: boolean; error?: string }>({ busy: false });

  useEffect(() => {
    setToken(window.location.hash.slice(1) || "");
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== again) {
      setState({ busy: false, error: "パスワードが一致しません。" });
      return;
    }
    setState({ busy: true });
    try {
      await api("/api/auth/reset", "POST", { token, password });
      window.location.replace("/account?reset=1");
    } catch (err) {
      setState({ busy: false, error: err instanceof Error ? err.message : String(err) });
    }
  };

  if (token === null) return null;
  if (!token) {
    return (
      <section className="card form">
        <h2>パスワードの再設定</h2>
        <p className="error">リンクが正しくありません。メールのリンクをそのまま開いてください。</p>
        <p className="hint">
          <Link href="/forgot">もう一度メールを送る</Link>
        </p>
      </section>
    );
  }
  return (
    <form className="card form" onSubmit={submit}>
      <h2>新しいパスワード</h2>
      <label>
        新しいパスワード（10文字以上）
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          minLength={10}
          autoFocus
          required
        />
      </label>
      <label>
        新しいパスワード（確認）
        <input type="password" value={again} onChange={(e) => setAgain(e.target.value)} autoComplete="new-password" required />
      </label>
      {state.error && <p className="error">{state.error}</p>}
      <button className="primary" disabled={state.busy}>
        {state.busy ? "変更中…" : "パスワードを変えてログイン"}
      </button>
      <p className="hint">変えると、ほかの端末のログインは切れます。</p>
    </form>
  );
}
