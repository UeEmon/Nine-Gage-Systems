"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ROLE_HELP, ROLE_LABELS, ROLE_ORDER, type RoleId, type SessionUser } from "@/lib/roles";

type Row = SessionUser & { createdAt: string; selfRegistered: boolean; ownKey: boolean; email: string | null; pending: boolean };

/** 追加のときに選べるロール（AI利用可能は一般ユーザーの中から変える） */
const NEW_ROLES: RoleId[] = ["user", "admin"];

/** ユーザー管理（管理者だけ）: 追加・ロール変更・パスワード再設定・削除 */
export function AdminUsersPanel({ currentUserId }: { currentUserId: string }) {
  const [users, setUsers] = useState<Row[] | null>(null);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [form, setForm] = useState({ username: "", password: "", role: "user" as RoleId });
  const [resetFor, setResetFor] = useState<string | null>(null);
  const [resetPassword, setResetPassword] = useState("");

  const reload = useCallback(async () => {
    try {
      const r = await api<{ users: Row[] }>("/api/admin/users", "GET");
      setUsers(r.users);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const run = async (fn: () => Promise<unknown>, done: string) => {
    setError(undefined);
    setNotice(undefined);
    try {
      await fn();
      setNotice(done);
      await reload();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    }
  };

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (await run(() => api("/api/admin/users", "POST", form), `${form.username} を追加しました。`)) {
      setForm({ username: "", password: "", role: "user" });
    }
  };

  return (
    <section className="card">
      <h2>ユーザー管理</h2>
      {users === null ? (
        <p className="hint">読み込み中…</p>
      ) : (
        <table className="users">
          <thead>
            <tr>
              <th>ユーザー名</th>
              <th>ロール</th>
              <th>登録日</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>
                  {u.username}
                  {u.id === currentUserId && <span className="muted">（自分）</span>}
                  {u.selfRegistered && <span className="muted">（自分で登録）</span>}
                  {u.role === "user" && u.ownKey && <span className="muted">（自分のキー設定済み）</span>}
                  {u.email && <div className="muted small-text">{u.email}</div>}
                  {u.pending && <div className="warn-text small-text">メール確認待ち</div>}
                </td>
                <td>
                  <select
                    value={u.role}
                    onChange={(e) =>
                      run(
                        () => api(`/api/admin/users/${u.id}`, "PATCH", { role: e.target.value }),
                        `${u.username} を${ROLE_LABELS[e.target.value as RoleId]}にしました。`,
                      )
                    }
                  >
                    {ROLE_ORDER.map((r) => (
                      <option key={r} value={r} disabled={r === "ai" && u.pending}>
                        {ROLE_LABELS[r]}
                      </option>
                    ))}
                  </select>
                  {u.role === "user" && !u.pending && (
                    <button
                      type="button"
                      className="small"
                      onClick={() =>
                        run(
                          () => api(`/api/admin/users/${u.id}`, "PATCH", { role: "ai" }),
                          `${u.username} をAI利用可能にしました（サーバーのAIを使えます）。`,
                        )
                      }
                    >
                      AI利用を許可
                    </button>
                  )}
                </td>
                <td className="muted">{u.createdAt.slice(0, 10)}</td>
                <td className="actions">
                  {resetFor === u.id ? (
                    <form
                      className="input-row"
                      onSubmit={async (e) => {
                        e.preventDefault();
                        if (
                          await run(
                            () => api(`/api/admin/users/${u.id}`, "PATCH", { password: resetPassword }),
                            `${u.username} のパスワードを再設定しました。`,
                          )
                        ) {
                          setResetFor(null);
                          setResetPassword("");
                        }
                      }}
                    >
                      <input
                        type="password"
                        autoComplete="new-password"
                        placeholder="新しいパスワード（10文字以上）"
                        value={resetPassword}
                        onChange={(e) => setResetPassword(e.target.value)}
                        autoFocus
                      />
                      <button>設定</button>
                      <button type="button" onClick={() => setResetFor(null)}>
                        やめる
                      </button>
                    </form>
                  ) : (
                    <>
                      <button type="button" onClick={() => setResetFor(u.id)}>
                        パスワード再設定
                      </button>
                      {u.id !== currentUserId && (
                        <button
                          type="button"
                          className="danger"
                          onClick={() => {
                            if (window.confirm(`${u.username} を削除しますか？`)) {
                              run(() => api(`/api/admin/users/${u.id}`, "DELETE"), `${u.username} を削除しました。`);
                            }
                          }}
                        >
                          削除
                        </button>
                      )}
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {error && <p className="error">{error}</p>}
      {notice && <p className="ok-text">{notice}</p>}

      <form className="form add-user" onSubmit={add}>
        <h3>ユーザーを追加</h3>
        <div className="input-row">
          <input
            placeholder="ユーザー名（半角英数字）"
            value={form.username}
            onChange={(e) => setForm({ ...form, username: e.target.value })}
            autoComplete="off"
            required
          />
          <input
            type="password"
            placeholder="初期パスワード（10文字以上）"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            autoComplete="new-password"
            required
          />
          <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as RoleId })}>
            {NEW_ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
          <button>追加</button>
        </div>
        <p className="hint">
          {ROLE_ORDER.map((r) => `${ROLE_LABELS[r]}: ${ROLE_HELP[r]}`).join("。")}。ログインなしでもレイアウトの作成はできます（AI提案なし）。自分で登録した人はメールの確認後に一般になります。サーバーのAIを使わせる人は、一般ユーザーの中から「AI利用を許可」で選びます。初期パスワードは本人に伝え、ログイン後に「パスワード変更」で変えてもらってください。
        </p>
      </form>
    </section>
  );
}
