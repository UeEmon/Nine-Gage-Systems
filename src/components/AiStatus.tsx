"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { PROVIDER_LABELS, type ProviderId } from "@/lib/llm/types";
import { api, API_KEY_GUIDE_PATH, type SessionUser } from "@/lib/roles";

export type Allowance = { limitJpy: number | null; usedJpy: number; resetsAt: string | null; expiresAt: string | null; overLimit: boolean };
type Info = { provider: ProviderId; model: string; ready: boolean; source: "server" | "own"; allowance: Allowance | null; message?: string };

const yen = (n: number) => `¥${Math.floor(n).toLocaleString("ja-JP")}`;
const day = (iso: string) => new Date(iso).toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric" });

/** 月の上限と使った分（プレミアムユーザー・プレミアムプラス） */
export function allowanceText(a: Allowance): string {
  if (a.limitJpy === null) return `今月の利用 ${yen(a.usedJpy)}（上限なし）`;
  const tail = a.resetsAt ? `・${day(a.resetsAt)}に戻ります` : a.expiresAt ? `・${day(a.expiresAt)}まで` : "";
  return `利用 ${yen(a.usedJpy)} / 上限 ${yen(a.limitJpy)}${tail}`;
}

/**
 * 使うAIの表示。
 * 管理者・プレミアムユーザー・プレミアムプラスは管理者が設定したAI（管理者用と別のモデルにできる）、一般ユーザーは自分で設定したAPIキー（「アカウント」画面）。
 * プレミアムユーザー・プレミアムプラスは月の上限まで。上限に達したら、登録した自分のAPIキーを使う
 */
export function AiStatus({ user }: { user: SessionUser }) {
  const [info, setInfo] = useState<Info | null>(null);
  useEffect(() => {
    api<Info>("/api/ai-config", "GET")
      .then(setInfo)
      .catch(() => {});
  }, []);
  if (!info) return null;
  const own = info.source === "own";
  return (
    <div className="ai-status">
      AI: <strong>{PROVIDER_LABELS[info.provider]}</strong>
      <span className="muted"> / {info.model}</span>
      {own && <span className="muted">（自分のAPIキー）</span>}
      {info.allowance && <span className="muted">（{allowanceText(info.allowance)}）</span>}
      {(user.role === "admin" || user.role === "ai" || user.role === "plus" || own) && (
        <>
          {" "}
          <Link href={user.role === "admin" ? "/admin" : "/account"}>設定</Link>
        </>
      )}
      {!info.ready && own && (
        <div className="own-key-cta">
          <p>AI提案を使うには、自分のAPIキー（Claude・OpenAI・Gemini）を登録してください。料金はキーの持ち主に請求されます。</p>
          <Link className="button primary" href="/account">
            APIキーを登録する
          </Link>{" "}
          <Link href={API_KEY_GUIDE_PATH}>登録のしかた（チュートリアル）</Link>
        </div>
      )}
      {!info.ready && !own && (
        <p className="warn-text">
          {info.message ??
            (user.role === "admin"
              ? "APIキーが未設定です。「設定」から入力してください。"
              : "AIがまだ設定されていません。管理者に連絡してください。")}
        </p>
      )}
    </div>
  );
}
