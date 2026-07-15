import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useEffect } from "react";
import {
  useFetcher,
  useLoaderData,
  useLocation,
  useRevalidator,
} from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { withEmbeddedSearch } from "../embedded-nav";
import { EmbeddedNavLink } from "../embedded-nav-link";
import { getOrCreateSeoSettings } from "../seo-settings.server";
import { runImageOptimizeBatch } from "../image-optimize.server";
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
  const latest = await prisma.imageOptimizeRun.findFirst({
    where: { shop },
    orderBy: { startedAt: "desc" },
  });
  const items = latest
    ? await prisma.imageOptimizeItem.findMany({
        where: { shop, runId: latest.id },
        orderBy: { createdAt: "desc" },
        take: 40,
      })
    : [];

  return {
    suiteUnlocked: partnerDevelopment || planHasSeoSuite(usage.plan),
    settings: {
      imageMaxWidth: settings.imageMaxWidth,
      imageQuality: settings.imageQuality,
    },
    latest,
    items,
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
    const maxWidth = Math.min(
      4000,
      Math.max(800, Number(formData.get("imageMaxWidth") || 2048)),
    );
    const quality = Math.min(
      95,
      Math.max(50, Number(formData.get("imageQuality") || 80)),
    );
    await prisma.seoSettings.update({
      where: { shop },
      data: { imageMaxWidth: maxWidth, imageQuality: quality },
    });
    return { status: "ok" as const, message: "Image settings saved." };
  }

  if (intent === "optimize") {
    try {
      const result = await runImageOptimizeBatch(admin, shop);
      return {
        status: "ok" as const,
        message: `Checked ${result.imagesChecked} images, optimized ${result.imagesOptimized}, saved ~${Math.round(result.bytesSaved / 1024)} KB.`,
      };
    } catch (error) {
      return {
        status: "error" as const,
        message: error instanceof Error ? error.message : "Optimize failed.",
      };
    }
  }

  return { status: "error" as const, message: "Unknown action." };
};

export default function ImageOptimizePage() {
  const { settings, latest, items, suiteUnlocked } =
    useLoaderData<typeof loader>();
  const { search } = useLocation();
  const fetcher = useFetcher<typeof action>();
  const revalidator = useRevalidator();
  const message = fetcher.data?.message;
  const tone = fetcher.data?.status === "error" ? "critical" : "success";
  const running =
    fetcher.state !== "idle" && fetcher.formData?.get("intent") === "optimize";

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.status === "ok") {
      revalidator.revalidate();
    }
  }, [fetcher.state, fetcher.data, revalidator]);

  return (
    <s-page heading="Image optimize">
      <s-link slot="breadcrumb-actions" href={withEmbeddedSearch("/app/seo", search)}>
        SEO Suite
      </s-link>

      <s-section>
        <s-text tone="neutral">
          Compress and resize product images (JPEG), then replace media on Shopify. Processes up
          to 15 images per run.
        </s-text>
        {!suiteUnlocked ? (
          <s-text tone="caution">
            Upgrade required.{" "}
            <EmbeddedNavLink hrefPathname="/app/billing/plans">View plans</EmbeddedNavLink>
          </s-text>
        ) : null}
        {message ? <s-text tone={tone}>{message}</s-text> : null}
      </s-section>

      <s-section heading="Settings">
        <fetcher.Form method="post">
          <input type="hidden" name="intent" value="save" />
          <s-stack direction="block" gap="base">
            <s-text-field
              name="imageMaxWidth"
              label="Max width (px)"
              value={String(settings.imageMaxWidth)}
            />
            <s-text-field
              name="imageQuality"
              label="JPEG quality (50–95)"
              value={String(settings.imageQuality)}
            />
            <s-button type="submit" disabled={!suiteUnlocked}>
              Save settings
            </s-button>
          </s-stack>
        </fetcher.Form>
      </s-section>

      <s-section heading="Run optimizer">
        <fetcher.Form method="post">
          <input type="hidden" name="intent" value="optimize" />
          <s-stack direction="block" gap="base">
            <s-text tone="neutral">
              Last run:{" "}
              {latest
                ? `${latest.status} · checked ${latest.imagesChecked} · optimized ${latest.imagesOptimized} · saved ~${Math.round(latest.bytesSaved / 1024)} KB · ${new Date(latest.startedAt).toLocaleString()}`
                : "never"}
            </s-text>
            {latest?.errorMessage ? (
              <s-text tone="critical">{latest.errorMessage}</s-text>
            ) : null}
            <s-button
              type="submit"
              variant="primary"
              disabled={!suiteUnlocked || running}
            >
              {running ? "Optimizing…" : "Optimize product images"}
            </s-button>
          </s-stack>
        </fetcher.Form>
      </s-section>

      <s-section heading="Results">
        {items.length === 0 ? (
          <s-text tone="neutral">No results yet.</s-text>
        ) : (
          <s-stack direction="block" gap="small-200">
            {items.map((item) => (
              <s-box key={item.id} padding="small-200" borderWidth="base" borderRadius="base">
                <s-text>
                  <strong>{item.status.toUpperCase()}</strong> — {item.productTitle || item.productId}
                </s-text>
                <s-text tone="neutral">
                  {item.message || "—"}
                  {item.originalBytes != null && item.newBytes != null
                    ? ` · ${Math.round(item.originalBytes / 1024)} KB → ${Math.round(item.newBytes / 1024)} KB`
                    : ""}
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
