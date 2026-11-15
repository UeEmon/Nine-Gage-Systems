# 本番用イメージ（Oracle Cloud などの VM / コンテナ環境向け）
# ベースイメージはダイジェストで固定する（Dependabot が週に一度更新のPRを出す）
FROM node:22-alpine@sha256:1314fb30ec37592d5845e5a160d522c0e680972aa534549940b8d73bde88481a AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine@sha256:1314fb30ec37592d5845e5a160d522c0e680972aa534549940b8d73bde88481a AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-alpine@sha256:1314fb30ec37592d5845e5a160d522c0e680972aa534549940b8d73bde88481a AS run
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 NINEGAGE_DATA_DIR=/data NEXT_TELEMETRY_DISABLED=1
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
# バックアップの書き出しと復元（docker compose exec nine-gage node scripts/backup.mjs）
COPY scripts ./scripts
# ユーザーとAI設定の保存先。ボリュームをつなぐ（node ユーザーが書ける）
RUN mkdir -p /data .next/cache && chown node:node /data .next/cache
VOLUME /data
USER node
EXPOSE 3000
# 起動して応答できるか（docker ps の STATUS に healthy と出る）
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null || exit 1
# 最初の管理者（NINEGAGE_ADMIN_USER / NINEGAGE_ADMIN_PASSWORD）とAIのキーは実行時に環境変数で渡す
# node:sqlite は Node 22 では試験的機能の警告を出すので、その警告だけ止める
CMD ["node", "--disable-warning=ExperimentalWarning", "server.js"]
