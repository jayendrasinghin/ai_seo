export interface PayPalTransactionRefs {
  /** Candidate PayPal checkout order IDs found in Shopify data */
  orderIds: string[];
  /** Capture IDs — resolved to order ID via PayPal API */
  captureIds: string[];
  /** Authorization IDs — resolved via PayPal API */
  authorizationIds: string[];
  /** Sale / transaction references */
  transactionIds: string[];
}

const ORDER_ID_KEYS = new Set([
  "paypal_order_id",
  "order_id",
  "parent_transaction_id",
]);

const CAPTURE_ID_KEYS = new Set([
  "capture_id",
  "transaction_id",
  "payment_id",
  "parent_id",
]);

const AUTH_ID_KEYS = new Set(["authorization_id", "auth_id"]);

function collectStrings(
  value: unknown,
  refs: PayPalTransactionRefs,
  depth = 0,
): void {
  if (depth > 8 || value == null) return;

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length >= 10) {
      refs.transactionIds.push(trimmed);
    }
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, refs, depth + 1);
    return;
  }

  if (typeof value === "object") {
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      const keyLower = key.toLowerCase();
      if (typeof nested === "string") {
        const v = nested.trim();
        if (!v) continue;
        if (ORDER_ID_KEYS.has(keyLower) || keyLower.includes("paypal_order")) {
          refs.orderIds.push(v);
        } else if (CAPTURE_ID_KEYS.has(keyLower) || keyLower.includes("capture")) {
          refs.captureIds.push(v);
        } else if (AUTH_ID_KEYS.has(keyLower) || keyLower.includes("authorization")) {
          refs.authorizationIds.push(v);
        } else if (
          keyLower.includes("transaction") ||
          keyLower === "id" ||
          keyLower === "paymentid"
        ) {
          refs.transactionIds.push(v);
        }
      } else {
        collectStrings(nested, refs, depth + 1);
      }
    }
  }
}

export function extractPayPalTransactionRefs(
  transactions: Array<{
    gateway?: string | null;
    authorizationCode?: string | null;
    receiptJson?: string | null;
    paymentId?: string | null;
  }>,
): PayPalTransactionRefs {
  const refs: PayPalTransactionRefs = {
    orderIds: [],
    captureIds: [],
    authorizationIds: [],
    transactionIds: [],
  };

  for (const tx of transactions) {
    const gateway = (tx.gateway ?? "").toLowerCase();
    if (gateway && !gateway.includes("paypal")) continue;

    if (tx.paymentId) refs.captureIds.push(tx.paymentId);
    if (tx.authorizationCode) refs.authorizationIds.push(tx.authorizationCode);

    if (tx.receiptJson) {
      try {
        collectStrings(JSON.parse(tx.receiptJson), refs);
      } catch {
        // ignore malformed receipt
      }
    }
  }

  const unique = (items: string[]) =>
    [...new Set(items.map((i) => i.trim()).filter(Boolean))];

  return {
    orderIds: unique(refs.orderIds),
    captureIds: unique(refs.captureIds),
    authorizationIds: unique(refs.authorizationIds),
    transactionIds: unique(refs.transactionIds),
  };
}