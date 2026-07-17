/**
 * StoreUsage.plan values synced from Shopify Billing (see billing.server.ts).
 * - free: SEO Starter Free (100 AI SEO / month)
 * - seo: AI SEO Starter — unlimited AI SEO + SEO Suite
 * - image: legacy AI Image–only (treated like paid for suite unlock)
 * - seo_image: SEO Pro Plus Image — Starter + AI images
 */

export function getEffectivePlan(
  usage: { plan: string; [key: string]: unknown },
): string {
  return usage.plan || "free";
}

export function planSeoUnlimited(plan: string): boolean {
  return plan === "seo" || plan === "seo_image";
}

export function planImageAllowed(plan: string): boolean {
  return plan === "image" || plan === "seo_image";
}

/** When true, enforce freeQuotaLimit for combined AI (SEO + image) usage. */
export function planSeoUsesFreeQuota(plan: string): boolean {
  return !planSeoUnlimited(plan);
}

/**
 * Phase 1 SEO suite (IndexNow, redirects, schema, sitemap, llms.txt)
 * unlocks on any paid plan.
 */
export function planHasSeoSuite(plan: string): boolean {
  return plan === "seo" || plan === "image" || plan === "seo_image";
}
