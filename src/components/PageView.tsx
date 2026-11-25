"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
// ターミナルからも使うので相対パスで読む
import { configureTracking, track, type Site } from "../lib/analytics";

/** 同じ画面の表示を続けて2回送らない（開発時の二重実行や、すぐの再描画） */
let last: { path: string; at: number } | null = null;

/** 画面を開くたびにアクセス解析へ「表示」を送る（src/lib/analytics.ts） */
export function PageView({ endpoint, site }: { endpoint?: string; site?: Site }) {
  const pathname = usePathname();
  useEffect(() => {
    configureTracking({ endpoint, site });
    const now = Date.now();
    if (last && last.path === pathname && now - last.at < 2000) return;
    last = { path: pathname, at: now };
    track("view");
  }, [pathname, endpoint, site]);
  return null;
}
