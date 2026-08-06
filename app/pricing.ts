/**
 * Plan catalog — keep amounts in sync with Shopify Managed Pricing.
 *
 * Display names (Partner Dashboard): Free · Basic · Pro
 * Internal StoreUsage.plan keys:
 *   free      → Free
 *   seo       → Basic  ($3.99/mo · launch $19.99/yr · later $44/yr)
 *   seo_image → Pro    ($8.99/mo · launch $49.99/yr · later $99/yr)
 *
 * Amount matching accepts ALL listed prices so launch subscribers and later
 * full-price subscribers both unlock the correct plan.
 */

/** Free */
export const FREE_PLAN_NAME = "Free";
export const FREE_AI_SEO_MONTHLY = 100;

/** Raise launch yearly prices in Partner Dashboard after this acquisition target. */
export const LAUNCH_STORE_TARGET = 200;

/** Basic (handle: starter) */
export const STARTER_PLAN_NAME = "Basic";
export const SEO_PLAN_USD_PER_MONTH = 3.99;
/** Current launch yearly (Partner Dashboard). Raise to REGULAR after ~200 installs. */
export const SEO_PLAN_USD_PER_YEAR = 19.99;
/** Post-launch / full yearly — still matched so older or future subs work. */
export const SEO_PLAN_USD_PER_YEAR_REGULAR = 44;

/** Pro (handle: pro) */
export const PRO_PLAN_NAME = "Pro";
export const AI_IMAGE_PLAN_USD_PER_MONTH = 8.99;
/** Current launch yearly (Partner Dashboard). Raise to REGULAR after ~200 installs. */
export const AI_IMAGE_PLAN_USD_PER_YEAR = 49.99;
/** Post-launch / full yearly — still matched. */
export const AI_IMAGE_PLAN_USD_PER_YEAR_REGULAR = 99;
export const AI_IMAGE_MONTHLY_INCLUDED = 100;

/** Legacy monthly amounts (pre-reprice) — keep matching forever. */
export const LEGACY_SEO_PLAN_USD_PER_MONTH = 9;
export const LEGACY_AI_IMAGE_PLAN_USD_PER_MONTH = 25;

/** All Basic amounts the app treats as "seo". */
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

/** Keep in sync with Shopify Managed Pricing feature lists (max ~40 chars each). */
export const PLAN_FEATURES = {
  free: [
    `${FREE_AI_SEO_MONTHLY} AI SEO optimizations/month`,
    "Product SEO scan",
    "AI titles and descriptions",
    "Basic image ALT text",
    "Basic SEO recommendations",
    "PaySync basic tracking sync",
    "Product & stock management",
    "Email support",
  ],
  starter: [
    "Everything in Free",
    "Unlimited AI SEO optimizations",
    "AI titles & meta descriptions",
    "Product SEO scan",
    "Image ALT text optimization",
    "SEO Suite tools unlocked",
    "Speed & image SEO tools",
    "PaySync PayPal & Razorpay",
  ],
  pro: [
    "Everything in Basic",
    "Unlimited AI SEO optimizations",
    "Full SEO Suite unlocked",
    "AI product image generation",
    `${AI_IMAGE_MONTHLY_INCLUDED} AI images per month`,
    "Image ALT + image SEO tools",
    "Product SEO scan & tips",
    "PaySync PayPal & Razorpay",
  ],
} as const;
