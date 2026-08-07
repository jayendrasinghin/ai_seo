import { PLAN_FEATURES } from "./pricing";
import { planFeaturesForListing as filterPlanFeatures } from "./pricing";

/**
 * PaySync visibility toggle for App Store review vs production.
 *
 * Set PAYSYNC_ENABLED=true in .env when PaySync should appear in nav, home hub,
 * billing copy, and /app/paysync routes. Default is hidden (SEO-only surface).
 */
export function paysyncEnabled(): boolean {
  return process.env.PAYSYNC_ENABLED === "true";
}

/** Plan bullet lines with PaySync entries removed when the module is hidden. */
export function planFeaturesForListing(
  tier: keyof typeof PLAN_FEATURES,
): string[] {
  return filterPlanFeatures(tier, paysyncEnabled());
}
