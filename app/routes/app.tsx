import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useLocation, useRouteError } from "react-router";
import { withEmbeddedSearch } from "../embedded-nav";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { useSeoiCssLock } from "../seoi-css-lock";
import { lastShopSetCookieHeader } from "../last-shop.server";

import { authenticate } from "../shopify.server";
import { maybeSyncStoreProfileForShop } from "../store-profile.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const setCookie = await lastShopSetCookieHeader(session.shop);

  // Capture merchant email / store profile on app open (throttled to once/day).
  void maybeSyncStoreProfileForShop(session.shop).catch((error) => {
    console.error("[app] store profile sync failed", session.shop, error);
  });

  // eslint-disable-next-line no-undef
  return Response.json(
    { apiKey: process.env.SHOPIFY_API_KEY || "" },
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

function isSeoWorkspacePath(pathname: string, search: string) {
  if (pathname === "/app" || pathname === "/app/") return false;
  if (isPaySyncPath(pathname)) return false;
  // Shared /app/support: keep PaySync nav when opened from PaySync.
  if (isSupportPath(pathname) && supportProductFromSearch(search) === "paysync") {
    return false;
  }
  return pathname.startsWith("/app/");
}

export default function App() {
  useSeoiCssLock();
  const { apiKey } = useLoaderData<typeof loader>();
  const { pathname, search } = useLocation();
  const onPaySync =
    isPaySyncPath(pathname) ||
    (isSupportPath(pathname) && supportProductFromSearch(search) === "paysync");
  const onSeoWorkspace = isSeoWorkspacePath(pathname, search);
  const onPaySyncOnboarding = pathname.startsWith("/app/paysync/onboarding");
  const onHome = pathname === "/app" || pathname === "/app/";

  return (
    <AppProvider embedded apiKey={apiKey}>
      {!onPaySyncOnboarding && (
        <s-app-nav>
          {onHome ? (
            <>
              <s-link href={withEmbeddedSearch("/app", search, { product: null })}>
                Home
              </s-link>
              <s-link
                href={withEmbeddedSearch("/app/seo-optimize", search, {
                  product: null,
                })}
              >
                SEO &amp; Image Optimization
              </s-link>
              <s-link
                href={withEmbeddedSearch("/app/paysync", search, {
                  product: null,
                })}
              >
                PayPal and Razorpay Sync
              </s-link>
            </>
          ) : null}

          {onSeoWorkspace ? (
            <>
              <s-link
                href={withEmbeddedSearch("/app/seo-optimize", search, {
                  product: null,
                })}
              >
                Home
              </s-link>
              <s-link
                href={withEmbeddedSearch("/app/seo-dashboard", search, {
                  product: null,
                })}
              >
                SEO Optimization
              </s-link>
              <s-link
                href={withEmbeddedSearch("/app/products", search, {
                  product: null,
                })}
              >
                Product Optimization
              </s-link>
              <s-link
                href={withEmbeddedSearch("/app/seo", search, { product: null })}
              >
                SEO Suite
              </s-link>
              <s-link
                href={withEmbeddedSearch("/app/manage", search, {
                  product: null,
                })}
              >
                Stock &amp; New Product
              </s-link>
              <s-link
                href={withEmbeddedSearch("/app/billing/plans", search, {
                  product: null,
                })}
              >
                Plans &amp; billing
              </s-link>
              <s-link
                href={withEmbeddedSearch("/app/support", search, {
                  product: "seoi",
                })}
              >
                Help &amp; support
              </s-link>
            </>
          ) : null}

          {onPaySync ? (
            <>
              <s-link
                href={withEmbeddedSearch("/app/paysync", search, {
                  product: null,
                })}
              >
                Home
              </s-link>
              <s-link
                href={withEmbeddedSearch("/app/paysync/orders", search, {
                  product: null,
                })}
              >
                Orders
              </s-link>
              <s-link
                href={withEmbeddedSearch("/app/paysync/queue", search, {
                  product: null,
                })}
              >
                Sync queue
              </s-link>
              <s-link
                href={withEmbeddedSearch("/app/paysync/paypal", search, {
                  product: null,
                })}
              >
                Payment accounts
              </s-link>
              <s-link
                href={withEmbeddedSearch("/app/paysync/settings", search, {
                  product: null,
                })}
              >
                Settings
              </s-link>
              <s-link
                href={withEmbeddedSearch("/app/support", search, {
                  product: "paysync",
                })}
              >
                Help &amp; support
              </s-link>
            </>
          ) : null}
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
