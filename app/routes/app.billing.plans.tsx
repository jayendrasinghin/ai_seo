import type {
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useLoaderData, useLocation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  billingChargesAreTest,
  isPartnerDevelopmentStore,
  syncStoreUsagePlanFromShopify,
} from "../billing.server";
import {
  AI_IMAGE_PLAN_LABEL,
  AI_IMAGE_MONTHLY_INCLUDED,
  SEO_PLAN_LABEL,
} from "../pricing";
import { planImageAllowed, planSeoUnlimited } from "../plan-helpers";
import { withEmbeddedSearch } from "../embedded-nav";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const partnerDevelopment = await isPartnerDevelopmentStore(admin);

  const plan = await syncStoreUsagePlanFromShopify(admin, shop);
  const usage = await prisma.storeUsage.upsert({
    where: { shop },
    update: {},
    create: { shop },
  });

  return {
    plan,
    freeQuotaLimit: usage.freeQuotaLimit,
    aiSeoUsed: usage.aiSeoUsed,
    aiImageUsed: usage.aiImageUsed,
    billingTestMode: billingChargesAreTest(),
    partnerDevelopment,
  };
};

export default function BillingPlansPage() {
  const { plan, billingTestMode, partnerDevelopment } = useLoaderData<typeof loader>();
  const { search } = useLocation();
  const params = new URLSearchParams(search.replaceAll("&amp;", "&"));
  const returned = params.get("billing") === "return" || params.get("pricing") === "return";

  const hasSeo = planSeoUnlimited(plan);
  const hasImage = planImageAllowed(plan);

  return (
    <div
      style={{
        maxWidth: "40rem",
        margin: "0 auto",
        padding: "1.25rem 1rem 2rem",
      }}
    >
      <s-page heading="Plans and billing">
        {billingTestMode ? (
          <s-section>
            <s-text tone="subdued">
              Test billing mode: charges are simulated (no real payment). Production uses live
              billing when NODE_ENV is production and SHOPIFY_BILLING_TEST is not true.
            </s-text>
          </s-section>
        ) : null}
        {partnerDevelopment ? (
          <s-section>
            <s-text tone="info">
              Partner development store detected. This app bypasses paid-plan checks here for
              testing, so subscription checkout is not required.
            </s-text>
          </s-section>
        ) : null}

        {returned ? (
          <s-section>
            <s-text tone="success">
              You returned from Shopify managed pricing. Your plan below should update within a few
              seconds. If it still looks wrong, refresh this page.
            </s-text>
          </s-section>
        ) : null}

        <s-section heading="Current plan">
          <s-stack direction="block" gap="small-200">
            <s-text>
              <strong>Plan:</strong>{" "}
              {plan === "free"
                ? "Includes 100 combined AI SEO + image generations"
                : plan === "seo"
                  ? `AI SEO Pro (${SEO_PLAN_LABEL}) — unlimited AI SEO`
                  : plan === "seo_image"
                    ? `SEO Pro + AI Image (${AI_IMAGE_PLAN_LABEL}) — unlimited SEO + ${AI_IMAGE_MONTHLY_INCLUDED} images/mo`
                    : plan === "image"
                      ? `Legacy AI Image (${AI_IMAGE_PLAN_LABEL}) — ${AI_IMAGE_MONTHLY_INCLUDED} images/mo`
                    : `SEO Pro + AI Image — unlimited SEO + ${AI_IMAGE_MONTHLY_INCLUDED} images/mo`}
            </s-text>
            {hasSeo ? (
              <s-text tone="subdued">AI SEO: unlimited (within fair use).</s-text>
            ) : null}
            {hasImage ? (
              <s-text tone="subdued">
                AI product images: up to {AI_IMAGE_MONTHLY_INCLUDED} per billing month.
              </s-text>
            ) : null}
          </s-stack>
        </s-section>

        <s-section heading="Managed pricing">
          <s-text tone="subdued">
            This app now uses Shopify Managed Pricing only. Plan approval, decline, and re-approval
            are handled by Shopify during install and reinstall flows.
          </s-text>
          <div style={{ marginTop: "1rem" }}>
            <s-stack direction="block" gap="base">
              <s-text tone="subdued">
                To switch plans, open your app listing in Shopify and choose a managed pricing
                plan there.
              </s-text>
              <s-text tone="subdued">
                If a merchant declined a charge previously, Shopify will request approval again
                when they reinstall and select a paid plan.
              </s-text>
            </s-stack>
          </div>
        </s-section>

        <s-section>
          <s-link href={withEmbeddedSearch("/app", search)}>Back to app home</s-link>
        </s-section>
      </s-page>
    </div>
  );
}

export const headers: HeadersFunction = (args) => boundary.headers(args);
