import type { Metadata } from "next";
import "../../../src/app/globals.css";
import "./share.css";

export const metadata: Metadata = {
  title: "みんなのレイアウト｜SenroLab",
  description: "SenroLab で作ったNゲージの線路レイアウトを投稿・共有し、ボードの端の線路でつないで大きなレイアウトにできます。",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
