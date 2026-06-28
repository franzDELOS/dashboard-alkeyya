import { Polar } from "@polar-sh/sdk";
import { env } from "../config/env.js";

/**
 * The single Polar client for the API process. Built from env: an access token
 * and the target environment ('sandbox' | 'production'), which maps to Polar's
 * own ServerList ("https://sandbox-api.polar.sh" / "https://api.polar.sh").
 *
 * Phase 1 ONLY constructs this client — it is not exercised against the Polar
 * API until Phase 2. POLAR_ACCESS_TOKEN is optional for now (see config/env.ts),
 * so this may be built with `accessToken: undefined` before the Polar products
 * exist; that's fine because no request is made yet. Phase 2 will make the
 * token required once the migration goes live.
 *
 * Constructor shape verified against the installed SDK types
 * (node_modules/@polar-sh/sdk dist/esm/lib/config.d.ts → SDKOptions):
 *   { accessToken?: string | (() => Promise<string>); server?: "production" | "sandbox"; ... }
 */
export const polar = new Polar({
  accessToken: env.POLAR_ACCESS_TOKEN,
  server: env.POLAR_SERVER,
});
