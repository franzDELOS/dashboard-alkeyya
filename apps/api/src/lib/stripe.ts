import Stripe from "stripe";
import { env } from "../config/env.js";

/**
 * The single Stripe client for the API process. apiVersion is pinned to the
 * version the installed `stripe` package (22.x) ships as its default, so SDK
 * upgrades are a deliberate, reviewable change rather than a silent shift in
 * webhook payload shapes / request behaviour.
 */
export const stripe = new Stripe(env.STRIPE_SECRET_KEY, {
  apiVersion: "2026-05-27.dahlia",
});
