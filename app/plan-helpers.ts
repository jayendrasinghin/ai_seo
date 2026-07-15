/**
 * StoreUsage.plan values synced from Shopify Billing (see billing.server.ts).
 * - free: no active subscription
 * - seo: SEO Pro recurring only (unlimited AI SEO vs free quota)
 * - image: AI Image recurring only (SEO still uses free quota)
 * - seo_image: both line items on one active subscription
 */
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
 * unlocks on any paid plan. Free can view settings but mutations are blocked.
 */
export function planHasSeoSuite(plan: string): boolean {
  return plan === "seo" || plan === "image" || plan === "seo_image";
}
