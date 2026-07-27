import { useEffect, useRef, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  Form,
  Link,
  isRouteErrorResponse,
  redirect,
  useFetcher,
  useLoaderData,
  useRouteError,
  useSearchParams,
} from "react-router";
import {
  adminSessionCookie,
  destroyAdminSession,
  ensureSupportApps,
  requireAdminSession,
} from "../admin-auth.server";
import prisma from "../db.server";
import { LAUNCH_STORE_TARGET } from "../pricing";
import { apiVersion } from "../shopify.server";

const MAX_REPLY = 5000;

function formatAdminDateTime(value?: string | Date | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

type LiveStoreProfile = {
  storeName: string | null;
  primaryDomain: string | null;
  contactEmail: string | null;
  phone: string | null;
  address: string | null;
  country: string | null;
  timezone: string | null;
  currency: string | null;
  planDisplayName: string | null;
};

async function fetchLiveStoreProfile(
  shop: string,
  accessToken: string,
): Promise<LiveStoreProfile | null> {
  try {
    const response = await fetch(`https://${shop}/admin/api/${apiVersion}/graphql.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": accessToken,
      },
      body: JSON.stringify({
        query: `#graphql
          query AdminInstalledStoreProfile {
            shop {
              name
              contactEmail
              ianaTimezone
              currencyCode
              primaryDomain {
                host
                url
              }
              billingAddress {
                address1
                address2
                city
                province
                country
                zip
                phone
              }
              plan {
                displayName
              }
            }
          }`,
      }),
    });
    if (!response.ok) return null;
    const json = (await response.json()) as {
      data?: {
        shop?: {
          name?: string | null;
          contactEmail?: string | null;
          ianaTimezone?: string | null;
          currencyCode?: string | null;
          primaryDomain?: { host?: string | null; url?: string | null } | null;
          billingAddress?: {
            address1?: string | null;
            address2?: string | null;
            city?: string | null;
            province?: string | null;
            country?: string | null;
            zip?: string | null;
            phone?: string | null;
          } | null;
          plan?: { displayName?: string | null } | null;
        };
      };
      errors?: Array<{ message?: string }>;
    };
    const s = json.data?.shop;
    if (!s) return null;
    const address = [
      s.billingAddress?.address1,
      s.billingAddress?.address2,
      s.billingAddress?.city,
      s.billingAddress?.province,
      s.billingAddress?.zip,
    ]
      .filter(Boolean)
      .join(", ");
    return {
      storeName: s.name ?? null,
      primaryDomain: s.primaryDomain?.host || s.primaryDomain?.url || null,
      contactEmail: s.contactEmail ?? null,
      phone: s.billingAddress?.phone ?? null,
      address: address || null,
      country: s.billingAddress?.country ?? null,
      timezone: s.ianaTimezone ?? null,
      currency: s.currencyCode ?? null,
      planDisplayName: s.plan?.displayName ?? null,
    };
  } catch {
    return null;
  }
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  try {
    await requireAdminSession(request);
  } catch {
    throw redirect("/admin/login");
  }

  await ensureSupportApps();

  const url = new URL(request.url);
  const appSlug = url.searchParams.get("app") || "all";
  const statusFilter = url.searchParams.get("status") || "all";
  const section = url.searchParams.get("section") === "shops" ? "shops" : "support";
  const q = (url.searchParams.get("q") || "").trim();

  const apps = await prisma.supportApp.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: "asc" },
    select: {
      id: true,
      slug: true,
      name: true,
      description: true,
      _count: { select: { messages: true } },
    },
  });

  const selectedApp = appSlug === "all" ? null : apps.find((a) => a.slug === appSlug) ?? null;

  const openWhere = {
    ...(selectedApp ? { appId: selectedApp.id } : {}),
    status: "open",
  };
  const repliedWhere = {
    ...(selectedApp ? { appId: selectedApp.id } : {}),
    status: "replied",
  };

  const [openCount, repliedCount, totalCount] = await Promise.all([
    prisma.supportMessage.count({ where: openWhere }),
    prisma.supportMessage.count({ where: repliedWhere }),
    prisma.supportMessage.count({
      where: selectedApp ? { appId: selectedApp.id } : {},
    }),
  ]);

  const messageWhere: {
    appId?: string;
    status?: string;
    OR?: Array<
      | { shop: { contains: string; mode: "insensitive" } }
      | { subject: { contains: string; mode: "insensitive" } }
      | { message: { contains: string; mode: "insensitive" } }
      | { contactEmail: { contains: string; mode: "insensitive" } }
    >;
  } = {};
  if (selectedApp) messageWhere.appId = selectedApp.id;
  if (statusFilter === "open" || statusFilter === "replied" || statusFilter === "closed") {
    messageWhere.status = statusFilter;
  }
  if (q) {
    messageWhere.OR = [
      { shop: { contains: q, mode: "insensitive" } },
      { subject: { contains: q, mode: "insensitive" } },
      { message: { contains: q, mode: "insensitive" } },
      { contactEmail: { contains: q, mode: "insensitive" } },
    ];
  }

  const messages = await prisma.supportMessage.findMany({
    where: messageWhere,
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
      status: true,
      createdAt: true,
      app: { select: { slug: true, name: true } },
    },
  });

  const appStats = await Promise.all(
    apps.map(async (app) => {
      const open = await prisma.supportMessage.count({
        where: { appId: app.id, status: "open" },
      });
      return { ...app, openCount: open };
    }),
  );

  let installedShops: Array<{
    shop: string;
    plan: string;
    aiSeoUsed: number;
    aiImageUsed: number;
    firstSeenAt: Date | null;
    lastActivityAt: Date | null;
    storeName: string | null;
    primaryDomain: string | null;
    contactEmail: string | null;
    phone: string | null;
    address: string | null;
    country: string | null;
    timezone: string | null;
    currency: string | null;
    planDisplayName: string | null;
  }> = [];

  let launchStats = {
    installed: 0,
    target: LAUNCH_STORE_TARGET,
    remaining: LAUNCH_STORE_TARGET,
  };

  if (section === "shops") {
    const sessionRows = await prisma.session.findMany({
      select: {
        shop: true,
        accessToken: true,
        isOnline: true,
        accountOwner: true,
      },
      orderBy: [{ shop: "asc" }, { isOnline: "desc" }, { accountOwner: "desc" }],
    });
    const sessionsByShop = new Map<
      string,
      { shop: string; accessToken: string; isOnline: boolean; accountOwner: boolean }
    >();
    for (const row of sessionRows) {
      if (!sessionsByShop.has(row.shop)) sessionsByShop.set(row.shop, row);
    }
    const installedShopRows = [...sessionsByShop.values()];
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
    launchStats = {
      installed: installedShopRows.length,
      target: LAUNCH_STORE_TARGET,
      remaining: Math.max(0, LAUNCH_STORE_TARGET - installedShopRows.length),
    };
    const usageByShop = new Map(usageRows.map((u) => [u.shop, u]));
    const savedProfiles = await prisma.storeProfile.findMany({
      where: { shop: { in: installedShopRows.map((r) => r.shop) } },
    });
    const savedByShop = new Map(savedProfiles.map((p) => [p.shop, p]));

    const liveProfiles = new Map(
      await Promise.all(
        installedShopRows.map(async (row) => {
          const live = await fetchLiveStoreProfile(row.shop, row.accessToken);
          if (live) {
            await prisma.storeProfile.upsert({
              where: { shop: row.shop },
              create: {
                shop: row.shop,
                storeName: live.storeName,
                primaryDomain: live.primaryDomain,
                contactEmail: live.contactEmail,
                phone: live.phone,
                address: live.address,
                country: live.country,
                timezone: live.timezone,
                currency: live.currency,
                planDisplayName: live.planDisplayName,
                syncedAt: new Date(),
              },
              update: {
                storeName: live.storeName,
                primaryDomain: live.primaryDomain,
                contactEmail: live.contactEmail,
                phone: live.phone,
                address: live.address,
                country: live.country,
                timezone: live.timezone,
                currency: live.currency,
                planDisplayName: live.planDisplayName,
                syncedAt: new Date(),
              },
            });
          }
          return [row.shop, live] as const;
        }),
      ),
    );

    installedShops = installedShopRows
      .map((row) => {
        const usage = usageByShop.get(row.shop);
        const live = liveProfiles.get(row.shop);
        const saved = savedByShop.get(row.shop);
        const profile = live ?? saved ?? null;
        return {
          shop: row.shop,
          plan: usage?.plan ?? "free",
          aiSeoUsed: usage?.aiSeoUsed ?? 0,
          aiImageUsed: usage?.aiImageUsed ?? 0,
          firstSeenAt: usage?.createdAt ?? null,
          lastActivityAt: usage?.updatedAt ?? null,
          storeName: profile?.storeName ?? null,
          primaryDomain: profile?.primaryDomain ?? null,
          contactEmail: profile?.contactEmail ?? null,
          phone: profile?.phone ?? null,
          address: profile?.address ?? null,
          country: profile?.country ?? null,
          timezone: profile?.timezone ?? null,
          currency: profile?.currency ?? null,
          planDisplayName: profile?.planDisplayName ?? null,
        };
      })
      .sort((a, b) => {
        const aTime = new Date(a.lastActivityAt ?? a.firstSeenAt ?? 0).getTime();
        const bTime = new Date(b.lastActivityAt ?? b.firstSeenAt ?? 0).getTime();
        if (bTime !== aTime) return bTime - aTime;
        return a.shop.localeCompare(b.shop);
      });
  }

  return {
    section,
    appSlug,
    statusFilter,
    q,
    apps: appStats,
    selectedApp,
    counts: { open: openCount, replied: repliedCount, total: totalCount },
    messages,
    installedShops,
    launchStats,
  };
};

type SupportRow = Awaited<ReturnType<typeof loader>>["messages"][number];

export const action = async ({ request }: ActionFunctionArgs) => {
  const formData = await request.formData();
  const intent = String(formData.get("intent") || "");

  if (intent === "set_reply" || intent === "set_status") {
    try {
      await requireAdminSession(request);
    } catch {
      throw redirect("/admin/login");
    }

    if (intent === "set_status") {
      const id = String(formData.get("messageId") || "");
      const status = String(formData.get("status") || "");
      if (!id || !["open", "replied", "closed"].includes(status)) {
        return { status: "error" as const, message: "Invalid status update." };
      }
      await prisma.supportMessage.update({ where: { id }, data: { status } });
      return { status: "saved" as const, messageId: id };
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
      data: {
        reply: replyRaw.length > 0 ? replyRaw : null,
        replyAt: replyRaw ? new Date() : null,
        status: replyRaw ? "replied" : "open",
      },
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

const styles = `
  :root {
    --bg: #f1f5f9;
    --panel: #ffffff;
    --ink: #0f172a;
    --muted: #64748b;
    --line: #e2e8f0;
    --accent: #0d9488;
    --accent-soft: #ccfbf1;
    --warn: #b45309;
    --ok: #047857;
  }
  * { box-sizing: border-box; }
  body { margin: 0; }
  .shell {
    min-height: 100vh;
    display: grid;
    grid-template-columns: 260px 1fr;
    background: var(--bg);
    color: var(--ink);
    font-family: "Segoe UI", ui-sans-serif, system-ui, -apple-system, sans-serif;
  }
  @media (max-width: 860px) {
    .shell { grid-template-columns: 1fr; }
    .sidebar { border-right: 0; border-bottom: 1px solid var(--line); }
  }
  .sidebar {
    background: #0b1220;
    color: #e2e8f0;
    padding: 1.25rem 1rem;
    display: flex;
    flex-direction: column;
    gap: .75rem;
  }
  .brand { font-weight: 750; letter-spacing: .04em; font-size: .85rem; text-transform: uppercase; color: #5eead4; }
  .side-title { margin: .5rem 0 .25rem; font-size: .72rem; text-transform: uppercase; letter-spacing: .12em; color: #94a3b8; }
  .nav a, .app-link {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: .5rem;
    text-decoration: none;
    color: #cbd5e1;
    padding: .55rem .65rem;
    border-radius: 10px;
    font-size: .92rem;
  }
  .nav a:hover, .app-link:hover { background: rgba(255,255,255,.06); color: #fff; }
  .nav a.active, .app-link.active { background: rgba(13,148,136,.25); color: #fff; }
  .badge {
    min-width: 1.4rem;
    text-align: center;
    font-size: .72rem;
    font-weight: 700;
    padding: .1rem .35rem;
    border-radius: 999px;
    background: #f59e0b;
    color: #111;
  }
  .main { padding: 1.25rem 1.35rem 2rem; }
  .topbar {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 1rem;
    margin-bottom: 1rem;
  }
  h1 { margin: 0; font-size: 1.45rem; letter-spacing: -.02em; }
  .muted { color: var(--muted); margin: .25rem 0 0; font-size: .92rem; }
  .stats {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: .75rem;
    margin: 1rem 0;
  }
  @media (max-width: 640px) { .stats { grid-template-columns: 1fr; } }
  .stat {
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 14px;
    padding: .9rem 1rem;
  }
  .stat .label { font-size: .78rem; color: var(--muted); text-transform: uppercase; letter-spacing: .08em; }
  .stat .value { font-size: 1.6rem; font-weight: 750; margin-top: .2rem; }
  .toolbar {
    display: flex;
    flex-wrap: wrap;
    gap: .6rem;
    margin-bottom: 1rem;
    align-items: center;
  }
  .toolbar input[type="search"] {
    flex: 1;
    min-width: 180px;
    border: 1px solid var(--line);
    border-radius: 10px;
    padding: .55rem .75rem;
    background: #fff;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    text-decoration: none;
    color: #334155;
    background: #fff;
    border: 1px solid var(--line);
    border-radius: 999px;
    padding: .35rem .7rem;
    font-size: .85rem;
  }
  .chip.active { background: var(--accent-soft); border-color: #99f6e4; color: #0f766e; font-weight: 650; }
  .card {
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 14px;
    padding: 1rem 1.05rem;
  }
  .card-grid { display: grid; gap: .85rem; }
  .row-top { display: flex; justify-content: space-between; gap: .75rem; flex-wrap: wrap; }
  .shop { font-weight: 700; }
  .meta { color: var(--muted); font-size: .82rem; }
  .pill {
    display: inline-block;
    font-size: .72rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: .06em;
    padding: .2rem .45rem;
    border-radius: 999px;
  }
  .pill.open { background: #ffedd5; color: var(--warn); }
  .pill.replied { background: #d1fae5; color: var(--ok); }
  .pill.closed { background: #e2e8f0; color: #475569; }
  .app-tag {
    display: inline-block;
    font-size: .75rem;
    background: #e0f2fe;
    color: #075985;
    border-radius: 6px;
    padding: .15rem .4rem;
    margin-right: .35rem;
  }
  .body { white-space: pre-wrap; margin: .55rem 0; line-height: 1.45; }
  .reply-box {
    margin-top: .65rem;
    padding: .65rem .75rem;
    background: #f0fdfa;
    border: 1px solid #99f6e4;
    border-radius: 10px;
    font-size: .92rem;
  }
  textarea {
    width: 100%;
    border: 1px solid var(--line);
    border-radius: 10px;
    padding: .55rem .7rem;
    font: inherit;
    resize: vertical;
    background: #f8fafc;
  }
  .actions { display: flex; flex-wrap: wrap; gap: .5rem; align-items: center; margin-top: .55rem; }
  button, .btn {
    border: 0;
    border-radius: 9px;
    padding: .45rem .8rem;
    font-weight: 650;
    cursor: pointer;
    background: var(--accent);
    color: #fff;
  }
  button.secondary { background: #e2e8f0; color: #0f172a; }
  button.ghost { background: transparent; color: var(--muted); text-decoration: underline; }
  .flash { color: var(--ok); font-size: .88rem; }
  .err { color: #b91c1c; font-size: .88rem; }
  .empty { color: var(--muted); padding: 1.5rem 0; }
`;

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

  const replyFieldKey = `${m.id}-${m.replyAt ? new Date(m.replyAt).toISOString() : "none"}`;

  return (
    <div ref={cardRef} id={`admin-msg-${m.id}`} className="card">
      <div className="row-top">
        <div>
          {m.app ? <span className="app-tag">{m.app.name}</span> : null}
          <span className="shop">{m.shop}</span>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span className={`pill ${m.status}`}>{m.status}</span>
          <span className="meta">{new Date(m.createdAt).toLocaleString()}</span>
        </div>
      </div>
      {m.subject ? <p style={{ margin: "0.45rem 0 0", fontWeight: 650 }}>{m.subject}</p> : null}
      <p className="body">{m.message}</p>
      <p className="meta">
        {m.contactEmail ? `Email: ${m.contactEmail}` : ""}
        {m.contactEmail && m.whatsapp ? " · " : ""}
        {m.whatsapp ? `WhatsApp: ${m.whatsapp}` : ""}
      </p>

      {m.reply ? (
        <div className="reply-box">
          <strong>Reply (visible in merchant app)</strong>
          <p className="body" style={{ marginBottom: 0 }}>
            {m.reply}
          </p>
          {m.replyAt ? (
            <p className="meta" style={{ marginTop: 6 }}>
              Saved {new Date(m.replyAt).toLocaleString()}
            </p>
          ) : null}
        </div>
      ) : null}

      <fetcher.Form method="post" style={{ marginTop: "0.65rem" }}>
        <input type="hidden" name="intent" value="set_reply" />
        <input type="hidden" name="messageId" value={m.id} />
        <label className="meta" htmlFor={`reply-${m.id}`}>
          {m.reply ? "Edit reply" : "Write a reply"}
        </label>
        <textarea
          id={`reply-${m.id}`}
          key={replyFieldKey}
          name="reply"
          rows={3}
          maxLength={MAX_REPLY}
          defaultValue={m.reply ?? ""}
          placeholder="Reply the merchant will see in Help & support…"
        />
        <div className="actions">
          <button type="submit" disabled={busy}>
            {busy ? "Saving…" : "Save reply"}
          </button>
          {flashSaved ? <span className="flash">Saved.</span> : null}
          {fetcher.data &&
          typeof fetcher.data === "object" &&
          "status" in fetcher.data &&
          fetcher.data.status === "error" ? (
            <span className="err">{fetcher.data.message}</span>
          ) : null}
        </div>
      </fetcher.Form>

      <div className="actions">
        {(["open", "replied", "closed"] as const).map((s) =>
          m.status === s ? null : (
            <fetcher.Form method="post" key={s}>
              <input type="hidden" name="intent" value="set_status" />
              <input type="hidden" name="messageId" value={m.id} />
              <input type="hidden" name="status" value={s} />
              <button type="submit" className="secondary" disabled={busy}>
                Mark {s}
              </button>
            </fetcher.Form>
          ),
        )}
      </div>
    </div>
  );
}

function hrefFor(opts: {
  section?: string;
  app?: string;
  status?: string;
  q?: string;
}) {
  const p = new URLSearchParams();
  if (opts.section && opts.section !== "support") p.set("section", opts.section);
  if (opts.app && opts.app !== "all") p.set("app", opts.app);
  if (opts.status && opts.status !== "all") p.set("status", opts.status);
  if (opts.q) p.set("q", opts.q);
  const s = p.toString();
  return s ? `/admin?${s}` : "/admin";
}

export default function AdminIndexPage() {
  const {
    section,
    appSlug,
    statusFilter,
    q,
    apps,
    selectedApp,
    counts,
    messages,
    installedShops,
    launchStats,
  } = useLoaderData<typeof loader>();
  const [searchParams] = useSearchParams();

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: styles }} />
      <div className="shell">
        <aside className="sidebar">
          <div className="brand">SEOI Support</div>
          <nav className="nav">
            <Link
              className={section === "support" ? "active" : ""}
              to={hrefFor({ section: "support", app: appSlug, status: statusFilter, q })}
            >
              Messages
            </Link>
            <Link
              className={section === "shops" ? "active" : ""}
              to={hrefFor({ section: "shops", app: appSlug })}
            >
              Installed stores
            </Link>
          </nav>

          <div className="side-title">Apps</div>
          <Link
            className={`app-link ${appSlug === "all" ? "active" : ""}`}
            to={hrefFor({ section: "support", app: "all", status: statusFilter, q })}
          >
            <span>All apps</span>
          </Link>
          {apps.map((app) => (
            <Link
              key={app.id}
              className={`app-link ${appSlug === app.slug ? "active" : ""}`}
              to={hrefFor({
                section: "support",
                app: app.slug,
                status: statusFilter,
                q,
              })}
            >
              <span>{app.name}</span>
              {app.openCount > 0 ? <span className="badge">{app.openCount}</span> : null}
            </Link>
          ))}

          <div style={{ marginTop: "auto", paddingTop: "1rem" }}>
            <Form method="post">
              <input type="hidden" name="intent" value="logout" />
              <button type="submit" className="ghost" style={{ color: "#94a3b8" }}>
                Log out
              </button>
            </Form>
          </div>
        </aside>

        <main className="main">
          <div className="topbar">
            <div>
              <h1>
                {section === "shops"
                  ? "Installed stores"
                  : selectedApp
                    ? selectedApp.name
                    : "All support messages"}
              </h1>
              <p className="muted">
                {section === "shops"
                  ? "Shops with an active session for Product Image SEO Optimizer."
                  : selectedApp?.description ||
                    "Tickets across your registered Shopify apps."}
              </p>
            </div>
          </div>

          {section === "support" ? (
            <>
              <div className="stats">
                <div className="stat">
                  <div className="label">Open</div>
                  <div className="value">{counts.open}</div>
                </div>
                <div className="stat">
                  <div className="label">Replied</div>
                  <div className="value">{counts.replied}</div>
                </div>
                <div className="stat">
                  <div className="label">Total</div>
                  <div className="value">{counts.total}</div>
                </div>
              </div>

              <Form method="get" className="toolbar">
                {searchParams.get("section") ? (
                  <input type="hidden" name="section" value={searchParams.get("section")!} />
                ) : null}
                {appSlug !== "all" ? <input type="hidden" name="app" value={appSlug} /> : null}
                <input
                  type="search"
                  name="q"
                  defaultValue={q}
                  placeholder="Search shop, subject, message, email…"
                />
                <button type="submit" className="secondary">
                  Search
                </button>
                <Link
                  className={`chip ${statusFilter === "all" ? "active" : ""}`}
                  to={hrefFor({ app: appSlug, status: "all", q })}
                >
                  All
                </Link>
                <Link
                  className={`chip ${statusFilter === "open" ? "active" : ""}`}
                  to={hrefFor({ app: appSlug, status: "open", q })}
                >
                  Open
                </Link>
                <Link
                  className={`chip ${statusFilter === "replied" ? "active" : ""}`}
                  to={hrefFor({ app: appSlug, status: "replied", q })}
                >
                  Replied
                </Link>
                <Link
                  className={`chip ${statusFilter === "closed" ? "active" : ""}`}
                  to={hrefFor({ app: appSlug, status: "closed", q })}
                >
                  Closed
                </Link>
              </Form>

              {messages.length === 0 ? (
                <p className="empty">No messages match this filter.</p>
              ) : (
                <div className="card-grid">
                  {messages.map((m) => (
                    <SupportMessageCard key={m.id} m={m} />
                  ))}
                </div>
              )}
            </>
          ) : null}

          {section === "shops" ? (
            installedShops.length === 0 ? (
              <p className="empty">No installed shops found yet.</p>
            ) : (
              <>
                <div className="stats" style={{ marginBottom: "1rem" }}>
                  <div className="stat">
                    <div className="label">Launch installs</div>
                    <div className="value">
                      {launchStats.installed} / {launchStats.target}
                    </div>
                    <p className="muted" style={{ margin: "0.35rem 0 0" }}>
                      {launchStats.remaining} stores remaining at launch pricing
                    </p>
                  </div>
                </div>
                <div className="card-grid">
                  {installedShops.map((s) => (
                    <div key={s.shop} className="card">
                      <div className="shop">{s.storeName || s.shop}</div>
                      <p className="meta" style={{ marginTop: 6 }}>
                        Domain: {s.primaryDomain || s.shop}
                      </p>
                      <p className="meta">
                        Shopify plan: {s.planDisplayName || s.plan}
                      </p>
                      <p className="meta">
                        AI SEO used: {s.aiSeoUsed} · AI image used: {s.aiImageUsed}
                      </p>
                      {(s.contactEmail || s.phone) && (
                        <p className="meta">
                          {s.contactEmail ? `Email: ${s.contactEmail}` : ""}
                          {s.contactEmail && s.phone ? " · " : ""}
                          {s.phone ? `Phone: ${s.phone}` : ""}
                        </p>
                      )}
                      {(s.country || s.timezone || s.currency) && (
                        <p className="meta">
                          {s.country || "-"}
                          {s.timezone ? ` · ${s.timezone}` : ""}
                          {s.currency ? ` · ${s.currency}` : ""}
                        </p>
                      )}
                      {s.address && <p className="meta">Address: {s.address}</p>}
                      <p className="meta">
                        First seen:{" "}
                        {formatAdminDateTime(s.firstSeenAt)} · Last activity:{" "}
                        {formatAdminDateTime(s.lastActivityAt)}
                      </p>
                    </div>
                  ))}
                </div>
              </>
            )
          ) : null}
        </main>
      </div>
    </>
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
