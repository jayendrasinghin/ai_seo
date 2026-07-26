import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import {
  useFetcher,
  useLoaderData,
  useLocation,
  useNavigate,
} from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import type { PayPalMode } from "@prisma/client";
import { authenticate } from "../shopify.server";
import { embeddedRedirect, withEmbeddedSearch } from "../embedded-nav";
import { encrypt } from "../lib/encryption";
import { PayPalClient } from "../clients/paypal/client";
import {
  paypalConnectionRepository,
  settingsRepository,
  shopRepository,
} from "../repositories";
import { startHistoricalSync } from "../services/historical-sync";

const STEPS = [
  { id: "welcome", label: "Welcome!" },
  { id: "paypal", label: "Connect Paypal account" },
  { id: "sync", label: "Sync old orders" },
  { id: "finish", label: "Finish" },
] as const;

type StepId = (typeof STEPS)[number]["id"];

function shopDisplayName(shopDomain: string) {
  return shopDomain.replace(/\.myshopify\.com$/i, "");
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await shopRepository.upsertByDomain(session.shop);
  const settings = await shopRepository.getOrCreateSettings(shop.id);
  const connection = await paypalConnectionRepository.findByShopId(shop.id);

  if (settings.onboardingCompletedAt) {
    throw embeddedRedirect("/app/paysync", request);
  }

  return {
    shopDomain: session.shop,
    shopName: shopDisplayName(session.shop),
    paypalConnected: Boolean(connection?.lastValidatedAt || connection),
    paypalMode: connection?.mode ?? "SANDBOX",
    paypalError: connection?.lastValidationError ?? null,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await shopRepository.upsertByDomain(session.shop);
  const form = await request.formData();
  const intent = form.get("intent");

  if (intent === "connect-paypal") {
    const mode = form.get("mode") as PayPalMode;
    const clientId = (form.get("clientId") as string)?.trim();
    const clientSecret = (form.get("clientSecret") as string)?.trim();

    if (!clientId || !clientSecret) {
      return {
        success: false,
        message: "Client ID and Client Secret are required",
      };
    }

    const connection = await paypalConnectionRepository.upsert(shop.id, {
      mode,
      encryptedClientId: encrypt(clientId),
      encryptedClientSecret: encrypt(clientSecret),
    });

    const client = PayPalClient.fromEncrypted(
      shop.id,
      connection.mode,
      connection.encryptedClientId,
      connection.encryptedClientSecret,
    );

    try {
      await client.testConnection();
      await paypalConnectionRepository.updateValidation(shop.id, true);
      return { success: true, message: "PayPal connected successfully" };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Auth failed";
      await paypalConnectionRepository.updateValidation(shop.id, false, message);
      return { success: false, message };
    }
  }

  if (intent === "historical-sync") {
    const since =
      (form.get("since") as string) ||
      new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const sinceIso = since.includes("T")
      ? since
      : `${since}T00:00:00.000Z`;

    await startHistoricalSync(session.shop, sinceIso);
    return {
      success: true,
      message:
        "Order import started — all payment types will appear in Orders.",
      synced: true,
    };
  }

  if (intent === "complete" || intent === "skip") {
    const connection = await paypalConnectionRepository.findByShopId(shop.id);
    if (!connection) {
      return {
        success: false,
        message: "Connect your PayPal account before finishing setup",
      };
    }

    await settingsRepository.completeOnboarding(shop.id);
    return { success: true, completed: true, message: "Setup complete" };
  }

  return { success: false, message: "Unknown action" };
};

const pageStyle: CSSProperties = {
  minHeight: "calc(100vh - 48px)",
  padding: "28px 20px 40px",
  background:
    "radial-gradient(circle at top left, #e8f1ff 0%, #f4f6f8 42%, #eef2f7 100%)",
};

const shellStyle: CSSProperties = {
  maxWidth: "980px",
  margin: "0 auto",
};

const cardStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(240px, 0.9fr) 1.1fr",
  overflow: "hidden",
  background: "#fff",
  border: "1px solid rgba(15, 23, 42, 0.08)",
  borderRadius: "22px",
  boxShadow:
    "0 18px 50px rgba(15, 23, 42, 0.08), 0 2px 8px rgba(15, 23, 42, 0.04)",
  minHeight: "420px",
};

const artStyle: CSSProperties = {
  position: "relative",
  padding: "36px 28px",
  background:
    "linear-gradient(160deg, #003087 0%, #0070ba 48%, #00a0e8 100%)",
  color: "#fff",
  overflow: "hidden",
};

const fieldStyle: CSSProperties = {
  display: "block",
  width: "100%",
  padding: "11px 12px",
  marginTop: "6px",
  marginBottom: "14px",
  border: "1px solid #c9cccf",
  borderRadius: "10px",
  fontSize: "14px",
  background: "#fff",
};

function Stepper({
  currentIndex,
  paypalConnected,
}: {
  currentIndex: number;
  paypalConnected: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "8px",
        margin: "22px 0 18px",
        flexWrap: "wrap",
      }}
    >
      {STEPS.map((step, index) => {
        const done =
          index < currentIndex || (step.id === "paypal" && paypalConnected && index <= currentIndex);
        const active = index === currentIndex;
        return (
          <div
            key={step.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              minWidth: "140px",
              flex: 1,
            }}
          >
            <div
              style={{
                width: "28px",
                height: "28px",
                borderRadius: "999px",
                display: "grid",
                placeItems: "center",
                fontSize: "13px",
                fontWeight: 700,
                color: done || active ? "#fff" : "#6d7175",
                background: done || active ? "#0070ba" : "#dfe3e8",
                flexShrink: 0,
              }}
            >
              {done && index < currentIndex ? "✓" : index + 1}
            </div>
            <div
              style={{
                fontSize: "13px",
                fontWeight: active ? 700 : 500,
                color: active ? "#111827" : "#6d7175",
              }}
            >
              {step.label}
            </div>
            {index < STEPS.length - 1 && (
              <div
                style={{
                  flex: 1,
                  height: "2px",
                  marginLeft: "4px",
                  background: index < currentIndex ? "#0070ba" : "#dfe3e8",
                  minWidth: "18px",
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function FeatureList() {
  const items = [
    "Auto-sync PayPal tracking after fulfillment",
    "Free plan includes 100 synced orders",
    "Reduce disputes with faster tracking updates",
    "Works across Shopify sales channels",
  ];

  return (
    <ul style={{ margin: "18px 0 0", padding: 0, listStyle: "none" }}>
      {items.map((item) => (
        <li
          key={item}
          style={{
            display: "flex",
            gap: "10px",
            alignItems: "flex-start",
            marginBottom: "10px",
            fontSize: "13px",
            lineHeight: 1.45,
            color: "rgba(255,255,255,0.92)",
          }}
        >
          <span
            style={{
              width: "18px",
              height: "18px",
              borderRadius: "999px",
              background: "rgba(255,255,255,0.18)",
              display: "grid",
              placeItems: "center",
              fontSize: "11px",
              flexShrink: 0,
              marginTop: "1px",
            }}
          >
            ✓
          </span>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

export default function OnboardingPage() {
  const data = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const navigate = useNavigate();
  const { search } = useLocation();
  const shopify = useAppBridge();

  const [step, setStep] = useState<StepId>(
    data.paypalConnected ? "sync" : "welcome",
  );
  const [mode, setMode] = useState<PayPalMode>(data.paypalMode as PayPalMode);
  const [paypalConnected, setPaypalConnected] = useState(data.paypalConnected);
  const [syncStarted, setSyncStarted] = useState(false);

  const currentIndex = useMemo(
    () => STEPS.findIndex((item) => item.id === step),
    [step],
  );
  const isLoading = fetcher.state !== "idle";

  useEffect(() => {
    if (!fetcher.data || fetcher.state !== "idle") return;

    if (fetcher.data.message) {
      shopify.toast.show(fetcher.data.message);
    }

    if (fetcher.data.success && step === "paypal") {
      setPaypalConnected(true);
      setStep("sync");
    }

    if (fetcher.data.success && "synced" in fetcher.data && fetcher.data.synced) {
      setSyncStarted(true);
      setStep("finish");
    }

    if (fetcher.data.success && "completed" in fetcher.data && fetcher.data.completed) {
      navigate(withEmbeddedSearch("/app/paysync", search));
    }
  }, [fetcher.data, fetcher.state, navigate, search, shopify, step]);

  const goNext = () => {
    if (step === "welcome") {
      setStep("paypal");
      return;
    }
    if (step === "paypal" && paypalConnected) {
      setStep("sync");
      return;
    }
    if (step === "sync") {
      setStep("finish");
    }
  };

  const goBack = () => {
    if (step === "paypal") setStep("welcome");
    if (step === "sync") setStep("paypal");
    if (step === "finish") setStep("sync");
  };

  const canSkipRemaining = paypalConnected && step !== "finish";

  return (
    <div style={pageStyle}>
      <div style={shellStyle}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "12px",
            flexWrap: "wrap",
          }}
        >
          <div>
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "10px",
                marginBottom: "8px",
              }}
            >
              <div
                style={{
                  width: "34px",
                  height: "34px",
                  borderRadius: "10px",
                  background: "linear-gradient(135deg, #0070ba, #003087)",
                  color: "#fff",
                  display: "grid",
                  placeItems: "center",
                  fontWeight: 800,
                  letterSpacing: "-0.04em",
                }}
              >
                P
              </div>
              <strong style={{ fontSize: "16px", color: "#111827" }}>
                PaySync Tracking
              </strong>
            </div>
            <h1
              style={{
                margin: 0,
                fontSize: "28px",
                letterSpacing: "-0.03em",
                color: "#111827",
              }}
            >
              Hello {data.shopName} 👋
            </h1>
          </div>

          {canSkipRemaining && (
            <fetcher.Form method="POST">
              <input type="hidden" name="intent" value="skip" />
              <button
                type="submit"
                style={{
                  border: "none",
                  background: "transparent",
                  color: "#0070ba",
                  fontWeight: 600,
                  cursor: "pointer",
                  fontSize: "14px",
                }}
              >
                Skip onboarding
              </button>
            </fetcher.Form>
          )}
        </div>

        <Stepper currentIndex={currentIndex} paypalConnected={paypalConnected} />

        <div
          className="paysync-onboarding-card"
          style={cardStyle}
        >
          <div style={artStyle}>
            <div
              style={{
                position: "absolute",
                width: "180px",
                height: "180px",
                borderRadius: "50%",
                background: "rgba(255,255,255,0.08)",
                top: "-40px",
                right: "-30px",
              }}
            />
            <div
              style={{
                position: "absolute",
                width: "120px",
                height: "120px",
                borderRadius: "50%",
                background: "rgba(255,255,255,0.08)",
                bottom: "24px",
                left: "-28px",
              }}
            />
            <div style={{ position: "relative", zIndex: 1 }}>
              <div
                style={{
                  display: "inline-flex",
                  padding: "6px 10px",
                  borderRadius: "999px",
                  background: "rgba(255,255,255,0.14)",
                  fontSize: "12px",
                  fontWeight: 600,
                  marginBottom: "16px",
                }}
              >
                Free · 100 synced orders
              </div>
              <h2
                style={{
                  margin: "0 0 10px",
                  fontSize: "26px",
                  lineHeight: 1.15,
                  letterSpacing: "-0.03em",
                }}
              >
                Get PayPal funds faster with automatic tracking sync
              </h2>
              <p
                style={{
                  margin: 0,
                  fontSize: "14px",
                  lineHeight: 1.5,
                  color: "rgba(255,255,255,0.9)",
                }}
              >
                Connect once. PaySync tags orders, maps PayPal payments, and
                sends tracking after fulfillment — securely with AES-256
                encryption.
              </p>
              <FeatureList />
            </div>
          </div>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              padding: "28px 28px 20px",
            }}
          >
            <div style={{ flex: 1 }}>
              {step === "welcome" && (
                <>
                  <h3
                    style={{
                      margin: "0 0 10px",
                      fontSize: "24px",
                      letterSpacing: "-0.02em",
                      color: "#111827",
                    }}
                  >
                    Welcome to PaySync
                  </h3>
                  <p style={{ margin: "0 0 16px", color: "#4b5563", lineHeight: 1.55 }}>
                    Auto-sync PayPal tracking to help release funds faster and
                    reduce disputes. Before anything else, connect your PayPal
                    business API credentials.
                  </p>
                  <div
                    style={{
                      display: "grid",
                      gap: "10px",
                      padding: "14px",
                      borderRadius: "14px",
                      background: "#f8fafc",
                      border: "1px solid #e5e7eb",
                      fontSize: "13px",
                      color: "#374151",
                    }}
                  >
                    <div>1. Connect PayPal Client ID & Secret</div>
                    <div>2. Optionally sync already fulfilled orders</div>
                    <div>3. Start automatic tracking sync</div>
                  </div>
                </>
              )}

              {step === "paypal" && (
                <>
                  <div
                    style={{
                      width: "42px",
                      height: "42px",
                      borderRadius: "12px",
                      background: "#003087",
                      color: "#fff",
                      display: "grid",
                      placeItems: "center",
                      fontWeight: 800,
                      marginBottom: "14px",
                      fontSize: "18px",
                    }}
                  >
                    P
                  </div>
                  <h3
                    style={{
                      margin: "0 0 8px",
                      fontSize: "24px",
                      letterSpacing: "-0.02em",
                      color: "#111827",
                    }}
                  >
                    Connect your PayPal account
                  </h3>
                  <p style={{ margin: "0 0 16px", color: "#4b5563", lineHeight: 1.55 }}>
                    PaySync uses PayPal&apos;s secure API to synchronize tracking
                    automatically. Your credentials are encrypted and never
                    exposed in the browser after save.
                  </p>

                  {paypalConnected ? (
                    <div
                      style={{
                        padding: "14px 16px",
                        borderRadius: "12px",
                        background: "#edfbf3",
                        border: "1px solid #b7ebd0",
                        color: "#08765b",
                        fontWeight: 600,
                      }}
                    >
                      PayPal connected successfully. Continue to sync old orders.
                    </div>
                  ) : (
                    <fetcher.Form method="POST">
                      <input type="hidden" name="intent" value="connect-paypal" />
                      <label htmlFor="onboarding-mode">
                        <strong>Mode</strong>
                        <select
                          id="onboarding-mode"
                          name="mode"
                          value={mode}
                          onChange={(e) =>
                            setMode(e.target.value as PayPalMode)
                          }
                          style={fieldStyle}
                        >
                          <option value="SANDBOX">Test (Sandbox)</option>
                          <option value="LIVE">Live (real payments)</option>
                        </select>
                      </label>
                      <label htmlFor="onboarding-client-id">
                        <strong>Client ID</strong>
                        <input
                          id="onboarding-client-id"
                          name="clientId"
                          type="text"
                          autoComplete="off"
                          required
                          placeholder="Paste Client ID from PayPal Developer"
                          style={fieldStyle}
                        />
                      </label>
                      <label htmlFor="onboarding-client-secret">
                        <strong>Client Secret</strong>
                        <input
                          id="onboarding-client-secret"
                          name="clientSecret"
                          type="password"
                          autoComplete="off"
                          required
                          placeholder="Paste Secret from PayPal Developer"
                          style={fieldStyle}
                        />
                      </label>
                      <button
                        type="submit"
                        disabled={isLoading}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "8px",
                          padding: "11px 16px",
                          borderRadius: "10px",
                          border: "1px solid #111827",
                          background: "#fff",
                          color: "#111827",
                          fontWeight: 650,
                          cursor: isLoading ? "wait" : "pointer",
                        }}
                      >
                        {isLoading ? "Connecting…" : "Connect Paypal account"}
                      </button>
                      {data.paypalError && (
                        <p style={{ marginTop: "12px", color: "#b42318", fontSize: "13px" }}>
                          {data.paypalError}
                        </p>
                      )}
                    </fetcher.Form>
                  )}
                </>
              )}

              {step === "sync" && (
                <>
                  <h3
                    style={{
                      margin: "0 0 8px",
                      fontSize: "24px",
                      letterSpacing: "-0.02em",
                      color: "#111827",
                    }}
                  >
                    Sync old orders
                  </h3>
                  <p style={{ margin: "0 0 16px", color: "#4b5563", lineHeight: 1.55 }}>
                    Catch up on PayPal tracking for orders you already fulfilled
                    before installing PaySync. You can skip this and sync later
                    from Settings.
                  </p>
                  <fetcher.Form method="POST">
                    <input type="hidden" name="intent" value="historical-sync" />
                    <label htmlFor="onboarding-since">
                      <strong>Sync fulfilled orders since</strong>
                      <input
                        id="onboarding-since"
                        name="since"
                        type="date"
                        defaultValue={new Date(Date.now() - 30 * 86400000)
                          .toISOString()
                          .slice(0, 10)}
                        style={fieldStyle}
                      />
                    </label>
                    <button
                      type="submit"
                      disabled={isLoading || !paypalConnected}
                      style={{
                        padding: "11px 16px",
                        borderRadius: "10px",
                        border: "none",
                        background: "#0070ba",
                        color: "#fff",
                        fontWeight: 650,
                        cursor:
                          isLoading || !paypalConnected ? "not-allowed" : "pointer",
                      }}
                    >
                      {isLoading ? "Starting…" : "Start historical sync"}
                    </button>
                  </fetcher.Form>
                  {syncStarted && (
                    <p style={{ marginTop: "12px", color: "#08765b", fontWeight: 600 }}>
                      Sync started. Continue to finish setup.
                    </p>
                  )}
                </>
              )}

              {step === "finish" && (
                <>
                  <h3
                    style={{
                      margin: "0 0 8px",
                      fontSize: "24px",
                      letterSpacing: "-0.02em",
                      color: "#111827",
                    }}
                  >
                    You&apos;re ready
                  </h3>
                  <p style={{ margin: "0 0 16px", color: "#4b5563", lineHeight: 1.55 }}>
                    PaySync will tag payment providers and send tracking to
                    PayPal after fulfillment. Free plan covers your first 100
                    synced orders.
                  </p>
                  <div
                    style={{
                      padding: "14px 16px",
                      borderRadius: "12px",
                      background: "#eef5ff",
                      border: "1px solid #c9dbf7",
                      color: "#1e3a8a",
                      fontSize: "13px",
                      lineHeight: 1.5,
                    }}
                  >
                    Tip: keep the worker running so webhook sync jobs process in
                    the background.
                  </div>
                </>
              )}
            </div>

            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: "12px",
                marginTop: "24px",
                paddingTop: "16px",
                borderTop: "1px solid #eef0f2",
              }}
            >
              <button
                type="button"
                onClick={goBack}
                disabled={step === "welcome"}
                style={{
                  border: "none",
                  background: "transparent",
                  color: step === "welcome" ? "#9ca3af" : "#374151",
                  fontWeight: 600,
                  cursor: step === "welcome" ? "default" : "pointer",
                }}
              >
                ← Back
              </button>

              {step === "finish" ? (
                <fetcher.Form method="POST">
                  <input type="hidden" name="intent" value="complete" />
                  <button
                    type="submit"
                    disabled={isLoading || !paypalConnected}
                    style={{
                      padding: "11px 18px",
                      borderRadius: "10px",
                      border: "none",
                      background:
                        isLoading || !paypalConnected ? "#9ca3af" : "#0070ba",
                      color: "#fff",
                      fontWeight: 700,
                      cursor:
                        isLoading || !paypalConnected ? "not-allowed" : "pointer",
                    }}
                  >
                    Go to dashboard
                  </button>
                </fetcher.Form>
              ) : step === "sync" ? (
                <button
                  type="button"
                  onClick={goNext}
                  style={{
                    padding: "11px 18px",
                    borderRadius: "10px",
                    border: "1px solid #d1d5db",
                    background: "#fff",
                    color: "#111827",
                    fontWeight: 650,
                    cursor: "pointer",
                  }}
                >
                  {syncStarted ? "Next step" : "Skip for now"}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={goNext}
                  disabled={step === "paypal" && !paypalConnected}
                  style={{
                    padding: "11px 18px",
                    borderRadius: "10px",
                    border: "none",
                    background:
                      step === "paypal" && !paypalConnected
                        ? "#c5c7c9"
                        : "#0070ba",
                    color: "#fff",
                    fontWeight: 700,
                    cursor:
                      step === "paypal" && !paypalConnected
                        ? "not-allowed"
                        : "pointer",
                  }}
                >
                  Next step
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @media (max-width: 860px) {
          .paysync-onboarding-card {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </div>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
