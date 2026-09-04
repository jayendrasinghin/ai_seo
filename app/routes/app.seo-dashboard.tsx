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
import { SeoHomeButton } from "../HomeButton";
import { productPathSegmentFromGid } from "../shopify-ids";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";
import { generateImageAltText } from "../ai.server";
import { getEffectivePlan, planSeoUsesFreeQuota } from "../plan-helpers";
import { isPartnerDevelopmentStore } from "../billing.server";

const SHORT_ALT_MIN = 20;
/** Max images processed per bulk generate/apply request (avoids timeouts). */
const BULK_ALT_BATCH_LIMIT = 100;

async function assertAiQuotaForBulk(
  admin: AdminApiContext,
  shop: string,
  requestedCount: number,
): Promise<
  | { ok: true; usage: { freeQuotaLimit: number; aiSeoUsed: number; aiImageUsed: number; plan: string } }
  | { ok: false; message: string }
> {
  const usage = await prisma.storeUsage.upsert({
    where: { shop },
    update: {},
    create: { shop },
  });
  const partnerDevelopment = await isPartnerDevelopmentStore(admin);
  const totalAiUsed = usage.aiSeoUsed + usage.aiImageUsed;
  if (
    !partnerDevelopment &&
    planSeoUsesFreeQuota(getEffectivePlan(usage)) &&
    totalAiUsed >= usage.freeQuotaLimit
  ) {
    return {
      ok: false,
      message:
        "Free AI quota reached. Upgrade your plan to continue bulk AI alt-text actions.",
    };
  }
  if (
    !partnerDevelopment &&
    planSeoUsesFreeQuota(getEffectivePlan(usage)) &&
    totalAiUsed + requestedCount > usage.freeQuotaLimit
  ) {
    const remaining = Math.max(0, usage.freeQuotaLimit - totalAiUsed);
    return {
      ok: false,
      message: `Free plan allows ${remaining} more AI action(s) this month. Select fewer rows or upgrade.`,
    };
  }
  return {
    ok: true,
    usage: {
      freeQuotaLimit: usage.freeQuotaLimit,
      aiSeoUsed: usage.aiSeoUsed,
      aiImageUsed: usage.aiImageUsed,
      plan: getEffectivePlan(usage),
    },
  };
}

async function latestCompletedScanRun(shop: string) {
  return prisma.imageScanRun.findFirst({
    where: { shop, status: "completed" },
    orderBy: { startedAt: "desc" },
  });
}

async function bulkIssueIds(
  shop: string,
  scanRunId: string,
  mode: "missing" | "all" | "ready_to_apply",
  limit = BULK_ALT_BATCH_LIMIT,
): Promise<string[]> {
  const where =
    mode === "missing"
      ? {
          shop,
          scanRunId,
          issueType: { in: ["MISSING_ALT", "SHORT_ALT"] },
        }
      : mode === "ready_to_apply"
        ? {
            shop,
            scanRunId,
            suggestedAlt: { not: null },
          }
        : { shop, scanRunId };

  const rows = await prisma.imageSeoIssue.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit,
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

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

async function runImageSeoScan(admin: AdminApiContext, shop: string) {
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
  let handlerIntent = intent;
  let selectedIds = formData
    .getAll("issueIds")
    .map((id) => String(id))
    .filter(Boolean);

  const isAiMutation =
    intent === "generate_alt_suggestions" ||
    intent === "apply_alt_suggestions" ||
    intent === "bulk_generate_missing_alt" ||
    intent === "bulk_apply_all_alt";

  if (isAiMutation) {
    const { admin, session } = await authenticate.admin(request);

    if (intent === "bulk_generate_missing_alt") {
      const scan = await latestCompletedScanRun(session.shop);
      if (!scan) {
        return {
          status: "bulk_skipped" as const,
          message: "Run a scan first, then use bulk ALT.",
        };
      }
      selectedIds = await bulkIssueIds(session.shop, scan.id, "missing");
      if (selectedIds.length === 0) {
        return {
          status: "bulk_skipped" as const,
          message: "No missing or short ALT issues to generate.",
        };
      }
      handlerIntent = "generate_alt_suggestions";
    }

    if (intent === "bulk_apply_all_alt") {
      const scan = await latestCompletedScanRun(session.shop);
      if (!scan) {
        return {
          status: "bulk_skipped" as const,
          message: "Run a scan first, then use bulk ALT.",
        };
      }
      selectedIds = await bulkIssueIds(session.shop, scan.id, "all");
      if (selectedIds.length === 0) {
        return {
          status: "bulk_skipped" as const,
          message: "No open issues to apply.",
        };
      }
      handlerIntent = "apply_alt_suggestions";
    }

    const quota = await assertAiQuotaForBulk(
      admin,
      session.shop,
      selectedIds.length,
    );
    if (!quota.ok) {
      return { status: "quota_exceeded" as const, message: quota.message };
    }
  }

  if (handlerIntent === "generate_alt_suggestions") {
    const { session } = await authenticate.admin(request);

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

    return {
      status: "suggestions_generated" as const,
      updated,
      bulk: intent === "bulk_generate_missing_alt",
    };
  }

  if (handlerIntent === "apply_alt_suggestions") {
    const { admin, session } = await authenticate.admin(request);

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
        scanRunId: true,
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
      const appliedIdSet = new Set(appliedIds);
      const affectedScanRunIds = [
        ...new Set(
          issues
            .filter((issue) => appliedIdSet.has(issue.id))
            .map((issue) => issue.scanRunId),
        ),
      ];

      await prisma.$transaction(async (tx) => {
        await tx.imageSeoIssue.deleteMany({
          where: { shop: session.shop, id: { in: appliedIds } },
        });

        for (const scanRunId of affectedScanRunIds) {
          const issuesOpen = await tx.imageSeoIssue.count({
            where: { shop: session.shop, scanRunId },
          });
          await tx.imageScanRun.updateMany({
            where: { id: scanRunId, shop: session.shop },
            data: { issuesOpen },
          });
        }
      });
    }

    return {
      status: "apply_completed" as const,
      generated,
      applied,
      failed,
      firstError,
      bulk: intent === "bulk_apply_all_alt",
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
  const usage = await prisma.storeUsage.upsert({
    where: { shop: session.shop },
    update: {},
    create: { shop: session.shop },
  });

  const latestScanRun = await prisma.imageScanRun.findFirst({
    where: { shop: session.shop, status: "completed" },
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
  const currentIssuesOpen =
    issueCounts.MISSING_ALT + issueCounts.SHORT_ALT + issueCounts.DUPLICATE_ALT;
  const currentScanRun = latestScanRun
    ? { ...latestScanRun, issuesOpen: currentIssuesOpen }
    : null;

  const bulkMissingCount = latestScanRun
    ? await prisma.imageSeoIssue.count({
        where: {
          shop: session.shop,
          scanRunId: latestScanRun.id,
          issueType: { in: ["MISSING_ALT", "SHORT_ALT"] },
        },
      })
    : 0;
  const bulkApplyCount = currentIssuesOpen;

  return {
    stats: {
      productsScanned: currentScanRun?.productsScanned ?? 0,
      imagesMissingAlt: issueCounts.MISSING_ALT,
      aiSeoUsed: usage.aiSeoUsed,
      aiImageUsed: usage.aiImageUsed,
    },
    bulkAlt: {
      missingCount: bulkMissingCount,
      applyCount: Math.min(bulkApplyCount, BULK_ALT_BATCH_LIMIT),
      batchLimit: BULK_ALT_BATCH_LIMIT,
      hasScan: Boolean(latestScanRun),
    },
    usage: {
      aiUsed: usage.aiSeoUsed + usage.aiImageUsed,
      freeQuotaLimit: usage.freeQuotaLimit,
      plan: getEffectivePlan(usage),
      partnerDevelopment,
    },
    latestScanRun: currentScanRun,
    latestIssues,
    issueCounts,
    issueTypeFilter: validIssueTypeFilter,
  };
};

export default function Index() {
  const {
    stats,
    usage,
    latestScanRun,
    latestIssues,
    issueCounts,
    issueTypeFilter,
    bulkAlt,
  } = useLoaderData<typeof loader>();
  const { search: embeddedSearch } = useLocation();
  const fetcher = useFetcher<typeof action>();
  const revalidator = useRevalidator();
  const [selectedIssueIds, setSelectedIssueIds] = useState<string[]>([]);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const isScanning =
    fetcher.state === "submitting" && fetcher.formData?.get("intent") === "scan_now";
  const isGeneratingSuggestions =
    fetcher.state === "submitting" &&
    (fetcher.formData?.get("intent") === "generate_alt_suggestions" ||
      fetcher.formData?.get("intent") === "bulk_generate_missing_alt");
  const isApplyingSuggestions =
    fetcher.state === "submitting" &&
    (fetcher.formData?.get("intent") === "apply_alt_suggestions" ||
      fetcher.formData?.get("intent") === "bulk_apply_all_alt");
  const bulkQuotaBlocked =
    !usage.partnerDevelopment &&
    planSeoUsesFreeQuota(usage.plan) &&
    usage.aiUsed >= usage.freeQuotaLimit;
  const imageHealthScore = latestScanRun?.imagesScanned
    ? Math.max(
        0,
        Math.round(
          ((latestScanRun.imagesScanned -
            Math.min(latestScanRun.imagesScanned, latestScanRun.issuesOpen)) /
            latestScanRun.imagesScanned) *
            100,
        ),
      )
    : 0;

  const visibleIssueIds = useMemo(() => latestIssues.map((i) => i.id), [latestIssues]);
  const selectedVisibleCount = selectedIssueIds.filter((id) =>
    visibleIssueIds.includes(id),
  ).length;
  const allVisibleSelected =
    visibleIssueIds.length > 0 && selectedVisibleCount === visibleIssueIds.length;

  useEffect(() => {
    // Keep selection valid when filter/data changes.
    setSelectedIssueIds((prev) => prev.filter((id) => visibleIssueIds.includes(id)));
  }, [visibleIssueIds]);

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
        `${
          "bulk" in fetcher.data && fetcher.data.bulk ? "Bulk" : ""
        } suggestions generated for ${fetcher.data.updated} image(s).${
          "bulk" in fetcher.data && fetcher.data.bulk
            ? " Click Apply all to Shopify next."
            : " Your selection is kept — click Apply next."
        }`,
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
    if (
      fetcher.data.status === "scan_failed" ||
      fetcher.data.status === "suggestions_skipped" ||
      fetcher.data.status === "apply_skipped" ||
      fetcher.data.status === "bulk_skipped"
    ) {
      setActionMessage(fetcher.data.message);
      return;
    }
    if (fetcher.data.status === "quota_exceeded") {
      setActionMessage(fetcher.data.message);
      return;
    }
  }, [fetcher.data, revalidator]);

  return (
    <div>
      <s-page heading="AI SEO & Image Optimization">
        <SeoHomeButton />
        <div className="seoi-page-hero">
          <div className="seoi-page-hero__content">
            <span className="seoi-eyebrow">AI-powered store optimization</span>
            <h2>Bulk ALT text &amp; image SEO</h2>
            <p>
              Scan your catalog, generate AI ALT text in bulk, and publish fixes
              to Shopify — up to {bulkAlt.batchLimit} images per batch.
            </p>
          </div>
          <span className="seoi-status">Store connected</span>
        </div>

        <div className="seoi-dashboard-grid">
          <section className="seoi-panel seoi-panel--accent">
            <div className="seoi-panel__top">
              <div>
                <div className="seoi-panel__icon">AI</div>
                <h3>Scan product image SEO</h3>
                <p className="seoi-panel__copy">
                  Review up to 50 products and 10 images each for missing,
                  duplicate, or weak ALT text. Turn every issue into an
                  actionable AI suggestion.
                </p>
              </div>
              <button
                className="seoi-primary-action"
                type="button"
                disabled={isScanning}
                onClick={() =>
                  fetcher.submit({ intent: "scan_now" }, { method: "post" })
                }
              >
                {isScanning ? "Scanning…" : "Analyze store"}
              </button>
            </div>
            {isScanning ? (
              <div className="seoi-scan-progress" aria-label="Scan in progress">
                <span />
              </div>
            ) : null}
            {fetcher.data?.status === "scan_failed" ? (
              <p>{fetcher.data.message}</p>
            ) : null}
            {actionMessage ? <p>{actionMessage}</p> : null}
          </section>

          <section className="seoi-panel">
            <div className="seoi-section-heading">
              <div>
                <h3>Image SEO health</h3>
                <p>Based on the latest completed image scan.</p>
              </div>
            </div>
            <div className="seoi-score-layout">
              <div
                className="seoi-score-ring"
                style={{ "--score": imageHealthScore } as CSSProperties}
                aria-label={`Image SEO health score ${imageHealthScore} out of 100`}
              >
                <span>
                  <strong>{imageHealthScore}</strong>
                  <small>/100</small>
                </span>
              </div>
              <div className="seoi-score-details">
                <strong>
                  {latestScanRun
                    ? `${latestScanRun.issuesOpen} open image issues`
                    : "Run your first scan"}
                </strong>
                <span>
                  {latestScanRun
                    ? `${latestScanRun.imagesScanned} images checked across ${latestScanRun.productsScanned} products.`
                    : "Your score and recommendations will appear here."}
                </span>
              </div>
            </div>
          </section>
        </div>

        <section className="seoi-section-card seoi-bulk-alt">
          <div className="seoi-section-heading">
            <div>
              <h3>Bulk ALT text</h3>
              <p>
                Fix missing or short ALT across your latest scan — no need to
                select rows one by one.
              </p>
            </div>
            <span className="seoi-status">3 steps</span>
          </div>
          <ol className="seoi-billing-steps">
            <li>
              <strong>Analyze store</strong> — scans up to 50 products (10
              images each).
            </li>
            <li>
              <strong>Generate all missing ALT</strong> — AI writes ALT for
              missing/short images
              {bulkAlt.hasScan
                ? ` (${Math.min(bulkAlt.missingCount, bulkAlt.batchLimit)} ready)`
                : ""}
              .
            </li>
            <li>
              <strong>Apply all to Shopify</strong> — publishes ALT to product
              media
              {bulkAlt.hasScan
                ? ` (up to ${bulkAlt.applyCount} open issues)`
                : ""}
              .
            </li>
          </ol>
          <div className="seoi-billing-actions">
            <button
              className="seoi-nav-button seoi-nav-button--secondary"
              type="button"
              disabled={isScanning}
              onClick={() =>
                fetcher.submit({ intent: "scan_now" }, { method: "post" })
              }
            >
              {isScanning ? "Scanning…" : "1. Analyze store"}
            </button>
            <button
              className="seoi-nav-button seoi-nav-button--secondary"
              type="button"
              disabled={
                !bulkAlt.hasScan ||
                bulkAlt.missingCount === 0 ||
                bulkQuotaBlocked ||
                isGeneratingSuggestions ||
                isApplyingSuggestions
              }
              onClick={() =>
                fetcher.submit(
                  { intent: "bulk_generate_missing_alt" },
                  { method: "post" },
                )
              }
            >
              {isGeneratingSuggestions
                ? "Generating…"
                : `2. Generate all missing ALT (${Math.min(bulkAlt.missingCount, bulkAlt.batchLimit)})`}
            </button>
            <button
              className="seoi-nav-button seoi-nav-button--primary"
              type="button"
              disabled={
                !bulkAlt.hasScan ||
                bulkAlt.applyCount === 0 ||
                bulkQuotaBlocked ||
                isGeneratingSuggestions ||
                isApplyingSuggestions
              }
              onClick={() =>
                fetcher.submit(
                  { intent: "bulk_apply_all_alt" },
                  { method: "post" },
                )
              }
            >
              {isApplyingSuggestions
                ? "Applying…"
                : `3. Apply all to Shopify (${bulkAlt.applyCount})`}
            </button>
          </div>
          {bulkQuotaBlocked ? (
            <p className="seoi-plan-card__note">
              Free AI quota reached — upgrade in Plans &amp; billing to continue
              bulk ALT.
            </p>
          ) : null}
        </section>

        <div className="seoi-stat-grid">
          {[
            { label: "Products reviewed", value: stats.productsScanned },
            { label: "Missing ALT", value: stats.imagesMissingAlt },
            { label: "AI SEO generations", value: stats.aiSeoUsed },
            {
              label: "AI usage remaining",
              value: Math.max(0, usage.freeQuotaLimit - usage.aiUsed),
            },
          ].map((card) => (
            <div className="seoi-stat-card" key={card.label}>
              <div className="seoi-stat-card__label">{card.label}</div>
              <div className="seoi-stat-card__value">{card.value}</div>
            </div>
          ))}
        </div>

        <section className="seoi-section-card">
          <div className="seoi-section-heading">
            <div>
              <h3>Latest scan results</h3>
              <p>
                Review image issues, create AI suggestions, and apply approved
                ALT text directly to Shopify.
              </p>
            </div>
            <span className="seoi-status">
              {latestScanRun?.status ?? "No scan"}
            </span>
          </div>
          <p style={{ margin: "0 0 0.75rem", maxWidth: "42rem", color: "#6d7175", fontSize: "0.875rem" }}>
            Alt updates use Shopify media IDs. Apply now auto-generates missing suggestions for
            selected rows.
          </p>
          {!latestScanRun ? (
            <div className="seoi-empty-state">
              No scan has run yet. Select <strong>Analyze store</strong> to
              create your first image SEO report.
            </div>
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
                      hrefPathname="/app/seo-dashboard"
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
                <s-text tone="neutral">No issues in latest run.</s-text>
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
                        <s-text tone="neutral">
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
                            <s-text tone="neutral">
                              Select
                            </s-text>
                          </label>
                          <s-text font-weight="bold">
                            {issue.issueType.replaceAll("_", " ")} —{" "}
                            {issue.productTitle || "Product"}
                          </s-text>
                          <s-text tone="neutral">
                            Current alt: {issue.currentAlt?.trim() || "(empty)"}
                          </s-text>
                          {issue.suggestedAlt ? (
                            <s-text>
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
        </section>

        <s-section heading="Workflows">
          <s-text tone="neutral">
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
                <s-text font-weight="bold">
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
              <s-text tone="neutral">
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
