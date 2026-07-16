/**
 * Plan catalog — keep amounts in sync with Shopify Managed Pricing.
 *
 * Free  → SEO Starter Free
 * seo   → AI SEO Starter ($3.99/mo · launch $19.99/yr · later $44/yr)
 * seo_image → SEO Pro Plus Image ($8.99/mo · launch $49.99/yr · later $99/yr)
 *
 * Amount matching accepts ALL listed prices so launch subscribers and later
 * full-price subscribers both unlock the correct plan.
 */

/** Free — SEO Starter Free */
export const FREE_PLAN_NAME = "SEO Starter Free";
export const FREE_AI_SEO_MONTHLY = 100;

/**
 * Optional app-side founding slots (Starter free for N months).
 * Prefer launch yearly pricing in Partner Dashboard for first ~200 installs.
 */
export const FOUNDING_MEMBER_LIMIT = 99;
export const FOUNDING_MONTHS = 12;
export const LAUNCH_STORE_TARGET = 200;

/** Starter — AI SEO Starter */
export const STARTER_PLAN_NAME = "AI SEO Starter";
export const SEO_PLAN_USD_PER_MONTH = 3.99;
/** Current launch yearly (Partner Dashboard). Raise to REGULAR after ~200 installs. */
export const SEO_PLAN_USD_PER_YEAR = 19.99;
/** Post-launch / full yearly — still matched so older or future subs work. */
export const SEO_PLAN_USD_PER_YEAR_REGULAR = 44;

/** Pro — SEO Pro Plus Image */
export const PRO_PLAN_NAME = "SEO Pro Plus Image";
export const AI_IMAGE_PLAN_USD_PER_MONTH = 8.99;
/** Current launch yearly (Partner Dashboard). Raise to REGULAR after ~200 installs. */
export const AI_IMAGE_PLAN_USD_PER_YEAR = 49.99;
/** Post-launch / full yearly — still matched. */
export const AI_IMAGE_PLAN_USD_PER_YEAR_REGULAR = 99;
export const AI_IMAGE_MONTHLY_INCLUDED = 100;

/** Legacy monthly amounts (pre-reprice) — keep matching forever. */
export const LEGACY_SEO_PLAN_USD_PER_MONTH = 9;
export const LEGACY_AI_IMAGE_PLAN_USD_PER_MONTH = 25;

/** All Starter amounts the app treats as "seo". */
export const SEO_PLAN_MATCH_AMOUNTS = [
  SEO_PLAN_USD_PER_MONTH,
  SEO_PLAN_USD_PER_YEAR,
  SEO_PLAN_USD_PER_YEAR_REGULAR,
  LEGACY_SEO_PLAN_USD_PER_MONTH,
] as const;

/** All Pro / image-combined amounts the app treats as "seo_image". */
export const AI_IMAGE_PLAN_MATCH_AMOUNTS = [
  AI_IMAGE_PLAN_USD_PER_MONTH,
  AI_IMAGE_PLAN_USD_PER_YEAR,
  AI_IMAGE_PLAN_USD_PER_YEAR_REGULAR,
  LEGACY_AI_IMAGE_PLAN_USD_PER_MONTH,
] as const;

export const SEO_PLAN_LABEL = `$${SEO_PLAN_USD_PER_MONTH}/mo or $${SEO_PLAN_USD_PER_YEAR}/yr (launch; later $${SEO_PLAN_USD_PER_YEAR_REGULAR}/yr)`;
export const AI_IMAGE_PLAN_LABEL = `$${AI_IMAGE_PLAN_USD_PER_MONTH}/mo or $${AI_IMAGE_PLAN_USD_PER_YEAR}/yr (launch; later $${AI_IMAGE_PLAN_USD_PER_YEAR_REGULAR}/yr)`;

/** Short labels for compact UI */
export const SEO_PLAN_LABEL_SHORT = `$${SEO_PLAN_USD_PER_MONTH}/mo · $${SEO_PLAN_USD_PER_YEAR}/yr`;
export const AI_IMAGE_PLAN_LABEL_SHORT = `$${AI_IMAGE_PLAN_USD_PER_MONTH}/mo · $${AI_IMAGE_PLAN_USD_PER_YEAR}/yr`;

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
