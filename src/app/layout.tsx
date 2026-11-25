import type { Metadata } from "next";
import { PageView } from "@/components/PageView";
import "./globals.css";

export const metadata: Metadata = {
  title: "SenroLab（センロラボ）｜Nゲージ レイアウトプランナー",
  description: "AIと一緒にNゲージの線路レイアウトを設計するWebアプリ",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>
        {children}
        <PageView />
      </body>
    </html>
  );
}
