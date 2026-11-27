# API image. The front end deploys separately (see vercel.json).
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=4000

COPY package.json package-lock.json ./
# tsx runs the TypeScript server directly, so it is installed with the rest.
RUN npm ci --include=dev && npm cache clean --force
COPY tsconfig*.json ./
COPY src ./src

# In production, pass DATABASE_URL, REDIS_URL, S3_*, SENTRY_DSN, and SESSION_SECRET at runtime.
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:4000/api/health || exit 1
CMD ["npx", "tsx", "src/backend/server.ts"]
