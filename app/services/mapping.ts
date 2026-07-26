import type { PaymentProvider } from "@prisma/client";
import { normalizePaymentProvider } from "./payment-provider";
import {
  orderSyncRepository,
  paypalConnectionRepository,
  providerMappingRepository,
} from "../repositories";
import { PayPalClient as PayPalClientClass, type PayPalClient } from "../clients/paypal/client";
import { isValidPayPalOrderId } from "./carrier";
import {
  autoMapPayPalOrderId,
  persistAutoMapping,
} from "./paypal-auto-mapper";

export interface MappingResult {
  providerOrderId: string | null;
  source:
    | "manual"
    | "stored"
    | "transaction"
    | "paypal_api"
    | "none";
}

export interface ResolvePayPalOptions {
  paypalClient?: PayPalClient;
  shopId?: string;
}

async function getPayPalClientForShop(shopId: string): Promise<PayPalClient | null> {
  const connection = await paypalConnectionRepository.findByShopId(shopId);
  if (!connection) return null;
  return PayPalClientClass.fromEncrypted(
    shopId,
    connection.mode,
    connection.encryptedClientId,
    connection.encryptedClientSecret,
  );
}

/**
 * Mapping priority:
 * 1. Manually confirmed PayPal mapping
 * 2. Stored app record from a previous sync
 * 3. Auto-map from Shopify receipt / PayPal API (capture, auth, transaction)
 * 4. None — merchant can still map manually
 */
export async function resolvePayPalOrderId(
  shopId: string,
  shopifyOrderGid: string,
  transactions: Array<{
    gateway?: string | null;
    authorizationCode?: string | null;
    receiptJson?: string | null;
    paymentId?: string | null;
  }>,
  options: ResolvePayPalOptions = {},
): Promise<MappingResult> {
  const manualMapping = await providerMappingRepository.findMapping(
    shopId,
    shopifyOrderGid,
    "paypal",
  );
  if (manualMapping?.mappingSource === "MANUAL" && manualMapping.providerOrderId) {
    return { providerOrderId: manualMapping.providerOrderId, source: "manual" };
  }

  const orderSync = await orderSyncRepository.findByShopifyGid(
    shopId,
    shopifyOrderGid,
  );
  if (orderSync?.providerOrderId && isValidPayPalOrderId(orderSync.providerOrderId)) {
    return { providerOrderId: orderSync.providerOrderId, source: "stored" };
  }

  if (manualMapping?.providerOrderId) {
    return { providerOrderId: manualMapping.providerOrderId, source: "manual" };
  }

  const paypalClient =
    options.paypalClient ?? (options.shopId ? await getPayPalClientForShop(shopId) : null);

  const auto = await autoMapPayPalOrderId(transactions, paypalClient ?? undefined);
  if (auto.paypalOrderId) {
    await persistAutoMapping(shopId, shopifyOrderGid, auto.paypalOrderId);
    return {
      providerOrderId: auto.paypalOrderId,
      source: auto.source === "receipt_order_id" ? "transaction" : "paypal_api",
    };
  }

  return { providerOrderId: null, source: "none" };
}

export async function saveManualPayPalMapping(
  shopId: string,
  shopifyOrderGid: string,
  paypalOrderId: string,
  mappedBy?: string,
): Promise<void> {
  if (!isValidPayPalOrderId(paypalOrderId)) {
    throw new Error("Invalid PayPal order ID format");
  }

  await providerMappingRepository.upsert({
    shopId,
    shopifyOrderGid,
    provider: "paypal",
    providerOrderId: paypalOrderId.trim().toUpperCase(),
    mappingSource: "MANUAL",
    mappedBy,
    verifiedAt: new Date(),
  });

  await orderSyncRepository.upsert({
    shopId,
    shopifyOrderGid,
    shopifyOrderName: "",
    paymentProvider: "paypal",
    paymentStatus: "paid",
    providerOrderId: paypalOrderId.trim().toUpperCase(),
    syncStatus: "pending",
  });
}

export function detectProviderFromTransactions(
  transactions: Array<{ gateway?: string | null }>,
): PaymentProvider {
  const gateway = transactions.find((t) => t.gateway)?.gateway ?? null;
  return normalizePaymentProvider(gateway);
}
