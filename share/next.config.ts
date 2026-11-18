import path from "node:path";
import type { NextConfig } from "next";

// 共有サイト（みんなのレイアウト）。本体と同じリポジトリの src/lib（線路の形・つなぎ方の計算）を使うので、
// ファイルの追跡とバンドルの起点をリポジトリのルートにする。
const root = path.join(__dirname, "..");

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: root,
  turbopack: { root },
};

export default nextConfig;
