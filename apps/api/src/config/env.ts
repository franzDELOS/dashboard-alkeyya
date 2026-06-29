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

    // ---- Stripe billing (retired — optional / legacy) -----------------------
    // Stripe is no longer the active provider. These vars are kept optional so
    // the app boots without them; Stripe columns in the DB are preserved as
    // historical data. Set these only if rolling back to Stripe.
    STRIPE_SECRET_KEY: z
      .string()
      .startsWith("sk_", "STRIPE_SECRET_KEY must start with 'sk_'")
      .optional(),
    STRIPE_WEBHOOK_SECRET: z
      .string()
      .startsWith("whsec_", "STRIPE_WEBHOOK_SECRET must start with 'whsec_'")
      .optional(),
    STRIPE_STARTER_PRODUCT_ID: z.string().min(1).optional(),
    STRIPE_STARTER_PRICE_ID: z.string().min(1).optional(),
    STRIPE_PREMIUM_PRODUCT_ID: z.string().min(1).optional(),
    STRIPE_PREMIUM_PRICE_ID: z.string().min(1).optional(),
    STRIPE_GROWTH_PRODUCT_ID: z.string().min(1).optional(),
    STRIPE_GROWTH_PRICE_ID: z.string().min(1).optional(),

    // ---- Polar billing (active provider) ------------------------------------
    // POLAR_SERVER selects Polar's environment (maps to the SDK's ServerList).
    POLAR_SERVER: z.enum(["sandbox", "production"]).default("sandbox"),
    // Polar is now the default and only active billing provider.
    BILLING_PROVIDER: z.enum(["stripe", "polar"]).default("polar"),
    POLAR_ACCESS_TOKEN: z.string().min(1).optional(),
    POLAR_WEBHOOK_SECRET: z.string().min(1).optional(),
    POLAR_STARTER_PRODUCT_ID: z.string().min(1).optional(),
    POLAR_GROWTH_PRODUCT_ID: z.string().min(1).optional(),
    POLAR_PREMIUM_PRODUCT_ID: z.string().min(1).optional(),

    // ---- Phase 3: Request form → n8n ---------------------------------------
    // Where customer requests are forwarded for downstream automation. Required
    // (no default) so a misconfigured deploy fails fast at boot rather than
    // silently dropping the webhook — though the webhook itself is best-effort
    // at request time (a failed POST never errors the customer's submission).
    N8N_WEBHOOK_URL: z.string().url(),
    // Shared secret sent as the `X-Webhook-Secret` header so n8n's Header Auth
    // credential can reject anything that isn't this dashboard.
    N8N_WEBHOOK_SECRET: z.string().min(1),
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

// Polar is the active provider — hard fail if any required var is missing.
// This mirrors the fail-fast pattern used for DATABASE_URL / JWT secrets above.
if (env.BILLING_PROVIDER === "polar") {
  const missing = (
    [
      ["POLAR_ACCESS_TOKEN", env.POLAR_ACCESS_TOKEN],
      ["POLAR_WEBHOOK_SECRET", env.POLAR_WEBHOOK_SECRET],
      ["POLAR_STARTER_PRODUCT_ID", env.POLAR_STARTER_PRODUCT_ID],
      ["POLAR_GROWTH_PRODUCT_ID", env.POLAR_GROWTH_PRODUCT_ID],
      ["POLAR_PREMIUM_PRODUCT_ID", env.POLAR_PREMIUM_PRODUCT_ID],
    ] as const
  )
    .filter(([, value]) => !value)
    .map(([name]) => name);

  if (missing.length > 0) {
    console.error(
      `Invalid environment configuration: BILLING_PROVIDER=polar but these required Polar vars are missing: ${missing.join(", ")}`
    );
    process.exit(1);
  }
}

// Warn loudly if someone attempts a Stripe rollback without the Stripe vars.
if (env.BILLING_PROVIDER === "stripe") {
  const missingStripe = (
    [
      ["STRIPE_SECRET_KEY", env.STRIPE_SECRET_KEY],
      ["STRIPE_WEBHOOK_SECRET", env.STRIPE_WEBHOOK_SECRET],
    ] as const
  )
    .filter(([, value]) => !value)
    .map(([name]) => name);

  if (missingStripe.length > 0) {
    console.warn(
      `[env] BILLING_PROVIDER=stripe but these Stripe vars are missing: ${missingStripe.join(", ")}. Stripe billing will not work until they are set.`
    );
  }
}

export const corsOrigins = env.CORS_ORIGIN.split(",")
  .map((o) => o.trim())
  .filter(Boolean);
