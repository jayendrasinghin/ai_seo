import type { PaymentProvider } from "@prisma/client";
import { extractPayPalTransactionRefs } from "./paypal-transaction-refs";

const GATEWAY_MAP: Record<string, PaymentProvider> = {
  paypal: "paypal",
  "paypal express": "paypal",
  "paypal payments": "paypal",
  shopify_payments: "shopify_payments",
  "shopify payments": "shopify_payments",
  stripe: "stripe",
  "stripe card payments": "stripe",
  razorpay: "razorpay",
  cashfree: "cashfree",
  "cash on delivery": "cod",
  "cash on delivery (cod)": "cod",
  "cash on delivery(cod)": "cod",
  cash_on_delivery: "cod",
  cod: "cod",
  cash: "cod",
  "money order": "cod",
  "payment on delivery": "cod",
  "pay on delivery": "cod",
  pod: "cod",
  manual: "manual",
  bogus: "manual",
  "bank deposit": "manual",
  "money transfer": "manual",
};

/** More specific providers win over generic Shopify txn gateways like "manual". */
const PROVIDER_PRIORITY: PaymentProvider[] = [
  "paypal",
  "razorpay",
  "stripe",
  "cashfree",
  "shopify_payments",
  "cod",
  "manual",
  "other",
];

const GENERIC_GATEWAY = /^(manual|bogus)$/i;

export function normalizePaymentProvider(
  gateway: string | null | undefined,
): PaymentProvider {
  if (!gateway) return "other";
  const normalized = gateway.toLowerCase().trim();
  if (GATEWAY_MAP[normalized]) return GATEWAY_MAP[normalized];
  for (const [key, provider] of Object.entries(GATEWAY_MAP)) {
    if (normalized.includes(key)) return provider;
  }
  return "other";
}

/**
 * Collect gateway strings from Shopify order payloads.
 * COD / cash often list the real method in paymentGatewayNames while
 * transactions[].gateway is only "manual".
 */
export function collectOrderGateways(order: {
  paymentGatewayNames?: string[] | null;
  transactions?: Array<{ gateway?: string | null }>;
}): string[] {
  const out: string[] = [];
  for (const name of order.paymentGatewayNames ?? []) {
    const trimmed = name?.trim();
    if (trimmed) out.push(trimmed);
  }
  for (const txn of order.transactions ?? []) {
    const trimmed = txn.gateway?.trim();
    if (trimmed) out.push(trimmed);
  }
  return out;
}

/**
 * Resolve a single display gateway string (legacy helper).
 * Prefer a non-generic paymentGatewayNames entry over txn "manual".
 */
export function resolveOrderGateway(order: {
  paymentGatewayNames?: string[] | null;
  transactions?: Array<{ gateway?: string | null }>;
}): string | null {
  const names = (order.paymentGatewayNames ?? [])
    .map((n) => n?.trim())
    .filter((n): n is string => Boolean(n));
  const fromTxn =
    order.transactions?.find((t) => t.gateway?.trim())?.gateway?.trim() ??
    null;

  const specificName =
    names.find((n) => !GENERIC_GATEWAY.test(n)) ?? names[0] ?? null;

  if (specificName && (!fromTxn || GENERIC_GATEWAY.test(fromTxn))) {
    return specificName;
  }
  return fromTxn ?? specificName;
}

/**
 * Pick the best PaymentProvider from all gateway signals on the order.
 * Fixes: txn gateway "manual" + paymentGatewayNames "Cash on Delivery (COD)"
 * previously stored as `manual`, so the COD filter showed 0.
 */
export function resolvePaymentProvider(order: {
  paymentGatewayNames?: string[] | null;
  transactions?: Array<{ gateway?: string | null }>;
}): PaymentProvider {
  const gateways = collectOrderGateways(order);
  if (gateways.length === 0) return "other";

  const providers = gateways.map(normalizePaymentProvider);
  for (const preferred of PROVIDER_PRIORITY) {
    if (providers.includes(preferred)) return preferred;
  }
  return providers[0] ?? "other";
}

export function normalizePaymentStatus(
  displayFinancialStatus: string | null | undefined,
  transactions: Array<{ status: string; kind: string }> = [],
): string {
  const status = (displayFinancialStatus ?? "").toUpperCase();
  if (status === "PAID" || status === "PARTIALLY_PAID") return "paid";
  if (status === "REFUNDED" || status === "PARTIALLY_REFUNDED") return "refunded";
  if (status === "VOIDED") return "failed";

  const hasSuccessSale = transactions.some(
    (t) =>
      t.kind?.toLowerCase() === "sale" &&
      t.status?.toLowerCase() === "success",
  );
  if (hasSuccessSale) return "paid";

  const hasPending = transactions.some(
    (t) => t.status?.toLowerCase() === "pending",
  );
  if (hasPending) return "pending";

  if (status === "PENDING" || status === "AUTHORIZED") return "pending";
  return "pending";
}

export function paymentStatusTag(
  status: string,
): "PAYMENT-PAID" | "PAYMENT-PENDING" | "PAYMENT-REFUNDED" | "PAYMENT-FAILED" {
  switch (status) {
    case "paid":
      return "PAYMENT-PAID";
    case "refunded":
      return "PAYMENT-REFUNDED";
    case "failed":
      return "PAYMENT-FAILED";
    default:
      return "PAYMENT-PENDING";
  }
}

function extractRazorpayId(
  transactions: Array<{
    gateway?: string | null;
    authorizationCode?: string | null;
    receiptJson?: string | null;
    paymentId?: string | null;
  }>,
): string | null {
  const looksLikeRzp = (value: string) => /^(pay_|order_)/i.test(value);

  for (const tx of transactions) {
    const gateway = (tx.gateway ?? "").toLowerCase();
    if (tx.paymentId?.trim()) {
      const id = tx.paymentId.trim();
      if (looksLikeRzp(id) || gateway.includes("razorpay")) return id;
    }
    if (tx.authorizationCode?.trim() && looksLikeRzp(tx.authorizationCode.trim())) {
      return tx.authorizationCode.trim();
    }
    if (!tx.receiptJson) continue;
    try {
      const receipt = JSON.parse(tx.receiptJson) as Record<string, unknown>;
      for (const key of [
        "razorpay_payment_id",
        "payment_id",
        "razorpay_order_id",
        "order_id",
      ]) {
        const value = receipt[key];
        if (typeof value === "string" && value.trim()) return value.trim();
      }
    } catch {
      // ignore malformed receipt
    }
  }
  return null;
}

export function extractProviderOrderId(
  provider: PaymentProvider,
  transactions: Array<{
    gateway?: string | null;
    authorizationCode?: string | null;
    receiptJson?: string | null;
    paymentId?: string | null;
  }>,
): string | null {
  if (provider === "paypal") {
    const refs = extractPayPalTransactionRefs(transactions);
    return refs.orderIds[0] ?? null;
  }
  if (provider === "razorpay") {
    return extractRazorpayId(transactions);
  }
  return null;
}
