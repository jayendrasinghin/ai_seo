import {
  useFetcher,
  useLoaderData,
  useLocation,
  useRouteError,
} from "react-router";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import type { CSSProperties } from "react";
import { timingSafeEqual } from "node:crypto";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";
import { withEmbeddedSearch } from "../embedded-nav";

const pageShellStyle: CSSProperties = {
  backgroundColor: "#f1f2f4",
  minHeight: "100%",
};

const MAX_REPLY = 5000;

function tokenOk(provided: string | null, expected: string | undefined): boolean {
  if (!provided || !expected) return false;
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

type SupportInboxRow = {
  id: string;
  shop: string;
  subject: string | null;
  message: string;
  contactEmail: string | null;
  whatsapp: string | null;
  reply: string | null;
  replyAt: Date | null;
  createdAt: Date;
};

async function loadMessages(): Promise<SupportInboxRow[]> {
  return prisma.supportMessage.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      shop: true,
      subject: true,
      message: true,
      contactEmail: true,
      whatsapp: true,
      reply: true,
      replyAt: true,
      createdAt: true,
    },
  });
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  const expected = process.env.SUPPORT_INBOX_TOKEN?.trim();
  const url = new URL(request.url);
  const token = url.searchParams.get("token");

  if (!expected) {
    return {
      mode: "no_env" as const,
      messages: [] as SupportInboxRow[],
    };
  }

  if (!tokenOk(token, expected)) {
    return {
      mode: "need_login" as const,
      messages: [] as SupportInboxRow[],
    };
  }

  return {
    mode: "ok" as const,
    messages: await loadMessages(),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  await authenticate.admin(request);
  const expected = process.env.SUPPORT_INBOX_TOKEN?.trim();
  if (!expected) {
    return { status: "error" as const, message: "SUPPORT_INBOX_TOKEN is not set." };
  }

  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");
  const token = String(formData.get("token") ?? "");

  if (!tokenOk(token, expected)) {
    return { status: "error" as const, message: "Invalid access token." };
  }

  if (intent === "set_reply") {
    const id = String(formData.get("messageId") ?? "");
    const replyRaw = String(formData.get("reply") ?? "").trim();

    if (!id) {
      return { status: "error" as const, message: "Missing message id." };
    }
    if (replyRaw.length > MAX_REPLY) {
      return {
        status: "error" as const,
        message: `Reply must be at most ${MAX_REPLY} characters.`,
      };
    }

    const reply = replyRaw.length > 0 ? replyRaw : null;
    await prisma.supportMessage.update({
      where: { id },
      data: {
        reply,
        replyAt: reply ? new Date() : null,
      },
    });

    return { status: "saved" as const, id };
  }

  return null;
};

export default function SupportInboxPage() {
  const data = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const location = useLocation();
  const search = location.search;
  const formAction = withEmbeddedSearch("/app/support-inbox", search);
  const tokenParam = new URLSearchParams(search).get("token") ?? "";

  return (
    <div style={pageShellStyle}>
      <s-page heading="Support inbox (developer)">
        <s-section>
          <s-text tone="neutral">
            Internal tool: reply to merchant messages. Set a long random{" "}
            <code style={{ whiteSpace: "nowrap" }}>SUPPORT_INBOX_TOKEN</code>{" "}
            in <code>.env</code>, then open this page with{" "}
            <code style={{ whiteSpace: "nowrap" }}>?token=…</code> in the URL
            (bookmark it). Do not share the link.
          </s-text>
        </s-section>

        {data.mode === "no_env" ? (
          <s-section heading="Not configured">
            <s-text tone="critical">
              Add{" "}
              <code style={{ whiteSpace: "nowrap" }}>SUPPORT_INBOX_TOKEN</code>{" "}
              to your environment and restart the server.
            </s-text>
          </s-section>
        ) : null}

        {data.mode === "need_login" ? (
          <s-section heading="Sign in">
            <form method="get" action={formAction}>
              <s-stack direction="block" gap="base">
                <label style={{ display: "block" }}>
                  <s-text font-weight="bold">Inbox token</s-text>
                  <input
                    name="token"
                    type="password"
                    autoComplete="off"
                    required
                    style={{
                      display: "block",
                      width: "100%",
                      maxWidth: "24rem",
                      marginTop: "0.35rem",
                      padding: "0.5rem",
                    }}
                  />
                </label>
                <s-button type="submit" variant="primary">
                  Continue
                </s-button>
              </s-stack>
            </form>
          </s-section>
        ) : null}

        {data.mode === "ok" ? (
          <s-section heading="All stores (latest 100)">
            <s-stack direction="block" gap="large">
              {data.messages.length === 0 ? (
                <s-text tone="neutral">No messages yet.</s-text>
              ) : (
                data.messages.map((row) => (
                  <InboxRow
                    key={row.id}
                    row={row}
                    token={tokenParam}
                    formAction={formAction}
                    fetcher={fetcher}
                  />
                ))
              )}
            </s-stack>
          </s-section>
        ) : null}
      </s-page>
    </div>
  );
}

function InboxRow({
  row,
  token,
  fetcher,
  formAction,
}: {
  row: SupportInboxRow;
  token: string;
  fetcher: ReturnType<typeof useFetcher<typeof action>>;
  formAction: string;
}) {
  const busy =
    fetcher.state !== "idle" &&
    fetcher.formData?.get("messageId") === row.id;

  const saved =
    fetcher.data?.status === "saved" && fetcher.data.id === row.id;

  return (
    <div
      style={{
        border: "1px solid #c9cccf",
        borderRadius: 8,
        padding: "1rem",
        background: "#fff",
      }}
    >
      <s-text tone="neutral">
        {new Date(row.createdAt).toLocaleString(undefined, {
          dateStyle: "medium",
          timeStyle: "short",
        })}
      </s-text>
      <div style={{ marginTop: "0.25rem" }}>
        <s-text font-weight="bold">Shop: {row.shop}</s-text>
      </div>
      {row.subject ? (
        <div style={{ marginTop: "0.25rem" }}>
          <s-text font-weight="bold">{row.subject}</s-text>
        </div>
      ) : null}
      <div style={{ marginTop: "0.5rem", whiteSpace: "pre-wrap" }}>
        <s-text>{row.message}</s-text>
      </div>
      <s-text tone="neutral">
        {row.contactEmail ? `Email: ${row.contactEmail}` : ""}
        {row.contactEmail && row.whatsapp ? " · " : ""}
        {row.whatsapp ? `WhatsApp: ${row.whatsapp}` : ""}
      </s-text>

      <fetcher.Form
        method="post"
        action={formAction}
        style={{ marginTop: "0.75rem" }}
      >
        <input type="hidden" name="intent" value="set_reply" />
        <input type="hidden" name="token" value={token} />
        <input type="hidden" name="messageId" value={row.id} />
        <label style={{ display: "block" }}>
          <s-text font-weight="bold">Your reply (merchant sees this)</s-text>
          <textarea
            key={`${row.id}-${row.replyAt ?? "none"}`}
            name="reply"
            rows={4}
            maxLength={MAX_REPLY}
            defaultValue={row.reply ?? ""}
            placeholder="Type a reply, or clear and save to remove the reply."
            style={{
              display: "block",
              width: "100%",
              maxWidth: "40rem",
              marginTop: "0.35rem",
              padding: "0.5rem",
            }}
          />
        </label>
        <div style={{ marginTop: "0.5rem" }}>
          <s-button
            type="submit"
            variant="primary"
            {...(busy ? { loading: true } : {})}
            disabled={busy}
          >
            Save reply
          </s-button>
        </div>
        {saved ? (
          <s-text tone="success">Saved.</s-text>
        ) : null}
        {fetcher.data?.status === "error" &&
        fetcher.formData?.get("messageId") === row.id ? (
          <s-text tone="critical">{fetcher.data.message}</s-text>
        ) : null}
      </fetcher.Form>
    </div>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (args) => boundary.headers(args);
