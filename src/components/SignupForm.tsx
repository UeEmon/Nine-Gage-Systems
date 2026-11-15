"use client";

import Link from "next/link";
import { useState } from "react";
import { api } from "@/lib/roles";

/** 自分でユーザー登録する（ロールは一般。AIは自分のAPIキーで使う） */
export function SignupForm() {
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [state, setState] = useState<{ busy: boolean; error?: string }>({ busy: false });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== again) {
      setState({ busy: false, error: "パスワードが一致しません。" });
      return;
    }
    setState({ busy: true });
    try {
      const r = await api<{ message: string }>("/api/auth/signup", "POST", { username, email, password });
      setSent(r.message);
      setPassword("");
      setAgain("");
      setState({ busy: false });
    } catch (err) {
      setState({ busy: false, error: err instanceof Error ? err.message : String(err) });
    }
  };

  if (sent) {
    return (
      <section className="card form">
        <h2>確認メールを送りました</h2>
        <p>{email} あてに確認メールを送りました。メールのリンクを開くと登録が完了します（24時間有効）。</p>
        <p className="hint">
          届かないときは迷惑メールのフォルダを確認するか、
          <button type="button" className="link-button" onClick={() => setSent(null)}>
            もう一度登録
          </button>
          してください。
        </p>
      </section>
    );
  }
  return (
    <form className="card form" onSubmit={submit}>
      <h2>ユーザー登録</h2>
      <label>
        ユーザー名（半角英数字と . _ @ - の3〜40文字）
        <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoFocus required />
      </label>
      <label>
        メールアドレス（確認メールを送ります）
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
      </label>
      <label>
        パスワード（10文字以上）
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          minLength={10}
          required
        />
      </label>
      <label>
        パスワード（確認）
        <input type="password" value={again} onChange={(e) => setAgain(e.target.value)} autoComplete="new-password" required />
      </label>
      {state.error && <p className="error">{state.error}</p>}
      <button className="primary" disabled={state.busy}>
        {state.busy ? "登録中…" : "登録する"}
      </button>
      <p className="hint">
        登録すると「一般」ユーザーになり、自分のAPIキー（Claude・OpenAI・Gemini）を設定してAI提案を使えます。サーバーのAIを使えるようにするかどうかは、管理者が一般ユーザーの中から選びます（「AI利用可能」）。
      </p>
      <p className="hint">
        <Link href="/login">ログイン</Link> ／ <Link href="/">ログインせずに使う</Link>
      </p>
    </form>
  );
}
