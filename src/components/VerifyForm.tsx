"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/roles";

/**
 * 確認メールのリンク（/verify#トークン）から開く。
 * トークンはURLの # の後ろにあるのでサーバーのログに残らない。メールソフトの自動の下見で完了しないよう、ボタンで送る。
 */
export function VerifyForm() {
  const [token, setToken] = useState<string | null>(null);
  const [state, setState] = useState<{ busy: boolean; error?: string }>({ busy: false });

  useEffect(() => {
    setToken(window.location.hash.slice(1) || "");
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setState({ busy: true });
    try {
      await api("/api/auth/verify", "POST", { token });
      window.location.replace("/account");
    } catch (err) {
      setState({ busy: false, error: err instanceof Error ? err.message : String(err) });
    }
  };

  if (token === null) return null;
  return (
    <form className="card form" onSubmit={submit}>
      <h2>メールアドレスの確認</h2>
      {token ? (
        <>
          <p>ボタンを押すと登録が完了し、ログインします。</p>
          {state.error && <p className="error">{state.error}</p>}
          <button className="primary" disabled={state.busy}>
            {state.busy ? "確認中…" : "登録を完了する"}
          </button>
        </>
      ) : (
        <p className="error">リンクが正しくありません。メールのリンクをそのまま開いてください。</p>
      )}
      <p className="hint">
        <Link href="/signup">ユーザー登録</Link> ／ <Link href="/login">ログイン</Link>
      </p>
    </form>
  );
}
