"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { PROVIDER_LABELS, type ProviderId } from "@/lib/llm/types";
import { api, type SessionUser } from "@/lib/roles";

type Info = { provider: ProviderId; model: string; ready: boolean };

/** 使うAIの表示。設定を変えられるのは管理者だけ（「管理」画面） */
export function AiStatus({ user }: { user: SessionUser }) {
  const [info, setInfo] = useState<Info | null>(null);
  useEffect(() => {
    api<Info>("/api/ai-config", "GET")
      .then(setInfo)
      .catch(() => {});
  }, []);
  if (!info) return null;
  return (
    <div className="ai-status">
      AI: <strong>{PROVIDER_LABELS[info.provider]}</strong>
      <span className="muted"> / {info.model}</span>
      {user.role === "admin" && (
        <>
          {" "}
          <Link href="/admin">設定</Link>
        </>
      )}
      {!info.ready && (
        <p className="warn-text">
          {user.role === "admin" ? "APIキーが未設定です。「設定」から入力してください。" : "AIがまだ設定されていません。管理者に連絡してください。"}
        </p>
      )}
    </div>
  );
}
