import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Nine-Gage レイアウトプランナー",
  description: "AIと一緒にNゲージの線路レイアウトを設計するWebアプリ",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
