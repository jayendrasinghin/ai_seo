export const ORDERS_LIST_QUERY = `#graphql
  query PaySyncOrdersList($query: String!, $first: Int!, $after: String) {
    orders(first: $first, after: $after, query: $query, sortKey: CREATED_AT) {
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
        node {
          id
          name
          createdAt
          tags
          displayFinancialStatus
          displayFulfillmentStatus
          requiresShipping
          paymentGatewayNames
          lineItems(first: 50) {
            edges {
              node {
                id
                name
                sku
                quantity
                requiresShipping
              }
            }
          }
          transactions(first: 20) {
            id
            gateway
            status
            kind
            authorizationCode
            paymentId
            receiptJson
          }
          fulfillments(first: 20) {
            id
            status
            trackingInfo {
              company
              number
              url
            }
            fulfillmentLineItems(first: 50) {
              edges {
                node {
                  id
                  quantity
                  lineItem { id name sku }
                }
              }
            }
          }
          metafields(first: 20, namespace: "paysync") {
            edges { node { key value type } }
          }
        }
      }
    }
  }
`;

export const ORDER_QUERY = `#graphql
  query PaySyncOrder($id: ID!) {
    order(id: $id) {
      id
      name
      createdAt
      tags
      displayFinancialStatus
      displayFulfillmentStatus
      requiresShipping
      paymentGatewayNames
      lineItems(first: 50) {
        edges {
          node {
            id
            name
            sku
            quantity
            requiresShipping
          }
        }
      }
      transactions(first: 20) {
        id
        gateway
        status
        kind
        authorizationCode
        paymentId
        receiptJson
      }
      fulfillments(first: 20) {
        id
        status
        trackingInfo {
          company
          number
          url
        }
        fulfillmentLineItems(first: 50) {
          edges {
            node {
              id
              quantity
              lineItem {
                id
                name
                sku
              }
            }
          }
        }
      }
      metafields(first: 20, namespace: "paysync") {
        edges {
          node {
            key
            value
            type
          }
        }
      }
    }
  }
`;

export const TAGS_ADD_MUTATION = `#graphql
  mutation PaySyncTagsAdd($id: ID!, $tags: [String!]!) {
    tagsAdd(id: $id, tags: $tags) {
      node {
        ... on Order {
          id
          tags
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export const TAGS_REMOVE_MUTATION = `#graphql
  mutation PaySyncTagsRemove($id: ID!, $tags: [String!]!) {
    tagsRemove(id: $id, tags: $tags) {
      node {
        ... on Order {
          id
          tags
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export const METAFIELDS_SET_MUTATION = `#graphql
  mutation PaySyncMetafieldsSet($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields {
        key
        namespace
        value
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export const METAFIELD_DEFINITIONS_CREATE = `#graphql
  mutation PaySyncMetafieldDefinitions($definitions: [MetafieldDefinitionInput!]!) {
    metafieldDefinitionCreate(definition: $definitions[0]) {
      createdDefinition {
        id
        name
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export interface ShopifyAdminGraphQL {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
}

export interface ShopifyOrder {
  id: string;
  name: string;
  createdAt?: string | null;
  tags: string[] | string;
  displayFinancialStatus: string | null;
  displayFulfillmentStatus: string | null;
  requiresShipping: boolean;
  paymentGatewayNames?: string[];
  customer?: { displayName?: string | null } | null;
  shippingAddress?: { name?: string | null } | null;
  lineItems: {
    edges: Array<{
      node: {
        id: string;
        name: string;
        sku: string | null;
        quantity: number;
        requiresShipping: boolean;
      };
    }>;
  };
  transactions: Array<{
    id: string;
    gateway: string | null;
    status: string;
    kind: string;
    authorizationCode: string | null;
    paymentId: string | null;
    receiptJson: string | null;
  }>;
  fulfillments: Array<{
    id: string;
    status: string;
    trackingInfo: Array<{
      company: string | null;
      number: string | null;
      url: string | null;
    }>;
    fulfillmentLineItems: {
      edges: Array<{
        node: {
          quantity: number;
          lineItem: { id: string; name: string; sku: string | null };
        };
      }>;
    };
  }>;
  metafields: {
    edges: Array<{ node: { key: string; value: string } }>;
  };
}

function isFatalGraphqlOrderError(error: {
  message: string;
  path?: Array<string | number>;
}): boolean {
  const msg = error.message || "";
  if (/not approved|ACCESS_DENIED|protected customer data/i.test(msg)) {
    // Nested fields (customer name, address) can be denied while order root is OK.
    return !error.path || error.path.length <= 1;
  }
  return true;
}

export function summarizeOrderItems(order: ShopifyOrder): string | null {
  const edges = order.lineItems?.edges ?? [];
  if (!edges.length) return null;
  const parts = edges.map((e) => {
    const qty = Number(e.node.quantity) || 1;
    return `${e.node.name} ×${qty}`;
  });
  if (parts.length <= 2) return parts.join(", ");
  return `${parts.slice(0, 2).join(", ")} +${parts.length - 2} more`;
}

export function resolveCustomerName(order: ShopifyOrder): string | null {
  const fromCustomer = order.customer?.displayName?.trim();
  if (fromCustomer) return fromCustomer;
  const fromShipping = order.shippingAddress?.name?.trim();
  return fromShipping || null;
}

export async function fetchOrder(
  admin: ShopifyAdminGraphQL,
  orderGid: string,
): Promise<ShopifyOrder | null> {
  const response = await admin.graphql(ORDER_QUERY, {
    variables: { id: orderGid },
  });
  const json = (await response.json()) as {
    data?: { order?: ShopifyOrder };
    errors?: Array<{ message: string; path?: Array<string | number> }>;
  };
  if (json.errors?.length) {
    const fatal = json.errors.filter(isFatalGraphqlOrderError);
    if (fatal.length) {
      throw new Error(fatal.map((e) => e.message).join("; "));
    }
  }
  return json.data?.order ?? null;
}

export async function fetchOrdersPage(
  admin: ShopifyAdminGraphQL,
  options: { query: string; first?: number; after?: string | null },
): Promise<{
  orders: ShopifyOrder[];
  hasNextPage: boolean;
  endCursor: string | null;
}> {
  const response = await admin.graphql(ORDERS_LIST_QUERY, {
    variables: {
      query: options.query,
      first: options.first ?? 25,
      after: options.after ?? null,
    },
  });
  const json = (await response.json()) as {
    data?: {
      orders?: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        edges: Array<{ node: ShopifyOrder }>;
      };
    };
    errors?: Array<{ message: string; path?: Array<string | number> }>;
  };
  if (json.errors?.length) {
    const fatal = json.errors.filter(isFatalGraphqlOrderError);
    if (fatal.length) {
      throw new Error(fatal.map((e) => e.message).join("; "));
    }
  }
  const connection = json.data?.orders;
  return {
    orders: connection?.edges.map((e) => e.node) ?? [],
    hasNextPage: connection?.pageInfo.hasNextPage ?? false,
    endCursor: connection?.pageInfo.endCursor ?? null,
  };
}

export async function addTags(
  admin: ShopifyAdminGraphQL,
  orderGid: string,
  tags: string[],
): Promise<void> {
  if (!tags.length) return;
  const response = await admin.graphql(TAGS_ADD_MUTATION, {
    variables: { id: orderGid, tags },
  });
  const json = (await response.json()) as {
    data?: { tagsAdd?: { userErrors: Array<{ message: string }> } };
  };
  const errors = json.data?.tagsAdd?.userErrors ?? [];
  if (errors.length) {
    throw new Error(errors.map((e) => e.message).join("; "));
  }
}

export async function removeTags(
  admin: ShopifyAdminGraphQL,
  orderGid: string,
  tags: string[],
): Promise<void> {
  if (!tags.length) return;
  const response = await admin.graphql(TAGS_REMOVE_MUTATION, {
    variables: { id: orderGid, tags },
  });
  const json = (await response.json()) as {
    data?: { tagsRemove?: { userErrors: Array<{ message: string }> } };
  };
  const errors = json.data?.tagsRemove?.userErrors ?? [];
  if (errors.length) {
    throw new Error(errors.map((e) => e.message).join("; "));
  }
}

export async function setOrderMetafields(
  admin: ShopifyAdminGraphQL,
  orderGid: string,
  fields: Record<string, string>,
): Promise<void> {
  const typeMap: Record<string, string> = {
    payment_provider: "single_line_text_field",
    payment_status: "single_line_text_field",
    provider_order_id: "single_line_text_field",
    provider_capture_id: "single_line_text_field",
    tracking_status: "single_line_text_field",
    sync_status: "single_line_text_field",
    last_synced_at: "date_time",
    last_error: "multi_line_text_field",
  };

  const metafields = Object.entries(fields)
    .filter(([, value]) => value !== "")
    .map(([key, value]) => ({
      ownerId: orderGid,
      namespace: "paysync",
      key,
      type: typeMap[key] ?? "single_line_text_field",
      value,
    }));

  if (!metafields.length) return;

  const response = await admin.graphql(METAFIELDS_SET_MUTATION, {
    variables: { metafields },
  });
  const json = (await response.json()) as {
    data?: { metafieldsSet?: { userErrors: Array<{ message: string }> } };
  };
  const errors = json.data?.metafieldsSet?.userErrors ?? [];
  if (errors.length) {
    throw new Error(errors.map((e) => e.message).join("; "));
  }
}

export function orderGidFromWebhook(payload: {
  admin_graphql_api_id?: string;
  id?: number | string;
}): string {
  if (payload.admin_graphql_api_id) return payload.admin_graphql_api_id;
  return `gid://shopify/Order/${payload.id}`;
}

export function fulfillmentGidFromWebhook(payload: {
  admin_graphql_api_id?: string;
  id?: number | string;
}): string {
  if (payload.admin_graphql_api_id) return payload.admin_graphql_api_id;
  return `gid://shopify/Fulfillment/${payload.id}`;
}
