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
import { getOrCreateSeoSettings } from "../seo-settings.server";
import { planHasSeoSuite } from "../plan-helpers";
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
  const storeHandle = shop.replace(/\.myshopify\.com$/i, "");
  const apiKey = process.env.SHOPIFY_API_KEY || "";

  return {
    suiteUnlocked: partnerDevelopment || planHasSeoSuite(usage.plan),
    settings: {
      lazyLoadEnabled: settings.lazyLoadEnabled,
      assetPreloadEnabled: settings.assetPreloadEnabled,
      scriptDeferEnabled: settings.scriptDeferEnabled,
    },
    themeEditorApps: apiKey
      ? `https://admin.shopify.com/store/${storeHandle}/themes/current/editor?context=apps&activateAppId=${apiKey}/seoi-seo-schema`
      : `https://admin.shopify.com/store/${storeHandle}/themes/current/editor?context=apps`,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;
  const partnerDevelopment = await isPartnerDevelopmentStore(admin);
  const usage = await prisma.storeUsage.findUnique({ where: { shop } });
  if (!partnerDevelopment && !planHasSeoSuite(usage?.plan ?? "free")) {
    return { status: "error" as const, message: "Upgrade required." };
  }

  const formData = await request.formData();
  if (String(formData.get("intent") || "") !== "save") {
    return { status: "error" as const, message: "Unknown action." };
  }

  await prisma.seoSettings.update({
    where: { shop },
    data: {
      lazyLoadEnabled: formData.get("lazyLoadEnabled") === "on",
      assetPreloadEnabled: formData.get("assetPreloadEnabled") === "on",
      scriptDeferEnabled: formData.get("scriptDeferEnabled") === "on",
    },
  });

  return { status: "ok" as const, message: "Speed preferences saved." };
};

export default function SpeedPage() {
  const { settings, themeEditorApps, suiteUnlocked } =
    useLoaderData<typeof loader>();
  const { search } = useLocation();
  const fetcher = useFetcher<typeof action>();
  const message = fetcher.data?.message;

  return (
    <s-page heading="Page speed">
      <s-link slot="breadcrumb-actions" href={withEmbeddedSearch("/app/seo", search)}>
        SEO Suite
      </s-link>

      <s-section>
        <s-text tone="neutral">
          Phase 3 speed tools: lazy-load images, hero preload, and soft defer for known
          third-party scripts via a theme App embed.
        </s-text>
        {message ? <s-text tone="success">{message}</s-text> : null}
      </s-section>

      <s-section heading="Enable in theme">
        <s-stack direction="block" gap="base">
          <s-text>
            1. Theme editor → App embeds → turn on <strong>Speed Boost</strong>
          </s-text>
          <s-text>2. Save the theme</s-text>
          <s-button href={themeEditorApps} target="_blank" variant="primary">
            Open App embeds
          </s-button>
        </s-stack>
      </s-section>

      <s-section heading="Preferences">
        <fetcher.Form method="post">
          <input type="hidden" name="intent" value="save" />
          <s-stack direction="block" gap="base">
            <label style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
              <input
                type="checkbox"
                name="lazyLoadEnabled"
                defaultChecked={settings.lazyLoadEnabled}
                disabled={!suiteUnlocked}
              />
              Lazy-load below-fold images
            </label>
            <label style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
              <input
                type="checkbox"
                name="assetPreloadEnabled"
                defaultChecked={settings.assetPreloadEnabled}
                disabled={!suiteUnlocked}
              />
              Preload hero image + DNS prefetch
            </label>
            <label style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
              <input
                type="checkbox"
                name="scriptDeferEnabled"
                defaultChecked={settings.scriptDeferEnabled}
                disabled={!suiteUnlocked}
              />
              Defer known analytics scripts
            </label>
            <s-text tone="neutral">
              Match these toggles in the Speed Boost embed settings for consistent guidance.
            </s-text>
            <s-button type="submit" disabled={!suiteUnlocked}>
              Save
            </s-button>
          </s-stack>
        </fetcher.Form>
        {!suiteUnlocked ? (
          <s-text tone="caution">
            Upgrade required.{" "}
            <EmbeddedNavLink hrefPathname="/app/billing/plans">View plans</EmbeddedNavLink>
          </s-text>
        ) : null}
      </s-section>
    </s-page>
  );
}

export function headers(args: Parameters<HeadersFunction>[0]) {
  return boundary.headers(args);
}
