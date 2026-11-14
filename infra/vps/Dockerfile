# syntax=docker/dockerfile:1.7

FROM node:24.18.0-bookworm-slim AS build

ENV PNPM_HOME="/pnpm"
ENV PATH="${PNPM_HOME}:${PATH}"

WORKDIR /workspace

RUN corepack enable \
  && corepack prepare pnpm@11.17.0 --activate

COPY . .

RUN --mount=type=cache,id=bunker-pnpm,target=/pnpm/store \
  pnpm install --frozen-lockfile
RUN pnpm --filter @bunker/backend... build
RUN pnpm --filter @bunker/backend --prod deploy --legacy /opt/bunker-backend

FROM node:24.18.0-bookworm-slim AS runtime

ENV HOST="0.0.0.0"
ENV NODE_ENV="production"
ENV PORT="3000"

WORKDIR /app

RUN groupadd --gid 10001 bunker \
  && useradd --uid 10001 --gid bunker --no-create-home --shell /usr/sbin/nologin bunker

COPY --from=build --chown=bunker:bunker /opt/bunker-backend ./

USER bunker

EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=4 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/health').then((response) => { if (!response.ok) process.exit(1); }).catch(() => process.exit(1));"]

CMD ["node", "dist/server.js"]
