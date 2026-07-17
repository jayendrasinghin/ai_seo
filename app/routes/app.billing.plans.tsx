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
  AI_IMAGE_MONTHLY_INCLUDED,
  AI_IMAGE_PLAN_LABEL,
  FREE_AI_SEO_MONTHLY,
  FREE_PLAN_NAME,
  LAUNCH_STORE_TARGET,
  PLAN_FEATURES,
  PRO_PLAN_NAME,
  SEO_PLAN_LABEL,
  STARTER_PLAN_NAME,
} from "../pricing";
import {
  getEffectivePlan,
  planImageAllowed,
  planSeoUnlimited,
} from "../plan-helpers";
import { withEmbeddedSearch } from "../embedded-nav";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const partnerDevelopment = await isPartnerDevelopmentStore(admin);

  await syncStoreUsagePlanFromShopify(admin, shop);
  const usage = await prisma.storeUsage.upsert({
    where: { shop },
    update: {},
    create: { shop },
  });

  const effectivePlan = getEffectivePlan(usage);

  return {
    plan: usage.plan,
    effectivePlan,
    freeQuotaLimit: usage.freeQuotaLimit,
    aiSeoUsed: usage.aiSeoUsed,
    aiImageUsed: usage.aiImageUsed,
    billingTestMode: billingChargesAreTest(),
    partnerDevelopment,
  };
};

function currentPlanLabel(
  shopifyPlan: string,
  effectivePlan: string,
): string {
  if (effectivePlan === "free" || shopifyPlan === "free") {
    return `${FREE_PLAN_NAME} — ${FREE_AI_SEO_MONTHLY} AI SEO optimizations/month`;
  }
  if (effectivePlan === "seo" || shopifyPlan === "seo") {
    return `${STARTER_PLAN_NAME} (${SEO_PLAN_LABEL}) — unlimited AI SEO`;
  }
  if (shopifyPlan === "seo_image") {
    return `${PRO_PLAN_NAME} (${AI_IMAGE_PLAN_LABEL}) — unlimited SEO + ${AI_IMAGE_MONTHLY_INCLUDED} images/mo`;
  }
  if (shopifyPlan === "image") {
    return `Legacy AI Image (${AI_IMAGE_PLAN_LABEL}) — ${AI_IMAGE_MONTHLY_INCLUDED} images/mo`;
  }
  return `${PRO_PLAN_NAME} — unlimited SEO + ${AI_IMAGE_MONTHLY_INCLUDED} images/mo`;
}

export default function BillingPlansPage() {
  const {
    plan,
    effectivePlan,
    billingTestMode,
    partnerDevelopment,
  } = useLoaderData<typeof loader>();
  const { search } = useLocation();
  const params = new URLSearchParams(search.replaceAll("&amp;", "&"));
  const returned = params.get("billing") === "return" || params.get("pricing") === "return";

  const hasSeo = planSeoUnlimited(effectivePlan);
  const hasImage = planImageAllowed(effectivePlan);

  return (
    <div>
      <s-page heading="Plans and billing">
        <div className="seoi-page-hero">
          <div className="seoi-page-hero__content">
            <span className="seoi-eyebrow">Simple, transparent pricing</span>
            <h2>Choose the SEO toolkit that fits your store.</h2>
            <p>
              Start free, unlock unlimited AI SEO, or add product-image
              generation as your catalog grows.
            </p>
          </div>
          <span className="seoi-status">Managed by Shopify</span>
        </div>

        {billingTestMode ? (
          <s-section>
            <s-text tone="neutral">
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
              <strong>Plan:</strong> {currentPlanLabel(plan, effectivePlan)}
            </s-text>
            {hasSeo ? (
              <s-text tone="neutral">AI SEO: unlimited (within fair use).</s-text>
            ) : null}
            {hasImage ? (
              <s-text tone="neutral">
                AI product images: up to {AI_IMAGE_MONTHLY_INCLUDED} per billing month.
              </s-text>
            ) : null}
          </s-stack>
        </s-section>

        <s-section heading="Available plans">
          <div className="seoi-plan-grid">
            <article className="seoi-plan-card">
              <h3>Free — {FREE_PLAN_NAME}</h3>
              <div className="seoi-plan-card__price">$0 · Free forever</div>
              <ul>
                {PLAN_FEATURES.free.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </article>
            <article className="seoi-plan-card seoi-plan-card--featured">
              <span className="seoi-plan-card__badge">Best value</span>
              <h3>Starter — {STARTER_PLAN_NAME}</h3>
              <div className="seoi-plan-card__price">
                {SEO_PLAN_LABEL} · 30-day trial
              </div>
              <p className="seoi-tool-card__meta">
                Launch yearly pricing for the first {LAUNCH_STORE_TARGET} stores.
                Existing subscriptions continue to match after regular pricing
                is introduced.
              </p>
              <ul>
                {PLAN_FEATURES.starter.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </article>
            <article className="seoi-plan-card">
              <h3>Pro — {PRO_PLAN_NAME}</h3>
              <div className="seoi-plan-card__price">
                {AI_IMAGE_PLAN_LABEL} · 30-day trial
              </div>
              <ul>
                {PLAN_FEATURES.pro.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </article>
          </div>
        </s-section>

        <s-section heading="Managed pricing">
          <s-text tone="neutral">
            This app uses Shopify Managed Pricing. Plan approval, decline, and re-approval are
            handled by Shopify during install and reinstall flows.
          </s-text>
          <div style={{ marginTop: "1rem" }}>
            <s-stack direction="block" gap="base">
              <s-text tone="neutral">
                To switch plans, open your app listing in Shopify and choose a managed pricing plan
                there.
              </s-text>
              <s-text tone="neutral">
                If a merchant declined a charge previously, Shopify will request approval again when
                they reinstall and select a paid plan.
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
