import type { ActionFunctionArgs } from "react-router";
import { DomainError } from "../lib/errors";
import { jsonResponse, withAdminAuth } from "../lib/api-helpers";
import { paypalConnectionRepository } from "../repositories";
import { PayPalClient } from "../clients/paypal/client";

export const action = async ({ request }: ActionFunctionArgs) => {
  return withAdminAuth(request, async ({ shopId }) => {
    const connection = await paypalConnectionRepository.findByShopId(shopId);
    if (!connection) {
      throw new DomainError("PAYPAL_NOT_CONNECTED");
    }

    const client = PayPalClient.fromEncrypted(
      shopId,
      connection.mode,
      connection.encryptedClientId,
      connection.encryptedClientSecret,
    );

    try {
      await client.testConnection();
      await paypalConnectionRepository.updateValidation(shopId, true);
      return jsonResponse({ success: true, message: "PayPal connection is working" });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Connection test failed";
      await paypalConnectionRepository.updateValidation(shopId, false, message);
      throw new DomainError("PAYPAL_AUTH_FAILED", { message });
    }
  });
};
