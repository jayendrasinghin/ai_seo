import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useLocation, useRouteError } from "react-router";
import { withEmbeddedSearch } from "../embedded-nav";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { useSeoiCssLock } from "../seoi-css-lock";

import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  // eslint-disable-next-line no-undef
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

function isPaySyncPath(pathname: string) {
  return pathname === "/app/paysync" || pathname.startsWith("/app/paysync/");
}

function isSeoWorkspacePath(pathname: string) {
  if (pathname === "/app" || pathname === "/app/") return false;
  if (isPaySyncPath(pathname)) return false;
  return pathname.startsWith("/app/");
}

export default function App() {
  useSeoiCssLock();
  const { apiKey } = useLoaderData<typeof loader>();
  const { pathname, search } = useLocation();
  const onPaySync = isPaySyncPath(pathname);
  const onSeoWorkspace = isSeoWorkspacePath(pathname);
  const onPaySyncOnboarding = pathname.startsWith("/app/paysync/onboarding");
  const onHome = pathname === "/app" || pathname === "/app/";

  return (
    <AppProvider embedded apiKey={apiKey}>
      {!onPaySyncOnboarding && (
        <s-app-nav>
          {onHome ? (
            <>
              <s-link href={withEmbeddedSearch("/app", search)}>Home</s-link>
              <s-link href={withEmbeddedSearch("/app/seo-optimize", search)}>
                SEO &amp; Image Optimization
              </s-link>
              <s-link href={withEmbeddedSearch("/app/paysync", search)}>
                PayPal and Razorpay Sync
              </s-link>
            </>
          ) : null}

          {onSeoWorkspace ? (
            <>
              <s-link href={withEmbeddedSearch("/app/seo-optimize", search)}>
                Home
              </s-link>
              <s-link href={withEmbeddedSearch("/app/seo-dashboard", search)}>
                SEO Optimization
              </s-link>
              <s-link href={withEmbeddedSearch("/app/products", search)}>
                Product Optimization
              </s-link>
              <s-link href={withEmbeddedSearch("/app/seo", search)}>
                SEO Suite
              </s-link>
              <s-link href={withEmbeddedSearch("/app/manage", search)}>
                Stock &amp; New Product
              </s-link>
              <s-link href={withEmbeddedSearch("/app/billing/plans", search)}>
                Plans &amp; billing
              </s-link>
              <s-link href={withEmbeddedSearch("/app/support", search)}>
                Help &amp; support
              </s-link>
            </>
          ) : null}

          {onPaySync ? (
            <>
              <s-link href={withEmbeddedSearch("/app/paysync", search)}>
                Home
              </s-link>
              <s-link href={withEmbeddedSearch("/app/paysync/orders", search)}>
                Orders
              </s-link>
              <s-link href={withEmbeddedSearch("/app/paysync/queue", search)}>
                Sync queue
              </s-link>
              <s-link href={withEmbeddedSearch("/app/paysync/paypal", search)}>
                Payment accounts
              </s-link>
              <s-link href={withEmbeddedSearch("/app/paysync/settings", search)}>
                Settings
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
