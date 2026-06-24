# Alkeyya Customer Dashboard

The customer-facing account, billing, and request portal for Alkeyya AI.
Served at **app.alkeyya.com**, alongside (but isolated from) your website,
Twenty CRM, and n8n.

> **Status — Phases 0–5 complete.** Authentication (registration, email
> verification, login, refresh-token rotation, password reset), Stripe billing
> with embedded Checkout, account settings, the support-request → n8n flow, the
> internal `/admin` panel, and Phase 5 security hardening (rate limiting,
> CSP/HSTS, Nginx TLS hardening, nightly database backups) are all in place.
> Jump to **[Production deployment](#production-deployment)** for a fresh VPS.

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
├── scripts/        backup-db.sh, restore-db.sh
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

# Start just the database (127.0.0.1:5433):
docker compose up -d dashboard-postgres

pnpm db:migrate               # apply migrations to the local DB
pnpm db:seed                  # seed the three billing plans (needs STRIPE_* in .env)

# Run API + web in watch mode:
pnpm dev
```

- Web: http://localhost:3001 — the `/` boot screen confirms the
  web → API → database chain (the authenticated app lives under `/login`,
  `/dashboard`, `/admin`, etc.).
- API: http://localhost:3020/health and /ready.

## Production deployment

A top-to-bottom checklist for standing the dashboard up on a fresh VPS. Run the
steps **in order** — several depend on the previous one (the database must be
up before migrations; Nginx must be live before the HTTPS checks). Do not skip
the HSTS gate in step 13.

### 1. DNS, TLS cert, and firewall
- Point an `app` A (and AAAA, if you use IPv6) record at the VPS IP.
- Ensure the `*.alkeyya.com` **wildcard certificate** exists at
  `/etc/letsencrypt/live/alkeyya.com/` — the Nginx config references
  `fullchain.pem` / `privkey.pem` there. (The wildcard already covers
  `app.alkeyya.com`; no new cert is needed.)
- Open inbound ports **80** and **443**.

### 2. Install Docker
```bash
sudo apt update && sudo apt install -y docker.io docker-compose-v2
sudo usermod -aG docker "$USER"   # then log out/in so `docker` runs without sudo
```

### 3. Install Node.js 22 + pnpm
Migrations and the plan seed run on the **host** (against the dockerized
Postgres on `127.0.0.1:5433`), so the host needs Node 22:
```bash
# e.g. via nodesource; any method that yields Node >= 22 is fine:
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
corepack enable                   # provides pnpm 9.15 (bundled with Node 22)
```

### 4. Clone the repo and fill in `.env`
```bash
git clone <your-repo-url> alkeyya-dashboard && cd alkeyya-dashboard
cp .env.example .env
```
Edit `.env` and set **every** value. Critical ones for production:
- `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` — strong password.
- `CORS_ORIGIN=https://app.alkeyya.com` (also enforced by docker-compose).
- `APP_URL=https://app.alkeyya.com` — **must** be the public URL; it is *not*
  overridden by docker-compose, and it builds the links in verification/reset
  emails. Leaving it at `localhost` ships broken email links.
- `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` — two **distinct** secrets, each
  ≥32 chars. Generate with `openssl rand -hex 32` (run it twice). The API
  refuses to boot if they are missing or equal.
- `BREVO_API_KEY`, `BREVO_SENDER_EMAIL`, `BREVO_SENDER_NAME` — transactional email.
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and the six
  `STRIPE_*_PRODUCT_ID` / `STRIPE_*_PRICE_ID` values (create the products/prices
  in Stripe first), plus `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`.
- `N8N_WEBHOOK_URL`, `N8N_WEBHOOK_SECRET`.

### 5. Install deps + generate the Prisma client (host)
```bash
pnpm install && pnpm db:generate
```
> `prisma generate` downloads a schema engine from `binaries.prisma.sh`. If you
> ever lock down outbound traffic, allowlist that host or set
> `PRISMA_ENGINES_MIRROR`.

### 6. Start the database
```bash
docker compose up -d dashboard-postgres
```

### 7. Apply migrations
```bash
pnpm db:deploy        # prisma migrate deploy — applies committed migrations, no prompts
```
(Use `db:deploy` in production, not the dev-only `pnpm db:migrate`.)

### 8. Seed the billing plans
```bash
pnpm db:seed          # upserts Starter/Premium/Growth from the STRIPE_* env values; idempotent
```

### 9. Build and start the API + web
```bash
docker compose up -d --build
```
Brings up `dashboard-api` (:3020) and `dashboard-web` (:3001), both bound to
`127.0.0.1` (Nginx is the only public entry point).

### 10. Verify locally (before Nginx)
```bash
curl http://localhost:3020/health    # -> {"status":"ok",...}
curl http://localhost:3020/ready     # -> {"status":"ready","database":"up"}
curl -I http://localhost:3001        # -> 200, with the Content-Security-Policy header
```

### 11. Install the Nginx config
```bash
sudo cp nginx/app.alkeyya.com.conf /etc/nginx/sites-available/app.alkeyya.com
sudo ln -s /etc/nginx/sites-available/app.alkeyya.com /etc/nginx/sites-enabled/
sudo nginx -t                        # must report "syntax is ok" / "test is successful"
sudo systemctl reload nginx
```
Also add `server_tokens off;` to the `http { }` block of
`/etc/nginx/nginx.conf` (it belongs there, not in the site conf).

### 12. Verify over HTTPS
```bash
curl https://app.alkeyya.com/api/health   # -> {"status":"ok",...}
curl https://app.alkeyya.com/api/ready    # -> {"status":"ready","database":"up"}
```

### 13. HSTS gate — read before keeping HSTS enabled
The Nginx config sends
`Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`.
Once a browser sees this it will refuse plain HTTP to the domain for **two
years**, and `preload` is effectively permanent. Only keep that header enabled
**after** step 12 confirms HTTPS works end-to-end. To back out you must serve
`max-age=0` and wait for every visitor's cache to expire — there is no remote
kill switch. Confirm it is live:
```bash
curl -I https://app.alkeyya.com | grep -i strict-transport-security
```

### 14. Promote the founder account to admin
Register + verify the founder's account through the UI first, then flip its
role (sourcing `.env` so the values are in your shell):
```bash
set -a; source .env; set +a
docker compose exec dashboard-postgres \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -c "UPDATE \"User\" SET role='admin' WHERE email='founder@alkeyya.com';"
```
(`role` is `"customer"` by default; `"admin"` unlocks the `/admin` panel.)

### 15. Set up nightly backups
Follow the header comments in `scripts/backup-db.sh`:
```bash
chmod +x scripts/backup-db.sh scripts/restore-db.sh
crontab -e
# add:
0 2 * * * /home/franz/alkeyya-dashboard/scripts/backup-db.sh >> /var/log/alkeyya-backup.log 2>&1
```
The script needs `postgresql-client` (for `pg_dump`) on the host:
`sudo apt install -y postgresql-client`. It writes 7 days of local dumps to
`/var/backups/alkeyya-dashboard/`. **Configure an offsite copy** (rclone/S3/
Backblaze) — a single VPS with no offsite copy is a business risk, not just a
technical one. Restore with `scripts/restore-db.sh /path/to/backup.sql.gz`.

### 16. Smoke-test the full flow
Register → verify email → login → billing → embedded Checkout (Stripe **test**
mode) → admin panel → approve a pilot.

## Future Phases

What is intentionally **not** built yet, and why:

- **MFA / TOTP** — *deferred for correctness, not complexity.* A real second
  factor needs recovery codes, an enforcement grace period, and trusted-device
  handling; shipping it half-designed is worse than not shipping it.
- **Usage / service-health panel** — *deferred (no data source).* Requires
  integrating telephony usage data (Telnyx or the IONOS AI Receptionist API).
  There is nothing to display until that feed exists.
- **Upgrade / downgrade subscription** — *deferred.* The current model is one
  subscription per user; changing plans needs proration logic and the Stripe
  subscription-update flow.
- **Self-service dunning recovery** — *deferred.* Reactivating a failed payment
  is currently a manual admin action; automation isn't worth it until
  subscription volume justifies it.
- **Offsite backup automation** — *reminder, not deferral.* `scripts/backup-db.sh`
  takes local nightly dumps, but the offsite copy (rclone/S3/Backblaze) must be
  configured manually with your own cloud-storage credentials.
