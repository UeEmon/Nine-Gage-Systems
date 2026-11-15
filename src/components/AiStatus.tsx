"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { PROVIDER_LABELS, type ProviderId } from "@/lib/llm/types";
import { api, type SessionUser } from "@/lib/roles";

type Info = { provider: ProviderId; model: string; ready: boolean; source: "server" | "own" };

/**
 * 使うAIの表示。
 * 管理者・プレミアムユーザーは管理者が設定したAI、一般ユーザーは自分で設定したAPIキー（「アカウント」画面）
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
      {(user.role === "admin" || own) && (
        <>
          {" "}
          <Link href={own ? "/account" : "/admin"}>設定</Link>
        </>
      )}
      {!info.ready && own && (
        <div className="own-key-cta">
          <p>AI提案を使うには、自分のAPIキー（Claude・OpenAI・Gemini）を登録してください。料金はキーの持ち主に請求されます。</p>
          <Link className="button primary" href="/account">
            APIキーを登録する
          </Link>
        </div>
      )}
      {!info.ready && !own && (
        <p className="warn-text">
          {user.role === "admin"
              ? "APIキーが未設定です。「設定」から入力してください。"
              : "AIがまだ設定されていません。管理者に連絡してください。"}
        </p>
      )}
    </div>
  );
}
