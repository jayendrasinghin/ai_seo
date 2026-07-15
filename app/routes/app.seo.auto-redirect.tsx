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
  const recent = await prisma.productDeleteRedirect.findMany({
    where: { shop },
    orderBy: { createdAt: "desc" },
    take: 30,
  });

  return {
    suiteUnlocked: partnerDevelopment || planHasSeoSuite(usage.plan),
    settings: {
      autoRedirectOnDelete: settings.autoRedirectOnDelete,
      autoRedirectTarget: settings.autoRedirectTarget,
    },
    recent,
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
  const intent = String(formData.get("intent") || "");
  if (intent === "save") {
    const target = String(formData.get("autoRedirectTarget") || "").trim() || "/collections/all";
    await prisma.seoSettings.update({
      where: { shop },
      data: {
        autoRedirectOnDelete: formData.get("autoRedirectOnDelete") === "on",
        autoRedirectTarget: target,
      },
    });
    return { status: "ok" as const, message: "Auto-redirect settings saved." };
  }
  return { status: "error" as const, message: "Unknown action." };
};

export default function AutoRedirectPage() {
  const { settings, recent, suiteUnlocked } = useLoaderData<typeof loader>();
  const { search } = useLocation();
  const fetcher = useFetcher<typeof action>();
  const message = fetcher.data?.message;

  return (
    <s-page heading="Auto-redirect on delete">
      <s-link slot="breadcrumb-actions" href={withEmbeddedSearch("/app/seo", search)}>
        SEO Suite
      </s-link>

      <s-section>
        <s-text tone="neutral">
          When a product is deleted, Seoi can automatically create a 301 from{" "}
          <code>/products/&#123;handle&#125;</code> so old links keep sending shoppers somewhere
          useful.
        </s-text>
        {!suiteUnlocked ? (
          <s-text tone="caution">
            Upgrade required.{" "}
            <EmbeddedNavLink hrefPathname="/app/billing/plans">View plans</EmbeddedNavLink>
          </s-text>
        ) : null}
        {message ? <s-text tone="success">{message}</s-text> : null}
      </s-section>

      <s-section heading="Settings">
        <fetcher.Form method="post">
          <input type="hidden" name="intent" value="save" />
          <s-stack direction="block" gap="base">
            <label style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
              <input
                type="checkbox"
                name="autoRedirectOnDelete"
                defaultChecked={settings.autoRedirectOnDelete}
                disabled={!suiteUnlocked}
              />
              Create 301 when a product is deleted
            </label>
            <s-text-field
              name="autoRedirectTarget"
              label="Redirect target"
              value={settings.autoRedirectTarget}
              details="Path or full URL. Common: /collections/all or /"
            />
            <s-button type="submit" variant="primary" disabled={!suiteUnlocked}>
              Save
            </s-button>
          </s-stack>
        </fetcher.Form>
      </s-section>

      <s-section heading="Recent auto-redirects">
        {recent.length === 0 ? (
          <s-text tone="neutral">None yet. Delete a product on a test store to verify.</s-text>
        ) : (
          <s-stack direction="block" gap="small-200">
            {recent.map((row) => (
              <s-box key={row.id} padding="small-200" borderWidth="base" borderRadius="base">
                <s-text>
                  {row.path} → {row.target}
                </s-text>
                <s-text tone="neutral">
                  {row.handle} · {new Date(row.createdAt).toLocaleString()}
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
