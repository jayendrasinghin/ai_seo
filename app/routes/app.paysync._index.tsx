import { useEffect, type CSSProperties, type ReactNode } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData, useLocation } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { withEmbeddedSearch } from "../embedded-nav";
import {
  orderSyncRepository,
  paypalConnectionRepository,
  shopRepository,
} from "../repositories";
import { startHistoricalSync } from "../services/historical-sync";
import {
  formatDateTime,
  formatPaymentStatus,
  formatPayPalAccountStatus,
  formatProvider,
  formatSyncStatus,
} from "../lib/display";

const FREE_SYNC_LIMIT = 100;

const panelStyle: CSSProperties = {
  padding: "20px",
  background: "#fff",
  border: "1px solid rgba(0, 0, 0, 0.08)",
  borderRadius: "16px",
  boxShadow: "0 1px 3px rgba(0, 0, 0, 0.05)",
};

function Pill({
  children,
  tone,
}: {
  children: ReactNode;
  tone: "success" | "warning" | "critical" | "neutral";
}) {
  const colors = {
    success: { background: "#dff7e9", color: "#08765b" },
    warning: { background: "#fff1c7", color: "#7a5700" },
    critical: { background: "#ffe3e3", color: "#b42318" },
    neutral: { background: "#f1f2f3", color: "#4a4a4a" },
  };

  return (
    <span
      style={{
        ...colors[tone],
        display: "inline-flex",
        padding: "4px 9px",
        borderRadius: "999px",
        fontSize: "12px",
        fontWeight: 600,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

function SummaryCard({
  icon,
  label,
  value,
  accent,
}: {
  icon: string;
  label: string;
  value: number;
  accent: string;
}) {
  return (
    <div
      style={{
        padding: "16px",
        border: "1px solid #e3e5e7",
        borderRadius: "12px",
        background: "#fff",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          marginBottom: "14px",
          color: "#4a4a4a",
          fontSize: "13px",
        }}
      >
        <span
          style={{
            display: "grid",
            width: "24px",
            height: "24px",
            placeItems: "center",
            borderRadius: "7px",
            color: accent,
            background: `${accent}14`,
            fontWeight: 700,
          }}
        >
          {icon}
        </span>
        {label}
      </div>
      <strong
        style={{
          color: "#202223",
          fontSize: "28px",
          letterSpacing: "-0.03em",
        }}
      >
        {value.toLocaleString()}
      </strong>
    </div>
  );
}

function syncTone(
  status: string,
): "success" | "warning" | "critical" | "neutral" {
  if (status === "synced") return "success";
  if (["failed", "failed_permanent"].includes(status)) return "critical";
  if (["needs_mapping", "retrying"].includes(status)) return "warning";
  return "neutral";
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await shopRepository.upsertByDomain(session.shop);
  const [stats, connection] = await Promise.all([
    orderSyncRepository.getOverviewStats(shop.id),
    paypalConnectionRepository.findByShopId(shop.id),
  ]);

  return {
    stats,
    shopName: session.shop.replace(/\.myshopify\.com$/i, ""),
    paypal: {
      connected: Boolean(connection),
      mode: connection?.mode ?? null,
      label: connection?.label ?? null,
      lastValidatedAt: connection?.lastValidatedAt?.toISOString() ?? null,
    },
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  await shopRepository.upsertByDomain(session.shop);

  const form = await request.formData();
  if (form.get("intent") !== "historical-sync") {
    return { success: false, message: "Unknown action" };
  }

  const { getOrdersAccessBlocker } = await import("../services/orders-access");
  const blocker = await getOrdersAccessBlocker(admin);
  if (blocker) {
    return { success: false, message: blocker };
  }

  const result = await startHistoricalSync(
    session.shop,
    new Date(Date.now() - 30 * 86400000).toISOString(),
  );

  return {
    success: true,
    message: result.hasMore
      ? `Imported ${result.processed} orders so far — more pages queued (keep npm run worker running).`
      : `Imported ${result.processed} orders. Open Orders to view them (PayPal, COD, Razorpay, etc.).`,
  };
};

export default function OverviewPage() {
  const { stats, shopName, paypal } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const { search } = useLocation();
  const paypalOrders =
    stats.providerDist.find((row) => row.paymentProvider === "paypal")?._count ??
    0;
  const totalOrders = stats.providerDist.reduce(
    (total, row) => total + row._count,
    0,
  );
  const usage = Math.min(stats.synced, FREE_SYNC_LIMIT);
  const usagePercent = Math.min(
    100,
    Math.round((usage / FREE_SYNC_LIMIT) * 100),
  );
  const setupSteps = [
    { label: "Connect PayPal account", done: paypal.connected },
    {
      label: "Validate PayPal credentials",
      done: Boolean(paypal.lastValidatedAt),
    },
    { label: "Process your first Shopify order", done: totalOrders > 0 },
  ];
  const completedSteps = setupSteps.filter((step) => step.done).length;

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.message) {
      shopify.toast.show(fetcher.data.message);
    }
  }, [fetcher.data, fetcher.state, shopify]);

  return (
    <s-page heading={`Hello ${shopName} 👋`}>
      <div style={{ display: "grid", gap: "16px", paddingBottom: "24px" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "12px",
            flexWrap: "wrap",
          }}
        >
          <p style={{ margin: 0, color: "#6d7175", fontSize: "14px" }}>
            Welcome to PaySync Tracking. Here is your store activity.
          </p>
          <Pill tone={paypal.connected ? "success" : "critical"}>
            {paypal.connected
              ? `● ${formatPayPalAccountStatus(true, paypal.mode, paypal.label)}`
              : "PayPal disconnected"}
          </Pill>
        </div>

        <div
          style={{
            overflow: "hidden",
            border: "1px solid #a9d4f5",
            borderRadius: "14px",
            background: "#fff",
          }}
        >
          <div
            style={{
              padding: "11px 16px",
              color: "#123a56",
              background: "#b9e2ff",
              fontSize: "13px",
              fontWeight: 700,
            }}
          >
            ⓘ Requirements for successful synchronization
          </div>
          <p
            style={{
              margin: 0,
              padding: "14px 16px",
              color: "#4b5563",
              fontSize: "13px",
              lineHeight: 1.5,
            }}
          >
            Mark Shopify orders as fulfilled and include a valid tracking
            number. PaySync sends eligible PayPal tracking updates
            automatically.
          </p>
        </div>

        {stats.failed > 0 && (
          <div
            style={{
              ...panelStyle,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "14px",
              borderColor: "#f0b6ad",
              background: "#fff8f7",
            }}
          >
            <div>
              <strong style={{ color: "#8e1f0b", fontSize: "14px" }}>
                ⚠ {stats.failed} tracking sync{" "}
                {stats.failed === 1 ? "needs" : "need"} attention
              </strong>
              <p
                style={{
                  margin: "5px 0 0",
                  color: "#6d3a31",
                  fontSize: "13px",
                }}
              >
                Review and retry failed shipments from the sync queue.
              </p>
            </div>
            <s-link href={withEmbeddedSearch("/app/paysync/queue", search)}>Review queue</s-link>
          </div>
        )}

        <div className="paysync-dashboard-grid">
          <main style={{ display: "grid", gap: "16px", minWidth: 0 }}>
            <div style={panelStyle}>
              <div className="paysync-plan-grid">
                <div>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <span style={{ color: "#4b5563", fontSize: "13px" }}>
                      Current plan
                    </span>
                    <Pill tone="neutral">Free</Pill>
                  </div>
                  <strong
                    style={{
                      display: "block",
                      marginTop: "14px",
                      fontSize: "18px",
                    }}
                  >
                    Starter
                  </strong>
                </div>
                <div className="paysync-plan-cell">
                  <span style={{ color: "#4b5563", fontSize: "13px" }}>
                    Order usage
                  </span>
                  <strong
                    style={{
                      display: "block",
                      marginTop: "14px",
                      fontSize: "18px",
                    }}
                  >
                    {usage} / {FREE_SYNC_LIMIT}
                  </strong>
                  <div
                    style={{
                      height: "5px",
                      marginTop: "8px",
                      overflow: "hidden",
                      borderRadius: "999px",
                      background: "#e5e7eb",
                    }}
                  >
                    <div
                      style={{
                        width: `${usagePercent}%`,
                        height: "100%",
                        background: "#0070ba",
                      }}
                    />
                  </div>
                </div>
                <div className="paysync-plan-cell">
                  <span style={{ color: "#4b5563", fontSize: "13px" }}>
                    PayPal account
                  </span>
                  <div style={{ marginTop: "13px" }}>
                    <Pill tone={paypal.connected ? "success" : "critical"}>
                      {formatPayPalAccountStatus(
                        paypal.connected,
                        paypal.mode,
                        paypal.label,
                      )}
                    </Pill>
                  </div>
                </div>
              </div>
            </div>

            <div style={panelStyle}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  gap: "12px",
                  marginBottom: "16px",
                }}
              >
                <div>
                  <h2 style={{ margin: 0, fontSize: "16px" }}>
                    PayPal tracking best practices
                  </h2>
                  <p
                    style={{
                      margin: "6px 0 0",
                      color: "#6d7175",
                      fontSize: "13px",
                    }}
                  >
                    Complete these steps for reliable automatic sync.
                  </p>
                </div>
                <span style={{ color: "#6d7175", fontSize: "12px" }}>
                  {completedSteps} / {setupSteps.length} completed
                </span>
              </div>
              <div
                style={{
                  height: "6px",
                  marginBottom: "16px",
                  overflow: "hidden",
                  borderRadius: "999px",
                  background: "#e5e7eb",
                }}
              >
                <div
                  style={{
                    width: `${(completedSteps / setupSteps.length) * 100}%`,
                    height: "100%",
                    background: "linear-gradient(90deg, #0070ba, #00a47c)",
                  }}
                />
              </div>
              <div style={{ display: "grid", gap: "9px" }}>
                {setupSteps.map((step) => (
                  <div
                    key={step.label}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "10px",
                      padding: "11px 12px",
                      borderRadius: "10px",
                      background: step.done ? "#f1faf6" : "#f7f8f9",
                      color: step.done ? "#08765b" : "#4b5563",
                      fontSize: "13px",
                      fontWeight: 600,
                    }}
                  >
                    <span>{step.done ? "●" : "○"}</span>
                    {step.label}
                  </div>
                ))}
              </div>
            </div>

            <div style={panelStyle}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: "14px",
                  flexWrap: "wrap",
                }}
              >
                <div>
                  <h2 style={{ margin: 0, fontSize: "16px" }}>
                    Sync your previous orders
                  </h2>
                  <p
                    style={{
                      margin: "6px 0 0",
                      color: "#6d7175",
                      fontSize: "13px",
                    }}
                  >
                    Process orders from the last 30 days (PayPal, COD, Razorpay,
                    and other payment methods). PayPal tracking sync still only
                    applies to PayPal orders.
                  </p>
                </div>
                <fetcher.Form method="POST">
                  <input type="hidden" name="intent" value="historical-sync" />
                  <s-button
                    type="submit"
                    variant="primary"
                    {...(fetcher.state !== "idle" ? { loading: true } : {})}
                  >
                    Process old orders
                  </s-button>
                </fetcher.Form>
              </div>
            </div>

            <div style={panelStyle}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: "16px",
                }}
              >
                <h2 style={{ margin: 0, fontSize: "16px" }}>Summary</h2>
                <Pill tone="neutral">All time</Pill>
              </div>
              <div className="paysync-summary-grid">
                <SummaryCard
                  icon="P"
                  label="PayPal orders"
                  value={paypalOrders}
                  accent="#0070ba"
                />
                <SummaryCard
                  icon="✓"
                  label="Total synced"
                  value={stats.synced}
                  accent="#008060"
                />
                <SummaryCard
                  icon="!"
                  label="Sync errors"
                  value={stats.failed}
                  accent="#d72c0d"
                />
              </div>
            </div>

            <div style={panelStyle}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: "12px",
                  marginBottom: "14px",
                }}
              >
                <h2 style={{ margin: 0, fontSize: "16px" }}>Latest activity</h2>
                <s-link href={withEmbeddedSearch("/app/paysync/orders", search)}>View all orders</s-link>
              </div>
              {stats.recent.length > 0 ? (
                <s-table>
                  <s-table-header-row>
                    <s-table-header>Order</s-table-header>
                    <s-table-header>Item name</s-table-header>
                    <s-table-header>Customer</s-table-header>
                    <s-table-header>Order date</s-table-header>
                    <s-table-header>Provider</s-table-header>
                    <s-table-header>Payment</s-table-header>
                    <s-table-header>Sync</s-table-header>
                    <s-table-header>Sync date</s-table-header>
                  </s-table-header-row>
                  <s-table-body>
                    {stats.recent.slice(0, 5).map((order) => (
                      <s-table-row key={order.id}>
                        <s-table-cell>{order.shopifyOrderName}</s-table-cell>
                        <s-table-cell>
                          {order.itemsSummary ? order.itemsSummary : "—"}
                        </s-table-cell>
                        <s-table-cell>
                          {order.customerName ? order.customerName : "—"}
                        </s-table-cell>
                        <s-table-cell>
                          {formatDateTime(
                            order.shopifyCreatedAt ?? order.createdAt,
                          )}
                        </s-table-cell>
                        <s-table-cell>
                          {formatProvider(order.paymentProvider)}
                        </s-table-cell>
                        <s-table-cell>
                          <Pill
                            tone={
                              order.paymentStatus === "paid"
                                ? "success"
                                : order.paymentStatus === "failed"
                                  ? "critical"
                                  : "neutral"
                            }
                          >
                            {formatPaymentStatus(order.paymentStatus)}
                          </Pill>
                        </s-table-cell>
                        <s-table-cell>
                          <Pill tone={syncTone(order.syncStatus)}>
                            {formatSyncStatus(order.syncStatus)}
                          </Pill>
                        </s-table-cell>
                        <s-table-cell>
                          {formatDateTime(
                            order.lastSyncedAt ?? order.updatedAt,
                          )}
                        </s-table-cell>
                      </s-table-row>
                    ))}
                  </s-table-body>
                </s-table>
              ) : (
                <div
                  style={{
                    padding: "30px",
                    borderRadius: "12px",
                    background: "#f7f8f9",
                    color: "#6d7175",
                    textAlign: "center",
                    fontSize: "13px",
                  }}
                >
                  Orders will appear here once Shopify webhooks are processed.
                </div>
              )}
            </div>
          </main>

          <aside style={{ display: "grid", alignContent: "start", gap: "16px" }}>
            <div style={panelStyle}>
              <h2 style={{ margin: "0 0 12px", fontSize: "16px" }}>
                Explore sync settings
              </h2>
              <p
                style={{
                  margin: "0 0 16px",
                  color: "#6d7175",
                  fontSize: "13px",
                  lineHeight: 1.5,
                }}
              >
                Control notifications, tagging, retention, and carrier
                behavior.
              </p>
              <s-link href={withEmbeddedSearch("/app/paysync/settings", search)}>Go to settings →</s-link>
            </div>

            <div style={panelStyle}>
              <h2 style={{ margin: "0 0 12px", fontSize: "16px" }}>
                Resources & support
              </h2>
              <div style={{ display: "grid", gap: "10px" }}>
                {[
                  {
                    icon: "?",
                    title: "Payment accounts",
                    text: "Manage PayPal and Razorpay credentials.",
                    href: withEmbeddedSearch("/app/paysync/paypal", search, {
                      product: null,
                    }),
                  },
                  {
                    icon: "↻",
                    title: "Sync queue",
                    text: "Inspect pending and failed shipments.",
                    href: withEmbeddedSearch("/app/paysync/queue", search, {
                      product: null,
                    }),
                  },
                  {
                    icon: "⚙",
                    title: "Feature settings",
                    text: "Configure order processing.",
                    href: withEmbeddedSearch("/app/paysync/settings", search, {
                      product: null,
                    }),
                  },
                  {
                    icon: "✉",
                    title: "Help & support",
                    text: "Ask about PaySync — tickets open in the PaySync inbox.",
                    href: withEmbeddedSearch("/app/support", search, {
                      product: "paysync",
                    }),
                  },
                ].map((item) => (
                  <button
                    key={item.title}
                    type="button"
                    onClick={() => window.location.assign(item.href)}
                    style={{
                      display: "flex",
                      gap: "10px",
                      padding: "12px",
                      border: "1px solid #e5e7eb",
                      borderRadius: "11px",
                      color: "inherit",
                      textDecoration: "none",
                      background: "#fafbfb",
                      cursor: "pointer",
                      textAlign: "left",
                      width: "100%",
                      font: "inherit",
                    }}
                  >
                    <span
                      style={{
                        display: "grid",
                        width: "28px",
                        height: "28px",
                        placeItems: "center",
                        flexShrink: 0,
                        borderRadius: "8px",
                        color: "#0070ba",
                        background: "#eaf5ff",
                        fontWeight: 700,
                      }}
                    >
                      {item.icon}
                    </span>
                    <span>
                      <strong style={{ display: "block", fontSize: "13px" }}>
                        {item.title}
                      </strong>
                      <span
                        style={{
                          display: "block",
                          marginTop: "3px",
                          color: "#6d7175",
                          fontSize: "12px",
                        }}
                      >
                        {item.text}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div
              style={{
                ...panelStyle,
                background: "linear-gradient(145deg, #edf7ff, #f6f2ff)",
              }}
            >
              <span style={{ color: "#5b43b8", fontSize: "20px" }}>♡</span>
              <h2 style={{ margin: "8px 0", fontSize: "15px" }}>
                Help us improve PaySync
              </h2>
              <p
                style={{
                  margin: "0 0 12px",
                  color: "#5f6368",
                  fontSize: "12px",
                  lineHeight: 1.5,
                }}
              >
                Your feedback helps shape a clearer, faster tracking workflow.
              </p>
              <s-link
                href={withEmbeddedSearch("/app/support", search, {
                  product: "paysync",
                })}
              >
                Contact PaySync support →
              </s-link>
            </div>
          </aside>
        </div>
      </div>

      <style>{`
        .paysync-dashboard-grid {
          display: grid;
          grid-template-columns: minmax(0, 2fr) minmax(250px, 0.85fr);
          gap: 16px;
          align-items: start;
        }
        .paysync-plan-grid,
        .paysync-summary-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 12px;
        }
        .paysync-plan-cell {
          border-left: 1px solid #e5e7eb;
          padding-left: 16px;
        }
        @media (max-width: 850px) {
          .paysync-dashboard-grid {
            grid-template-columns: 1fr;
          }
        }
        @media (max-width: 620px) {
          .paysync-plan-grid,
          .paysync-summary-grid {
            grid-template-columns: 1fr;
          }
          .paysync-plan-cell {
            border-left: 0;
            border-top: 1px solid #e5e7eb;
            padding: 14px 0 0;
          }
        }
      `}</style>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
