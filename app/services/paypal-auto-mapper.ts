import type { PayPalClient } from "../clients/paypal/client";
import { isValidPayPalOrderId } from "./carrier";
import { extractPayPalTransactionRefs } from "./paypal-transaction-refs";
import { providerMappingRepository } from "../repositories";
import { createChildLogger } from "../lib/logger";

const log = createChildLogger({ service: "paypal-auto-mapper" });

export type AutoMapSource =
  | "receipt_order_id"
  | "paypal_capture"
  | "paypal_authorization"
  | "paypal_transaction";

export interface AutoMapResult {
  paypalOrderId: string | null;
  source: AutoMapSource | null;
}

/**
 * Automatically discover PayPal checkout order ID from Shopify transaction data
 * and PayPal API lookups (capture / authorization / sale references).
 */
export async function autoMapPayPalOrderId(
  transactions: Array<{
    gateway?: string | null;
    authorizationCode?: string | null;
    receiptJson?: string | null;
    paymentId?: string | null;
  }>,
  paypalClient?: PayPalClient,
): Promise<AutoMapResult> {
  const refs = extractPayPalTransactionRefs(transactions);

  for (const candidate of refs.orderIds) {
    if (!isValidPayPalOrderId(candidate)) continue;
    const normalized = candidate.toUpperCase();
    if (paypalClient) {
      try {
        if (await paypalClient.getOrder(normalized)) {
          return { paypalOrderId: normalized, source: "receipt_order_id" };
        }
      } catch {
        continue;
      }
    } else {
      return { paypalOrderId: normalized, source: "receipt_order_id" };
    }
  }

  if (!paypalClient) {
    return { paypalOrderId: null, source: null };
  }

  for (const captureId of refs.captureIds) {
    const orderId = await paypalClient.resolveCheckoutOrderId(captureId);
    if (orderId && isValidPayPalOrderId(orderId)) {
      log.info({ captureId, orderId }, "Auto-mapped PayPal order from capture");
      return { paypalOrderId: orderId, source: "paypal_capture" };
    }
  }

  for (const authId of refs.authorizationIds) {
    const orderId = await paypalClient.resolveCheckoutOrderId(authId);
    if (orderId && isValidPayPalOrderId(orderId)) {
      log.info({ authId, orderId }, "Auto-mapped PayPal order from authorization");
      return { paypalOrderId: orderId, source: "paypal_authorization" };
    }
  }

  for (const txId of refs.transactionIds) {
    if (refs.orderIds.includes(txId) || refs.captureIds.includes(txId)) continue;
    const orderId = await paypalClient.resolveCheckoutOrderId(txId);
    if (orderId && isValidPayPalOrderId(orderId)) {
      log.info({ txId, orderId }, "Auto-mapped PayPal order from transaction ref");
      return { paypalOrderId: orderId, source: "paypal_transaction" };
    }
  }

  return { paypalOrderId: null, source: null };
}

export async function persistAutoMapping(
  shopId: string,
  shopifyOrderGid: string,
  paypalOrderId: string,
): Promise<void> {
  await providerMappingRepository.upsert({
    shopId,
    shopifyOrderGid,
    provider: "paypal",
    providerOrderId: paypalOrderId,
    mappingSource: "AUTO",
    verifiedAt: new Date(),
  });
}
