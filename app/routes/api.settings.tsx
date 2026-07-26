import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { z } from "zod";
import { jsonResponse, withAdminAuth } from "../lib/api-helpers";
import { settingsRepository, shopRepository } from "../repositories";

const settingsSchema = z.object({
  autoTaggingEnabled: z.boolean().optional(),
  notifyBuyerDefault: z.boolean().optional(),
  tagUnfulfilledPhysical: z.boolean().optional(),
  dataRetentionDays: z.number().int().min(30).max(730).optional(),
  carrierMappings: z.record(z.string(), z.string()).optional(),
});

export const loader = async ({ request }: LoaderFunctionArgs) => {
  return withAdminAuth(request, async ({ shopId }) => {
    const settings = await shopRepository.getOrCreateSettings(shopId);
    return jsonResponse({ settings });
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  return withAdminAuth(request, async ({ shopId }) => {
    const body = settingsSchema.parse(await request.json());
    const settings = await settingsRepository.update(shopId, body);
    return jsonResponse({ success: true, settings });
  });
};
