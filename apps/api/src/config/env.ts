import { z } from "zod";

/**
 * Validate environment once at boot. If anything required is missing or
 * malformed, the process refuses to start with a readable error instead of
 * failing deep inside a request handler later.
 */
const EnvSchema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    PORT: z.coerce.number().int().positive().default(3020),
    DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
    // Comma-separated list of allowed browser origins (the web app's URL).
    CORS_ORIGIN: z.string().default("http://localhost:3001"),

    // ---- Phase 1: Auth -----------------------------------------------------
    // Separate secrets for access vs refresh so leaking one signing key never
    // lets an attacker mint the other kind of token.
    JWT_ACCESS_SECRET: z
      .string()
      .min(32, "JWT_ACCESS_SECRET must be at least 32 characters"),
    JWT_REFRESH_SECRET: z
      .string()
      .min(32, "JWT_REFRESH_SECRET must be at least 32 characters"),

    // Brevo transactional email.
    BREVO_API_KEY: z.string().min(1, "BREVO_API_KEY is required"),
    BREVO_SENDER_EMAIL: z.string().email().default("hello@alkeyya.com"),
    BREVO_SENDER_NAME: z.string().default("Alkeyya"),

    // Public web origin, used to build verification/reset links in emails.
    APP_URL: z.string().url().default("http://localhost:3001"),
  })
  .refine((e) => e.JWT_ACCESS_SECRET !== e.JWT_REFRESH_SECRET, {
    message: "JWT_REFRESH_SECRET must differ from JWT_ACCESS_SECRET",
    path: ["JWT_REFRESH_SECRET"],
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
