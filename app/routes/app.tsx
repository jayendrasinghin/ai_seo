import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useLocation, useRouteError } from "react-router";
import { withEmbeddedSearch } from "../embedded-nav";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { useSeoiCssLock } from "../seoi-css-lock";
import { lastShopSetCookieHeader } from "../last-shop.server";

import { authenticate } from "../shopify.server";
import { maybeSyncStoreProfileForShop } from "../store-profile.server";
import { paysyncEnabled } from "../paysync-feature.server";
import {
  planHandleFromRequest,
  shouldRetryBillingSync,
  syncStoreUsagePlanFromShopify,
} from "../billing.server";
import { appNavLabel } from "../app-nav-label";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const setCookie = await lastShopSetCookieHeader(session.shop);

  // Keep entitlements in sync after managed-pricing upgrade/downgrade.
  await syncStoreUsagePlanFromShopify(admin, session.shop, {
    planHandle: planHandleFromRequest(request),
    retry: shouldRetryBillingSync(request),
  }).catch((error) => {
    console.error("[app] billing sync failed", session.shop, error);
  });

  // Capture merchant email / store profile on app open (throttled to once/day).
  void maybeSyncStoreProfileForShop(session.shop).catch((error) => {
    console.error("[app] store profile sync failed", session.shop, error);
  });

  // eslint-disable-next-line no-undef
  return Response.json(
    {
      apiKey: process.env.SHOPIFY_API_KEY || "",
      paysyncEnabled: paysyncEnabled(),
    },
    setCookie ? { headers: { "Set-Cookie": setCookie } } : undefined,
  );
};

function isPaySyncPath(pathname: string) {
  return pathname === "/app/paysync" || pathname.startsWith("/app/paysync/");
}

function isSupportPath(pathname: string) {
  return pathname === "/app/support" || pathname.startsWith("/app/support/");
}

function supportProductFromSearch(search: string): "paysync" | "seoi" {
  const q = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const raw = (q.get("product") || "").trim().toLowerCase();
  if (raw === "paysync" || raw === "pay-sync" || raw === "paypal" || raw === "pay") {
    return "paysync";
  }
  return "seoi";
}

export default function App() {
  useSeoiCssLock();
  const { apiKey, paysyncEnabled: paySyncOn } = useLoaderData<typeof loader>();
  const { pathname, search } = useLocation();
  const onPaySync =
    paySyncOn &&
    (isPaySyncPath(pathname) ||
      (isSupportPath(pathname) && supportProductFromSearch(search) === "paysync"));
  const onPaySyncOnboarding =
    paySyncOn && pathname.startsWith("/app/paysync/onboarding");

  return (
    <AppProvider embedded apiKey={apiKey}>
      {!onPaySyncOnboarding && (
        <s-app-nav>
          <s-link
            href={withEmbeddedSearch("/app", search, { product: null })}
            {...({ rel: "home" } as Record<string, string>)}
          >
            Home
          </s-link>
          <s-link
            href={withEmbeddedSearch("/app/seo-optimize", search, {
              product: null,
            })}
          >
            {appNavLabel("AI SEO & Images")}
          </s-link>
          <s-link
            href={withEmbeddedSearch("/app/products", search, {
              product: null,
            })}
          >
            {appNavLabel("Product Optimization", 1)}
          </s-link>
          <s-link href={withEmbeddedSearch("/app/seo", search, { product: null })}>
            {appNavLabel("AI SEO Suite", 1)}
          </s-link>
          <s-link
            href={withEmbeddedSearch("/app/manage", search, {
              product: null,
            })}
          >
            {appNavLabel("Stock & Products")}
          </s-link>
          {paySyncOn ? (
            <>
              <s-link
                href={withEmbeddedSearch("/app/paysync", search, {
                  product: null,
                })}
              >
                {appNavLabel("PaySync")}
              </s-link>
              <s-link
                href={withEmbeddedSearch("/app/paysync/orders", search, {
                  product: null,
                })}
              >
                {appNavLabel("Orders", 1)}
              </s-link>
              <s-link
                href={withEmbeddedSearch("/app/paysync/queue", search, {
                  product: null,
                })}
              >
                {appNavLabel("Sync queue", 1)}
              </s-link>
              <s-link
                href={withEmbeddedSearch("/app/paysync/paypal", search, {
                  product: null,
                })}
              >
                {appNavLabel("Payment accounts", 1)}
              </s-link>
              <s-link
                href={withEmbeddedSearch("/app/paysync/settings", search, {
                  product: null,
                })}
              >
                {appNavLabel("PaySync settings", 1)}
              </s-link>
            </>
          ) : null}
          <s-link
            href={withEmbeddedSearch("/app/billing/plans", search, {
              product: null,
            })}
          >
            {appNavLabel("Plans & billing")}
          </s-link>
          <s-link
            href={withEmbeddedSearch("/app/support", search, {
              product: paySyncOn && onPaySync ? "paysync" : "seoi",
            })}
          >
            {appNavLabel("Help & support")}
          </s-link>
        </s-app-nav>
      )}
      <main className="seoi-app-shell">
        <Outlet />
      </main>
    </AppProvider>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
