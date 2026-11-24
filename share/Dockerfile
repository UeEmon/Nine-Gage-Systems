# ターミナルの本番用イメージ。リポジトリのルートを context にして作る:
#   docker build -f share/Dockerfile .
# プラットフォームと同じ src/lib（線路の形・つなぎ方の計算）を使うので、依存もプラットフォームと同じ package-lock.json から入れる。
FROM node:22-alpine@sha256:1314fb30ec37592d5845e5a160d522c0e680972aa534549940b8d73bde88481a AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine@sha256:1314fb30ec37592d5845e5a160d522c0e680972aa534549940b8d73bde88481a AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npx next build share

FROM node:22-alpine@sha256:1314fb30ec37592d5845e5a160d522c0e680972aa534549940b8d73bde88481a AS run
WORKDIR /app
ENV NODE_ENV=production PORT=3100 HOSTNAME=0.0.0.0 SHARE_DATA_DIR=/data NEXT_TELEMETRY_DISABLED=1
# standalone の中は「node_modules と share/server.js」（追跡の起点がリポジトリのルートのため）
COPY --from=build /app/share/.next/standalone ./
COPY --from=build /app/share/.next/static ./share/.next/static
# 投稿の保存先。ボリュームをつなぐ（node ユーザーが書ける）
RUN mkdir -p /data share/.next/cache && chown node:node /data share/.next/cache
VOLUME /data
USER node
EXPOSE 3100
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3100/api/health >/dev/null || exit 1
# SENROLAB_URL・SENROLAB_SHARE_SECRET・SHARE_SESSION_SECRET は実行時に環境変数で渡す
CMD ["node", "--disable-warning=ExperimentalWarning", "share/server.js"]
