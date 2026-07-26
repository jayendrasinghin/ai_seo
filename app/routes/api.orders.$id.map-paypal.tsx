import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { DomainError } from "../lib/errors";
import { jsonResponse, withAdminAuth } from "../lib/api-helpers";
import { orderSyncRepository, paypalConnectionRepository } from "../repositories";
import { saveManualPayPalMapping } from "../services/mapping";
import { PayPalClient } from "../clients/paypal/client";

const mapSchema = z.object({
  paypalOrderId: z.string().min(10).max(20),
});

export const action = async ({ request, params }: ActionFunctionArgs) => {
  return withAdminAuth(request, async ({ shopId }) => {
    const order = await orderSyncRepository.findById(params.id!);
    if (!order || order.shopId !== shopId) {
      throw new DomainError("NOT_FOUND");
    }

    const body = mapSchema.parse(await request.json());

    const connection = await paypalConnectionRepository.findByShopId(shopId);
    if (connection) {
      const client = PayPalClient.fromEncrypted(
        shopId,
        connection.mode,
        connection.encryptedClientId,
        connection.encryptedClientSecret,
      );
      const exists = await client.getOrder(body.paypalOrderId);
      if (!exists) {
        throw new DomainError("PAYPAL_ORDER_NOT_FOUND");
      }
    }

    await saveManualPayPalMapping(
      shopId,
      order.shopifyOrderGid,
      body.paypalOrderId,
      "merchant",
    );

    await orderSyncRepository.upsert({
      shopId,
      shopifyOrderGid: order.shopifyOrderGid,
      shopifyOrderName: order.shopifyOrderName,
      paymentProvider: "paypal",
      paymentStatus: order.paymentStatus,
      providerOrderId: body.paypalOrderId.toUpperCase(),
      syncStatus: "pending",
    });

    return jsonResponse({
      success: true,
      message: "PayPal order mapped successfully",
    });
  });
};
