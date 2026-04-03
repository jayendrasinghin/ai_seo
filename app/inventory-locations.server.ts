import { randomUUID } from "node:crypto";

type GraphqlClient = {
  graphql: (
    query: string,
    init?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

export type ApplyInventoryResult =
  | { ok: true; locationsAdjusted: number }
  | { ok: false; message: string };

/**
 * Sets the same "available" quantity at every active shop location for one inventory item.
 * Activates new locations when needed, then applies deltas where levels already exist.
 */
export async function applyAvailableQuantityToAllLocations(
  admin: GraphqlClient,
  inventoryItemId: string,
  newQuantity: number,
): Promise<ApplyInventoryResult> {
  const locRes = await admin.graphql(
    `#graphql
      query InvLocActive {
        locations(first: 25, sortKey: NAME) {
          nodes {
            id
            isActive
          }
        }
      }`,
  );
  const locJson = (await locRes.json()) as {
    data?: {
      locations?: {
        nodes?: Array<{ id: string; isActive: boolean }>;
      };
    };
  };
  const activeLocs =
    locJson.data?.locations?.nodes?.filter((l) => l.isActive) ?? [];

  if (activeLocs.length === 0) {
    return {
      ok: false,
      message:
        "No active shop locations found. Add a location in Shopify Admin.",
    };
  }

  const levelsRes = await admin.graphql(
    `#graphql
      query ItemLevels($id: ID!) {
        inventoryItem(id: $id) {
          inventoryLevels(first: 25) {
            nodes {
              location {
                id
              }
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
  const levelNodes =
    levelsJson.data?.inventoryItem?.inventoryLevels?.nodes ?? [];
  const currentByLocation = new Map<string, number>();
  for (const n of levelNodes) {
    const locId = n.location?.id;
    if (!locId) continue;
    const entry = (n.quantities ?? []).find((q) => q.name === "available");
    currentByLocation.set(
      locId,
      typeof entry?.quantity === "number" ? entry.quantity : 0,
    );
  }

  const activations: Array<{ locationId: string; available: number }> = [];
  const changes: Array<{
    delta: number;
    inventoryItemId: string;
    locationId: string;
  }> = [];

  for (const loc of activeLocs) {
    const hasLevel = currentByLocation.has(loc.id);
    if (!hasLevel) {
      if (newQuantity > 0) {
        activations.push({ locationId: loc.id, available: newQuantity });
      }
      continue;
    }
    const current = currentByLocation.get(loc.id) ?? 0;
    const delta = newQuantity - current;
    if (delta !== 0) {
      changes.push({
        delta,
        inventoryItemId,
        locationId: loc.id,
      });
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
            userErrors {
              field
              message
            }
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
        inventoryActivate?: {
          userErrors?: Array<{ message: string }>;
        };
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
            userErrors {
              field
              message
            }
            inventoryAdjustmentGroup {
              id
            }
          }
        }`,
      {
        variables: {
          input: {
            name: "available",
            reason: "correction",
            referenceDocumentUri: `app://ai-product-descriptions-seo/inventory/${idemKey}`,
            changes,
          },
        },
      },
    );
    const adjustJson = await adjustRes.json();
    const userErrors =
      adjustJson.data?.inventoryAdjustQuantities?.userErrors ?? [];
    if (userErrors.length > 0) {
      return {
        ok: false,
        message: userErrors.map((e: { message: string }) => e.message).join(" "),
      };
    }
  }

  return {
    ok: true,
    locationsAdjusted: activations.length + changes.length,
  };
}
