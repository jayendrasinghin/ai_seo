import { PLAN_FEATURES } from "./pricing";
import { planFeaturesForListing as filterPlanFeatures } from "./pricing";

/**
 * PaySync visibility toggle.
 *
 * Enabled by default. Set PAYSYNC_ENABLED=false in .env to hide PaySync (e.g. SEO-only review build).
 */
export function paysyncEnabled(): boolean {
  return process.env.PAYSYNC_ENABLED !== "false";
}

/** Plan bullet lines with PaySync entries removed when the module is hidden. */
export function planFeaturesForListing(
  tier: keyof typeof PLAN_FEATURES,
): string[] {
  return filterPlanFeatures(tier, paysyncEnabled());
}
