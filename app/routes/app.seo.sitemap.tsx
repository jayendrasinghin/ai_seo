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
import { ModernPageHeader } from "../ModernPageHeader";
import { SeoHomeButton } from "../HomeButton";
import {
  getOrCreateSeoSettings,
  storefrontProxyUrl,
} from "../seo-settings.server";
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

  return {
    suiteUnlocked: partnerDevelopment || planHasSeoSuite(getEffectivePlan(usage)),
    settings: {
      sitemapEnabled: settings.sitemapEnabled,
      llmsTxtEnabled: settings.llmsTxtEnabled,
      llmsTxtCustom: settings.llmsTxtCustom || "",
    },
    urls: {
      sitemap: storefrontProxyUrl(shop, "/sitemap"),
      llms: storefrontProxyUrl(shop, "/llms.txt"),
    },
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
    const custom = String(formData.get("llmsTxtCustom") || "");
    await prisma.seoSettings.update({
      where: { shop },
      data: {
        sitemapEnabled: formData.get("sitemapEnabled") === "on",
        llmsTxtEnabled: formData.get("llmsTxtEnabled") === "on",
        llmsTxtCustom: custom.trim() ? custom : null,
      },
    });
    return { status: "ok" as const, message: "Sitemap & llms.txt settings saved." };
  }
  return { status: "error" as const, message: "Unknown action." };
};

export default function SitemapSettingsPage() {
  const { settings, urls, suiteUnlocked } = useLoaderData<typeof loader>();
  const { search } = useLocation();
  const fetcher = useFetcher<typeof action>();
  const message = fetcher.data?.message;

  return (
    <s-page heading="Sitemap & llms.txt">
      <SeoHomeButton />
      <s-link slot="breadcrumb-actions" href={withEmbeddedSearch("/app/seo", search)}>
        SEO Suite
      </s-link>
      <ModernPageHeader
        eyebrow="Store discovery"
        title="Make your catalog easier to understand."
        description="Publish a human-friendly sitemap and an AI-readable llms.txt file from your storefront domain."
        status={settings.sitemapEnabled || settings.llmsTxtEnabled ? "Publishing enabled" : "Disabled"}
      />

      <s-section>
        <s-text tone="neutral">
          Publish an HTML sitemap for humans/crawlers and an llms.txt file so AI assistants can
          discover your catalog cleanly.
        </s-text>
        {message ? <s-text tone="success">{message}</s-text> : null}
        {!suiteUnlocked ? (
          <s-text tone="caution">
            Upgrade to change these settings.{" "}
            <EmbeddedNavLink hrefPathname="/app/billing/plans">
              View plans
            </EmbeddedNavLink>
          </s-text>
        ) : null}
      </s-section>

      <s-section heading="Public URLs">
        <s-stack direction="block" gap="small-200">
          <s-text>
            HTML sitemap:{" "}
            <a href={urls.sitemap} target="_blank" rel="noreferrer">
              {urls.sitemap}
            </a>
          </s-text>
          <s-text>
            llms.txt:{" "}
            <a href={urls.llms} target="_blank" rel="noreferrer">
              {urls.llms}
            </a>
          </s-text>
        </s-stack>
      </s-section>

      <s-section heading="Settings">
        <fetcher.Form method="post">
          <input type="hidden" name="intent" value="save" />
          <s-stack direction="block" gap="base">
            <label style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
              <input
                type="checkbox"
                name="sitemapEnabled"
                defaultChecked={settings.sitemapEnabled}
                disabled={!suiteUnlocked}
              />
              Enable HTML sitemap
            </label>
            <label style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
              <input
                type="checkbox"
                name="llmsTxtEnabled"
                defaultChecked={settings.llmsTxtEnabled}
                disabled={!suiteUnlocked}
              />
              Enable llms.txt
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
              <span>Custom llms.txt (optional)</span>
              <textarea
                name="llmsTxtCustom"
                rows={12}
                defaultValue={settings.llmsTxtCustom}
                disabled={!suiteUnlocked}
                style={{
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                  fontSize: "0.85rem",
                  padding: "0.75rem",
                  borderRadius: "8px",
                  border: "1px solid #ccc",
                  width: "100%",
                }}
                placeholder="Leave blank to auto-generate from products & collections."
              />
            </label>
            <s-button type="submit" variant="primary" disabled={!suiteUnlocked}>
              Save
            </s-button>
          </s-stack>
        </fetcher.Form>
      </s-section>
    </s-page>
  );
}

export function headers(args: Parameters<HeadersFunction>[0]) {
  return boundary.headers(args);
}
