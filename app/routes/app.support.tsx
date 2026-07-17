import {
  useFetcher,
  useLoaderData,
  useRouteError,
} from "react-router";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { getDefaultSupportAppId } from "../admin-auth.server";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";

const MAX_MESSAGE = 5000;
const MAX_SUBJECT = 200;

/** Stale deploys can ship an old generated client without `SupportMessage` — `prisma.supportMessage` is then undefined. */
function supportMessageDelegate() {
  return (
    prisma as unknown as {
      supportMessage?: (typeof prisma)["supportMessage"];
    }
  ).supportMessage;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;

  const delegate = supportMessageDelegate();
  const recent = delegate
    ? await delegate.findMany({
        where: { shop },
        orderBy: { createdAt: "desc" },
        take: 10,
        select: {
          id: true,
          subject: true,
          message: true,
          contactEmail: true,
          whatsapp: true,
          reply: true,
          replyAt: true,
          createdAt: true,
        },
      })
    : [];

  let shopEmailHint = "";
  let shopPhoneHint = "";
  try {
    const res = await admin.graphql(
      `#graphql
        query SupportShopContact {
          shop {
            email
            contactEmail
            billingAddress {
              phone
            }
          }
        }`,
    );
    const json = (await res.json()) as {
      data?: {
        shop?: {
          email?: string | null;
          contactEmail?: string | null;
          billingAddress?: { phone?: string | null } | null;
        } | null;
      };
      errors?: { message: string }[];
    };
    if (!json.errors?.length && json.data?.shop) {
      const s = json.data.shop;
      shopEmailHint = (s.contactEmail || s.email || "").trim();
      const rawPhone = (s.billingAddress?.phone || "").trim();
      shopPhoneHint = rawPhone.slice(0, 32);
    }
  } catch {
    /* optional hints only */
  }

  const sessionRow = await prisma.session.findUnique({
    where: { id: session.id },
    select: { email: true },
  });
  const sessionEmail = sessionRow?.email?.trim() ?? "";
  const lastContact = recent[0];
  const defaultContactEmail =
    shopEmailHint ||
    sessionEmail ||
    (lastContact?.contactEmail?.trim() ?? "") ||
    "";
  const defaultWhatsapp =
    shopPhoneHint || (lastContact?.whatsapp?.trim() ?? "") || "";

  return {
    shop,
    recent,
    clientStale: !delegate,
    defaultContactEmail,
    defaultWhatsapp,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();

  const subjectRaw = String(formData.get("subject") ?? "").trim();
  const messageRaw = String(formData.get("message") ?? "").trim();
  const contactEmailRaw = String(formData.get("contactEmail") ?? "").trim();
  const whatsappRaw = String(formData.get("whatsapp") ?? "").trim();

  if (messageRaw.length < 10) {
    return {
      status: "error" as const,
      message: "Please enter at least 10 characters so we can help.",
    };
  }
  if (messageRaw.length > MAX_MESSAGE) {
    return {
      status: "error" as const,
      message: `Message must be at most ${MAX_MESSAGE} characters.`,
    };
  }
  if (subjectRaw.length > MAX_SUBJECT) {
    return {
      status: "error" as const,
      message: `Subject must be at most ${MAX_SUBJECT} characters.`,
    };
  }

  let contactEmail: string | null = null;
  if (contactEmailRaw.length > 0) {
    const basic =
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmailRaw) &&
      contactEmailRaw.length <= 320;
    if (!basic) {
      return {
        status: "error" as const,
        message: "Please enter a valid email address, or leave it blank.",
      };
    }
    contactEmail = contactEmailRaw;
  }

  let whatsapp: string | null = null;
  if (whatsappRaw.length > 0) {
    if (whatsappRaw.length > 32) {
      return {
        status: "error" as const,
        message: "WhatsApp number is too long (max 32 characters).",
      };
    }
    whatsapp = whatsappRaw;
  }

  const delegate = supportMessageDelegate();
  if (!delegate) {
    return {
      status: "error" as const,
      message:
        "Support form is unavailable until the app is redeployed with a current database client. Run `npx prisma generate` on the server, then restart.",
    };
  }

  let appId: string | null = null;
  try {
    appId = await getDefaultSupportAppId();
  } catch {
    appId = null;
  }

  await delegate.create({
    data: {
      shop,
      subject: subjectRaw.length > 0 ? subjectRaw : null,
      message: messageRaw,
      contactEmail,
      whatsapp,
      status: "open",
      ...(appId ? { appId } : {}),
    },
  });

  return { status: "ok" as const };
};

export default function SupportPage() {
  const { recent, clientStale, defaultContactEmail, defaultWhatsapp } =
    useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const busy = fetcher.state !== "idle";
  const ok = fetcher.data?.status === "ok";
  const err =
    fetcher.data?.status === "error" ? fetcher.data.message : null;

  return (
    <div>
      <s-page heading="Help &amp; support">
        <div className="seoi-page-hero">
          <div className="seoi-page-hero__content">
            <span className="seoi-eyebrow">Merchant support</span>
            <h2>Get help without leaving Shopify.</h2>
            <p>
              Send a question, report an issue, or request guidance. Replies stay
              attached to your store so your support history remains easy to find.
            </p>
          </div>
          <span className="seoi-status">Support available</span>
        </div>

        <s-section>
          <s-text tone="neutral">
            Send us a question or describe an issue. Your store domain is saved
            automatically so we can match the request to your shop. When we
            reply, it appears under your message below.
          </s-text>
        </s-section>

        {clientStale ? (
          <s-section heading="Setup required">
            <s-text tone="critical">
              The support database client is missing on this server. On the
              machine that runs the app, run{" "}
              <code style={{ whiteSpace: "nowrap" }}>npx prisma generate</code>
              , apply migrations with{" "}
              <code style={{ whiteSpace: "nowrap" }}>
                npx prisma migrate deploy
              </code>
              , then restart the process. After redeploy, reload this page.
            </s-text>
          </s-section>
        ) : null}

        <s-section heading="Send a message">
          <fetcher.Form method="post" className="seoi-support-form">
            <s-stack direction="block" gap="base">
              <label style={{ display: "block" }}>
                <s-text font-weight="bold">Your email (optional)</s-text>
                <s-text tone="neutral">
                  We can reply to this address. Pre-filled from your shop or
                  account when available — edit or clear as you like. Leave blank
                  if you prefer we use your Shopify account contact only.
                </s-text>
                <input
                  name="contactEmail"
                  type="email"
                  autoComplete="email"
                  defaultValue={defaultContactEmail}
                  placeholder="you@example.com"
                  disabled={clientStale}
                  style={{
                    display: "block",
                    width: "100%",
                    maxWidth: "28rem",
                    marginTop: "0.35rem",
                    padding: "0.5rem",
                  }}
                />
              </label>
              <label style={{ display: "block" }}>
                <s-text font-weight="bold">WhatsApp (optional)</s-text>
                <s-text tone="neutral">
                  Include country code, e.g. +1 555 123 4567. Pre-filled from
                  your shop billing phone when Shopify provides it.
                </s-text>
                <input
                  name="whatsapp"
                  type="tel"
                  autoComplete="tel"
                  defaultValue={defaultWhatsapp}
                  placeholder="+1…"
                  maxLength={32}
                  disabled={clientStale}
                  style={{
                    display: "block",
                    width: "100%",
                    maxWidth: "28rem",
                    marginTop: "0.35rem",
                    padding: "0.5rem",
                  }}
                />
              </label>
              <label style={{ display: "block" }}>
                <s-text font-weight="bold">Subject (optional)</s-text>
                <input
                  name="subject"
                  type="text"
                  maxLength={MAX_SUBJECT}
                  placeholder="e.g. Billing question, feature request"
                  disabled={clientStale}
                  style={{
                    display: "block",
                    width: "100%",
                    maxWidth: "28rem",
                    marginTop: "0.35rem",
                    padding: "0.5rem",
                  }}
                />
              </label>
              <label style={{ display: "block" }}>
                <s-text font-weight="bold">Message</s-text>
                <textarea
                  name="message"
                  required
                  rows={6}
                  minLength={10}
                  maxLength={MAX_MESSAGE}
                  placeholder="Describe your question or what you need help with…"
                  disabled={clientStale}
                  style={{
                    display: "block",
                    width: "100%",
                    maxWidth: "36rem",
                    marginTop: "0.35rem",
                    padding: "0.5rem",
                  }}
                />
              </label>
              <div>
                <s-button
                  type="submit"
                  variant="primary"
                  {...(busy ? { loading: true } : {})}
                  disabled={busy || clientStale}
                >
                  Send message
                </s-button>
              </div>
              {ok ? (
                <s-text tone="success">
                  Thanks — we received your message and will get back to you as
                  soon as we can.
                </s-text>
              ) : null}
              {err ? <s-text tone="critical">{err}</s-text> : null}
            </s-stack>
          </fetcher.Form>
        </s-section>

        {recent.length > 0 ? (
          <s-section heading="Your recent messages (this store)">
            <div className="seoi-conversation-list">
              {recent.map((row) => (
                <div
                  key={row.id}
                  className="seoi-conversation-card"
                >
                  <s-text tone="neutral">
                    {new Date(row.createdAt).toLocaleString(undefined, {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </s-text>
                  {row.subject ? (
                    <div style={{ marginTop: "0.25rem" }}>
                      <s-text font-weight="bold">{row.subject}</s-text>
                    </div>
                  ) : null}
                  <div style={{ marginTop: "0.35rem", whiteSpace: "pre-wrap" }}>
                    <s-text>{row.message}</s-text>
                  </div>
                  {row.contactEmail ? (
                    <s-text tone="neutral">
                      Email: {row.contactEmail}
                    </s-text>
                  ) : null}
                  {row.whatsapp ? (
                    <s-text tone="neutral">WhatsApp: {row.whatsapp}</s-text>
                  ) : null}
                  {row.reply ? (
                    <div
                      className="seoi-support-reply"
                    >
                      <s-text font-weight="bold">Reply from support</s-text>
                      {row.replyAt ? (
                        <s-text tone="neutral">
                          {new Date(row.replyAt).toLocaleString(undefined, {
                            dateStyle: "medium",
                            timeStyle: "short",
                          })}
                        </s-text>
                      ) : null}
                      <div
                        style={{
                          marginTop: "0.35rem",
                          whiteSpace: "pre-wrap",
                        }}
                      >
                        <s-text>{row.reply}</s-text>
                      </div>
                    </div>
                  ) : (
                    <s-text tone="neutral">
                      No reply yet — we’ll post it here when we respond.
                    </s-text>
                  )}
                </div>
              ))}
            </div>
          </s-section>
        ) : null}
      </s-page>
    </div>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (args) => boundary.headers(args);
