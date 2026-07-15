import { randomUUID } from "node:crypto";
import prisma from "./db.server";

export async function getOrCreateSeoSettings(shop: string) {
  const existing = await prisma.seoSettings.findUnique({ where: { shop } });
  if (existing) {
    if (!existing.indexNowKey) {
      return prisma.seoSettings.update({
        where: { shop },
        data: { indexNowKey: randomUUID().replace(/-/g, "") },
      });
    }
    return existing;
  }

  return prisma.seoSettings.create({
    data: {
      shop,
      indexNowKey: randomUUID().replace(/-/g, ""),
    },
  });
}

export function appProxyBasePath() {
  return "/apps/seoi";
}

/** Public storefront URLs served via app proxy. */
export function storefrontProxyUrl(shopDomain: string, path: string) {
  const host = shopDomain.replace(/\/$/, "");
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `https://${host}${appProxyBasePath()}${normalized}`;
}
