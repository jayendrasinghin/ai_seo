import {
  PAYSYNC_TAGS,
  PAYMENT_PROVIDER_TAGS,
  PAYMENT_STATUS_TAGS,
  type PaysyncTag,
} from "../lib/constants";

export function parseTags(tagsString: string | null | undefined): Set<string> {
  if (!tagsString?.trim()) return new Set();
  return new Set(
    tagsString
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean),
  );
}

export function serializeTags(tags: Set<string>): string {
  return Array.from(tags).sort().join(", ");
}

export function computeTagChanges(
  currentTags: Set<string>,
  desired: {
    add: PaysyncTag[];
    remove: PaysyncTag[];
  },
): { toAdd: PaysyncTag[]; toRemove: PaysyncTag[] } {
  const toAdd = desired.add.filter((t) => !currentTags.has(t));
  const toRemove = desired.remove.filter((t) => currentTags.has(t));
  return { toAdd, toRemove };
}

export function buildOrderTags(input: {
  paymentProvider: string;
  paymentStatus: string;
  trackingMissing: boolean;
  syncStatus?: string;
  partialShipment?: boolean;
}): { add: PaysyncTag[]; remove: PaysyncTag[] } {
  const add: PaysyncTag[] = ["PAYSYNC"];
  const remove: PaysyncTag[] = [];

  const providerTag =
    PAYMENT_PROVIDER_TAGS[input.paymentProvider] ?? "PAYMENT-OTHER";
  add.push(providerTag);

  for (const tag of Object.values(PAYMENT_PROVIDER_TAGS)) {
    if (tag !== providerTag) remove.push(tag);
  }

  const statusTag = paymentStatusToTag(input.paymentStatus);
  add.push(statusTag);
  for (const tag of PAYMENT_STATUS_TAGS) {
    if (tag !== statusTag) remove.push(tag);
  }

  if (input.trackingMissing) {
    add.push("TRACKING-MISSING");
  } else {
    remove.push("TRACKING-MISSING");
  }

  if (input.syncStatus === "synced") {
    add.push("TRACKING-SYNCED");
    remove.push("TRACKING-MISSING", "PAYSYNC-SYNC-FAILED", "PAYSYNC-ACTION-REQUIRED");
  }

  if (input.syncStatus === "needs_mapping") {
    add.push("PAYSYNC-ACTION-REQUIRED");
    remove.push("TRACKING-SYNCED");
  }

  if (input.syncStatus === "failed" || input.syncStatus === "failed_permanent") {
    add.push("PAYSYNC-SYNC-FAILED");
  }

  if (input.partialShipment) {
    add.push("PAYSYNC-PARTIAL-SHIPMENT");
  }

  const paysyncOnly = new Set<string>(PAYSYNC_TAGS);
  return {
    add: add.filter((t) => paysyncOnly.has(t)),
    remove: remove.filter((t) => paysyncOnly.has(t)),
  };
}

function paymentStatusToTag(
  status: string,
): (typeof PAYMENT_STATUS_TAGS)[number] {
  switch (status) {
    case "paid":
      return "PAYMENT-PAID";
    case "refunded":
      return "PAYMENT-REFUNDED";
    case "failed":
      return "PAYMENT-FAILED";
    default:
      return "PAYMENT-PENDING";
  }
}

export function mergeTagChanges(
  existing: string[],
  toAdd: string[],
  toRemove: string[],
): string[] {
  const set = new Set(existing);
  for (const t of toRemove) set.delete(t);
  for (const t of toAdd) set.add(t);
  return Array.from(set);
}
