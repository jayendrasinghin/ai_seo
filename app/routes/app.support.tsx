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
import {
  getSupportAppIdForProduct,
  normalizeSupportProduct,
  type SupportProductKey,
} from "../admin-auth.server";
import { authenticate } from "../shopify.server";
import { PaySyncHomeButton, SeoHomeButton } from "../HomeButton";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";

const PRODUCT_LABEL: Record<SupportProductKey, string> = {
  seoi: "Seoi SEO",
  paysync: "PaySync",
};

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
  const url = new URL(request.url);
  const product = normalizeSupportProduct(url.searchParams.get("product"));
  const appId = await getSupportAppIdForProduct(product);

  const delegate = supportMessageDelegate();
  const recent = delegate
    ? await delegate.findMany({
        where: {
          shop,
          ...(appId
            ? {
                OR: [
                  { appId },
                  // Legacy SEO tickets created before product tagging
                  ...(product === "seoi" ? [{ appId: null }] : []),
                ],
              }
            : {}),
        },
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
    product,
    productLabel: PRODUCT_LABEL[product],
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

  const product = normalizeSupportProduct(String(formData.get("product") ?? ""));
  let appId: string | null = null;
  try {
    appId = await getSupportAppIdForProduct(product);
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
  const {
    recent,
    clientStale,
    defaultContactEmail,
    defaultWhatsapp,
    shop,
    product,
    productLabel,
  } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const busy = fetcher.state !== "idle";
  const ok = fetcher.data?.status === "ok";
  const err =
    fetcher.data?.status === "error" ? fetcher.data.message : null;

  return (
    <div className="seoi-support-page">
      {product === "paysync" ? <PaySyncHomeButton /> : <SeoHomeButton />}
      <h1 className="seoi-support-title">Help &amp; support</h1>

        <div className="seoi-page-hero seoi-support-hero">
          <div className="seoi-page-hero__content">
            <span className="seoi-eyebrow">{productLabel} support</span>
            <h2>We’re here when you need us.</h2>
            <p>
              Ask a question, report an issue, or request guidance — replies stay
              with this store so your history is always easy to find.
            </p>
          </div>
          <div className="seoi-support-hero__aside">
            <span className="seoi-status">Online</span>
            <span className="seoi-support-hero__shop">{shop}</span>
          </div>
        </div>

        {clientStale ? (
          <section className="seoi-section-card">
            <div className="seoi-callout seoi-callout--danger">
              Support cannot save messages until the database client is updated.
              Run <code>npx prisma generate</code> and{" "}
              <code>npx prisma migrate deploy</code>, then restart.
            </div>
          </section>
        ) : null}

        <div className="seoi-support-layout">
          <section className="seoi-support-compose">
            <header className="seoi-support-compose__head">
              <h3>Send a message</h3>
              <p>Your store is attached automatically to every request.</p>
            </header>

            <fetcher.Form method="post" className="seoi-support-form">
              <input type="hidden" name="product" value={product} />
              <div className="seoi-support-row">
                <div className="seoi-support-field">
                  <label htmlFor="support-email">Email</label>
                  <input
                    id="support-email"
                    name="contactEmail"
                    type="email"
                    autoComplete="email"
                    defaultValue={defaultContactEmail}
                    placeholder="you@example.com"
                    disabled={clientStale}
                  />
                </div>
                <div className="seoi-support-field">
                  <label htmlFor="support-whatsapp">WhatsApp</label>
                  <input
                    id="support-whatsapp"
                    name="whatsapp"
                    type="tel"
                    autoComplete="tel"
                    defaultValue={defaultWhatsapp}
                    placeholder="+91…"
                    maxLength={32}
                    disabled={clientStale}
                  />
                </div>
              </div>

              <div className="seoi-support-field">
                <label htmlFor="support-subject">Subject</label>
                <input
                  id="support-subject"
                  name="subject"
                  type="text"
                  maxLength={MAX_SUBJECT}
                  placeholder="Billing, feature request, bug report…"
                  disabled={clientStale}
                />
              </div>

              <div className="seoi-support-field">
                <label htmlFor="support-message">Message</label>
                <textarea
                  id="support-message"
                  name="message"
                  required
                  rows={7}
                  minLength={10}
                  maxLength={MAX_MESSAGE}
                  placeholder="Tell us what happened and what you need…"
                  disabled={clientStale}
                />
              </div>

              <div className="seoi-support-form__footer">
                <button
                  type="submit"
                  className="seoi-primary-action"
                  disabled={busy || clientStale}
                >
                  {busy ? "Sending…" : "Send message"}
                </button>
                {ok ? (
                  <p className="seoi-support-success">
                    Message sent — we’ll reply here soon.
                  </p>
                ) : null}
                {err ? <p className="seoi-support-error">{err}</p> : null}
              </div>
            </fetcher.Form>
          </section>

          <aside className="seoi-support-guide">
            <h3>Tips for a faster reply</h3>
            <p>
              {product === "paysync"
                ? "A few details help us diagnose PayPal, Razorpay, or sync issues quickly."
                : "A few details help us diagnose SEO, billing, or image issues quickly."}
            </p>
            <ul>
              <li>
                <strong>Context</strong>
                <span>What you tried and what went wrong</span>
              </li>
              <li>
                <strong>IDs</strong>
                <span>
                  {product === "paysync"
                    ? "Order name, PayPal transaction ID, or sync queue job if relevant"
                    : "Product, scan, or billing references if relevant"}
                </span>
              </li>
              <li>
                <strong>Contact</strong>
                <span>Best email or WhatsApp for follow-up</span>
              </li>
              <li>
                <strong>Store</strong>
                <span>Domain is saved automatically</span>
              </li>
            </ul>
          </aside>
        </div>

        <section className="seoi-support-history">
          <header className="seoi-support-history__head">
            <div>
              <h3>Conversation history</h3>
              <p>{productLabel} messages and replies for this store.</p>
            </div>
            {recent.length > 0 ? (
              <span className="seoi-status">{recent.length} thread{recent.length === 1 ? "" : "s"}</span>
            ) : null}
          </header>

          {recent.length > 0 ? (
            <div className="seoi-conversation-list">
              {recent.map((row) => (
                <article
                  key={row.id}
                  className={`seoi-thread${row.reply ? " seoi-thread--replied" : ""}`}
                >
                  <div className="seoi-thread__head">
                    <div className="seoi-thread__title">
                      <h4>{row.subject?.trim() || "Support request"}</h4>
                      <time dateTime={new Date(row.createdAt).toISOString()}>
                        {new Date(row.createdAt).toLocaleString(undefined, {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}
                      </time>
                    </div>
                    <span
                      className={`seoi-thread__badge${row.reply ? " seoi-thread__badge--done" : " seoi-thread__badge--open"}`}
                    >
                      {row.reply ? "Replied" : "Open"}
                    </span>
                  </div>

                  <div className="seoi-thread__bubble seoi-thread__bubble--you">
                    <span className="seoi-thread__who">You</span>
                    <p>{row.message}</p>
                    {(row.contactEmail || row.whatsapp) && (
                      <div className="seoi-thread__chips">
                        {row.contactEmail ? (
                          <span>{row.contactEmail}</span>
                        ) : null}
                        {row.whatsapp ? <span>{row.whatsapp}</span> : null}
                      </div>
                    )}
                  </div>

                  {row.reply ? (
                    <div className="seoi-thread__bubble seoi-thread__bubble--support">
                      <div className="seoi-thread__who-row">
                        <span className="seoi-thread__who">Support</span>
                        {row.replyAt ? (
                          <time dateTime={new Date(row.replyAt).toISOString()}>
                            {new Date(row.replyAt).toLocaleString(undefined, {
                              dateStyle: "medium",
                              timeStyle: "short",
                            })}
                          </time>
                        ) : null}
                      </div>
                      <p>{row.reply}</p>
                    </div>
                  ) : (
                    <p className="seoi-thread__waiting">
                      Waiting for a reply — we’ll post it here.
                    </p>
                  )}
                </article>
              ))}
            </div>
          ) : (
            <div className="seoi-empty-state seoi-support-empty">
              <strong>No conversations yet</strong>
              <span>Send your first message above and it will appear here.</span>
            </div>
          )}
        </section>
    </div>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (args) => boundary.headers(args);
