# syntax=docker/dockerfile:1

# ---- Base: Node 22 + pnpm via corepack -------------------------------------
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /repo

# ---- Deps: install the whole workspace (cached on lockfile) -----------------
FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/db/package.json packages/db/package.json
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

# ---- Build: generate Prisma client, compile db + api ------------------------
FROM deps AS build
COPY packages/db packages/db
COPY apps/api apps/api
# Prisma needs egress to binaries.prisma.sh for the schema engine.
RUN pnpm -F @alkeyya/db generate \
 && pnpm -F @alkeyya/db build \
 && pnpm -F @alkeyya/api build

# ---- Runner: production deps only + compiled output -------------------------
FROM base AS runner
ENV NODE_ENV=production
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/db/package.json packages/db/package.json
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod

# Compiled JS + the generated Prisma client (lives under db/src/generated).
COPY --from=build /repo/packages/db/dist packages/db/dist
COPY --from=build /repo/packages/db/src/generated packages/db/src/generated
COPY --from=build /repo/apps/api/dist apps/api/dist

WORKDIR /repo/apps/api
EXPOSE 3020
CMD ["node", "dist/index.js"]
