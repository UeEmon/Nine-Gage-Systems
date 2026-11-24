"use client";

import Link from "next/link";
import { useState } from "react";
import { api } from "@/lib/roles";

/** パスワードを忘れたとき。登録したメールアドレスに再設定のリンクを送る */
export function ForgotForm() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  const [state, setState] = useState<{ busy: boolean; error?: string }>({ busy: false });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setState({ busy: true });
    try {
      const r = await api<{ message: string }>("/api/auth/forgot", "POST", { email });
      setSent(r.message);
      setState({ busy: false });
    } catch (err) {
      setState({ busy: false, error: err instanceof Error ? err.message : String(err) });
    }
  };

  if (sent) {
    return (
      <section className="card form">
        <h2>メールを確認してください</h2>
        <p>{sent}</p>
        <p className="hint">
          リンクは1時間有効です。<Link href="/login">ログインへ戻る</Link>
        </p>
      </section>
    );
  }
  return (
    <form className="card form" onSubmit={submit}>
      <h2>パスワードの再設定</h2>
      <p className="hint">登録したメールアドレスを入れてください。新しいパスワードを決めるリンクをお送りします。</p>
      <label>
        メールアドレス
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" autoFocus required />
      </label>
      {state.error && <p className="error">{state.error}</p>}
      <button className="primary" disabled={state.busy}>
        {state.busy ? "送信中…" : "再設定のメールを送る"}
      </button>
      <p className="hint">
        ユーザー名で使っていてメールアドレスを登録していない方は、管理者に再設定を依頼してください。
        <br />
        <Link href="/login">ログインへ戻る</Link>
      </p>
    </form>
  );
}
