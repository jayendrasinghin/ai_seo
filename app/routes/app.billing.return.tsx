import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { authenticate } from "../shopify.server";
import { syncStoreUsagePlanFromShopify } from "../billing.server";
import { withEmbeddedSearch } from "../embedded-nav";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  await syncStoreUsagePlanFromShopify(admin, session.shop);

  const url = new URL(request.url);
  const next = withEmbeddedSearch("/app/billing/plans", url.search);
  const sep = next.includes("?") ? "&" : "?";
  return redirect(`${next}${sep}billing=return`);
};
