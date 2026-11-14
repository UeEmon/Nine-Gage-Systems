"use client";

import { useState } from "react";
import { api } from "@/lib/roles";

export function PasswordForm() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [state, setState] = useState<{ busy: boolean; error?: string; done?: boolean }>({ busy: false });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (next !== again) {
      setState({ busy: false, error: "新しいパスワードが一致しません。" });
      return;
    }
    setState({ busy: true });
    try {
      await api("/api/auth/password", "POST", { current, next });
      setCurrent("");
      setNext("");
      setAgain("");
      setState({ busy: false, done: true });
    } catch (err) {
      setState({ busy: false, error: err instanceof Error ? err.message : String(err) });
    }
  };

  return (
    <form className="card form" onSubmit={submit}>
      <h2>パスワード変更</h2>
      <label>
        今のパスワード
        <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required />
      </label>
      <label>
        新しいパスワード（10文字以上）
        <input type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" minLength={10} required />
      </label>
      <label>
        新しいパスワード（確認）
        <input type="password" value={again} onChange={(e) => setAgain(e.target.value)} autoComplete="new-password" required />
      </label>
      {state.error && <p className="error">{state.error}</p>}
      {state.done && <p className="ok-text">変更しました。ほかの端末ではログインし直しになります。</p>}
      <button className="primary" disabled={state.busy}>
        {state.busy ? "変更中…" : "変更する"}
      </button>
    </form>
  );
}
