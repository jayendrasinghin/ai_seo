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
  createUrlRedirect,
  deleteUrlRedirect,
  listUrlRedirects,
} from "../redirects.server";
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
  const url = new URL(request.url);
  const q = url.searchParams.get("q") || undefined;
  const { redirects, error } = await listUrlRedirects(admin, 50, q);

  return {
    suiteUnlocked: partnerDevelopment || planHasSeoSuite(usage.plan),
    redirects,
    error,
    q: q || "",
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

  if (intent === "create") {
    const path = String(formData.get("path") || "").trim();
    const target = String(formData.get("target") || "").trim();
    if (!path || !target) {
      return { status: "error" as const, message: "Path and target are required." };
    }
    const result = await createUrlRedirect(admin, path, target);
    if (result.error) {
      return { status: "error" as const, message: result.error };
    }
    return { status: "ok" as const, message: "Redirect created." };
  }

  if (intent === "delete") {
    const id = String(formData.get("id") || "");
    const result = await deleteUrlRedirect(admin, id);
    if (!result.ok) {
      return { status: "error" as const, message: result.error || "Delete failed." };
    }
    return { status: "ok" as const, message: "Redirect deleted." };
  }

  return { status: "error" as const, message: "Unknown action." };
};

export default function RedirectsPage() {
  const { redirects, error, q, suiteUnlocked } = useLoaderData<typeof loader>();
  const { search } = useLocation();
  const fetcher = useFetcher<typeof action>();
  const message = fetcher.data?.message;
  const tone = fetcher.data?.status === "error" ? "critical" : "success";

  return (
    <s-page heading="URL Redirects">
      <s-link slot="breadcrumb-actions" href={withEmbeddedSearch("/app/seo", search)}>
        SEO Suite
      </s-link>

      <s-section>
        <s-text tone="neutral">
          Manage Shopify 301 redirects. Use this when you rename products, delete pages, or
          fix broken inbound links so traffic is retained.
        </s-text>
        {!suiteUnlocked ? (
          <s-text tone="caution">
            Upgrade to manage redirects.{" "}
            <EmbeddedNavLink hrefPathname="/app/billing/plans">
              View plans
            </EmbeddedNavLink>
          </s-text>
        ) : null}
        {error ? <s-text tone="critical">{error}</s-text> : null}
        {message ? <s-text tone={tone}>{message}</s-text> : null}
      </s-section>

      <s-section heading="Create redirect">
        <fetcher.Form method="post">
          <input type="hidden" name="intent" value="create" />
          <s-stack direction="block" gap="base">
            <s-text-field
              name="path"
              label="From path"
              placeholder="/old-product-handle"
              details="Must start with / and be a path on your store."
            />
            <s-text-field
              name="target"
              label="To target"
              placeholder="/products/new-handle"
              details="Path or full URL."
            />
            <s-button type="submit" variant="primary" disabled={!suiteUnlocked}>
              Create 301 redirect
            </s-button>
          </s-stack>
        </fetcher.Form>
      </s-section>

      <s-section heading="Existing redirects">
        <form method="get" style={{ marginBottom: "1rem" }}>
          <s-stack direction="inline" gap="base">
            <s-text-field name="q" label="Search" value={q} />
            <s-button type="submit">Search</s-button>
          </s-stack>
        </form>

        {redirects.length === 0 ? (
          <s-text tone="neutral">No redirects found.</s-text>
        ) : (
          <s-stack direction="block" gap="small-200">
            {redirects.map((row) => (
              <s-box key={row.id} padding="base" borderWidth="base" borderRadius="base">
                <s-stack direction="block" gap="small-200">
                  <s-text>
                    <strong>{row.path}</strong> → {row.target}
                  </s-text>
                  <fetcher.Form method="post">
                    <input type="hidden" name="intent" value="delete" />
                    <input type="hidden" name="id" value={row.id} />
                    <s-button
                      type="submit"
                      tone="critical"
                      variant="tertiary"
                      disabled={!suiteUnlocked}
                    >
                      Delete
                    </s-button>
                  </fetcher.Form>
                </s-stack>
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
