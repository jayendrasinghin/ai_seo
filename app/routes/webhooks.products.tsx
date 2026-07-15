import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import {
  buildProductOnlineStoreUrl,
  maybeAutoPingProductUrl,
} from "../indexnow.server";
import { maybeAutoRedirectDeletedProduct } from "../auto-redirect.server";

/**
 * products/create + products/update → IndexNow
 * products/delete → auto 301 redirect
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload, admin } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  if (!admin) {
    return new Response();
  }

  const normalized = String(topic || "").toUpperCase().replace(/_/g, "/");

  try {
    if (normalized === "PRODUCTS/DELETE") {
      const product = payload as { handle?: string };
      await maybeAutoRedirectDeletedProduct(admin, shop, product.handle);
      return new Response();
    }

    if (
      normalized === "PRODUCTS/CREATE" ||
      normalized === "PRODUCTS/UPDATE"
    ) {
      const product = payload as {
        handle?: string;
        admin_graphql_api_id?: string;
      };

      const handle = product.handle;
      let onlineUrl: string | null = null;

      if (product.admin_graphql_api_id) {
        const response = await admin.graphql(
          `#graphql
            query IndexNowWebhookProduct($id: ID!) {
              product(id: $id) {
                handle
                onlineStoreUrl
              }
            }`,
          { variables: { id: product.admin_graphql_api_id } },
        );
        const json = (await response.json()) as {
          data?: {
            product?: { handle?: string; onlineStoreUrl?: string | null } | null;
          };
        };
        onlineUrl =
          json.data?.product?.onlineStoreUrl ||
          (await buildProductOnlineStoreUrl(
            shop,
            json.data?.product?.handle || handle,
            admin,
          ));
      } else {
        onlineUrl = await buildProductOnlineStoreUrl(shop, handle, admin);
      }

      await maybeAutoPingProductUrl(shop, onlineUrl);
    }
  } catch (error) {
    console.error("Products webhook failed", error);
  }

  return new Response();
};
