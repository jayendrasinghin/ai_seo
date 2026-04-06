import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import {
  useFetcher,
  useLoaderData,
  useLocation,
  useRevalidator,
} from "react-router";
import { EmbeddedNavLink } from "../embedded-nav-link";
import { productPathSegmentFromGid } from "../shopify-ids";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";
import { generateImageAltText } from "../ai.server";
import { planSeoUsesFreeQuota } from "../plan-helpers";
import { isPartnerDevelopmentStore } from "../billing.server";

const SHORT_ALT_MIN = 20;

/** Use product.media MediaImage ids — product.images ids are not valid for productUpdateMedia. */
type ScanMediaImageNode = {
  id: string;
  alt: string | null;
  image?: { url: string; altText: string | null } | null;
};

type ScanProductNode = {
  id: string;
  title: string;
  status: string;
  media?: { nodes?: (ScanMediaImageNode | null)[] | null };
};

function normalizeAlt(input: string): string {
  return input.toLowerCase().trim().replace(/\s+/g, " ");
}

async function runImageSeoScan(admin: any, shop: string) {
  const scanRun = await prisma.imageScanRun.create({
    data: { shop, status: "running" },
  });

  try {
    const response = await admin.graphql(
      `#graphql
        query AiSeoOptimizerScanProducts {
          products(first: 50) {
            nodes {
              id
              title
              status
              media(first: 10) {
                nodes {
                  ... on MediaImage {
                    id
                    alt
                    image {
                      url
                      altText
                    }
                  }
                }
              }
            }
          }
        }`,
    );

    const json = (await response.json()) as {
      data?: { products?: { nodes?: ScanProductNode[] } };
      errors?: { message?: string }[];
    };

    if (json.errors?.length) {
      throw new Error(json.errors[0]?.message || "Scan query failed.");
    }

    const products = json.data?.products?.nodes ?? [];
    const flatImages = products.flatMap((p) =>
      (p.media?.nodes ?? [])
        .filter((node): node is ScanMediaImageNode => Boolean(node?.id))
        .map((img) => {
          const altCombined = img.alt?.trim() || img.image?.altText?.trim() || "";
          return {
            productId: p.id,
            productTitle: p.title,
            mediaId: img.id,
            imageUrl: img.image?.url ?? null,
            altText: altCombined || img.image?.altText || null,
          };
        }),
    );

    const altBuckets = new Map<string, number>();
    for (const img of flatImages) {
      const alt = img.altText?.trim();
      if (!alt) continue;
      const key = normalizeAlt(alt);
      altBuckets.set(key, (altBuckets.get(key) ?? 0) + 1);
    }

    const issues = [];
    for (const img of flatImages) {
      const alt = img.altText?.trim() ?? "";
      const normalized = alt ? normalizeAlt(alt) : "";

      if (!alt) {
        issues.push({
          shop,
          scanRunId: scanRun.id,
          productId: img.productId,
          productTitle: img.productTitle,
          mediaId: img.mediaId,
          imageUrl: img.imageUrl,
          currentAlt: img.altText,
          issueType: "MISSING_ALT",
        });
      } else if (alt.length < SHORT_ALT_MIN) {
        issues.push({
          shop,
          scanRunId: scanRun.id,
          productId: img.productId,
          productTitle: img.productTitle,
          mediaId: img.mediaId,
          imageUrl: img.imageUrl,
          currentAlt: img.altText,
          issueType: "SHORT_ALT",
        });
      } else if ((altBuckets.get(normalized) ?? 0) > 1) {
        issues.push({
          shop,
          scanRunId: scanRun.id,
          productId: img.productId,
          productTitle: img.productTitle,
          mediaId: img.mediaId,
          imageUrl: img.imageUrl,
          currentAlt: img.altText,
          issueType: "DUPLICATE_ALT",
        });
      }
    }

    if (issues.length > 0) {
      await prisma.imageSeoIssue.createMany({ data: issues });
    }

    await prisma.imageScanRun.update({
      where: { id: scanRun.id },
      data: {
        status: "completed",
        finishedAt: new Date(),
        productsScanned: products.length,
        imagesScanned: flatImages.length,
        issuesOpen: issues.length,
      },
    });

    return {
      scanRunId: scanRun.id,
      productsScanned: products.length,
      imagesScanned: flatImages.length,
      issuesOpen: issues.length,
    };
  } catch (error) {
    await prisma.imageScanRun.update({
      where: { id: scanRun.id },
      data: {
        status: "failed",
        finishedAt: new Date(),
        errorMessage: error instanceof Error ? error.message : "Unknown scan error.",
      },
    });
    throw error;
  }
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const formData = await request.formData();
  const intent = String(formData.get("intent") || "");
  const isAiMutation =
    intent === "generate_alt_suggestions" || intent === "apply_alt_suggestions";

  if (isAiMutation) {
    const { admin, session } = await authenticate.admin(request);
    const usage = await prisma.storeUsage.upsert({
      where: { shop: session.shop },
      update: {},
      create: { shop: session.shop },
    });
    const partnerDevelopment = await isPartnerDevelopmentStore(admin);
    const totalAiUsed = usage.aiSeoUsed + usage.aiImageUsed;
    if (
      !partnerDevelopment &&
      planSeoUsesFreeQuota(usage.plan) &&
      totalAiUsed >= usage.freeQuotaLimit
    ) {
      return {
        status: "quota_exceeded" as const,
        message:
          "Free AI quota reached. Upgrade your plan to continue bulk AI alt-text actions.",
      };
    }
  }

  if (intent === "generate_alt_suggestions") {
    const { session } = await authenticate.admin(request);
    const selectedIds = formData
      .getAll("issueIds")
      .map((id) => String(id))
      .filter(Boolean);

    if (selectedIds.length === 0) {
      return { status: "suggestions_skipped" as const, message: "Select at least one row." };
    }

    const issues = await prisma.imageSeoIssue.findMany({
      where: { shop: session.shop, id: { in: selectedIds } },
      select: { id: true, productTitle: true, currentAlt: true },
    });

    let updated = 0;
    for (const issue of issues) {
      const { altText } = await generateImageAltText({
        productTitle: issue.productTitle || "Product",
        currentAlt: issue.currentAlt,
      });
      await prisma.imageSeoIssue.update({
        where: { id: issue.id },
        data: { suggestedAlt: altText, suggestionUpdatedAt: new Date() },
      });
      updated += 1;
    }

    if (updated > 0) {
      await prisma.storeUsage.update({
        where: { shop: session.shop },
        data: {
          usedCredits: { increment: updated },
          aiSeoUsed: { increment: updated },
        },
      });
    }

    return { status: "suggestions_generated" as const, updated };
  }

  if (intent === "apply_alt_suggestions") {
    const { admin, session } = await authenticate.admin(request);
    const selectedIds = formData
      .getAll("issueIds")
      .map((id) => String(id))
      .filter(Boolean);

    if (selectedIds.length === 0) {
      return {
        status: "apply_skipped" as const,
        message: "Select at least one row.",
      };
    }

    const issues = await prisma.imageSeoIssue.findMany({
      where: { shop: session.shop, id: { in: selectedIds } },
      select: {
        id: true,
        productId: true,
        mediaId: true,
        productTitle: true,
        currentAlt: true,
        suggestedAlt: true,
      },
    });

    let generated = 0;
    for (const issue of issues) {
      if (issue.suggestedAlt?.trim()) continue;
      const { altText } = await generateImageAltText({
        productTitle: issue.productTitle || "Product",
        currentAlt: issue.currentAlt,
      });
      issue.suggestedAlt = altText;
      await prisma.imageSeoIssue.update({
        where: { id: issue.id },
        data: { suggestedAlt: altText, suggestionUpdatedAt: new Date() },
      });
      generated += 1;
    }

    if (generated > 0) {
      await prisma.storeUsage.update({
        where: { shop: session.shop },
        data: {
          usedCredits: { increment: generated },
          aiSeoUsed: { increment: generated },
        },
      });
    }

    let applied = 0;
    let failed = 0;
    const appliedIds: string[] = [];
    let firstError: string | null = null;

    for (const issue of issues) {
      const alt = issue.suggestedAlt?.trim();
      if (!alt) {
        failed += 1;
        if (!firstError) firstError = "Missing suggested alt for one or more rows.";
        continue;
      }

      try {
        const res = await admin.graphql(
          `#graphql
            mutation AiSeoApplyAltSuggestion($productId: ID!, $media: [UpdateMediaInput!]!) {
              productUpdateMedia(productId: $productId, media: $media) {
                mediaUserErrors {
                  field
                  message
                }
              }
            }`,
          {
            variables: {
              productId: issue.productId,
              media: [{ id: issue.mediaId, alt }],
            },
          },
        );

        const json = (await res.json()) as {
          data?: { productUpdateMedia?: { mediaUserErrors?: { message?: string }[] } };
          errors?: { message?: string }[];
        };
        if (json.errors?.length) {
          failed += 1;
          if (!firstError) firstError = json.errors[0]?.message ?? "GraphQL error.";
          continue;
        }
        const userErrors = json.data?.productUpdateMedia?.mediaUserErrors ?? [];
        if (userErrors.length > 0) {
          failed += 1;
          if (!firstError) firstError = userErrors[0]?.message ?? "Shopify rejected update.";
          continue;
        }

        applied += 1;
        appliedIds.push(issue.id);
      } catch (err) {
        failed += 1;
        if (!firstError) {
          firstError = err instanceof Error ? err.message : "Network error.";
        }
      }
    }

    if (appliedIds.length > 0) {
      await prisma.imageSeoIssue.deleteMany({
        where: { shop: session.shop, id: { in: appliedIds } },
      });
    }

    return {
      status: "apply_completed" as const,
      generated,
      applied,
      failed,
      firstError,
    };
  }

  if (intent !== "scan_now") return null;

  try {
    const { admin, session } = await authenticate.admin(request);
    const summary = await runImageSeoScan(admin, session.shop);
    return { status: "scan_completed" as const, summary };
  } catch (error) {
    return {
      status: "scan_failed" as const,
      message: error instanceof Error ? error.message : "Scan failed.",
    };
  }
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const partnerDevelopment = await isPartnerDevelopmentStore(admin);
  const url = new URL(request.url);
  const issueTypeFilter = (url.searchParams.get("issueType") || "ALL").toUpperCase();
  const validIssueTypeFilter =
    issueTypeFilter === "ALL" ||
    issueTypeFilter === "MISSING_ALT" ||
    issueTypeFilter === "SHORT_ALT" ||
    issueTypeFilter === "DUPLICATE_ALT"
      ? issueTypeFilter
      : "ALL";
  const response = await admin.graphql(
    `#graphql
      query AiSeoAppOptimizerDashboard {
        products(first: 20) {
          nodes {
            id
            title
            status
            images(first: 1) {
              nodes {
                url
                altText
              }
            }
          }
        }
      }`,
  );

  const json = (await response.json()) as {
    data?: {
      products?: {
        nodes?: Array<{
          id: string;
          title: string;
          status: string;
          images?: { nodes?: Array<{ altText?: string | null }> };
        }>;
      };
    };
    errors?: { message: string }[];
  };

  const products = json.data?.products?.nodes ?? [];
  const missingAltCount = products.reduce((acc, p) => {
    const firstAlt = p.images?.nodes?.[0]?.altText?.trim();
    return firstAlt ? acc : acc + 1;
  }, 0);

  const usage = await prisma.storeUsage.upsert({
    where: { shop: session.shop },
    update: {},
    create: { shop: session.shop },
  });

  const latestScanRun = await prisma.imageScanRun.findFirst({
    where: { shop: session.shop },
    orderBy: { startedAt: "desc" },
  });

  const latestIssues = latestScanRun
    ? await prisma.imageSeoIssue.findMany({
        where: {
          shop: session.shop,
          scanRunId: latestScanRun.id,
          ...(validIssueTypeFilter === "ALL"
            ? {}
            : { issueType: validIssueTypeFilter }),
        },
        orderBy: { createdAt: "desc" },
        take: 30,
      })
    : [];

  const latestIssueCounts = latestScanRun
    ? await prisma.imageSeoIssue.groupBy({
        by: ["issueType"],
        where: { shop: session.shop, scanRunId: latestScanRun.id },
        _count: { _all: true },
      })
    : [];

  const issueCounts = {
    MISSING_ALT: 0,
    SHORT_ALT: 0,
    DUPLICATE_ALT: 0,
  };
  for (const row of latestIssueCounts) {
    if (row.issueType in issueCounts) {
      issueCounts[row.issueType as keyof typeof issueCounts] = row._count._all;
    }
  }

  return {
    stats: {
      productsScanned: products.length,
      imagesMissingAlt: missingAltCount,
      aiSeoUsed: usage.aiSeoUsed,
      aiImageUsed: usage.aiImageUsed,
    },
    usage: {
      aiUsed: usage.aiSeoUsed + usage.aiImageUsed,
      freeQuotaLimit: usage.freeQuotaLimit,
      plan: usage.plan,
      partnerDevelopment,
    },
    errors: json.errors ?? null,
    latestScanRun,
    latestIssues,
    issueCounts,
    issueTypeFilter: validIssueTypeFilter,
  };
};

const pageShellStyle: CSSProperties = {
  backgroundColor: "#f1f2f4",
  minHeight: "100%",
};

export default function Index() {
  const { stats, usage, errors, latestScanRun, latestIssues, issueCounts, issueTypeFilter } =
    useLoaderData<typeof loader>();
  const { search: embeddedSearch } = useLocation();
  const fetcher = useFetcher<typeof action>();
  const revalidator = useRevalidator();
  const [selectedIssueIds, setSelectedIssueIds] = useState<string[]>([]);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const isScanning =
    fetcher.state === "submitting" && fetcher.formData?.get("intent") === "scan_now";
  const isGeneratingSuggestions =
    fetcher.state === "submitting" &&
    fetcher.formData?.get("intent") === "generate_alt_suggestions";
  const isApplyingSuggestions =
    fetcher.state === "submitting" &&
    fetcher.formData?.get("intent") === "apply_alt_suggestions";

  const visibleIssueIds = useMemo(() => latestIssues.map((i) => i.id), [latestIssues]);
  const selectedVisibleCount = selectedIssueIds.filter((id) =>
    visibleIssueIds.includes(id),
  ).length;
  const allVisibleSelected =
    visibleIssueIds.length > 0 && selectedVisibleCount === visibleIssueIds.length;

  useEffect(() => {
    // Keep selection valid when filter/data changes.
    setSelectedIssueIds((prev) => prev.filter((id) => visibleIssueIds.includes(id)));
  }, [visibleIssueIds.join("|")]);

  useEffect(() => {
    if (!fetcher.data) return;
    if (fetcher.data.status === "apply_completed") {
      const err = "firstError" in fetcher.data && fetcher.data.firstError
        ? ` First error: ${fetcher.data.firstError}`
        : "";
      setActionMessage(
        `Generated: ${fetcher.data.generated}, Applied: ${fetcher.data.applied}, Failed: ${fetcher.data.failed}.${err} Updating list...`,
      );
      setSelectedIssueIds([]);
      revalidator.revalidate();
      return;
    }
    if (fetcher.data.status === "suggestions_generated") {
      setActionMessage(
        `Suggestions generated for ${fetcher.data.updated} issue(s). Your selection is kept — click Apply next.`,
      );
      revalidator.revalidate();
      return;
    }
    if (fetcher.data.status === "scan_completed") {
      setActionMessage(
        `Scan completed: ${fetcher.data.summary.productsScanned} products, ${fetcher.data.summary.imagesScanned} images, ${fetcher.data.summary.issuesOpen} issues.`,
      );
      revalidator.revalidate();
      return;
    }
    if (fetcher.data.status === "scan_failed" || fetcher.data.status === "suggestions_skipped" || fetcher.data.status === "apply_skipped") {
      setActionMessage(fetcher.data.message);
      return;
    }
    if (fetcher.data.status === "quota_exceeded") {
      setActionMessage(fetcher.data.message);
      return;
    }
  }, [fetcher.data]);

  return (
    <div style={pageShellStyle}>
      <s-page heading="Product Image SEO Optimizer">
        {errors && (
          <s-section>
            <s-text tone="critical">
              Could not load full dashboard data. {errors[0]?.message || "Unknown error"}
            </s-text>
          </s-section>
        )}

        <s-section>
          <s-text tone="subdued">
            AI used: {usage.aiUsed} / {usage.freeQuotaLimit}
            {usage.plan === "free" ? " (Free trial)" : " (Paid plan)"}
          </s-text>
        </s-section>

        <s-section heading="Scan all products">
          <s-stack direction="block" gap="base">
            <s-text tone="subdued">
              Scan up to 50 products and 10 images each in this first version. We detect
              missing alt text, short alt text, and duplicate alt text.
            </s-text>
            <s-button
              variant="primary"
              onClick={() => fetcher.submit({ intent: "scan_now" }, { method: "post" })}
              {...(isScanning ? { loading: true } : {})}
            >
              {isScanning ? "Scanning..." : "Scan now"}
            </s-button>

            {fetcher.data?.status === "scan_completed" && (
              <s-text tone="success">
                Scan completed: {fetcher.data.summary.productsScanned} products,{" "}
                {fetcher.data.summary.imagesScanned} images,{" "}
                {fetcher.data.summary.issuesOpen} issues found. Refresh to view latest list.
              </s-text>
            )}

            {fetcher.data?.status === "scan_failed" && (
              <s-text tone="critical">{fetcher.data.message}</s-text>
            )}
            {actionMessage ? <s-text tone="subdued">{actionMessage}</s-text> : null}
          </s-stack>
        </s-section>

        <s-section heading="Overview">
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
              gap: "0.75rem",
            }}
          >
            {[
              { label: "Products in sample", value: stats.productsScanned },
              { label: "Missing alt (first image)", value: stats.imagesMissingAlt },
              { label: "AI SEO generations", value: stats.aiSeoUsed },
              { label: "AI images used", value: stats.aiImageUsed },
            ].map((card) => (
              <s-box
                key={card.label}
                padding="base"
                borderWidth="base"
                borderRadius="base"
                background="subdued"
              >
                <s-text
                  tone="subdued"
                  as="p"
                  style={{ margin: "0 0 0.35rem", fontSize: "0.8125rem" }}
                >
                  {card.label}
                </s-text>
                <s-text
                  font-weight="bold"
                  as="p"
                  style={{ margin: 0, fontSize: "1.5rem", lineHeight: 1.2 }}
                >
                  {card.value}
                </s-text>
              </s-box>
            ))}
          </div>
        </s-section>

        <s-section heading="Latest scan results">
          <p style={{ margin: "0 0 0.75rem", maxWidth: "42rem", color: "#6d7175", fontSize: "0.875rem" }}>
            Alt updates use Shopify media IDs. Apply now auto-generates missing suggestions for
            selected rows.
          </p>
          {!latestScanRun ? (
            <s-text tone="subdued">No scan has run yet. Click Scan now to start.</s-text>
          ) : (
            <s-stack direction="block" gap="base">
              <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
                <s-text font-weight="bold">
                  Status: {latestScanRun.status} • Products: {latestScanRun.productsScanned} •
                  Images: {latestScanRun.imagesScanned} • Issues: {latestScanRun.issuesOpen}
                </s-text>
              </s-box>

              <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                {[
                  { id: "ALL", label: "All", count: latestScanRun.issuesOpen },
                  {
                    id: "MISSING_ALT",
                    label: "Missing alt",
                    count: issueCounts.MISSING_ALT,
                  },
                  {
                    id: "SHORT_ALT",
                    label: "Short alt",
                    count: issueCounts.SHORT_ALT,
                  },
                  {
                    id: "DUPLICATE_ALT",
                    label: "Duplicate alt",
                    count: issueCounts.DUPLICATE_ALT,
                  },
                ].map((chip) => {
                  const isActive = issueTypeFilter === chip.id;
                  const chipParams = new URLSearchParams(embeddedSearch);
                  if (chip.id === "ALL") {
                    chipParams.delete("issueType");
                  } else {
                    chipParams.set("issueType", chip.id);
                  }
                  const chipSearch = chipParams.toString()
                    ? `?${chipParams.toString()}`
                    : undefined;
                  return (
                    <EmbeddedNavLink
                      key={chip.id}
                      hrefPathname="/app"
                      search={chipSearch}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "0.35rem",
                        textDecoration: "none",
                        padding: "0.3rem 0.55rem",
                        borderRadius: 999,
                        border: isActive ? "1px solid #1d4ed8" : "1px solid #cbd5e1",
                        background: isActive ? "#dbeafe" : "#f3f4f6",
                        color: "#111827",
                        fontSize: "0.78rem",
                        fontWeight: 600,
                      }}
                    >
                      {`${chip.label} · ${chip.count}`}
                    </EmbeddedNavLink>
                  );
                })}
              </div>

              {latestIssues.length === 0 ? (
                <s-text tone="subdued">No issues in latest run.</s-text>
              ) : (
                <s-stack direction="block" gap="small-200">
                  <fetcher.Form method="post">
                    {selectedIssueIds.map((id) => (
                      <input key={id} type="hidden" name="issueIds" value={id} />
                    ))}
                    <div
                      style={{
                        display: "flex",
                        gap: "0.5rem",
                        alignItems: "center",
                        flexWrap: "wrap",
                      }}
                    >
                      {!usage.partnerDevelopment &&
                      planSeoUsesFreeQuota(usage.plan) &&
                      usage.aiUsed >= usage.freeQuotaLimit ? (
                        <s-text tone="critical">
                          Free AI quota reached. Upgrade plan to use Generate/Apply bulk AI
                          suggestions.
                        </s-text>
                      ) : null}
                      <button
                        type="submit"
                        name="intent"
                        value="generate_alt_suggestions"
                        disabled={
                          selectedIssueIds.length === 0 ||
                          (!usage.partnerDevelopment &&
                            planSeoUsesFreeQuota(usage.plan) &&
                            usage.aiUsed >= usage.freeQuotaLimit) ||
                          isGeneratingSuggestions ||
                          isApplyingSuggestions
                        }
                        style={{
                          padding: "0.45rem 0.85rem",
                          borderRadius: 8,
                          fontWeight: 600,
                          fontSize: "0.8125rem",
                          border: "1px solid #cbd5e1",
                          background: "#f3f4f6",
                          color: "#111827",
                          cursor: "pointer",
                        }}
                      >
                        {isGeneratingSuggestions
                          ? "Generating…"
                          : `Generate alt for selected (${selectedIssueIds.length})`}
                      </button>
                      <button
                        type="submit"
                        name="intent"
                        value="apply_alt_suggestions"
                        disabled={
                          selectedIssueIds.length === 0 ||
                          (!usage.partnerDevelopment &&
                            planSeoUsesFreeQuota(usage.plan) &&
                            usage.aiUsed >= usage.freeQuotaLimit) ||
                          isGeneratingSuggestions ||
                          isApplyingSuggestions
                        }
                        style={{
                          padding: "0.45rem 0.85rem",
                          borderRadius: 8,
                          fontWeight: 600,
                          fontSize: "0.8125rem",
                          border: "1px solid #1d4ed8",
                          background: "#2563eb",
                          color: "#ffffff",
                          cursor: "pointer",
                        }}
                      >
                        {isApplyingSuggestions
                          ? "Generating/Applying…"
                          : "Apply selected (auto-generate missing)"}
                      </button>
                      <s-button
                        type="button"
                        variant="tertiary"
                        disabled={selectedIssueIds.length === 0}
                        onClick={() => setSelectedIssueIds([])}
                      >
                        Clear selection
                      </s-button>
                      <label
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "0.35rem",
                          marginLeft: "0.25rem",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={allVisibleSelected}
                          onChange={(e) => {
                            const checked = e.currentTarget.checked;
                            if (checked) {
                              setSelectedIssueIds((prev) =>
                                Array.from(new Set([...prev, ...visibleIssueIds])),
                              );
                            } else {
                              setSelectedIssueIds((prev) =>
                                prev.filter((id) => !visibleIssueIds.includes(id)),
                              );
                            }
                          }}
                        />
                        <s-text tone="subdued">
                          Select all on page ({visibleIssueIds.length})
                        </s-text>
                      </label>
                    </div>
                  </fetcher.Form>

                  {latestIssues.map((issue) => (
                    <s-box
                      key={issue.id}
                      padding="small-300"
                      borderWidth="base"
                      borderRadius="base"
                      background="subdued"
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "flex-start",
                          gap: "0.75rem",
                          flexWrap: "wrap",
                        }}
                      >
                        <div style={{ minWidth: 0 }}>
                          <label
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "0.4rem",
                              marginBottom: "0.35rem",
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={selectedIssueIds.includes(issue.id)}
                              onChange={(e) => {
                                const checked = e.currentTarget.checked;
                                setSelectedIssueIds((prev) =>
                                  checked
                                    ? [...prev, issue.id]
                                    : prev.filter((id) => id !== issue.id),
                                );
                              }}
                            />
                            <s-text tone="subdued" as="span">
                              Select
                            </s-text>
                          </label>
                          <s-text font-weight="bold">
                            {issue.issueType.replaceAll("_", " ")} —{" "}
                            {issue.productTitle || "Product"}
                          </s-text>
                          <s-text tone="subdued" as="p" style={{ margin: "0.2rem 0 0" }}>
                            Current alt: {issue.currentAlt?.trim() || "(empty)"}
                          </s-text>
                          {issue.suggestedAlt ? (
                            <s-text as="p" style={{ margin: "0.2rem 0 0" }}>
                              Suggested alt: {issue.suggestedAlt}
                            </s-text>
                          ) : null}
                        </div>
                        <EmbeddedNavLink
                          hrefPathname={`/app/products/${productPathSegmentFromGid(issue.productId)}`}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            textDecoration: "none",
                            padding: "0.3rem 0.55rem",
                            borderRadius: 8,
                            border: "1px solid #cbd5e1",
                            background: "#f3f4f6",
                            color: "#111827",
                            fontSize: "0.78rem",
                            fontWeight: 600,
                            whiteSpace: "nowrap",
                          }}
                        >
                          Open product
                        </EmbeddedNavLink>
                      </div>
                    </s-box>
                  ))}
                </s-stack>
              )}
            </s-stack>
          )}
        </s-section>

        <s-section heading="Workflows">
          <s-text tone="subdued" as="p" style={{ margin: "0 0 1rem", maxWidth: "42rem" }}>
            Pick a workflow below. Most merchants start with products, then use AI SEO and AI
            images on each product page.
          </s-text>

          <div style={{ marginBottom: "1.25rem" }}>
            <EmbeddedNavLink
              hrefPathname="/app/products"
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                marginTop: "5px",
                padding: "0.45rem 0.95rem",
                borderRadius: 8,
                fontWeight: 600,
                fontSize: "0.8125rem",
                textDecoration: "none",
                backgroundColor: "#2563eb",
                border: "1px solid #1d4ed8",
                color: "#ffffff",
              }}
            >
              Start with products
            </EmbeddedNavLink>
          </div>

          <s-stack direction="block" gap="base">
            <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  justifyContent: "space-between",
                  gap: "0.75rem",
                  flexWrap: "wrap",
                  marginBottom: "0.5rem",
                }}
              >
                <s-text font-weight="bold" style={{ fontSize: "1.0625rem" }}>
                  Product tools
                </s-text>
                <span
                  style={{
                    fontSize: "0.75rem",
                    fontWeight: 600,
                    padding: "0.15rem 0.5rem",
                    borderRadius: 4,
                    background: "#e3e8ef",
                    color: "#202223",
                  }}
                >
                  Main
                </span>
              </div>
              <s-text tone="subdued" as="p" style={{ margin: "0 0 0.85rem", lineHeight: 1.5 }}>
                Browse your catalog and open any product to fix image SEO, run AI SEO, or
                generate AI images.
              </s-text>
              <EmbeddedNavLink
                hrefPathname="/app/products"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: "0.4rem 0.75rem",
                  marginTop: "0.2rem",
                  marginLeft: "30px",
                  borderRadius: 8,
                  fontWeight: 600,
                  fontSize: "0.8125rem",
                  textDecoration: "none",
                  backgroundColor: "#e5e7eb",
                  border: "1px solid #cbd5e1",
                  color: "#111827",
                }}
              >
                Open products
              </EmbeddedNavLink>
            </s-box>
          </s-stack>
        </s-section>
      </s-page>
    </div>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
