import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useLocation, useRouteError } from "react-router";
import { withEmbeddedSearch } from "../embedded-nav";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";

import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  // eslint-disable-next-line no-undef
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();
  const { search } = useLocation();

  return (
    <AppProvider embedded apiKey={apiKey}>
      <s-app-nav>
        <s-link href={withEmbeddedSearch("/app", search)}>
          Image SEO Optimizer
        </s-link>
        <s-link href={withEmbeddedSearch("/app/products", search)}>
          Product Tools
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
      </s-app-nav>
      <Outlet />
    </AppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
