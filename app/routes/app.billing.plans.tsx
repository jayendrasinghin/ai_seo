import { useEffect } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData, useLocation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  billingChargesAreTest,
  billingReturnUrl,
  createAppSubscription,
  isPartnerDevelopmentStore,
  syncStoreUsagePlanFromShopify,
  type BillingPlanChoice,
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

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const choice = String(formData.get("plan") || "") as BillingPlanChoice;

  if (choice !== "seo" && choice !== "seo_image") {
    return { error: "Invalid plan." };
  }
  // if (partnerDevelopment) {
  //   return {
  //     error:
  //       "Development store detected. Paid subscription checkout is disabled; test features are already unlocked.",
  //   };
  // }

  const returnUrl = billingReturnUrl(session.shop);
  const result = await createAppSubscription(
    admin,
    session.shop,
    choice,
    returnUrl,
  );

  if (!result.ok) {
    return { error: result.error };
  }

  /** Do not use HTTP redirect — embedded app iframe cannot load admin.shopify.com (X-Frame-Options). */
  return { confirmationUrl: result.confirmationUrl };
};

export default function BillingPlansPage() {
  const { plan, billingTestMode, partnerDevelopment } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const { search } = useLocation();

  useEffect(() => {
    const data = fetcher.data;
    if (
      data &&
      typeof data === "object" &&
      "confirmationUrl" in data &&
      typeof (data as { confirmationUrl?: string }).confirmationUrl === "string"
    ) {
      const url = (data as { confirmationUrl: string }).confirmationUrl;
      if (url) {
        const topWin = window.top ?? window;
        topWin.location.href = url;
      }
    }
  }, [fetcher.data]);
  const params = new URLSearchParams(search.replaceAll("&amp;", "&"));
  const returned = params.get("billing") === "return";

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

        {fetcher.data && "error" in fetcher.data && fetcher.data.error ? (
          <s-section>
            <s-text tone="critical">{fetcher.data.error}</s-text>
          </s-section>
        ) : null}

        {returned ? (
          <s-section>
            <s-text tone="success">
              You returned from Shopify billing. Your plan below should update within a few
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

        <s-section heading="Subscribe or change plan">
          <s-text tone="subdued">
            Shopify may ask you to approve a new charge when you add or change plans. If you
            already have a subscription, the new one replaces it.
          </s-text>
          <div style={{ marginTop: "1rem" }}>
            <s-stack direction="block" gap="base">
            <fetcher.Form method="post">
              <input type="hidden" name="plan" value="seo" />
              {plan === "seo" ? (
                <s-text tone="success">Current plan: AI SEO Pro ({SEO_PLAN_LABEL})</s-text>
              ) : (
                <s-button
                  variant="primary"
                  type="submit"
                  disabled={fetcher.state !== "idle"}
                >
                  {fetcher.state !== "idle" && fetcher.formData?.get("plan") === "seo"
                    ? "Redirecting to Shopify…"
                    : `Subscribe AI SEO Pro (${SEO_PLAN_LABEL})`}
                </s-button>
              )}
            </fetcher.Form>
            <fetcher.Form method="post">
              <input type="hidden" name="plan" value="seo_image" />
              {plan === "seo_image" || plan === "image" ? (
                <s-text tone="success">
                  Current plan: SEO Pro + AI Image ({AI_IMAGE_PLAN_LABEL})
                </s-text>
              ) : (
                <s-button
                  variant="secondary"
                  type="submit"
                  disabled={fetcher.state !== "idle"}
                >
                  {fetcher.state !== "idle" && fetcher.formData?.get("plan") === "seo_image"
                    ? "Redirecting to Shopify…"
                    : `Subscribe SEO Pro + AI Image (${AI_IMAGE_PLAN_LABEL})`}
                </s-button>
              )}
            </fetcher.Form>
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
