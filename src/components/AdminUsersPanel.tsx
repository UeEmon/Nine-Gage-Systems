"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ASSIGNABLE_ROLES, ROLE_HELP, ROLE_LABELS, ROLE_ORDER, type AssignableRole, type SessionUser } from "@/lib/roles";

type Row = SessionUser & {
  createdAt: string;
  selfRegistered: boolean;
  ownKey: boolean;
  email: string | null;
  pending: boolean;
  storedRole: AssignableRole;
  aiLimitJpy: number | null;
  github: string | null;
};

/** 追加のときに選べるロール（プレミアムプラスは一般ユーザーの中から変える） */
const NEW_ROLES: AssignableRole[] = ["user", "admin"];

/** プレミアムプラスの月の上限（円）。空欄なら上限なし */
function LimitForm({ row, onSave }: { row: Row; onSave: (limit: number | null) => void }) {
  const [value, setValue] = useState(row.aiLimitJpy === null ? "" : String(row.aiLimitJpy));
  useEffect(() => setValue(row.aiLimitJpy === null ? "" : String(row.aiLimitJpy)), [row.aiLimitJpy]);
  const parsed = value.trim() === "" ? null : Number(value);
  const valid = parsed === null || (Number.isInteger(parsed) && parsed >= 0);
  return (
    <form
      className="input-row small-text"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) onSave(parsed);
      }}
    >
      <label>
        月の上限 ¥
        <input
          type="number"
          min={0}
          step={100}
          inputMode="numeric"
          placeholder="上限なし"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-label={`${row.username} の月の上限（円）`}
          style={{ width: "7em" }}
        />
      </label>
      <button className="small" disabled={!valid || parsed === row.aiLimitJpy}>
        保存
      </button>
    </form>
  );
}

/** ユーザー管理（管理者だけ）: 追加・ロール変更・パスワード再設定・削除 */
export function AdminUsersPanel({ currentUserId }: { currentUserId: string }) {
  const [users, setUsers] = useState<Row[] | null>(null);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [form, setForm] = useState({ username: "", password: "", role: "user" as AssignableRole });
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
                  {u.role !== "admin" && u.ownKey && <span className="muted">（自分のキー設定済み）</span>}
                  {u.email && <div className="muted small-text">{u.email}</div>}
                  {u.pending && <div className="warn-text small-text">メール確認待ち</div>}
                  {u.github && <div className="muted small-text">GitHub: {u.github}</div>}
                </td>
                <td>
                  <select
                    value={u.storedRole}
                    onChange={(e) =>
                      run(
                        () => api(`/api/admin/users/${u.id}`, "PATCH", { role: e.target.value }),
                        `${u.username} を${ROLE_LABELS[e.target.value as AssignableRole]}にしました。`,
                      )
                    }
                  >
                    {ASSIGNABLE_ROLES.map((r) => (
                      <option key={r} value={r} disabled={r === "plus" && u.pending}>
                        {ROLE_LABELS[r]}
                      </option>
                    ))}
                  </select>
                  {u.role === "ai" && <div className="small-text">{ROLE_LABELS.ai}（GitHub Sponsors で支援中）</div>}
                  {u.storedRole === "plus" && (
                    <LimitForm
                      row={u}
                      onSave={(limit) =>
                        run(
                          () => api(`/api/admin/users/${u.id}`, "PATCH", { aiLimitJpy: limit }),
                          limit === null
                            ? `${u.username} の月の上限をなしにしました。`
                            : `${u.username} の月の上限を¥${limit.toLocaleString("ja-JP")}にしました。`,
                        )
                      }
                    />
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
          <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as AssignableRole })}>
            {NEW_ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
          <button>追加</button>
        </div>
        <p className="hint">
          {ROLE_ORDER.map((r) => `${ROLE_LABELS[r]}: ${ROLE_HELP[r]}`).join("。")}。ログインなしでもレイアウトの作成はできます（AI提案なし）。自分で登録した人はメールの確認後に一般になります。GitHub Sponsors で支援した人は、アカウント画面で GitHub を連携すると自動で{ROLE_LABELS.ai}になります（ここでは選べません）。特別にサーバーのAIを使わせる人は、一般ユーザーの中から{ROLE_LABELS.plus}に変え、月の上限を決めます（空欄なら上限なし）。初期パスワードは本人に伝え、ログイン後に「パスワード変更」で変えてもらってください。
        </p>
      </form>
    </section>
  );
}
