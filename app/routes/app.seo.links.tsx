import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData, useLocation, useRevalidator } from "react-router";
import { useEffect } from "react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { withEmbeddedSearch } from "../embedded-nav";
import { EmbeddedNavLink } from "../embedded-nav-link";
import { ModernPageHeader } from "../ModernPageHeader";
import { runBrokenLinkScan } from "../link-crawl.server";
import { createUrlRedirect } from "../redirects.server";
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

  const latestScan = await prisma.linkScanRun.findFirst({
    where: { shop },
    orderBy: { startedAt: "desc" },
  });

  const issues = latestScan
    ? await prisma.brokenLinkIssue.findMany({
        where: { shop, scanRunId: latestScan.id },
        orderBy: { createdAt: "desc" },
        take: 100,
      })
    : [];

  return {
    suiteUnlocked: partnerDevelopment || planHasSeoSuite(getEffectivePlan(usage)),
    latestScan,
    issues,
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

  if (intent === "scan") {
    try {
      const result = await runBrokenLinkScan(admin, shop);
      return {
        status: "ok" as const,
        message: `Checked ${result.urlsChecked} URLs — ${result.brokenCount} broken/error, ${result.issueCount} flagged.`,
      };
    } catch (error) {
      return {
        status: "error" as const,
        message: error instanceof Error ? error.message : "Scan failed.",
      };
    }
  }

  if (intent === "create_redirect") {
    const issueId = String(formData.get("issueId") || "");
    const target = String(formData.get("target") || "/").trim() || "/";
    const issue = await prisma.brokenLinkIssue.findFirst({
      where: { id: issueId, shop },
    });
    if (!issue) {
      return { status: "error" as const, message: "Issue not found." };
    }

    let path: string;
    let hostname = "";
    try {
      const u = new URL(issue.linkUrl);
      path = u.pathname || "/";
      hostname = u.hostname;
    } catch {
      return { status: "error" as const, message: "Invalid link URL for redirect." };
    }

    const shopHost = shop.replace(/\/$/, "");
    const isOnStore =
      hostname === shopHost ||
      hostname.endsWith(".myshopify.com") ||
      path.startsWith("/products/") ||
      path.startsWith("/collections/") ||
      path.startsWith("/pages/") ||
      path.startsWith("/blogs/");

    if (!isOnStore && (hostname.includes(".") && !hostname.includes("myshopify"))) {
      // External absolute URL — Shopify redirects can't fix off-domain destinations.
      if (!issue.linkUrl.includes(shopHost) && !hostname.endsWith(".myshopify.com")) {
        return {
          status: "error" as const,
          message:
            "This looks like an external URL. Edit the source content instead of creating a Shopify redirect.",
        };
      }
    }

    const result = await createUrlRedirect(admin, path, target);
    if (result.error) {
      return { status: "error" as const, message: result.error };
    }

    await prisma.brokenLinkIssue.update({
      where: { id: issue.id },
      data: { redirectCreated: true },
    });

    return { status: "ok" as const, message: `Redirect created: ${path} → ${target}` };
  }

  return { status: "error" as const, message: "Unknown action." };
};

export default function BrokenLinksPage() {
  const { latestScan, issues, suiteUnlocked } = useLoaderData<typeof loader>();
  const { search } = useLocation();
  const fetcher = useFetcher<typeof action>();
  const revalidator = useRevalidator();
  const message = fetcher.data?.message;
  const tone = fetcher.data?.status === "error" ? "critical" : "success";
  const scanning = fetcher.state !== "idle" && fetcher.formData?.get("intent") === "scan";

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.status === "ok") {
      revalidator.revalidate();
    }
  }, [fetcher.state, fetcher.data, revalidator]);

  return (
    <s-page heading="Broken links">
      <s-link slot="breadcrumb-actions" href={withEmbeddedSearch("/app/seo", search)}>
        SEO Suite
      </s-link>
      <ModernPageHeader
        eyebrow="Store health"
        title="Find links that cost shoppers and search engines."
        description="Scan catalog content for broken destinations, review each source, and repair eligible store URLs with a redirect."
        status={latestScan ? `${latestScan.brokenCount} issues` : "Not scanned"}
      />

      <s-section>
        <s-text tone="neutral">
          Scan links in product, collection, and page content. Broken URLs (404/errors) can be
          fixed with a 301 redirect when the path is on your store.
        </s-text>
        {!suiteUnlocked ? (
          <s-text tone="caution">
            Upgrade to run scans.{" "}
            <EmbeddedNavLink hrefPathname="/app/billing/plans">View plans</EmbeddedNavLink>
          </s-text>
        ) : null}
        {message ? <s-text tone={tone}>{message}</s-text> : null}
      </s-section>

      <s-section heading="Scan">
        <fetcher.Form method="post">
          <input type="hidden" name="intent" value="scan" />
          <s-stack direction="block" gap="base">
            <s-text tone="neutral">
              Checks up to 80 unique links. Last run:{" "}
              {latestScan
                ? `${latestScan.status} · ${latestScan.urlsChecked} checked · ${latestScan.brokenCount} broken/error · ${new Date(latestScan.startedAt).toLocaleString()}`
                : "never"}
            </s-text>
            {latestScan?.errorMessage ? (
              <s-text tone="critical">{latestScan.errorMessage}</s-text>
            ) : null}
            <s-button type="submit" variant="primary" disabled={!suiteUnlocked || scanning}>
              {scanning ? "Scanning…" : "Run link scan"}
            </s-button>
          </s-stack>
        </fetcher.Form>
      </s-section>

      <s-section heading="Issues">
        {issues.length === 0 ? (
          <s-text tone="neutral">No issues from the latest scan.</s-text>
        ) : (
          <s-stack direction="block" gap="base">
            {issues.map((issue) => (
              <s-box key={issue.id} padding="base" borderWidth="base" borderRadius="base">
                <s-stack direction="block" gap="small-200">
                  <s-text>
                    <strong>{issue.status.toUpperCase()}</strong>
                    {issue.httpStatus != null ? ` (${issue.httpStatus})` : ""} — {issue.linkUrl}
                  </s-text>
                  <s-text tone="neutral">
                    Found in {issue.sourceType}: {issue.sourceTitle || "—"}
                    {issue.sourceUrl ? (
                      <>
                        {" "}
                        ·{" "}
                        <a href={issue.sourceUrl} target="_blank" rel="noreferrer">
                          open source
                        </a>
                      </>
                    ) : null}
                  </s-text>
                  {issue.redirectCreated ? (
                    <s-text tone="success">Redirect already created.</s-text>
                  ) : issue.status === "broken" || issue.status === "error" ? (
                    <fetcher.Form method="post">
                      <input type="hidden" name="intent" value="create_redirect" />
                      <input type="hidden" name="issueId" value={issue.id} />
                      <s-stack direction="inline" gap="base">
                        <s-text-field
                          name="target"
                          label="Redirect to"
                          value="/collections/all"
                        />
                        <s-button type="submit" disabled={!suiteUnlocked}>
                          Create 301
                        </s-button>
                      </s-stack>
                    </fetcher.Form>
                  ) : null}
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
