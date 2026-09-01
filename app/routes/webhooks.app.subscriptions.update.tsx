import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { syncStoreUsagePlanFromShopify } from "../billing.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, session, admin } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);

  if (admin && shop) {
    await syncStoreUsagePlanFromShopify(admin, shop);
  } else if (session && shop) {
    console.warn(
      `[webhook] ${topic} for ${shop}: no admin context — plan syncs on next app open`,
    );
  }

  return new Response();
};
