import type {
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useLoaderData, useLocation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { SeoHomeButton } from "../HomeButton";
import { EmbeddedNavLink } from "../embedded-nav-link";
import prisma from "../db.server";
import {
  billingChargesAreTest,
  isPartnerDevelopmentStore,
  managedPricingPlansUrl,
  planHandleFromRequest,
  shouldRetryBillingSync,
  syncStoreUsagePlanFromShopify,
} from "../billing.server";
import {
  AI_IMAGE_MONTHLY_INCLUDED,
  AI_IMAGE_PLAN_LABEL_SHORT,
  AI_IMAGE_PLAN_USD_PER_MONTH,
  AI_IMAGE_PLAN_USD_PER_YEAR,
  FREE_AI_SEO_MONTHLY,
  FREE_PLAN_NAME,
  LAUNCH_STORE_TARGET,
  planFeaturesForListing,
  PRO_PLAN_NAME,
  SEO_PLAN_LABEL_SHORT,
  SEO_PLAN_USD_PER_MONTH,
  SEO_PLAN_USD_PER_YEAR,
  STARTER_PLAN_NAME,
} from "../pricing";
import {
  getEffectivePlan,
  planImageAllowed,
  planSeoUnlimited,
} from "../plan-helpers";
import { paysyncEnabled } from "../paysync-feature.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const partnerDevelopment = await isPartnerDevelopmentStore(admin);

  const syncedPlan = await syncStoreUsagePlanFromShopify(admin, shop, {
    planHandle: planHandleFromRequest(request),
    retry: shouldRetryBillingSync(request),
  });
  const usage = await prisma.storeUsage.upsert({
    where: { shop },
    update: {},
    create: { shop },
  });

  const effectivePlan = getEffectivePlan(usage);
  const apiKey = process.env.SHOPIFY_API_KEY || "";
  const changePlanUrl = managedPricingPlansUrl(shop, apiKey);

  return {
    plan: usage.plan,
    effectivePlan,
    freeQuotaLimit: usage.freeQuotaLimit,
    aiSeoUsed: usage.aiSeoUsed,
    aiImageUsed: usage.aiImageUsed,
    billingTestMode: billingChargesAreTest(),
    partnerDevelopment,
    showPaySync: paysyncEnabled(),
    changePlanUrl,
    syncedPlan,
  };
};

function currentPlanLabel(
  shopifyPlan: string,
  effectivePlan: string,
): string {
  if (effectivePlan === "free" || shopifyPlan === "free") {
    return `${FREE_PLAN_NAME}`;
  }
  if (effectivePlan === "seo" || shopifyPlan === "seo") {
    return `${STARTER_PLAN_NAME}`;
  }
  if (shopifyPlan === "seo_image") {
    return `${PRO_PLAN_NAME}`;
  }
  if (shopifyPlan === "image") {
    return `Legacy AI Image`;
  }
  return `${PRO_PLAN_NAME}`;
}

function currentPlanDetail(
  shopifyPlan: string,
  effectivePlan: string,
): string {
  if (effectivePlan === "free" || shopifyPlan === "free") {
    return `${FREE_AI_SEO_MONTHLY} AI SEO optimizations / month`;
  }
  if (effectivePlan === "seo" || shopifyPlan === "seo") {
    return "Unlimited AI SEO";
  }
  if (shopifyPlan === "seo_image" || shopifyPlan === "image") {
    return `Unlimited SEO + ${AI_IMAGE_MONTHLY_INCLUDED} AI images / month`;
  }
  return `Unlimited SEO + ${AI_IMAGE_MONTHLY_INCLUDED} AI images / month`;
}

export default function BillingPlansPage() {
  const {
    plan,
    effectivePlan,
    aiSeoUsed,
    aiImageUsed,
    freeQuotaLimit,
    billingTestMode,
    partnerDevelopment,
    showPaySync,
    changePlanUrl,
    syncedPlan,
  } = useLoaderData<typeof loader>();
  const { search } = useLocation();
  const params = new URLSearchParams(search.replaceAll("&amp;", "&"));
  const returned =
    params.get("billing") === "return" || params.get("pricing") === "return";

  const hasSeo = planSeoUnlimited(effectivePlan);
  const hasImage = planImageAllowed(effectivePlan);
  const isFree = effectivePlan === "free" || plan === "free";
  const isStarter = effectivePlan === "seo" || plan === "seo";
  const isPro =
    plan === "seo_image" ||
    plan === "image" ||
    (!isFree && !isStarter && hasImage);

  return (
    <div>
      <s-page heading="Plans and billing">
        <SeoHomeButton />

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

        {(billingTestMode || partnerDevelopment || returned) && (
          <div className="seoi-billing-notices">
            {billingTestMode ? (
              <div className="seoi-callout">
                Test billing mode — charges are simulated (no real payment).
              </div>
            ) : null}
            {partnerDevelopment ? (
              <div className="seoi-callout">
                Partner development store — paid-plan checks are bypassed for
                testing.
              </div>
            ) : null}
            {returned ? (
              <div className="seoi-callout seoi-callout--success">
                Plan updated from Shopify billing
                {syncedPlan ? ` — active plan: ${currentPlanLabel(syncedPlan, syncedPlan)}` : ""}.
                Entitlements below reflect your subscription.
              </div>
            ) : null}
          </div>
        )}

        <section className="seoi-section-card seoi-billing-current">
          <div className="seoi-section-heading">
            <div>
              <h3>Your current plan</h3>
              <p>Active entitlements for this store.</p>
            </div>
            <span className="seoi-status">Active</span>
          </div>

          <div className="seoi-billing-current__grid">
            <div className="seoi-billing-stat">
              <span className="seoi-billing-stat__label">Plan</span>
              <strong className="seoi-billing-stat__value">
                {currentPlanLabel(plan, effectivePlan)}
              </strong>
              <span className="seoi-billing-stat__meta">
                {currentPlanDetail(plan, effectivePlan)}
              </span>
            </div>
            <div className="seoi-billing-stat">
              <span className="seoi-billing-stat__label">AI SEO</span>
              <strong className="seoi-billing-stat__value">
                {hasSeo ? "Unlimited" : `${aiSeoUsed} / ${freeQuotaLimit}`}
              </strong>
              <span className="seoi-billing-stat__meta">
                {hasSeo ? "Within fair use" : "Free monthly quota"}
              </span>
            </div>
            <div className="seoi-billing-stat">
              <span className="seoi-billing-stat__label">AI images</span>
              <strong className="seoi-billing-stat__value">
                {hasImage
                  ? `${aiImageUsed} / ${AI_IMAGE_MONTHLY_INCLUDED}`
                  : "Not included"}
              </strong>
              <span className="seoi-billing-stat__meta">
                {hasImage ? "Per billing month" : "Upgrade to Pro"}
              </span>
            </div>
          </div>
        </section>

        <section className="seoi-section-card">
          <div className="seoi-section-heading">
            <div>
              <h3>Available plans</h3>
              <p>
                Switch plans anytime in Shopify — billing is managed by Shopify
                App Pricing.
              </p>
            </div>
            {changePlanUrl ? (
              <a
                className="seoi-nav-button seoi-nav-button--secondary"
                href={changePlanUrl}
                target="_top"
                rel="noreferrer"
              >
                Change plan
              </a>
            ) : null}
          </div>

          <div className="seoi-plan-grid">
            <article
              className={`seoi-plan-card${isFree ? " seoi-plan-card--current" : ""}`}
            >
              {isFree ? (
                <span className="seoi-plan-card__badge seoi-plan-card__badge--current">
                  Current
                </span>
              ) : null}
              <p className="seoi-plan-card__tier">Free</p>
              <h3>{FREE_PLAN_NAME}</h3>
              <div className="seoi-plan-card__price">
                <span className="seoi-plan-card__amount">$0</span>
                <span className="seoi-plan-card__period">forever</span>
              </div>
              <ul>
                {planFeaturesForListing("free", showPaySync).map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </article>

            <article
              className={`seoi-plan-card seoi-plan-card--featured${isStarter ? " seoi-plan-card--current" : ""}`}
            >
              <span className="seoi-plan-card__badge">
                {isStarter ? "Current" : "Best value"}
              </span>
              <p className="seoi-plan-card__tier">Basic</p>
              <h3>{STARTER_PLAN_NAME}</h3>
              <div className="seoi-plan-card__price">
                <span className="seoi-plan-card__amount">
                  ${SEO_PLAN_USD_PER_MONTH}
                </span>
                <span className="seoi-plan-card__period">/mo</span>
              </div>
              <p className="seoi-plan-card__alt-price">
                or ${SEO_PLAN_USD_PER_YEAR}/yr launch · {SEO_PLAN_LABEL_SHORT}
              </p>
              <p className="seoi-plan-card__note">
                Launch yearly for the first {LAUNCH_STORE_TARGET} stores.
              </p>
              <ul>
                {planFeaturesForListing("starter", showPaySync).map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </article>

            <article
              className={`seoi-plan-card${isPro ? " seoi-plan-card--current" : ""}`}
            >
              {isPro ? (
                <span className="seoi-plan-card__badge seoi-plan-card__badge--current">
                  Current
                </span>
              ) : null}
              <p className="seoi-plan-card__tier">Pro</p>
              <h3>{PRO_PLAN_NAME}</h3>
              <div className="seoi-plan-card__price">
                <span className="seoi-plan-card__amount">
                  ${AI_IMAGE_PLAN_USD_PER_MONTH}
                </span>
                <span className="seoi-plan-card__period">/mo</span>
              </div>
              <p className="seoi-plan-card__alt-price">
                or ${AI_IMAGE_PLAN_USD_PER_YEAR}/yr launch ·{" "}
                {AI_IMAGE_PLAN_LABEL_SHORT}
              </p>
              <ul>
                {planFeaturesForListing("pro", showPaySync).map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </article>
          </div>
        </section>

        <section className="seoi-section-card seoi-billing-managed">
          <div className="seoi-section-heading">
            <div>
              <h3>How billing works</h3>
              <p>Shopify Managed Pricing handles approval and charges.</p>
            </div>
          </div>
          <ul className="seoi-billing-steps">
            <li>
              Use <strong>Change plan</strong> below to upgrade or downgrade in
              Shopify — no support ticket or reinstall required.
            </li>
            <li>
              Plan approval, decline, and re-approval happen in Shopify&apos;s
              checkout flow.
            </li>
            <li>
              Charges appear in Shopify Admin → Settings → Billing → App
              charges after you confirm a plan.
            </li>
          </ul>
          <div className="seoi-billing-actions">
            {changePlanUrl ? (
              <a
                className="seoi-nav-button seoi-nav-button--primary"
                href={changePlanUrl}
                target="_top"
                rel="noreferrer"
              >
                Change plan
              </a>
            ) : null}
            <EmbeddedNavLink
              hrefPathname="/app/billing/plans"
              variant="secondary"
            >
              Refresh plan status
            </EmbeddedNavLink>
            <EmbeddedNavLink
              hrefPathname="/app/seo-optimize"
              variant="secondary"
            >
              ← Back to SEO hub
            </EmbeddedNavLink>
          </div>
        </section>
      </s-page>
    </div>
  );
}

export const headers: HeadersFunction = (args) => boundary.headers(args);
