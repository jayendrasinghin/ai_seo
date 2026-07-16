/**
 * Plan catalog — keep amounts in sync with Shopify Managed Pricing.
 *
 * Free  → SEO Starter Free
 * seo   → AI SEO Starter ($3.99/mo or $44/yr)
 * seo_image → SEO Pro Plus Image ($8.99/mo or $99/yr)
 */

/** Free — SEO Starter Free */
export const FREE_PLAN_NAME = "SEO Starter Free";
export const FREE_AI_SEO_MONTHLY = 100;

/** Starter — AI SEO Starter */
export const STARTER_PLAN_NAME = "AI SEO Starter";
export const SEO_PLAN_USD_PER_MONTH = 3.99;
export const SEO_PLAN_USD_PER_YEAR = 44;

/** Pro — SEO Pro Plus Image */
export const PRO_PLAN_NAME = "SEO Pro Plus Image";
export const AI_IMAGE_PLAN_USD_PER_MONTH = 8.99;
export const AI_IMAGE_PLAN_USD_PER_YEAR = 99;
export const AI_IMAGE_MONTHLY_INCLUDED = 100;

/** Legacy amounts still matched so existing subscriptions keep working. */
export const LEGACY_SEO_PLAN_USD_PER_MONTH = 9;
export const LEGACY_AI_IMAGE_PLAN_USD_PER_MONTH = 25;

export const SEO_PLAN_LABEL = `$${SEO_PLAN_USD_PER_MONTH}/month or $${SEO_PLAN_USD_PER_YEAR}/year`;
export const AI_IMAGE_PLAN_LABEL = `$${AI_IMAGE_PLAN_USD_PER_MONTH}/month or $${AI_IMAGE_PLAN_USD_PER_YEAR}/year`;

/** Short labels for compact UI */
export const SEO_PLAN_LABEL_SHORT = `$${SEO_PLAN_USD_PER_MONTH}/mo`;
export const AI_IMAGE_PLAN_LABEL_SHORT = `$${AI_IMAGE_PLAN_USD_PER_MONTH}/mo`;

export const PLAN_FEATURES = {
  free: [
    `${FREE_AI_SEO_MONTHLY} AI SEO optimizations/month`,
    "Product SEO scan",
    "AI titles and descriptions",
    "Image ALT text (basic / limited)",
    "Basic SEO recommendations",
    "Product & stock management (optional)",
  ],
  starter: [
    "Unlimited AI SEO optimizations",
    "AI titles and meta descriptions",
    "Product SEO scan",
    "Image ALT text optimization",
    "SEO Suite (IndexNow, redirects, schema, sitemap)",
    "Speed & image SEO tools",
    "Basic + advanced SEO recommendations",
    "Product & stock management",
  ],
  pro: [
    "Everything in Starter",
    "Unlimited AI SEO optimizations",
    "Full SEO Suite unlocked",
    "AI product image generation",
    `${AI_IMAGE_MONTHLY_INCLUDED} AI images per month`,
    "Image ALT text + image SEO automation",
    "Product SEO scan & recommendations",
    "Product & stock management",
  ],
} as const;
