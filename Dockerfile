# 本番用イメージ（Oracle Cloud などの VM / コンテナ環境向け）
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-alpine AS run
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 NINEGAGE_DATA_DIR=/data NEXT_TELEMETRY_DISABLED=1
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
# ユーザーとAI設定の保存先。ボリュームをつなぐ（node ユーザーが書ける）
RUN mkdir -p /data .next/cache && chown node:node /data .next/cache
VOLUME /data
USER node
EXPOSE 3000
# 最初の管理者（NINEGAGE_ADMIN_USER / NINEGAGE_ADMIN_PASSWORD）とAIのキーは実行時に環境変数で渡す
CMD ["node", "server.js"]
