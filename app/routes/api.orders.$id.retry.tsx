import type { ActionFunctionArgs } from "react-router";
import { DomainError } from "../lib/errors";
import { jsonResponse, withAdminAuth } from "../lib/api-helpers";
import { orderSyncRepository } from "../repositories";
import { retryShipmentSync } from "../services/paypal-sync";

export const action = async ({ request, params }: ActionFunctionArgs) => {
  return withAdminAuth(request, async ({ shopId }) => {
    const order = await orderSyncRepository.findById(params.id!);
    if (!order || order.shopId !== shopId) {
      throw new DomainError("NOT_FOUND");
    }

    for (const shipment of order.shipments) {
      if (["failed", "failed_permanent", "retrying"].includes(shipment.syncStatus)) {
        await retryShipmentSync(shipment.id);
      }
    }

    return jsonResponse({ success: true, message: "Retry queued for failed shipments" });
  });
};
