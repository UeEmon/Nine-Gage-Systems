"use client";

import { useState } from "react";

async function send(url: string, method: string, body?: unknown) {
  const res = await fetch(url, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `エラー（${res.status}）`);
  return data;
}

/** 投稿した人（と管理者）だけに出す、題名・説明の変更と削除 */
export function OwnerActions({ kind, id, title, description }: { kind: "post" | "set"; id: string; title: string; description: string }) {
  const [editing, setEditing] = useState(false);
  const [t, setT] = useState(title);
  const [d, setD] = useState(description);
  const [error, setError] = useState<string | null>(null);
  const base = kind === "post" ? `/api/posts/${id}` : `/api/sets/${id}`;

  const save = async () => {
    try {
      setError(null);
      if (kind === "post") await send(base, "PATCH", { title: t, description: d });
      else {
        const cur = await send(base, "GET");
        await send(base, "PUT", { title: t, description: d, modules: cur.set.modules });
      }
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const remove = async () => {
    if (!window.confirm(kind === "post" ? "この投稿を削除しますか？ つないだレイアウトからも消えます。" : "このつないだレイアウトを削除しますか？")) return;
    try {
      await send(base, "DELETE");
      window.location.href = kind === "post" ? "/" : "/sets";
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="form" style={{ marginTop: 12 }}>
      {editing ? (
        <>
          <label>
            題名
            <input type="text" value={t} onChange={(e) => setT(e.target.value)} maxLength={80} />
          </label>
          <label>
            説明
            <textarea value={d} onChange={(e) => setD(e.target.value)} maxLength={2000} />
          </label>
          <div className="actions">
            <button type="button" onClick={save}>
              保存
            </button>
            <button type="button" onClick={() => setEditing(false)}>
              やめる
            </button>
          </div>
        </>
      ) : (
        <div className="actions">
          <button type="button" onClick={() => setEditing(true)}>
            題名・説明を変える
          </button>
          {kind === "set" && (
            <a className="button" href={`/connect?set=${id}`}>
              つなぎ直す
            </a>
          )}
          <button type="button" className="danger" onClick={remove}>
            削除
          </button>
        </div>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
