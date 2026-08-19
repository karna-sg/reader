# Reader backend — multi-stage build. Runs on Node 22 (built-in node:sqlite,
# no native deps). Produces a small runtime image that serves the JSON API and
# runs the polling scheduler.

# ---- build ----
FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN npm install -g pnpm@11.2.2
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json tsdown.config.ts ./
COPY src ./src
RUN pnpm build

# ---- runtime ----
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN npm install -g pnpm@11.2.2
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --prod --frozen-lockfile && pnpm store prune
COPY --from=build /app/dist ./dist
COPY seeds ./seeds
COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh && mkdir -p /data

ENV PORT=8787
ENV DB_PATH=/data/reader.db
EXPOSE 8787
ENTRYPOINT ["./docker-entrypoint.sh"]
