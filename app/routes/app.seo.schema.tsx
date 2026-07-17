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
import { getOrCreateSeoSettings } from "../seo-settings.server";
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

  // shop is e.g. mycyberstores.myshopify.com
  const storeHandle = shop.replace(/\.myshopify\.com$/i, "");
  const apiKey = process.env.SHOPIFY_API_KEY || "";
  const extensionHandle = "seoi-seo-schema";

  // Deep-link into Online Store theme editor → App embeds (not the app nav).
  const themeEditorApps = apiKey
    ? `https://admin.shopify.com/store/${storeHandle}/themes/current/editor?context=apps&activateAppId=${apiKey}/${extensionHandle}`
    : `https://admin.shopify.com/store/${storeHandle}/themes/current/editor?context=apps`;

  return {
    suiteUnlocked: partnerDevelopment || planHasSeoSuite(getEffectivePlan(usage)),
    jsonLdEnabled: settings.jsonLdEnabled,
    themeEditorApps,
    storeHandle,
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
      data: { jsonLdEnabled: formData.get("jsonLdEnabled") === "on" },
    });
    return { status: "ok" as const, message: "Schema preference saved." };
  }
  return { status: "error" as const, message: "Unknown action." };
};

export default function SchemaPage() {
  const { jsonLdEnabled, themeEditorApps, suiteUnlocked } =
    useLoaderData<typeof loader>();
  const { search } = useLocation();
  const fetcher = useFetcher<typeof action>();
  const message = fetcher.data?.message;

  return (
    <s-page heading="JSON-LD Schema">
      <s-link slot="breadcrumb-actions" href={withEmbeddedSearch("/app/seo", search)}>
        SEO Suite
      </s-link>
      <ModernPageHeader
        eyebrow="Structured data"
        title="Help search engines understand your storefront."
        description="Publish product, breadcrumb, organization, and website JSON-LD through a lightweight theme app embed."
        status={jsonLdEnabled ? "Configured" : "Needs setup"}
      />

      <s-section>
        <s-text tone="caution">
          Theme embeds are not listed in this app’s left nav. They appear only in the Shopify
          theme editor under App embeds.
        </s-text>
        <s-text tone="neutral">
          The embed injects Product, BreadcrumbList, Organization, and WebSite JSON-LD into your
          storefront head.
        </s-text>
        {message ? <s-text tone="success">{message}</s-text> : null}
      </s-section>

      <s-section heading="Enable in theme (required)">
        <s-stack direction="block" gap="base">
          <s-text tone="caution">
            You opened Theme settings (Logo, Colors, Typography…). That is not App embeds.
          </s-text>
          <s-text>
            In the theme editor left menu bar there are usually <strong>3 icons</strong>:
          </s-text>
          <s-text>1. Sections (page layout)</s-text>
          <s-text>2. Theme settings gear ← you are here (Logo, Colors…)</s-text>
          <s-text>
            3. <strong>App embeds</strong> (puzzle / apps icon) ← click this one instead
          </s-text>
          <s-text>
            Then search for <strong>Seoi Product JSON-LD</strong>, toggle it ON, and Save.
          </s-text>
          <s-text>
            Keep <strong>shopify app dev</strong> running while testing locally.
          </s-text>
          <s-button href={themeEditorApps} target="_blank" variant="primary">
            Open theme editor
          </s-button>
          <s-text tone="neutral">
            Shortcut tip: in the theme editor, App embeds keyboard shortcut is often Ctrl/Cmd +
            Control + 3 (see Shopify theme editor shortcuts).
          </s-text>
          <s-text tone="neutral">
            If App embeds opens but Seoi is missing: the theme extension did not install on the
            store yet — restart <code>shopify app dev</code>, open the preview again, then refresh
            the theme editor.
          </s-text>
        </s-stack>
      </s-section>

      <s-section heading="In-app preference">
        <fetcher.Form method="post">
          <input type="hidden" name="intent" value="save" />
          <s-stack direction="block" gap="base">
            <label style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
              <input
                type="checkbox"
                name="jsonLdEnabled"
                defaultChecked={jsonLdEnabled}
                disabled={!suiteUnlocked}
              />
              Mark JSON-LD as part of my SEO setup
            </label>
            <s-button type="submit" disabled={!suiteUnlocked}>
              Save
            </s-button>
          </s-stack>
        </fetcher.Form>
        {!suiteUnlocked ? (
          <s-text tone="caution">
            Upgrade to manage SEO suite preferences.{" "}
            <EmbeddedNavLink hrefPathname="/app/billing/plans">
              View plans
            </EmbeddedNavLink>
          </s-text>
        ) : null}
      </s-section>
    </s-page>
  );
}

export function headers(args: Parameters<HeadersFunction>[0]) {
  return boundary.headers(args);
}
