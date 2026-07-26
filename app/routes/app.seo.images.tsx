import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useEffect, useState } from "react";
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
import { ModernPageHeader } from "../ModernPageHeader";
import { SeoHomeButton } from "../HomeButton";
import { getOrCreateSeoSettings } from "../seo-settings.server";
import { runImageOptimizeBatch } from "../image-optimize.server";
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
    suiteUnlocked: partnerDevelopment || planHasSeoSuite(getEffectivePlan(usage)),
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
  if (!partnerDevelopment && !planHasSeoSuite(getEffectivePlan({ plan: usage?.plan ?? "free", foundingMember: usage?.foundingMember ?? false, foundingMemberNumber: usage?.foundingMemberNumber ?? null, foundingGrantedAt: usage?.foundingGrantedAt ?? null, foundingExpiresAt: usage?.foundingExpiresAt ?? null }))) {
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

const SIZE_PRESETS = [800, 1200, 1600, 2048, 3000] as const;

export default function ImageOptimizePage() {
  const { settings, latest, items, suiteUnlocked } =
    useLoaderData<typeof loader>();
  const { search } = useLocation();
  const fetcher = useFetcher<typeof action>();
  const revalidator = useRevalidator();
  const [maxWidth, setMaxWidth] = useState(String(settings.imageMaxWidth));
  const [quality, setQuality] = useState(String(settings.imageQuality));
  const message = fetcher.data?.message;
  const tone = fetcher.data?.status === "error" ? "critical" : "success";
  const running =
    fetcher.state !== "idle" && fetcher.formData?.get("intent") === "optimize";
  const saving =
    fetcher.state !== "idle" && fetcher.formData?.get("intent") === "save";

  useEffect(() => {
    setMaxWidth(String(settings.imageMaxWidth));
    setQuality(String(settings.imageQuality));
  }, [settings.imageMaxWidth, settings.imageQuality]);

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.status === "ok") {
      revalidator.revalidate();
    }
  }, [fetcher.state, fetcher.data, revalidator]);

  return (
    <s-page heading="Image optimize">
      <SeoHomeButton />
      <s-link slot="breadcrumb-actions" href={withEmbeddedSearch("/app/seo", search)}>
        SEO Suite
      </s-link>
      <ModernPageHeader
        eyebrow="Storefront performance"
        title="Reduce image weight without leaving Shopify."
        description="Resize and compress product media with controlled dimensions and quality, then review the savings from each run."
        status={latest ? `Last run: ${latest.status}` : "Ready to optimize"}
      />

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

      <s-section heading="Change image size">
        <fetcher.Form method="post">
          <input type="hidden" name="intent" value="save" />
          <input type="hidden" name="imageMaxWidth" value={maxWidth} />
          <input type="hidden" name="imageQuality" value={quality} />
          <s-stack direction="block" gap="base">
            <s-text tone="neutral">
              Choose a max width (or type a custom size). Wider images are resized down to this
              width; smaller images are not enlarged.
            </s-text>
            <s-stack direction="inline" gap="small-200">
              {SIZE_PRESETS.map((preset) => (
                <s-button
                  key={preset}
                  type="button"
                  variant={Number(maxWidth) === preset ? "primary" : "secondary"}
                  disabled={!suiteUnlocked}
                  onClick={() => setMaxWidth(String(preset))}
                >
                  {preset}px
                </s-button>
              ))}
            </s-stack>
            <label htmlFor="image-max-width">
              Max width (px)
              <input
                id="image-max-width"
                type="number"
                min={800}
                max={4000}
                step={1}
                value={maxWidth}
                disabled={!suiteUnlocked}
                onChange={(e) => setMaxWidth(e.target.value)}
                style={{ display: "block", width: "100%", marginTop: 6 }}
              />
            </label>
            <label htmlFor="image-quality">
              JPEG quality (50–95)
              <input
                id="image-quality"
                type="number"
                min={50}
                max={95}
                step={1}
                value={quality}
                disabled={!suiteUnlocked}
                onChange={(e) => setQuality(e.target.value)}
                style={{ display: "block", width: "100%", marginTop: 6 }}
              />
            </label>
            <s-button type="submit" disabled={!suiteUnlocked || saving}>
              {saving ? "Saving…" : "Save size settings"}
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
