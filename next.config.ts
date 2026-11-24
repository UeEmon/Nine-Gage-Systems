import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Docker などで node server.js だけで動かせるようにする
  output: "standalone",
  // 名称変更（みんなのレイアウト → ターミナル）前のURL。古いリンクと、更新前のターミナルからのログインを受ける
  async redirects() {
    return [
      { source: "/share", destination: "/terminal", permanent: true },
      { source: "/api/share/handoff", destination: "/api/terminal/handoff", permanent: false },
    ];
  },
};

export default nextConfig;
