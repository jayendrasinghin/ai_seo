export const PAYSYNC_TAGS = [
  "PAYSYNC",
  "PAYMENT-PAYPAL",
  "PAYMENT-SHOPIFY-PAYMENTS",
  "PAYMENT-STRIPE",
  "PAYMENT-RAZORPAY",
  "PAYMENT-CASHFREE",
  "PAYMENT-COD",
  "PAYMENT-MANUAL",
  "PAYMENT-OTHER",
  "PAYMENT-PAID",
  "PAYMENT-PENDING",
  "PAYMENT-REFUNDED",
  "PAYMENT-FAILED",
  "TRACKING-MISSING",
  "TRACKING-SYNCED",
  "PAYSYNC-SYNC-FAILED",
  "PAYSYNC-ACTION-REQUIRED",
  "PAYSYNC-PARTIAL-SHIPMENT",
] as const;

export type PaysyncTag = (typeof PAYSYNC_TAGS)[number];

export const PAYMENT_PROVIDER_TAGS: Record<string, PaysyncTag> = {
  paypal: "PAYMENT-PAYPAL",
  shopify_payments: "PAYMENT-SHOPIFY-PAYMENTS",
  stripe: "PAYMENT-STRIPE",
  razorpay: "PAYMENT-RAZORPAY",
  cashfree: "PAYMENT-CASHFREE",
  cod: "PAYMENT-COD",
  manual: "PAYMENT-MANUAL",
  other: "PAYMENT-OTHER",
};

export const PAYMENT_STATUS_TAGS = [
  "PAYMENT-PAID",
  "PAYMENT-PENDING",
  "PAYMENT-REFUNDED",
  "PAYMENT-FAILED",
] as const;

export const METAFIELD_NAMESPACE = "paysync";

export const METAFIELD_KEYS = [
  "payment_provider",
  "payment_status",
  "provider_order_id",
  "provider_capture_id",
  "tracking_status",
  "sync_status",
  "last_synced_at",
  "last_error",
] as const;

/** Retry delays in milliseconds: 1m, 5m, 30m, 2h, 12h */
export const RETRY_DELAYS_MS = [
  60_000,
  300_000,
  1_800_000,
  7_200_000,
  43_200_000,
] as const;

export const MAX_RETRIES = RETRY_DELAYS_MS.length;
