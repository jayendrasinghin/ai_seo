import type { LoaderFunctionArgs } from "react-router";
import { jsonResponse, withAdminAuth } from "../lib/api-helpers";
import { shipmentSyncRepository } from "../repositories";
import type { SyncStatus } from "@prisma/client";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  return withAdminAuth(request, async ({ shopId }) => {
    const url = new URL(request.url);
    const status = url.searchParams.get("status") as SyncStatus | null;
    const items = await shipmentSyncRepository.listQueue(
      shopId,
      status ?? undefined,
    );
    return jsonResponse({ items });
  });
};
