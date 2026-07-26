/** Human-readable labels for dashboard display. */

export function formatSyncStatus(status: string): string {
  switch (status) {
    case "not_applicable":
      return "Not required";
    case "needs_mapping":
      return "Needs mapping";
    case "failed_permanent":
      return "Failed (permanent)";
    case "synced":
      return "Synced";
    case "pending":
      return "Pending";
    case "queued":
      return "Queued";
    case "retrying":
      return "Retrying";
    case "failed":
      return "Failed";
    default:
      return status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }
}

export function formatPaymentStatus(status: string): string {
  switch (status) {
    case "pending":
      return "Pending";
    case "paid":
      return "Paid";
    case "refunded":
      return "Refunded";
    case "failed":
      return "Failed";
    default:
      return status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }
}

export function formatProvider(name: string): string {
  switch (name) {
    case "cod":
      return "COD / Cash";
    case "shopify_payments":
      return "Shopify Payments";
    case "paypal":
      return "PayPal";
    case "razorpay":
      return "Razorpay";
    default:
      return name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }
}

/** PayPal API environment — never show raw enum like "SANDBOX". */
export function formatPayPalMode(mode: string | null | undefined): string {
  switch ((mode ?? "").toUpperCase()) {
    case "LIVE":
      return "Live";
    case "SANDBOX":
      return "Test";
    default:
      return "Not set";
  }
}

/**
 * Prefer the merchant's account name (label). Mode is only a short tag.
 * Example: "My Store PayPal · Test" or "Main Live · Live"
 */
export function formatPayPalAccountStatus(
  connected: boolean,
  mode: string | null | undefined,
  label?: string | null,
): string {
  if (!connected) return "Not connected";
  const env = formatPayPalMode(mode);
  const name = label?.trim() || "PayPal account";
  return `${name} · ${env}`;
}

/** Short local date/time for tables. */
export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}
