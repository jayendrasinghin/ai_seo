import prisma from "./db.server";
import { getOrCreateSeoSettings, storefrontProxyUrl } from "./seo-settings.server";

const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";

type SubmitResult = {
  ok: boolean;
  status: number;
  message: string;
};

function shopHost(shop: string) {
  return shop.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

/**
 * Submit one or more absolute URLs to IndexNow (Bing, Yandex, etc.).
 * Key file is served at /apps/seoi/indexnow-key.txt via app proxy.
 */
export async function submitUrlsToIndexNow(
  shop: string,
  urls: string[],
): Promise<SubmitResult> {
  const settings = await getOrCreateSeoSettings(shop);
  if (!settings.indexNowEnabled) {
    return { ok: false, status: 0, message: "IndexNow is disabled for this shop." };
  }
  if (!settings.indexNowKey) {
    return { ok: false, status: 0, message: "IndexNow key is missing." };
  }

  const uniqueUrls = [...new Set(urls.filter(Boolean))];
  if (uniqueUrls.length === 0) {
    return { ok: false, status: 0, message: "No URLs to submit." };
  }

  const host = shopHost(shop);
  const keyLocation = storefrontProxyUrl(shop, "/indexnow-key.txt");

  const body = {
    host,
    key: settings.indexNowKey,
    keyLocation,
    urlList: uniqueUrls.slice(0, 10000),
  };

  try {
    const response = await fetch(INDEXNOW_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(body),
    });

    const ok = response.status === 200 || response.status === 202;
    const message = ok
      ? `Submitted ${uniqueUrls.length} URL(s) (HTTP ${response.status}).`
      : `IndexNow rejected request (HTTP ${response.status}).`;

    await prisma.indexNowLog.createMany({
      data: uniqueUrls.map((url) => ({
        shop,
        url,
        status: ok ? "success" : "error",
        message,
      })),
    });

    // Keep log lean: drop older than 200 rows.
    const old = await prisma.indexNowLog.findMany({
      where: { shop },
      orderBy: { createdAt: "desc" },
      skip: 200,
      select: { id: true },
    });
    if (old.length > 0) {
      await prisma.indexNowLog.deleteMany({
        where: { id: { in: old.map((r) => r.id) } },
      });
    }

    return { ok, status: response.status, message };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "IndexNow request failed.";
    await prisma.indexNowLog.create({
      data: {
        shop,
        url: uniqueUrls[0] ?? "",
        status: "error",
        message,
      },
    });
    return { ok: false, status: 0, message };
  }
}

export async function maybeAutoPingProductUrl(
  shop: string,
  productOnlineStoreUrl: string | null | undefined,
) {
  if (!productOnlineStoreUrl) return;
  const settings = await getOrCreateSeoSettings(shop);
  if (!settings.indexNowEnabled || !settings.indexNowAutoPing) return;
  await submitUrlsToIndexNow(shop, [productOnlineStoreUrl]);
}

export async function buildProductOnlineStoreUrl(
  shop: string,
  handle: string | null | undefined,
  admin: { graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response> },
): Promise<string | null> {
  if (!handle) return null;

  const response = await admin.graphql(
    `#graphql
      query IndexNowShopPrimaryDomain {
        shop {
          primaryDomain {
            url
          }
          myshopifyDomain
        }
      }`,
  );
  const json = (await response.json()) as {
    data?: {
      shop?: {
        primaryDomain?: { url?: string | null } | null;
        myshopifyDomain?: string | null;
      };
    };
  };

  const base =
    json.data?.shop?.primaryDomain?.url?.replace(/\/$/, "") ||
    `https://${json.data?.shop?.myshopifyDomain || shop}`;

  return `${base}/products/${handle}`;
}
