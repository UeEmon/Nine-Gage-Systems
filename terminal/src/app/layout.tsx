import type { Metadata } from "next";
import { PageView } from "../../../src/components/PageView";
import "../../../src/app/globals.css";
import { senrolabUrl } from "../lib/config";
import "./terminal.css";

export const metadata: Metadata = {
  title: "ターミナル｜SenroLab",
  description: "SenroLab プラットフォームで作ったNゲージの線路レイアウトを投稿・共有し、ボードの端の線路でつないで大きなレイアウトにできます。",
};

// アクセス解析の送り先（プラットフォームのアドレス）を起動時の環境変数から読むため
export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>
        {children}
        {/* 表示と投稿は、プラットフォームのアクセス解析に送る（同じアカウント・同じ訪問者として数える） */}
        <PageView endpoint={`${senrolabUrl()}/api/events`} site="terminal" />
      </body>
    </html>
  );
}
