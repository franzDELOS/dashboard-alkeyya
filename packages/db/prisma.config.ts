// Prisma 7 configuration.
//
// In Prisma 7 the datasource `url` is no longer allowed in schema.prisma. CLI
// commands that talk to the database (migrate, studio, db seed, introspect)
// read the connection URL from here instead; the runtime PrismaClient keeps
// using the pg driver adapter (see src/client.ts).
//
// The repo-root .env is the single source of truth for DATABASE_URL, so we load
// it explicitly — Prisma's cwd is this package, and Prisma 7 no longer walks up
// to find it. It may be absent (e.g. the Docker `prisma generate` build step,
// which doesn't connect to a database), so we only declare the datasource when
// the URL is actually present. Using `env()` here would throw on a missing var
// and break that build step.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { defineConfig } from "prisma/config";

const here = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(here, "../../.env") });

const databaseUrl = process.env.DATABASE_URL;

export default defineConfig({
  schema: path.join("prisma", "schema.prisma"),
  ...(databaseUrl ? { datasource: { url: databaseUrl } } : {}),
  migrations: {
    seed: "tsx prisma/seed.ts",
  },
});
