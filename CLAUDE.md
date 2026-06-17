# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

**Alkeyya Customer Dashboard** is a monorepo delivering a separate account/billing/request portal for Alkeyya AI customers, isolated from the Twenty CRM, website, and n8n.

- **Phase 0 status**: Deployable skeleton. Proven web → API → database chain. No auth/billing yet; arrives in Phase 1.
- **Deployment**: Docker Compose locally; Docker Compose + Nginx on production VPS.
- **Repo structure**: pnpm workspaces with three packages.

## Stack

| Layer    | Choice                     | Notes                                                     |
| -------- | -------------------------- | --------------------------------------------------------- |
| Web      | Next.js 16, React 19       | Tailwind 4, standalone build, rewrites `/api` in dev      |
| API      | Express 5, TypeScript      | Helmet + CORS, graceful shutdown, Zod env validation      |
| Database | PostgreSQL 17              | Prisma 7 (Rust-free, pg driver adapter)                   |
| Runtime  | Node.js 22, pnpm 9.15      | ESM modules (`"type": "module"`)                          |

## Architecture

### Monorepo Layout
```
alkeyya-dashboard/
├── apps/
│   ├── api/                 # Express 5, :3020, health probes + routes
│   └── web/                 # Next.js 16, :3001, boot screen + rewrite proxy
├── packages/
│   └── db/                  # Prisma schema, client export, migrations
├── docker-compose.yml       # Postgres 17, API, web
├── nginx/                   # Production: app.alkeyya.com server block
└── scripts/                 # (currently empty; available)
```

### Data Flow
- **Local dev**: Browser → localhost:3001 (Next.js rewrite) → localhost:3020 (Express).
- **Production**: Browser → HTTPS app.alkeyya.com → Nginx → API (same container network).
- **No CORS in browser path**: API origin is always the same as web origin (same-origin requests).

### API Structure (`apps/api/src/`)
- `index.ts` — Server bootstrap, graceful shutdown on SIGTERM/SIGINT, 10s force-exit timeout.
- `app.ts` — Express app factory: Helmet, CORS, JSON body parser, `/health` and `/ready` probes, error handler.
- `config/env.ts` — Zod schema for environment variables (NODE_ENV, PORT, DATABASE_URL, CORS_ORIGIN). Validation at boot; early exit on failure.
- `routes/health.ts` — Health/readiness endpoints (Phase 0: no database models yet).

### Database (`packages/db/`)
- Prisma schema in `prisma/schema.prisma` (currently empty; Phase 1 brings auth/billing models).
- Exports `PrismaClient`, `prisma` singleton, and types.
- **Connectivity**: PostgreSQL adapter (`@prisma/adapter-pg`), no Rust engine — engine binary downloaded at `prisma generate`.
- Generated client at `src/generated/prisma/` (in .gitignore).

### Web (`apps/web/src/`)
- `app/page.tsx` — Phase 0 boot screen: status board confirming web → API → DB.
- `app/layout.tsx` — Root layout (Tailwind 4).
- `app/status-board.tsx` — Queries `/api/health` and `/api/ready` (client-side fetch).
- **Proxy**: Next.js rewrites `/api/*` to API_PROXY_TARGET (localhost:3020 dev, http://dashboard-api:3020 Docker).

## Common Commands

### Setup
```bash
# Install dependencies, generate Prisma client, build db package
pnpm setup

# Or step by step:
pnpm install
pnpm db:generate
pnpm -F @alkeyya/db build
```

### Development
```bash
# Run API + web in watch mode (parallel, both ports open)
pnpm dev

# Start only the Postgres container (on 127.0.0.1:5433)
docker compose up -d dashboard-postgres

# Optionally: Prisma Studio for schema browsing
pnpm db:studio
```

### Building & Linting
```bash
# Build all packages (db → api → web)
pnpm build

# Type-check all workspaces
pnpm typecheck

# Lint all workspaces (Next.js lint only; no ESLint config yet)
pnpm lint

# Specific workspace commands
pnpm -F @alkeyya/api dev
pnpm -F @alkeyya/web dev
pnpm -F @alkeyya/db migrate
```

### Database
```bash
# Create + apply migrations (schema-driven)
pnpm db:migrate

# Inspect schema in Prisma Studio
pnpm db:studio
```

### Production Deployment
```bash
# Build Docker images and start stack (all three containers)
docker compose up -d --build

# Verify health probes
curl https://app.alkeyya.com/api/health
curl https://app.alkeyya.com/api/ready

# Nginx setup (after first deploy)
sudo cp nginx/app.alkeyya.com.conf /etc/nginx/sites-available/app.alkeyya.com
sudo ln -s /etc/nginx/sites-available/app.alkeyya.com /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

## Key Patterns & Conventions

### Environment Validation
- API validates `NODE_ENV`, `PORT`, `DATABASE_URL`, `CORS_ORIGIN` using Zod in `config/env.ts`.
- Missing or malformed env vars cause immediate boot failure with readable error output.
- CORS_ORIGIN accepts comma-separated origins; split and trimmed at boot.

### Prisma Setup
- **Rust-free**: Uses `@prisma/adapter-pg` to talk to PostgreSQL without the default Rust engine.
- **Client generation**: `prisma generate` outputs client to `src/generated/prisma/` in each workspace that uses it.
- **Connection pooling**: `pg` driver adapter handles pooling; url uses `?schema=public` to specify the schema.
- **Migrations**: `prisma migrate dev` for local schema changes.

### Error Handling (Express)
- Express 5 auto-forwards rejected async errors to the global error handler.
- Health probes (no auth) return status and component status (database up/down).
- 404 for unmatched routes; 500 for internal errors.

### Next.js in Production
- **Standalone output** — does not require Node.js or npm at runtime (embeds dependencies).
- **API proxy in Docker** — rewrites `/api/*` via `next.config.ts` when API_PROXY_TARGET is set.
- **React Strict Mode** enabled in development.

### CORS
- Only the web origin (localhost:3001 or app.alkeyya.com) can call the API from a browser.
- CORS headers set at Express boot; list comes from env var (comma-separated).
- Production Nginx routes `/api` to the API service, so no CORS headers needed in the browser path.

### Graceful Shutdown
- API listens for SIGTERM and SIGINT.
- Server closes, allowing in-flight requests to finish.
- 10-second force-exit timeout to avoid hanging.

## Roadmap (Phase 1+)

- **Phase 1**: Auth (registration, email verification via Brevo, login, refresh-token rotation, password reset, sessions), first Prisma migration with User/Account models, branded authenticated layout.
- **Phase 5**: Backups (nightly pg_dump to offsite object storage).

## Notable Constraints & Decisions

- **Phase 0 ships zero domain models** — Prisma schema is empty; connectivity proven by raw `SELECT 1` in health probes.
- **Postgres on 5433 locally** — avoids collision with other Postgres instances on 5432.
- **Separate database from Twenty/website** — this dashboard has its own Postgres volume and backup lifecycle.
- **No test suite yet** — Phase 0 focuses on deployability; testing arrives with auth/models.
- **No ESLint config** — only Next.js built-in lint; linting rules can be added in Phase 1.
- **Prisma engine egress** — `prisma generate` downloads from binaries.prisma.sh; requires open outbound or PRISMA_ENGINES_MIRROR env var.
