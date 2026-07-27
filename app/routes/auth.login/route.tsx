import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, redirect, useActionData, useLoaderData } from "react-router";

import { login } from "../../shopify.server";
import { readLastShop } from "../../last-shop.server";
import { loginErrorMessage } from "./error.server";

function shopFromReferrer(referrer: string | null): string | null {
  if (!referrer) return null;
  try {
    const ref = new URL(referrer);
    if (!ref.hostname.endsWith("shopify.com")) return null;
    const match = ref.pathname.match(/\/store\/([^/?#]+)/);
    if (!match?.[1]) return null;
    const handle = match[1];
    return handle.includes(".") ? handle : `${handle}.myshopify.com`;
  } catch {
    return null;
  }
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  if (!url.searchParams.get("shop")) {
    const shop =
      shopFromReferrer(request.headers.get("referer")) ||
      (await readLastShop(request));
    if (shop) {
      throw redirect(`/app?shop=${encodeURIComponent(shop)}`);
    }
  }

  const errors = loginErrorMessage(await login(request));

  return { errors };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const errors = loginErrorMessage(await login(request));

  return {
    errors,
  };
};

export default function Auth() {
  const loaderData = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [shop, setShop] = useState("");
  const { errors } = actionData || loaderData;

  return (
    <AppProvider embedded={false}>
      <s-page>
        <Form method="post">
          <s-section heading="Log in">
            <s-text-field
              name="shop"
              label="Shop domain"
              details="example.myshopify.com"
              value={shop}
              onChange={(e) => setShop(e.currentTarget.value)}
              autocomplete="on"
              error={errors.shop}
            ></s-text-field>
            <s-button type="submit">Log in</s-button>
          </s-section>
        </Form>
      </s-page>
    </AppProvider>
  );
}
