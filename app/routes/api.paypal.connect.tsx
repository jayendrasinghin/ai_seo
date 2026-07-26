import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { z } from "zod";
import { encrypt } from "../lib/encryption";
import { DomainError } from "../lib/errors";
import { jsonResponse, withAdminAuth } from "../lib/api-helpers";
import { paypalConnectionRepository } from "../repositories";
import { PayPalClient } from "../clients/paypal/client";
import type { PayPalMode } from "@prisma/client";

const connectSchema = z.object({
  mode: z.enum(["SANDBOX", "LIVE"]),
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
});

export const loader = async ({ request }: LoaderFunctionArgs) => {
  return withAdminAuth(request, async ({ shopId }) => {
    const connection = await paypalConnectionRepository.findByShopId(shopId);
    return jsonResponse({
      connected: !!connection,
      mode: connection?.mode ?? null,
      connectedAt: connection?.connectedAt ?? null,
      lastValidatedAt: connection?.lastValidatedAt ?? null,
      lastValidationError: connection?.lastValidationError ?? null,
    });
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  return withAdminAuth(request, async ({ shopId }) => {
    const body = connectSchema.parse(await request.json());

    const encryptedClientId = encrypt(body.clientId);
    const encryptedClientSecret = encrypt(body.clientSecret);

    const connection = await paypalConnectionRepository.upsert(shopId, {
      mode: body.mode as PayPalMode,
      encryptedClientId,
      encryptedClientSecret,
    });

    const client = PayPalClient.fromEncrypted(
      shopId,
      connection.mode,
      connection.encryptedClientId,
      connection.encryptedClientSecret,
    );

    try {
      await client.testConnection();
      await paypalConnectionRepository.updateValidation(shopId, true);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Connection test failed";
      await paypalConnectionRepository.updateValidation(shopId, false, message);
      throw new DomainError("PAYPAL_AUTH_FAILED", { message });
    }

    return jsonResponse({
      success: true,
      message: "PayPal connected successfully",
      mode: connection.mode,
    });
  });
};
