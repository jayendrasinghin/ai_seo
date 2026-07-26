import type { ActionFunctionArgs } from "react-router";
import { handleShopifyWebhook } from "../lib/api-helpers";

export const action = async ({ request }: ActionFunctionArgs) => {
  return handleShopifyWebhook(request, "refunds/create");
};
