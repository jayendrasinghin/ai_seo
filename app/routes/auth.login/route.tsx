import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData } from "react-router";

import { login } from "../../shopify.server";
import { readLastShop } from "../../last-shop.server";
import { loginErrorMessage } from "./error.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  // If Shopify (or a form) already provided ?shop=, login() starts OAuth.
  // Do NOT redirect cookie → /app here: that causes a 410 / redirect loop
  // outside the Admin iframe.
  if (!url.searchParams.get("shop")) {
    const lastShop = await readLastShop(request);
    if (lastShop) {
      return {
        errors: loginErrorMessage({}),
        lastShop,
      };
    }
  }

  const errors = loginErrorMessage(await login(request));

  return {
    errors,
    lastShop: url.searchParams.get("shop") ?? "",
  };
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
  const [shop, setShop] = useState(loaderData.lastShop || "");
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
