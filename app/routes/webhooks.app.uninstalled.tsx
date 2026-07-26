import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { shopRepository, paypalConnectionRepository, razorpayConnectionRepository } from "../repositories";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, session, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  // Webhook requests can trigger multiple times and after an app has already been uninstalled.
  // If this webhook already ran, the session may have been deleted previously.
  if (session) {
    await db.session.deleteMany({ where: { shop } });
  }

  // SEO data cleanup
  await db.indexNowLog.deleteMany({ where: { shop } });
  await db.brokenLinkIssue.deleteMany({ where: { shop } });
  await db.linkScanRun.deleteMany({ where: { shop } });
  await db.productDeleteRedirect.deleteMany({ where: { shop } });
  await db.imageOptimizeItem.deleteMany({ where: { shop } });
  await db.imageOptimizeRun.deleteMany({ where: { shop } });
  await db.seoSettings.deleteMany({ where: { shop } });
  await db.imageSeoIssue.deleteMany({ where: { shop } });
  await db.imageScanRun.deleteMany({ where: { shop } });
  await db.storeUsage.deleteMany({ where: { shop } });
  await db.supportMessage.deleteMany({ where: { shop } });

  // PaySync cleanup
  try {
    const shopRecord = await shopRepository.findByDomain(shop);
    if (shopRecord) {
      await paypalConnectionRepository.deleteByShopId(shopRecord.id);
      await razorpayConnectionRepository.deleteByShopId(shopRecord.id);
      await shopRepository.markUninstalled(shop);
    }
  } catch {
    // shop may not exist yet
  }

  return new Response();
};
