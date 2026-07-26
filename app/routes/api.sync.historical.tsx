import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { jsonResponse, withAdminAuth } from "../lib/api-helpers";
import { startHistoricalSync } from "../services/historical-sync";

const bodySchema = z.object({
  since: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
});

export const action = async ({ request }: ActionFunctionArgs) => {
  return withAdminAuth(request, async ({ shopDomain }) => {
    const body = bodySchema.parse(await request.json());
    const sinceIso = body.since.includes("T")
      ? body.since
      : `${body.since}T00:00:00.000Z`;

    const result = await startHistoricalSync(shopDomain, sinceIso);

    return jsonResponse({
      success: true,
      message: result.hasMore
        ? `Imported ${result.processed} orders so far — more pages queued (keep the worker running).`
        : `Imported ${result.processed} orders. Open Orders to view them.`,
      processed: result.processed,
      hasMore: result.hasMore,
    });
  });
};
