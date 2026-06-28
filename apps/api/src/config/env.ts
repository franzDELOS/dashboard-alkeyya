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

    // ---- Phase 2: Stripe billing -------------------------------------------
    // No defaults: billing must never silently misconfigure. The secret/webhook
    // keys carry their well-known Stripe prefixes so a swapped key fails fast.
    STRIPE_SECRET_KEY: z
      .string()
      .startsWith("sk_", "STRIPE_SECRET_KEY must start with 'sk_'"),
    STRIPE_WEBHOOK_SECRET: z
      .string()
      .startsWith("whsec_", "STRIPE_WEBHOOK_SECRET must start with 'whsec_'"),

    // Product/Price IDs for the three fixed plans. Seeded into Plan rows; the
    // API itself reads them only via the database, but they're validated here
    // so a missing one is caught at boot rather than at seed time.
    STRIPE_STARTER_PRODUCT_ID: z.string().min(1),
    STRIPE_STARTER_PRICE_ID: z.string().min(1),
    STRIPE_PREMIUM_PRODUCT_ID: z.string().min(1),
    STRIPE_PREMIUM_PRICE_ID: z.string().min(1),
    STRIPE_GROWTH_PRODUCT_ID: z.string().min(1),
    STRIPE_GROWTH_PRICE_ID: z.string().min(1),

    // ---- Polar billing (migration) -----------------------------------------
    // Polar (Merchant of Record) is being introduced ALONGSIDE Stripe. These
    // vars are OPTIONAL for now: the Polar client is constructed at boot but not
    // exercised until Phase 2, so the app must boot whether or not the Polar
    // products / tokens exist yet. Phase 2 will tighten the ones that become
    // required (at minimum POLAR_ACCESS_TOKEN, POLAR_WEBHOOK_SECRET, and the
    // three product IDs once BILLING_PROVIDER flips to 'polar').
    //
    // POLAR_SERVER selects Polar's environment; it maps to the SDK's ServerList.
    POLAR_SERVER: z.enum(["sandbox", "production"]).default("sandbox"),
    // Which provider the billing flow uses. Stays 'stripe' until Phase 2 cuts
    // over; existing Stripe billing is unaffected while this is 'stripe'.
    BILLING_PROVIDER: z.enum(["stripe", "polar"]).default("stripe"),
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

export const corsOrigins = env.CORS_ORIGIN.split(",")
  .map((o) => o.trim())
  .filter(Boolean);
