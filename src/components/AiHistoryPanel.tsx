"use client";

import { useCallback, useEffect, useState } from "react";

/** /api/ai-layouts の一覧の1件 */
export type AiLayoutSummary = {
  id: string;
  createdAt: string;
  title: string;
  mode: string;
  maker: string;
  target: string | null;
  board: { width: number; height: number };
  pieces: number;
  model: string;
  hint: string | null;
};

/** /api/ai-layouts/[id] の1件（value は /api/propose の1案と同じ形） */
export type AiLayoutEntry = AiLayoutSummary & {
  input: { board: { width: number; height: number }; request: string; mode: string; maker: string } | null;
  value: unknown;
};

const MODE_LABELS: Record<string, string> = {
  free: "自由に",
  owned: "手持ちだけ",
  expand: "拡張案",
  replica: "再現してみた",
};

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

type Props = {
  /** 変わったら一覧を読み直す（提案が終わったときなど） */
  version: number;
  onOpen: (e: AiLayoutEntry) => void;
  onSave: (e: AiLayoutEntry) => void;
};

/** AIで作ったレイアウトの一覧（サーバーに自動保存）。開く・パターンに登録・削除 */
export function AiHistoryPanel({ version, onOpen, onSave }: Props) {
  const [items, setItems] = useState<AiLayoutSummary[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/ai-layouts", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setItems(data.layouts as AiLayoutSummary[]);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, version]);

  const fetchEntry = async (id: string): Promise<AiLayoutEntry | null> => {
    setBusy(id);
    setError(null);
    try {
      const res = await fetch(`/api/ai-layouts/${encodeURIComponent(id)}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      return data.layout as AiLayoutEntry;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      load();
      return null;
    } finally {
      setBusy(null);
    }
  };

  const remove = async (s: AiLayoutSummary) => {
    if (!confirm(`「${s.title}」を一覧から削除しますか？\n同じ条件で頼むと、次はAIが作り直します。`)) return;
    setBusy(s.id);
    try {
      const res = await fetch(`/api/ai-layouts/${encodeURIComponent(s.id)}`, { method: "DELETE" });
      if (!res.ok && res.status !== 404) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      setItems((xs) => xs?.filter((x) => x.id !== s.id) ?? xs);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <details className="ai-history">
      <summary>AIで作ったレイアウト{items ? `（${items.length}件）` : ""}</summary>
      <p className="hint">
        AIが作った案は自動で保存されます（1人100件まで。超えると古いものから消えます）。同じ条件で頼み直したときは、AIを使わずにここから出すので、トークンを使いません。
      </p>
      {error && <p className="error">{error}</p>}
      {items === null ? (
        !error && <p className="hint">読み込み中…</p>
      ) : items.length === 0 ? (
        <p className="hint">まだありません</p>
      ) : (
        <ul className="patterns ai-history-list">
          {items.map((s) => (
            <li key={s.id}>
              <button
                className="link"
                disabled={busy !== null}
                onClick={async () => {
                  const e = await fetchEntry(s.id);
                  if (e) onOpen(e);
                }}
                title="キャンバスに開いて編集（編集中の線路は置き換わります）"
              >
                {s.title}
              </button>
              <span className="muted">
                {MODE_LABELS[s.mode] ?? s.mode}
                {s.target ? `「${s.target}」` : ""}・{s.pieces}本・{s.board.width}×{s.board.height}・{fmtDate(s.createdAt)}
              </span>
              <span className="actions">
                <button
                  className="mini"
                  disabled={busy !== null}
                  onClick={async () => {
                    const e = await fetchEntry(s.id);
                    if (e) onSave(e);
                  }}
                  title="パターンに登録（このブラウザに保存）"
                >
                  登録
                </button>
                <button className="mini danger" disabled={busy !== null} onClick={() => remove(s)}>
                  削除
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}
