import type { LoaderFunctionArgs } from "react-router";
import { jsonResponse, withAdminAuth } from "../lib/api-helpers";
import { orderSyncRepository } from "../repositories";
import type { PaymentProvider, SyncStatus } from "@prisma/client";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  return withAdminAuth(request, async ({ shopId }) => {
    const url = new URL(request.url);
    const provider = url.searchParams.get("provider") as PaymentProvider | null;
    const syncStatus = url.searchParams.get("syncStatus") as SyncStatus | null;
    const paymentStatus = url.searchParams.get("paymentStatus");
    const search = url.searchParams.get("search") ?? undefined;
    const failuresOnly = url.searchParams.get("failuresOnly") === "true";
    const needsMappingOnly = url.searchParams.get("needsMappingOnly") === "true";
    const page = parseInt(url.searchParams.get("page") ?? "1", 10);
    const take = 25;

    const result = await orderSyncRepository.list(shopId, {
      provider: provider ?? undefined,
      syncStatus: syncStatus ?? undefined,
      paymentStatus: paymentStatus ?? undefined,
      search,
      failuresOnly,
      needsMappingOnly,
      skip: (page - 1) * take,
      take,
    });

    return jsonResponse({
      orders: result.items,
      total: result.total,
      page,
      pageSize: take,
    });
  });
};
