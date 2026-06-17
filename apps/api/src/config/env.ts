import { z } from "zod";

/**
 * Validate environment once at boot. If anything required is missing or
 * malformed, the process refuses to start with a readable error instead of
 * failing deep inside a request handler later.
 */
const EnvSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().positive().default(3020),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  // Comma-separated list of allowed browser origins (the web app's URL).
  CORS_ORIGIN: z.string().default("http://localhost:3001"),
});

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  // Flatten gives a compact, readable map of which vars failed.
  console.error(
    "Invalid environment configuration:",
    JSON.stringify(parsed.error.flatten().fieldErrors, null, 2)
  );
  process.exit(1);
}

export const env = parsed.data;

export const corsOrigins = env.CORS_ORIGIN.split(",")
  .map((o) => o.trim())
  .filter(Boolean);
