import { DeliveryMethod } from "@shopify/shopify-app-react-router/server";

/**
 * Shop-specific webhooks registered after OAuth (afterAuth hook).
 * These are NOT listed in shopify.app.toml because order/fulfillment/refund
 * topics contain protected customer data and block `shopify app dev` until
 * Protected Customer Data access is configured in the Partner Dashboard.
 *
 * Compliance webhooks remain in shopify.app.toml (app-specific subscriptions).
 */
export const paysyncShopWebhooks = {
  ORDERS_CREATE: {
    deliveryMethod: DeliveryMethod.Http,
    callbackUrl: "/webhooks/orders/create",
  },
  ORDERS_UPDATED: {
    deliveryMethod: DeliveryMethod.Http,
    callbackUrl: "/webhooks/orders/updated",
  },
  FULFILLMENTS_CREATE: {
    deliveryMethod: DeliveryMethod.Http,
    callbackUrl: "/webhooks/fulfillments/create",
  },
  FULFILLMENTS_UPDATE: {
    deliveryMethod: DeliveryMethod.Http,
    callbackUrl: "/webhooks/fulfillments/update",
  },
  REFUNDS_CREATE: {
    deliveryMethod: DeliveryMethod.Http,
    callbackUrl: "/webhooks/refunds/create",
  },
} as const;
