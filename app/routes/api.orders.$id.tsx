import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { DomainError } from "../lib/errors";
import { jsonResponse, withAdminAuth } from "../lib/api-helpers";
import { orderSyncRepository } from "../repositories";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  return withAdminAuth(request, async ({ shopId }) => {
    const order = await orderSyncRepository.findById(params.id!);
    if (!order || order.shopId !== shopId) {
      throw new DomainError("NOT_FOUND");
    }
    return jsonResponse({ order });
  });
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }
  return withAdminAuth(request, async ({ shopId }) => {
    const order = await orderSyncRepository.findById(params.id!);
    if (!order || order.shopId !== shopId) {
      throw new DomainError("NOT_FOUND");
    }
    const body = await request.json();
    const { retryShipmentSync } = await import("../services/paypal-sync");

    if (body.action === "retry" && body.shipmentSyncId) {
      await retryShipmentSync(body.shipmentSyncId);
      return jsonResponse({ success: true, message: "Retry queued" });
    }

    return jsonResponse({ error: "Unknown action" }, 400);
  });
};
