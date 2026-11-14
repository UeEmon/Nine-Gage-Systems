import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Docker などで node server.js だけで動かせるようにする
  output: "standalone",
};

export default nextConfig;
