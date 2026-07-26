import { useState, useEffect, type CSSProperties } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData, useRouteError } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { encrypt } from "../lib/encryption";
import { formatPayPalMode } from "../lib/display";
import {
  paypalConnectionRepository,
  razorpayConnectionRepository,
  shopRepository,
} from "../repositories";
import { PayPalClient } from "../clients/paypal/client";
import { RazorpayClient } from "../clients/razorpay/client";
import type { PayPalMode } from "@prisma/client";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await shopRepository.upsertByDomain(session.shop);
  const [paypalAccounts, razorpayAccounts] = await Promise.all([
    paypalConnectionRepository.listByShopId(shop.id),
    razorpayConnectionRepository.listByShopId(shop.id),
  ]);

  return {
    paypalAccounts: paypalAccounts.map((a) => ({
      id: a.id,
      label: a.label,
      mode: a.mode,
      isDefault: a.isDefault,
      connectedAt: a.connectedAt.toISOString(),
      lastValidatedAt: a.lastValidatedAt?.toISOString() ?? null,
      lastValidationError: a.lastValidationError,
    })),
    razorpayAccounts: razorpayAccounts.map((a) => ({
      id: a.id,
      label: a.label,
      isDefault: a.isDefault,
      connectedAt: a.connectedAt.toISOString(),
      lastValidatedAt: a.lastValidatedAt?.toISOString() ?? null,
      lastValidationError: a.lastValidationError,
    })),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await shopRepository.upsertByDomain(session.shop);
  const form = await request.formData();
  const intent = form.get("intent");

  if (intent === "paypal-add") {
    const mode = form.get("mode") as PayPalMode;
    const label = ((form.get("label") as string) || "").trim() || "PayPal";
    const clientId = (form.get("clientId") as string)?.trim();
    const clientSecret = (form.get("clientSecret") as string)?.trim();
    const makeDefault = form.get("makeDefault") === "on";

    if (!clientId || !clientSecret) {
      return { success: false, message: "Client ID and Client Secret are required" };
    }

    const connection = await paypalConnectionRepository.create(shop.id, {
      mode,
      label,
      encryptedClientId: encrypt(clientId),
      encryptedClientSecret: encrypt(clientSecret),
      makeDefault,
    });

    const client = PayPalClient.fromEncrypted(
      shop.id,
      connection.mode,
      connection.encryptedClientId,
      connection.encryptedClientSecret,
    );

    try {
      await client.testConnection();
      await paypalConnectionRepository.updateValidationById(connection.id, true);
      return { success: true, message: `PayPal account “${label}” connected` };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Auth failed";
      await paypalConnectionRepository.updateValidationById(
        connection.id,
        false,
        message,
      );
      return { success: false, message };
    }
  }

  if (intent === "paypal-set-default") {
    const id = form.get("accountId") as string;
    await paypalConnectionRepository.setDefault(shop.id, id);
    return { success: true, message: "Default PayPal account updated" };
  }

  if (intent === "paypal-delete") {
    const id = form.get("accountId") as string;
    await paypalConnectionRepository.deleteById(shop.id, id);
    return { success: true, message: "PayPal account removed" };
  }

  if (intent === "paypal-rename") {
    const id = form.get("accountId") as string;
    const label = ((form.get("label") as string) || "").trim();
    if (!label) {
      return { success: false, message: "Account name is required" };
    }
    const updated = await paypalConnectionRepository.updateLabel(
      shop.id,
      id,
      label,
    );
    if (!updated) {
      return { success: false, message: "Account not found" };
    }
    return { success: true, message: `Account name saved as “${label}”` };
  }

  if (intent === "paypal-test") {
    const id = form.get("accountId") as string;
    const connection = await paypalConnectionRepository.findById(id);
    if (!connection || connection.shopId !== shop.id) {
      return { success: false, message: "Account not found" };
    }
    const client = PayPalClient.fromEncrypted(
      shop.id,
      connection.mode,
      connection.encryptedClientId,
      connection.encryptedClientSecret,
    );
    try {
      await client.testConnection();
      await paypalConnectionRepository.updateValidationById(id, true);
      return { success: true, message: "PayPal connection test passed" };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Connection test failed";
      await paypalConnectionRepository.updateValidationById(id, false, message);
      return { success: false, message };
    }
  }

  if (intent === "razorpay-add") {
    const label = ((form.get("label") as string) || "").trim() || "Razorpay";
    const keyId = (form.get("keyId") as string)?.trim();
    const keySecret = (form.get("keySecret") as string)?.trim();
    const makeDefault = form.get("makeDefault") === "on";

    if (!keyId || !keySecret) {
      return { success: false, message: "Key ID and Key Secret are required" };
    }

    const connection = await razorpayConnectionRepository.create(shop.id, {
      label,
      encryptedKeyId: encrypt(keyId),
      encryptedKeySecret: encrypt(keySecret),
      makeDefault,
    });

    try {
      await RazorpayClient.fromEncrypted(
        connection.encryptedKeyId,
        connection.encryptedKeySecret,
      ).testConnection();
      await razorpayConnectionRepository.updateValidationById(
        connection.id,
        true,
      );
      return { success: true, message: `Razorpay account “${label}” connected` };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Auth failed";
      await razorpayConnectionRepository.updateValidationById(
        connection.id,
        false,
        message,
      );
      return { success: false, message };
    }
  }

  if (intent === "razorpay-set-default") {
    const id = form.get("accountId") as string;
    await razorpayConnectionRepository.setDefault(shop.id, id);
    return { success: true, message: "Default Razorpay account updated" };
  }

  if (intent === "razorpay-delete") {
    const id = form.get("accountId") as string;
    await razorpayConnectionRepository.deleteById(shop.id, id);
    return { success: true, message: "Razorpay account removed" };
  }

  if (intent === "razorpay-test") {
    const id = form.get("accountId") as string;
    const list = await razorpayConnectionRepository.listByShopId(shop.id);
    const connection = list.find((a) => a.id === id);
    if (!connection) return { success: false, message: "Account not found" };
    try {
      await RazorpayClient.fromEncrypted(
        connection.encryptedKeyId,
        connection.encryptedKeySecret,
      ).testConnection();
      await razorpayConnectionRepository.updateValidationById(id, true);
      return { success: true, message: "Razorpay connection test passed" };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Connection test failed";
      await razorpayConnectionRepository.updateValidationById(id, false, message);
      return { success: false, message };
    }
  }

  return { success: false, message: "Unknown intent" };
};

const fieldStyle: CSSProperties = {
  display: "block",
  width: "100%",
  maxWidth: "480px",
  padding: "10px 12px",
  marginTop: "6px",
  marginBottom: "16px",
  border: "1px solid #c9cccf",
  borderRadius: "8px",
  fontSize: "14px",
};

export default function PaymentAccountsPage() {
  const data = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const [mode, setMode] = useState<PayPalMode>("SANDBOX");
  const isLoading = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.data?.message && fetcher.state === "idle") {
      shopify.toast.show(fetcher.data.message);
    }
  }, [fetcher.data, fetcher.state, shopify]);

  return (
    <s-page heading="Payment accounts">
      <s-section heading="PayPal accounts">
        <s-paragraph>
          Add one or more PayPal apps. Use <strong>Test</strong> keys while
          testing, and <strong>Live</strong> keys for real orders. Set an{" "}
          <strong>account name</strong> (your shop / PayPal business name) so it
          shows on the dashboard instead of a generic label.
        </s-paragraph>

        {data.paypalAccounts.length === 0 ? (
          <s-banner tone="warning">
            <s-paragraph>No PayPal account connected yet.</s-paragraph>
          </s-banner>
        ) : (
          <s-stack direction="block" gap="base">
            {data.paypalAccounts.map((account) => (
              <s-box
                key={account.id}
                padding="base"
                borderWidth="base"
                borderRadius="base"
              >
                <s-stack direction="block" gap="small">
                  <s-paragraph>
                    <strong>{account.label}</strong>
                    {account.isDefault ? " · Default" : ""}
                    {" · "}
                    {formatPayPalMode(account.mode)}
                  </s-paragraph>
                  <s-paragraph>
                    Connected {new Date(account.connectedAt).toLocaleString()}
                  </s-paragraph>
                  {account.lastValidationError ? (
                    <s-banner tone="warning">
                      <s-paragraph>{account.lastValidationError}</s-paragraph>
                    </s-banner>
                  ) : null}
                  <fetcher.Form method="POST">
                    <input type="hidden" name="intent" value="paypal-rename" />
                    <input type="hidden" name="accountId" value={account.id} />
                    <label htmlFor={`paypal-rename-${account.id}`}>
                      <strong>Account name</strong>
                      <input
                        id={`paypal-rename-${account.id}`}
                        name="label"
                        type="text"
                        defaultValue={account.label}
                        placeholder="e.g. My Store PayPal"
                        style={fieldStyle}
                      />
                    </label>
                    <s-button
                      type="submit"
                      variant="secondary"
                      {...(isLoading ? { loading: true } : {})}
                    >
                      Save name
                    </s-button>
                  </fetcher.Form>
                  <s-stack direction="inline" gap="base">
                    {!account.isDefault ? (
                      <fetcher.Form method="POST">
                        <input type="hidden" name="intent" value="paypal-set-default" />
                        <input type="hidden" name="accountId" value={account.id} />
                        <s-button type="submit" variant="secondary" {...(isLoading ? { loading: true } : {})}>
                          Set default
                        </s-button>
                      </fetcher.Form>
                    ) : null}
                    <fetcher.Form method="POST">
                      <input type="hidden" name="intent" value="paypal-test" />
                      <input type="hidden" name="accountId" value={account.id} />
                      <s-button type="submit" variant="tertiary" {...(isLoading ? { loading: true } : {})}>
                        Test
                      </s-button>
                    </fetcher.Form>
                    <fetcher.Form method="POST">
                      <input type="hidden" name="intent" value="paypal-delete" />
                      <input type="hidden" name="accountId" value={account.id} />
                      <s-button type="submit" variant="tertiary" tone="critical" {...(isLoading ? { loading: true } : {})}>
                        Remove
                      </s-button>
                    </fetcher.Form>
                  </s-stack>
                </s-stack>
              </s-box>
            ))}
          </s-stack>
        )}
      </s-section>

      <s-section heading="Add PayPal account">
        <s-paragraph>
          PayPal Developer → Apps &amp; Credentials → copy Client ID and Secret.
          For real customers choose <strong>Live</strong> and use Live API keys.
        </s-paragraph>
        <fetcher.Form method="POST">
          <input type="hidden" name="intent" value="paypal-add" />
          <label htmlFor="paypal-label">
            <strong>Account name</strong>
            <input
              id="paypal-label"
              name="label"
              type="text"
              placeholder="e.g. My Store PayPal"
              required
              style={fieldStyle}
            />
          </label>
          <label htmlFor="paypal-mode">
            <strong>Mode</strong>
            <select
              id="paypal-mode"
              name="mode"
              value={mode}
              onChange={(e) => setMode(e.target.value as PayPalMode)}
              style={fieldStyle}
            >
              <option value="SANDBOX">Test (Sandbox)</option>
              <option value="LIVE">Live (real payments)</option>
            </select>
          </label>
          <label htmlFor="paypal-client-id">
            <strong>Client ID</strong>
            <input
              id="paypal-client-id"
              name="clientId"
              type="text"
              autoComplete="off"
              placeholder="Paste Client ID from PayPal"
              style={fieldStyle}
            />
          </label>
          <label htmlFor="paypal-client-secret">
            <strong>Client Secret</strong>
            <input
              id="paypal-client-secret"
              name="clientSecret"
              type="password"
              autoComplete="off"
              placeholder="Paste Secret from PayPal"
              style={fieldStyle}
            />
          </label>
          <label
            htmlFor="paypal-default"
            style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 16 }}
          >
            <input id="paypal-default" name="makeDefault" type="checkbox" defaultChecked />
            Use as default for tracking sync
          </label>
          <s-button type="submit" variant="primary" {...(isLoading ? { loading: true } : {})}>
            Add PayPal account
          </s-button>
        </fetcher.Form>
      </s-section>

      <s-section heading="Razorpay accounts">
        <s-paragraph>
          Optional: store Razorpay API keys for this shop. Orders paid with
          Razorpay still appear in the Orders list from Shopify; keys are for
          future Razorpay API features. Tracking sync to PayPal still uses the
          default PayPal account only.
        </s-paragraph>

        {data.razorpayAccounts.length === 0 ? (
          <s-banner tone="info">
            <s-paragraph>No Razorpay account connected yet.</s-paragraph>
          </s-banner>
        ) : (
          <s-stack direction="block" gap="base">
            {data.razorpayAccounts.map((account) => (
              <s-box
                key={account.id}
                padding="base"
                borderWidth="base"
                borderRadius="base"
              >
                <s-stack direction="block" gap="small">
                  <s-paragraph>
                    <strong>{account.label}</strong>
                    {account.isDefault ? " · Default" : ""}
                  </s-paragraph>
                  <s-paragraph>
                    Connected {new Date(account.connectedAt).toLocaleString()}
                  </s-paragraph>
                  {account.lastValidationError ? (
                    <s-banner tone="warning">
                      <s-paragraph>{account.lastValidationError}</s-paragraph>
                    </s-banner>
                  ) : null}
                  <s-stack direction="inline" gap="base">
                    {!account.isDefault ? (
                      <fetcher.Form method="POST">
                        <input type="hidden" name="intent" value="razorpay-set-default" />
                        <input type="hidden" name="accountId" value={account.id} />
                        <s-button type="submit" variant="secondary" {...(isLoading ? { loading: true } : {})}>
                          Set default
                        </s-button>
                      </fetcher.Form>
                    ) : null}
                    <fetcher.Form method="POST">
                      <input type="hidden" name="intent" value="razorpay-test" />
                      <input type="hidden" name="accountId" value={account.id} />
                      <s-button type="submit" variant="tertiary" {...(isLoading ? { loading: true } : {})}>
                        Test
                      </s-button>
                    </fetcher.Form>
                    <fetcher.Form method="POST">
                      <input type="hidden" name="intent" value="razorpay-delete" />
                      <input type="hidden" name="accountId" value={account.id} />
                      <s-button type="submit" variant="tertiary" tone="critical" {...(isLoading ? { loading: true } : {})}>
                        Remove
                      </s-button>
                    </fetcher.Form>
                  </s-stack>
                </s-stack>
              </s-box>
            ))}
          </s-stack>
        )}
      </s-section>

      <s-section heading="Add Razorpay account">
        <s-paragraph>
          Razorpay Dashboard → Settings → API Keys → copy Key ID and Key Secret.
        </s-paragraph>
        <fetcher.Form method="POST">
          <input type="hidden" name="intent" value="razorpay-add" />
          <label htmlFor="rzp-label">
            <strong>Account name</strong>
            <input
              id="rzp-label"
              name="label"
              type="text"
              placeholder="e.g. Main Razorpay"
              defaultValue="Razorpay"
              style={fieldStyle}
            />
          </label>
          <label htmlFor="rzp-key-id">
            <strong>Key ID</strong>
            <input
              id="rzp-key-id"
              name="keyId"
              type="text"
              autoComplete="off"
              placeholder="rzp_live_… or rzp_test_…"
              style={fieldStyle}
            />
          </label>
          <label htmlFor="rzp-key-secret">
            <strong>Key Secret</strong>
            <input
              id="rzp-key-secret"
              name="keySecret"
              type="password"
              autoComplete="off"
              placeholder="Paste Key Secret"
              style={fieldStyle}
            />
          </label>
          <label
            htmlFor="rzp-default"
            style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 16 }}
          >
            <input id="rzp-default" name="makeDefault" type="checkbox" defaultChecked />
            Use as default Razorpay account
          </label>
          <s-button type="submit" variant="primary" {...(isLoading ? { loading: true } : {})}>
            Add Razorpay account
          </s-button>
        </fetcher.Form>
      </s-section>
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (args) => boundary.headers(args);
