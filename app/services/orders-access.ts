import type { ShopifyAdminGraphQL } from "../clients/shopify/graphql";

/**
 * Shopify blocks Order queries until Protected Customer Data is approved,
 * even when read_orders is granted.
 */
export async function getOrdersAccessBlocker(
  admin: ShopifyAdminGraphQL,
): Promise<string | null> {
  try {
    const response = await admin.graphql(`#graphql
      query OrdersAccessProbe {
        orders(first: 1) {
          edges { node { id } }
        }
      }`);
    const json = (await response.json()) as {
      errors?: Array<{ message?: string }>;
    };
    const message = json.errors?.map((e) => e.message).filter(Boolean).join("; ");
    if (!message) return null;
    if (/protected customer data|not approved to access the Order|Access denied for orders/i.test(message)) {
      return (
        "Shopify blocked order access: enable Protected Customer Data (Orders) " +
        "in Partner Dashboard → API access, then reopen this app. " +
        "Until that is approved, COD / Razorpay / PayPal orders cannot import."
      );
    }
    return `Shopify orders API error: ${message}`;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/protected customer data|not approved to access the Order|Access denied for orders/i.test(message)) {
      return (
        "Shopify blocked order access: enable Protected Customer Data (Orders) " +
        "in Partner Dashboard → API access, then reopen this app. " +
        "Until that is approved, COD / Razorpay / PayPal orders cannot import."
      );
    }
    return `Shopify orders API error: ${message}`;
  }
}
