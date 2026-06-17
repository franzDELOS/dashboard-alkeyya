# Alkeyya Customer Dashboard

The customer-facing account, billing, and request portal for Alkeyya AI.
Served at **app.alkeyya.com**, alongside (but isolated from) your website,
Twenty CRM, and n8n.

> **Phase 0 — the deployable skeleton.** Monorepo, the dashboard's own
> Postgres, Dockerfiles, Nginx, and a healthcheck that proves the
> web → API → database chain works end to end. No auth or billing yet.

## Stack

| Layer    | Choice                                  |
| -------- | --------------------------------------- |
| Web      | Next.js 16, React 19, Tailwind 4        |
| API      | Express 5, TypeScript                   |
| Database | PostgreSQL 17, Prisma 7 (pg adapter)    |
| Runtime  | Node.js 22, pnpm workspaces             |
| Infra    | Docker Compose, Nginx, Let's Encrypt    |

## Layout

```
alkeyya-dashboard/
├── apps/
│   ├── api/        Express 5 API  (internal :3020)
│   └── web/        Next.js 16 app (internal :3001)
├── packages/
│   └── db/         Prisma 7 schema + shared client
├── nginx/          app.alkeyya.com server block
├── docker-compose.yml
└── .env.example
```

The browser only ever talks to `/api` **same-origin** — Nginx routes `/api`
to the API in production, and a Next.js rewrite mirrors that in local dev. No
CORS in the browser path.

## Local development

```bash
cp .env.example .env          # then edit POSTGRES_PASSWORD etc.

corepack enable               # makes pnpm available (bundled with Node 22)
pnpm setup                    # install + prisma generate + build db package

# Start just the database:
docker compose up -d dashboard-postgres

# Run API + web in watch mode:
pnpm dev
```

- Web: http://localhost:3001 — the boot screen should show all three rows
  **Online**.
- API: http://localhost:3020/health and /ready.

## Production deploy (your VPS)

```bash
# 1. Copy the repo onto the box, then:
cp .env.example .env          # set strong POSTGRES_PASSWORD, CORS_ORIGIN, etc.

# 2. Build and start the stack (its own Postgres on 127.0.0.1:5433):
docker compose up -d --build

# 3. Wire the domain:
sudo cp nginx/app.alkeyya.com.conf /etc/nginx/sites-available/app.alkeyya.com
sudo ln -s /etc/nginx/sites-available/app.alkeyya.com /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

Point an `app` A/AAAA record at the VPS. The existing `*.alkeyya.com`
wildcard cert already covers `app.alkeyya.com`.

Verify:

```bash
curl https://app.alkeyya.com/api/health   # {"status":"ok",...}
curl https://app.alkeyya.com/api/ready    # {"status":"ready","database":"up"}
```

## Two things to know about this environment

- **Prisma engine egress.** `prisma generate` / migrations download a schema
  engine from `binaries.prisma.sh`. Your VPS has open egress so this is fine;
  only relevant if you ever lock down outbound traffic (then allowlist that
  host or set `PRISMA_ENGINES_MIRROR`).
- **Backups (do before the first real customer).** This Postgres holds billing
  data. A nightly `pg_dump` to offsite object storage lands in Phase 5, but
  don't take payments until it exists. One box with no offsite backup is a
  business risk, not just a technical one.

## What's next — Phase 1

Auth: registration, email verification (via Brevo), login, refresh-token
rotation, password reset, sessions — plus the first real Prisma migration and
the branded authenticated layout.
