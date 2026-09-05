import { randomUUID } from "node:crypto";
import type { ApplyInventoryResult } from "./inventory-locations.server";

type GraphqlClient = {
  graphql: (
    query: string,
    init?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

export type InventoryChangeMode = "receive" | "set";

async function fetchCurrentByLocation(
  admin: GraphqlClient,
  inventoryItemId: string,
): Promise<Map<string, number>> {
  const levelsRes = await admin.graphql(
    `#graphql
      query ItemLevels($id: ID!) {
        inventoryItem(id: $id) {
          inventoryLevels(first: 25) {
            nodes {
              location { id }
              quantities(names: ["available"]) {
                name
                quantity
              }
            }
          }
        }
      }`,
    { variables: { id: inventoryItemId } },
  );
  const levelsJson = (await levelsRes.json()) as {
    data?: {
      inventoryItem?: {
        inventoryLevels?: {
          nodes?: Array<{
            location?: { id: string } | null;
            quantities?: Array<{ name?: string; quantity?: number }>;
          }>;
        };
      };
    };
  };
  const currentByLocation = new Map<string, number>();
  for (const n of levelsJson.data?.inventoryItem?.inventoryLevels?.nodes ?? []) {
    const locId = n.location?.id;
    if (!locId) continue;
    const entry = (n.quantities ?? []).find((q) => q.name === "available");
    currentByLocation.set(
      locId,
      typeof entry?.quantity === "number" ? entry.quantity : 0,
    );
  }
  return currentByLocation;
}

/**
 * Apply stock at selected locations only.
 * - receive: add `quantity` to available at each selected location
 * - set: set available to `quantity` at each selected location
 */
export async function applyInventoryAtLocations(
  admin: GraphqlClient,
  inventoryItemId: string,
  locationIds: string[],
  mode: InventoryChangeMode,
  quantity: number,
  referenceDocumentUri?: string,
): Promise<ApplyInventoryResult> {
  if (locationIds.length === 0) {
    return { ok: false, message: "Select at least one location." };
  }
  if (quantity < 0) {
    return { ok: false, message: "Quantity cannot be negative." };
  }
  if (mode === "receive" && quantity === 0) {
    return { ok: false, message: "Enter a quantity to receive." };
  }

  const currentByLocation = await fetchCurrentByLocation(admin, inventoryItemId);

  const activations: Array<{ locationId: string; available: number }> = [];
  const changes: Array<{
    delta: number;
    inventoryItemId: string;
    locationId: string;
  }> = [];

  for (const locationId of locationIds) {
    const hasLevel = currentByLocation.has(locationId);
    const current = currentByLocation.get(locationId) ?? 0;
    const target =
      mode === "receive" ? current + quantity : quantity;
    if (!hasLevel) {
      if (target > 0) {
        activations.push({ locationId, available: target });
      }
      continue;
    }
    const delta = target - current;
    if (delta !== 0) {
      changes.push({ delta, inventoryItemId, locationId });
    }
  }

  if (activations.length === 0 && changes.length === 0) {
    return { ok: true, locationsAdjusted: 0 };
  }

  for (const a of activations) {
    const actRes = await admin.graphql(
      `#graphql
        mutation InvActivate(
          $inventoryItemId: ID!
          $locationId: ID!
          $available: Int!
        ) {
          inventoryActivate(
            inventoryItemId: $inventoryItemId
            locationId: $locationId
            available: $available
          ) {
            userErrors { field message }
          }
        }`,
      {
        variables: {
          inventoryItemId,
          locationId: a.locationId,
          available: a.available,
        },
      },
    );
    const actJson = (await actRes.json()) as {
      data?: {
        inventoryActivate?: { userErrors?: Array<{ message: string }> };
      };
    };
    const actErrors = actJson.data?.inventoryActivate?.userErrors ?? [];
    if (actErrors.length > 0) {
      return { ok: false, message: actErrors.map((e) => e.message).join(" ") };
    }
  }

  if (changes.length > 0) {
    const idemKey = randomUUID();
    const adjustRes = await admin.graphql(
      `#graphql
        mutation AdjustInv($input: InventoryAdjustQuantitiesInput!) {
          inventoryAdjustQuantities(input: $input) {
            userErrors { field message }
            inventoryAdjustmentGroup { id }
          }
        }`,
      {
        variables: {
          input: {
            name: "available",
            reason: mode === "receive" ? "received" : "correction",
            referenceDocumentUri:
              referenceDocumentUri ??
              `app://ai-product-descriptions-seo/inventory/${idemKey}`,
            changes,
          },
        },
      },
    );
    const adjustJson = (await adjustRes.json()) as {
      data?: {
        inventoryAdjustQuantities?: {
          userErrors?: Array<{ message: string }>;
        };
      };
    };
    const userErrors =
      adjustJson.data?.inventoryAdjustQuantities?.userErrors ?? [];
    if (userErrors.length > 0) {
      return {
        ok: false,
        message: userErrors.map((e) => e.message).join(" "),
      };
    }
  }

  return {
    ok: true,
    locationsAdjusted: activations.length + changes.length,
  };
}

export function buildInvoiceReferenceUri(invoiceNumber: string): string {
  const safe = invoiceNumber.trim().replace(/[^\w.-]+/g, "-").slice(0, 80);
  return `gid://seoi/Invoice/${safe || "unknown"}`;
}

export async function updateVariantPrice(
  admin: GraphqlClient,
  productId: string,
  variantId: string,
  newPrice: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const res = await admin.graphql(
    `#graphql
      mutation ManageUpdateVariantPrice(
        $productId: ID!
        $variants: [ProductVariantsBulkInput!]!
      ) {
        productVariantsBulkUpdate(productId: $productId, variants: $variants) {
          userErrors { field message }
        }
      }`,
    {
      variables: {
        productId,
        variants: [{ id: variantId, price: newPrice }],
      },
    },
  );
  const json = (await res.json()) as {
    data?: {
      productVariantsBulkUpdate?: {
        userErrors?: Array<{ message: string }>;
      };
    };
  };
  const errors = json.data?.productVariantsBulkUpdate?.userErrors ?? [];
  if (errors.length > 0) {
    return { ok: false, message: errors.map((e) => e.message).join(" ") };
  }
  return { ok: true };
}
