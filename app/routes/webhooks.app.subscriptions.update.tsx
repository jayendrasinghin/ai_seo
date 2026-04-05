import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { syncStoreUsagePlanFromShopify } from "../billing.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, session, admin } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);

  if (!session || !admin) {
    return new Response();
  }

  await syncStoreUsagePlanFromShopify(admin, shop);
  return new Response();
};
