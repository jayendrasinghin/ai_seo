import { useEffect, useRef, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  Form,
  isRouteErrorResponse,
  redirect,
  useFetcher,
  useLoaderData,
  useLocation,
  useRouteError,
} from "react-router";
import {
  adminSessionCookie,
  destroyAdminSession,
  requireAdminSession,
} from "../admin-auth.server";
import prisma from "../db.server";

const MAX_REPLY = 5000;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  try {
    await requireAdminSession(request);
  } catch {
    throw redirect("/admin/login");
  }

  const installedShopRows = await prisma.session.findMany({
    distinct: ["shop"],
    select: { shop: true },
    orderBy: { shop: "asc" },
  });
  const usageRows = await prisma.storeUsage.findMany({
    select: {
      shop: true,
      plan: true,
      aiSeoUsed: true,
      aiImageUsed: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  const usageByShop = new Map(usageRows.map((u) => [u.shop, u]));
  const installedShops = installedShopRows.map((row) => {
    const usage = usageByShop.get(row.shop);
    return {
      shop: row.shop,
      plan: usage?.plan ?? "free",
      aiSeoUsed: usage?.aiSeoUsed ?? 0,
      aiImageUsed: usage?.aiImageUsed ?? 0,
      firstSeenAt: usage?.createdAt ?? null,
      lastActivityAt: usage?.updatedAt ?? null,
    };
  });

  const messages = await prisma.supportMessage.findMany({
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
  return { messages, installedShops };
};

type SupportRow = Awaited<ReturnType<typeof loader>>["messages"][number];

export const action = async ({ request }: ActionFunctionArgs) => {
  const formData = await request.formData();
  const intent = String(formData.get("intent") || "");
  if (intent === "set_reply") {
    try {
      await requireAdminSession(request);
    } catch {
      throw redirect("/admin/login");
    }
    const id = String(formData.get("messageId") || "");
    const replyRaw = String(formData.get("reply") || "").trim();
    if (!id) return { status: "error" as const, message: "Missing message id." };
    if (replyRaw.length > MAX_REPLY) {
      return {
        status: "error" as const,
        message: `Reply must be at most ${MAX_REPLY} characters.`,
      };
    }
    await prisma.supportMessage.update({
      where: { id },
      data: { reply: replyRaw.length > 0 ? replyRaw : null, replyAt: replyRaw ? new Date() : null },
    });
    return { status: "saved" as const, messageId: id };
  }

  if (intent !== "logout") return null;

  const cookieHeader = request.headers.get("Cookie");
  const token = await adminSessionCookie.parse(cookieHeader);
  await destroyAdminSession(token && typeof token === "string" ? token : null);
  return redirect("/admin/login", {
    headers: {
      "Set-Cookie": await adminSessionCookie.serialize("", { maxAge: 0 }),
    },
  });
};

function SupportMessageCard({ m }: { m: SupportRow }) {
  const fetcher = useFetcher<typeof action>();
  const busy = fetcher.state !== "idle";
  const cardRef = useRef<HTMLDivElement>(null);
  const lastSaved =
    fetcher.state === "idle" &&
    fetcher.data &&
    "status" in fetcher.data &&
    fetcher.data.status === "saved" &&
    fetcher.data.messageId === m.id;

  const [flashSaved, setFlashSaved] = useState(false);

  useEffect(() => {
    if (!lastSaved || !cardRef.current) return;
    cardRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
    setFlashSaved(true);
    const t = window.setTimeout(() => setFlashSaved(false), 5000);
    return () => window.clearTimeout(t);
  }, [lastSaved]);

  useEffect(() => {
    if (fetcher.state === "submitting") setFlashSaved(false);
  }, [fetcher.state]);

  // Remount textarea when server reply changes so defaultValue matches DB (uncontrolled inputs ignore prop updates).
  const replyFieldKey = `${m.id}-${m.replyAt ? new Date(m.replyAt).toISOString() : "none"}`;

  return (
    <div
      ref={cardRef}
      id={`admin-msg-${m.id}`}
      style={{ border: "1px solid #ddd", borderRadius: 8, padding: "0.75rem 1rem" }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
        <strong>{m.shop}</strong>
        <span style={{ color: "#666", fontSize: 13 }}>
          {new Date(m.createdAt).toLocaleString()}
        </span>
      </div>
      {m.subject ? <p style={{ margin: "0.35rem 0", fontWeight: 600 }}>{m.subject}</p> : null}
      <p style={{ margin: "0.35rem 0", whiteSpace: "pre-wrap" }}>{m.message}</p>
      <p style={{ margin: "0.35rem 0", color: "#555", fontSize: 13 }}>
        {m.contactEmail ? `Email: ${m.contactEmail}` : ""}
        {m.contactEmail && m.whatsapp ? " · " : ""}
        {m.whatsapp ? `WhatsApp: ${m.whatsapp}` : ""}
      </p>

      {m.reply ? (
        <div
          style={{
            marginTop: "0.5rem",
            padding: "0.5rem 0.65rem",
            background: "#f0f5ff",
            borderRadius: 6,
            border: "1px solid #c5d4f9",
            fontSize: 14,
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: "0.25rem" }}>
            Reply (shown to merchant in the app)
          </div>
          <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{m.reply}</p>
          {m.replyAt ? (
            <p style={{ margin: "0.35rem 0 0", fontSize: 12, color: "#555" }}>
              Last saved: {new Date(m.replyAt).toLocaleString()}
            </p>
          ) : null}
        </div>
      ) : null}

      <fetcher.Form method="post" style={{ marginTop: "0.5rem" }}>
        <input type="hidden" name="intent" value="set_reply" />
        <input type="hidden" name="messageId" value={m.id} />
        <label style={{ display: "block", fontSize: 13, color: "#444", marginBottom: "0.25rem" }}>
          {m.reply ? "Edit reply" : "Your reply"}
        </label>
        <textarea
          key={replyFieldKey}
          name="reply"
          rows={3}
          maxLength={MAX_REPLY}
          defaultValue={m.reply ?? ""}
          placeholder="Write reply for merchant..."
          style={{ width: "100%", maxWidth: "40rem", padding: "0.45rem" }}
        />
        <div style={{ marginTop: "0.4rem", display: "flex", alignItems: "center", gap: "0.65rem" }}>
          <button type="submit" disabled={busy}>
            {busy ? "Saving…" : "Save reply"}
          </button>
          {flashSaved ? (
            <span style={{ color: "#0d7a3e", fontSize: 14 }}>Reply saved.</span>
          ) : null}
          {fetcher.data &&
          typeof fetcher.data === "object" &&
          "status" in fetcher.data &&
          fetcher.data.status === "error" ? (
            <span style={{ color: "#b00020", fontSize: 14 }}>{fetcher.data.message}</span>
          ) : null}
        </div>
      </fetcher.Form>
    </div>
  );
}

export default function AdminIndexPage() {
  const { messages, installedShops } = useLoaderData<typeof loader>();
  const { search } = useLocation();
  const section = new URLSearchParams(search).get("section") === "shops" ? "shops" : "support";
  return (
    <div style={{ maxWidth: 980, margin: "2rem auto", padding: "0 1rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1>Admin support dashboard</h1>
        <Form method="post">
          <input type="hidden" name="intent" value="logout" />
          <button type="submit">Logout</button>
        </Form>
      </div>
      <div style={{ display: "flex", gap: 10, margin: "0.5rem 0 1rem" }}>
        <a href="/admin?section=support">Support</a>
        <a href="/admin?section=shops">Installed stores</a>
      </div>

      {section === "shops" ? (
        <>
          <p style={{ color: "#555" }}>
            Shops currently installed (from sessions) with plan and activity details.
          </p>
          {installedShops.length === 0 ? (
            <p>No installed shops found yet.</p>
          ) : (
            <div style={{ display: "grid", gap: "0.5rem" }}>
              {installedShops.map((s) => (
                <div
                  key={s.shop}
                  style={{ border: "1px solid #ddd", borderRadius: 8, padding: "0.6rem 0.9rem" }}
                >
                  <div style={{ fontWeight: 700 }}>{s.shop}</div>
                  <div style={{ fontSize: 13, color: "#555", marginTop: 4 }}>
                    Plan: {s.plan} · AI SEO used: {s.aiSeoUsed} · AI image used: {s.aiImageUsed}
                  </div>
                  <div style={{ fontSize: 12, color: "#666", marginTop: 2 }}>
                    First seen: {s.firstSeenAt ? new Date(s.firstSeenAt).toLocaleString() : "-"} ·
                    Last activity:{" "}
                    {s.lastActivityAt ? new Date(s.lastActivityAt).toLocaleString() : "-"}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      ) : null}

      {section === "support" && messages.length === 0 ? (
        <p>No support messages yet.</p>
      ) : null}

      {section === "support" ? (
        <>
        <p style={{ color: "#555" }}>Latest 100 support submissions from all shops.</p>
        <div style={{ display: "grid", gap: "0.75rem" }}>
          {messages.map((m) => (
            <SupportMessageCard key={m.id} m={m} />
          ))}
        </div>
        </>
      ) : null}
    </div>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  const isDisabled404 =
    isRouteErrorResponse(error) &&
    error.status === 404 &&
    error.data === "Not found";

  return (
    <div style={{ maxWidth: 560, margin: "4rem auto", padding: "1rem" }}>
      <h1 style={{ marginBottom: "0.5rem" }}>
        {isDisabled404 ? "Admin panel is disabled" : "Unable to open admin dashboard"}
      </h1>
      <p style={{ marginTop: 0, color: "#555" }}>
        {isDisabled404
          ? "Set ADMIN_PANEL_ENABLED=true in your environment, restart the app with updated env, then open /admin again."
          : "Please try again. If this keeps happening, check server logs for the exact error."}
      </p>
    </div>
  );
}
