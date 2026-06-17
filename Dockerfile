# どのコンテナ host（Render / Railway / Fly.io / Cloud Run など）でも動く構成
FROM node:24-alpine

WORKDIR /app
ENV NODE_ENV=production
# 公開デモはモックAI（無料・キー不要）。本物のAIを使う場合は AI_MODE=auto + OPENAI_API_KEY を設定
ENV AI_MODE=mock
# データは永続ボリューム /data に保存（マウントしない場合はコンテナ寿命と同じ）
ENV DATA_DIR=/data

COPY package*.json ./
RUN npm install --omit=dev

COPY . .
RUN mkdir -p /data

EXPOSE 3000
CMD ["node", "--no-warnings", "server.js"]
