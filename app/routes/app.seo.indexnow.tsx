import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData, useLocation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { withEmbeddedSearch } from "../embedded-nav";
import { EmbeddedNavLink } from "../embedded-nav-link";
import {
  getOrCreateSeoSettings,
  storefrontProxyUrl,
} from "../seo-settings.server";
import {
  buildProductOnlineStoreUrl,
  submitUrlsToIndexNow,
} from "../indexnow.server";
import { getEffectivePlan, planHasSeoSuite } from "../plan-helpers";
import prisma from "../db.server";
import { isPartnerDevelopmentStore } from "../billing.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;
  const partnerDevelopment = await isPartnerDevelopmentStore(admin);
  const usage = await prisma.storeUsage.upsert({
    where: { shop },
    update: {},
    create: { shop },
  });
  const settings = await getOrCreateSeoSettings(shop);
  const logs = await prisma.indexNowLog.findMany({
    where: { shop },
    orderBy: { createdAt: "desc" },
    take: 25,
  });

  return {
    shop,
    suiteUnlocked: partnerDevelopment || planHasSeoSuite(getEffectivePlan(usage)),
    settings: {
      indexNowEnabled: settings.indexNowEnabled,
      indexNowAutoPing: settings.indexNowAutoPing,
      indexNowKey: settings.indexNowKey,
    },
    keyUrl: storefrontProxyUrl(shop, "/indexnow-key.txt"),
    logs,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;
  const partnerDevelopment = await isPartnerDevelopmentStore(admin);
  const usage = await prisma.storeUsage.findUnique({ where: { shop } });
  if (!partnerDevelopment && !planHasSeoSuite(getEffectivePlan({ plan: usage?.plan ?? "free", foundingMember: usage?.foundingMember ?? false, foundingMemberNumber: usage?.foundingMemberNumber ?? null, foundingGrantedAt: usage?.foundingGrantedAt ?? null, foundingExpiresAt: usage?.foundingExpiresAt ?? null }))) {
    return { status: "error" as const, message: "Upgrade required." };
  }

  const formData = await request.formData();
  const intent = String(formData.get("intent") || "");

  if (intent === "save") {
    await prisma.seoSettings.update({
      where: { shop },
      data: {
        indexNowEnabled: formData.get("indexNowEnabled") === "on",
        indexNowAutoPing: formData.get("indexNowAutoPing") === "on",
      },
    });
    return { status: "ok" as const, message: "IndexNow settings saved." };
  }

  if (intent === "ping_url") {
    const url = String(formData.get("url") || "").trim();
    if (!/^https?:\/\//i.test(url)) {
      return { status: "error" as const, message: "Enter a full https URL." };
    }
    const result = await submitUrlsToIndexNow(shop, [url]);
    return {
      status: result.ok ? ("ok" as const) : ("error" as const),
      message: result.message,
    };
  }

  if (intent === "ping_recent_products") {
    const response = await admin.graphql(
      `#graphql
        query IndexNowRecentProducts {
          products(first: 10, sortKey: UPDATED_AT, reverse: true) {
            nodes {
              handle
              onlineStoreUrl
            }
          }
        }`,
    );
    const json = (await response.json()) as {
      data?: {
        products?: {
          nodes?: Array<{ handle?: string; onlineStoreUrl?: string | null }>;
        };
      };
    };

    const urls: string[] = [];
    for (const p of json.data?.products?.nodes ?? []) {
      const url =
        p.onlineStoreUrl ||
        (await buildProductOnlineStoreUrl(shop, p.handle ?? null, admin));
      if (url) urls.push(url);
    }

    const result = await submitUrlsToIndexNow(shop, urls);
    return {
      status: result.ok ? ("ok" as const) : ("error" as const),
      message: result.message,
    };
  }

  return { status: "error" as const, message: "Unknown action." };
};

export default function IndexNowPage() {
  const { settings, keyUrl, logs, suiteUnlocked } = useLoaderData<typeof loader>();
  const { search } = useLocation();
  const fetcher = useFetcher<typeof action>();
  const message = fetcher.data?.message;
  const tone = fetcher.data?.status === "error" ? "critical" : "success";

  return (
    <s-page heading="IndexNow">
      <s-link slot="breadcrumb-actions" href={withEmbeddedSearch("/app/seo", search)}>
        SEO Suite
      </s-link>

      <s-section>
        <s-text tone="neutral">
          Submit product URLs to IndexNow so Bing and Yandex can crawl updates faster.
          Host the key file on your store, then enable auto-ping.
        </s-text>
        {!suiteUnlocked ? (
          <s-text tone="caution">
            Upgrade to a paid plan to enable IndexNow submissions.{" "}
            <EmbeddedNavLink hrefPathname="/app/billing/plans">
              View plans
            </EmbeddedNavLink>
          </s-text>
        ) : null}
        {message ? <s-text tone={tone}>{message}</s-text> : null}
      </s-section>

      <s-section heading="Settings">
        <fetcher.Form method="post">
          <input type="hidden" name="intent" value="save" />
          <s-stack direction="block" gap="base">
            <label style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
              <input
                type="checkbox"
                name="indexNowEnabled"
                defaultChecked={settings.indexNowEnabled}
                disabled={!suiteUnlocked}
              />
              Enable IndexNow
            </label>
            <label style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
              <input
                type="checkbox"
                name="indexNowAutoPing"
                defaultChecked={settings.indexNowAutoPing}
                disabled={!suiteUnlocked}
              />
              Auto-ping when products are created or updated
            </label>
            <s-text tone="neutral">
              Key file URL:{" "}
              <a href={keyUrl} target="_blank" rel="noreferrer">
                {keyUrl}
              </a>
            </s-text>
            <s-text tone="neutral">Key: {settings.indexNowKey}</s-text>
            <s-button type="submit" variant="primary" disabled={!suiteUnlocked}>
              Save settings
            </s-button>
          </s-stack>
        </fetcher.Form>
      </s-section>

      <s-section heading="Manual submit">
        <fetcher.Form method="post">
          <input type="hidden" name="intent" value="ping_url" />
          <s-stack direction="block" gap="base">
            <s-text-field
              name="url"
              label="Product or page URL"
              placeholder="https://your-store.com/products/example"
            />
            <s-button type="submit" disabled={!suiteUnlocked || !settings.indexNowEnabled}>
              Submit URL
            </s-button>
          </s-stack>
        </fetcher.Form>
        <div style={{ marginTop: "1rem" }}>
          <fetcher.Form method="post">
            <input type="hidden" name="intent" value="ping_recent_products" />
            <s-button type="submit" disabled={!suiteUnlocked || !settings.indexNowEnabled}>
              Submit 10 recently updated products
            </s-button>
          </fetcher.Form>
        </div>
      </s-section>

      <s-section heading="Recent submissions">
        {logs.length === 0 ? (
          <s-text tone="neutral">No submissions yet.</s-text>
        ) : (
          <s-stack direction="block" gap="small-200">
            {logs.map((log) => (
              <s-box key={log.id} padding="small-200" borderWidth="base" borderRadius="base">
                <s-text>
                  {log.status === "success" ? "OK" : "ERR"} — {log.url}
                </s-text>
                <s-text tone="neutral">
                  {log.message} · {new Date(log.createdAt).toLocaleString()}
                </s-text>
              </s-box>
            ))}
          </s-stack>
        )}
      </s-section>
    </s-page>
  );
}

export function headers(args: Parameters<HeadersFunction>[0]) {
  return boundary.headers(args);
}
