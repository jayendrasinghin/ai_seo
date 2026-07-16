import {
  foundingDaysRemaining,
  isFoundingStarterActive,
  type FoundingFields,
} from "./founding.server";

/**
 * StoreUsage.plan values synced from Shopify Billing (see billing.server.ts).
 * - free: SEO Starter Free (100 AI SEO / month)
 * - seo: AI SEO Starter ($3.99/mo or $44/yr) — unlimited AI SEO + SEO Suite
 * - image: legacy AI Image–only (treated like paid for suite unlock)
 * - seo_image: SEO Pro Plus Image ($8.99/mo or $99/yr) — Starter + AI images
 *
 * Founding members (first 99): Starter free for 12 months via getEffectivePlan.
 */

export type PlanUsageLike = FoundingFields & {
  plan: string;
};

/**
 * Shopify billing plan, upgraded to Starter while founding offer is active.
 * Paid Pro (seo_image) always wins over founding Starter.
 */
export function getEffectivePlan(
  usage: PlanUsageLike,
  now: Date = new Date(),
): string {
  const shopifyPlan = usage.plan || "free";
  if (shopifyPlan === "seo_image" || shopifyPlan === "image") {
    return shopifyPlan;
  }
  if (isFoundingStarterActive(usage, now)) {
    return "seo";
  }
  return shopifyPlan;
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
 * unlocks on any paid plan (or active founding Starter).
 */
export function planHasSeoSuite(plan: string): boolean {
  return plan === "seo" || plan === "image" || plan === "seo_image";
}

export function foundingOfferSummary(
  usage: PlanUsageLike,
  now: Date = new Date(),
): {
  active: boolean;
  expired: boolean;
  number: number | null;
  expiresAt: Date | null;
  daysLeft: number | null;
} {
  const number = usage.foundingMemberNumber;
  const expiresAt = usage.foundingExpiresAt;
  const active = isFoundingStarterActive(usage, now);
  const expired = Boolean(
    usage.foundingMember && expiresAt && !active,
  );
  return {
    active,
    expired,
    number,
    expiresAt,
    daysLeft: foundingDaysRemaining(usage, now),
  };
}
