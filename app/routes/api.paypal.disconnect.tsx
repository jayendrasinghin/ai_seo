import type { ActionFunctionArgs } from "react-router";
import { jsonResponse, withAdminAuth } from "../lib/api-helpers";
import { paypalConnectionRepository } from "../repositories";

export const action = async ({ request }: ActionFunctionArgs) => {
  return withAdminAuth(request, async ({ shopId }) => {
    await paypalConnectionRepository.deleteByShopId(shopId);
    return jsonResponse({
      success: true,
      message: "PayPal disconnected. Credentials have been removed.",
    });
  });
};
