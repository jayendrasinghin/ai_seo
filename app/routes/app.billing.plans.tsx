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
  FOUNDING_MEMBER_LIMIT,
  FOUNDING_MONTHS,
  FREE_AI_SEO_MONTHLY,
  FREE_PLAN_NAME,
  PLAN_FEATURES,
  PRO_PLAN_NAME,
  SEO_PLAN_LABEL,
  STARTER_PLAN_NAME,
} from "../pricing";
import {
  foundingOfferSummary,
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
  const founding = foundingOfferSummary(usage);

  return {
    plan: usage.plan,
    effectivePlan,
    founding,
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
  founding: ReturnType<typeof foundingOfferSummary>,
): string {
  if (founding.active) {
    return `Founding Member #${founding.number} — ${STARTER_PLAN_NAME} free until ${founding.expiresAt?.toLocaleDateString() ?? "—"} (${founding.daysLeft} days left)`;
  }
  if (founding.expired) {
    return `Founding year ended — now on ${shopifyPlan === "free" ? FREE_PLAN_NAME : shopifyPlan === "seo" ? STARTER_PLAN_NAME : PRO_PLAN_NAME}. Upgrade to keep Starter (${SEO_PLAN_LABEL}).`;
  }
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
    founding,
    billingTestMode,
    partnerDevelopment,
  } = useLoaderData<typeof loader>();
  const { search } = useLocation();
  const params = new URLSearchParams(search.replaceAll("&amp;", "&"));
  const returned = params.get("billing") === "return" || params.get("pricing") === "return";

  const hasSeo = planSeoUnlimited(effectivePlan);
  const hasImage = planImageAllowed(effectivePlan);

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
              testing, so subscription checkout is not required. Dev stores do not use founding
              member slots.
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

        {founding.active ? (
          <s-section heading="Launch offer">
            <s-stack direction="block" gap="small-200">
              <s-text tone="success">
                You are Founding Member #{founding.number} of {FOUNDING_MEMBER_LIMIT}.{" "}
                {STARTER_PLAN_NAME} is included free for {FOUNDING_MONTHS} months.
              </s-text>
              <s-text tone="neutral">
                Expires {founding.expiresAt?.toLocaleDateString() ?? "—"} ({founding.daysLeft} days
                left). After that, keep Starter at {SEO_PLAN_LABEL}, or stay on Free. AI product
                images stay on Pro ({AI_IMAGE_PLAN_LABEL}).
              </s-text>
            </s-stack>
          </s-section>
        ) : null}

        {founding.expired ? (
          <s-section heading="Founding year ended">
            <s-text tone="caution">
              Your {FOUNDING_MONTHS}-month Starter offer has ended. Upgrade to {STARTER_PLAN_NAME} (
              {SEO_PLAN_LABEL}) to keep unlimited AI SEO and the SEO Suite, or continue on{" "}
              {FREE_PLAN_NAME}.
            </s-text>
          </s-section>
        ) : null}

        <s-section heading="Current plan">
          <s-stack direction="block" gap="small-200">
            <s-text>
              <strong>Plan:</strong> {currentPlanLabel(plan, effectivePlan, founding)}
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
          <s-stack direction="block" gap="base">
            <div>
              <s-text>
                <strong>Free — {FREE_PLAN_NAME}</strong>
              </s-text>
              <s-unordered-list>
                {PLAN_FEATURES.free.map((line) => (
                  <s-list-item key={line}>{line}</s-list-item>
                ))}
              </s-unordered-list>
            </div>
            <div>
              <s-text>
                <strong>Starter — {STARTER_PLAN_NAME}</strong> ({SEO_PLAN_LABEL}, 30-day trial)
              </s-text>
              <s-text tone="neutral">
                First {FOUNDING_MEMBER_LIMIT} stores: Starter free for {FOUNDING_MONTHS} months,
                then {SEO_PLAN_LABEL} or Free.
              </s-text>
              <s-unordered-list>
                {PLAN_FEATURES.starter.map((line) => (
                  <s-list-item key={line}>{line}</s-list-item>
                ))}
              </s-unordered-list>
            </div>
            <div>
              <s-text>
                <strong>Pro — {PRO_PLAN_NAME}</strong> ({AI_IMAGE_PLAN_LABEL}, 30-day trial)
              </s-text>
              <s-unordered-list>
                {PLAN_FEATURES.pro.map((line) => (
                  <s-list-item key={line}>{line}</s-list-item>
                ))}
              </s-unordered-list>
            </div>
          </s-stack>
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
