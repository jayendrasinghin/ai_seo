import prisma from "./db.server";

type AdminGraphql = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

type SourceLink = {
  sourceType: "product" | "collection" | "page";
  sourceId: string;
  sourceTitle: string;
  sourceUrl: string | null;
  linkUrl: string;
};

const HREF_RE = /href\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/gi;
const MAX_URLS = 80;
const FETCH_TIMEOUT_MS = 8000;

function extractHrefs(html: string | null | undefined): string[] {
  if (!html) return [];
  const urls: string[] = [];
  let match: RegExpExecArray | null;
  HREF_RE.lastIndex = 0;
  while ((match = HREF_RE.exec(html)) !== null) {
    const raw = (match[1] || match[2] || match[3] || "").trim();
    if (!raw || raw.startsWith("#") || raw.startsWith("mailto:") || raw.startsWith("tel:") || raw.startsWith("javascript:")) {
      continue;
    }
    urls.push(raw);
  }
  return urls;
}

function resolveUrl(base: string, href: string): string | null {
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

async function shopBase(admin: AdminGraphql): Promise<string> {
  const response = await admin.graphql(
    `#graphql
      query LinkCrawlShopDomain {
        shop {
          primaryDomain { url }
          myshopifyDomain
        }
      }`,
  );
  const json = (await response.json()) as {
    data?: {
      shop?: {
        primaryDomain?: { url?: string | null } | null;
        myshopifyDomain?: string | null;
      };
    };
  };
  return (
    json.data?.shop?.primaryDomain?.url?.replace(/\/$/, "") ||
    `https://${json.data?.shop?.myshopifyDomain || "shop.myshopify.com"}`
  );
}

async function collectSourceLinks(admin: AdminGraphql): Promise<SourceLink[]> {
  const base = await shopBase(admin);
  const response = await admin.graphql(
    `#graphql
      query LinkCrawlSources {
        products(first: 40, query: "status:active") {
          nodes {
            id
            title
            handle
            onlineStoreUrl
            descriptionHtml
          }
        }
        collections(first: 20) {
          nodes {
            id
            title
            handle
            descriptionHtml
          }
        }
        pages(first: 20) {
          nodes {
            id
            title
            handle
            body
          }
        }
      }`,
  );

  const json = (await response.json()) as {
    data?: {
      products?: {
        nodes?: Array<{
          id: string;
          title?: string;
          handle?: string;
          onlineStoreUrl?: string | null;
          descriptionHtml?: string | null;
        }>;
      };
      collections?: {
        nodes?: Array<{
          id: string;
          title?: string;
          handle?: string;
          descriptionHtml?: string | null;
        }>;
      };
      pages?: {
        nodes?: Array<{
          id: string;
          title?: string;
          handle?: string;
          body?: string | null;
        }>;
      };
    };
    errors?: { message?: string }[];
  };

  if (json.errors?.length) {
    throw new Error(json.errors[0]?.message || "Link crawl query failed.");
  }

  const out: SourceLink[] = [];

  for (const p of json.data?.products?.nodes ?? []) {
    const sourceUrl = p.onlineStoreUrl || (p.handle ? `${base}/products/${p.handle}` : null);
    for (const href of extractHrefs(p.descriptionHtml)) {
      const absolute = resolveUrl(base, href);
      if (!absolute) continue;
      out.push({
        sourceType: "product",
        sourceId: p.id,
        sourceTitle: p.title || p.handle || p.id,
        sourceUrl,
        linkUrl: absolute,
      });
    }
  }

  for (const c of json.data?.collections?.nodes ?? []) {
    const sourceUrl = c.handle ? `${base}/collections/${c.handle}` : null;
    for (const href of extractHrefs(c.descriptionHtml)) {
      const absolute = resolveUrl(base, href);
      if (!absolute) continue;
      out.push({
        sourceType: "collection",
        sourceId: c.id,
        sourceTitle: c.title || c.handle || c.id,
        sourceUrl,
        linkUrl: absolute,
      });
    }
  }

  for (const page of json.data?.pages?.nodes ?? []) {
    const sourceUrl = page.handle ? `${base}/pages/${page.handle}` : null;
    for (const href of extractHrefs(page.body)) {
      const absolute = resolveUrl(base, href);
      if (!absolute) continue;
      out.push({
        sourceType: "page",
        sourceId: page.id,
        sourceTitle: page.title || page.handle || page.id,
        sourceUrl,
        linkUrl: absolute,
      });
    }
  }

  return out;
}

type ProbeResult = {
  status: "ok" | "broken" | "redirect" | "error";
  httpStatus: number | null;
  finalUrl: string | null;
};

async function probeUrl(url: string): Promise<ProbeResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    let response = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: controller.signal,
      headers: { "User-Agent": "SeoiLinkChecker/1.0" },
    });

    // Some hosts reject HEAD.
    if (response.status === 405 || response.status === 501) {
      response = await fetch(url, {
        method: "GET",
        redirect: "follow",
        signal: controller.signal,
        headers: { "User-Agent": "SeoiLinkChecker/1.0" },
      });
    }

    const httpStatus = response.status;
    const finalUrl = response.url || url;

    if (httpStatus >= 200 && httpStatus < 300) {
      const redirected = normalizeUrl(finalUrl) !== normalizeUrl(url);
      return {
        status: redirected ? "redirect" : "ok",
        httpStatus,
        finalUrl,
      };
    }
    if (httpStatus === 404 || httpStatus === 410 || httpStatus === 451) {
      return { status: "broken", httpStatus, finalUrl };
    }
    if (httpStatus >= 400) {
      return { status: "broken", httpStatus, finalUrl };
    }
    return { status: "error", httpStatus, finalUrl };
  } catch {
    return { status: "error", httpStatus: null, finalUrl: null };
  } finally {
    clearTimeout(timer);
  }
}

function normalizeUrl(input: string) {
  try {
    const u = new URL(input);
    u.hash = "";
    return u.toString().replace(/\/$/, "");
  } catch {
    return input;
  }
}

/**
 * Crawl product/collection/page HTML for hrefs and flag broken/error/redirect links.
 */
export async function runBrokenLinkScan(admin: AdminGraphql, shop: string) {
  const scanRun = await prisma.linkScanRun.create({
    data: { shop, status: "running" },
  });

  try {
    const sources = await collectSourceLinks(admin);

    // Deduplicate by link URL, keep first source.
    const unique = new Map<string, SourceLink>();
    for (const row of sources) {
      if (!unique.has(row.linkUrl)) unique.set(row.linkUrl, row);
    }

    const toCheck = [...unique.values()].slice(0, MAX_URLS);
    const issues: Array<{
      shop: string;
      scanRunId: string;
      sourceType: string;
      sourceId: string | null;
      sourceTitle: string | null;
      sourceUrl: string | null;
      linkUrl: string;
      status: string;
      httpStatus: number | null;
      finalUrl: string | null;
    }> = [];

    let brokenCount = 0;

    // Sequential to avoid hammering merchant/external hosts.
    for (const item of toCheck) {
      const result = await probeUrl(item.linkUrl);
      if (result.status === "ok") continue;

      if (result.status === "broken" || result.status === "error") {
        brokenCount += 1;
      }

      issues.push({
        shop,
        scanRunId: scanRun.id,
        sourceType: item.sourceType,
        sourceId: item.sourceId,
        sourceTitle: item.sourceTitle,
        sourceUrl: item.sourceUrl,
        linkUrl: item.linkUrl,
        status: result.status,
        httpStatus: result.httpStatus,
        finalUrl: result.finalUrl,
      });
    }

    if (issues.length > 0) {
      await prisma.brokenLinkIssue.createMany({ data: issues });
    }

    await prisma.linkScanRun.update({
      where: { id: scanRun.id },
      data: {
        status: "completed",
        finishedAt: new Date(),
        urlsChecked: toCheck.length,
        brokenCount,
      },
    });

    return {
      scanRunId: scanRun.id,
      urlsChecked: toCheck.length,
      issueCount: issues.length,
      brokenCount,
    };
  } catch (error) {
    await prisma.linkScanRun.update({
      where: { id: scanRun.id },
      data: {
        status: "failed",
        finishedAt: new Date(),
        errorMessage:
          error instanceof Error ? error.message : "Link scan failed.",
      },
    });
    throw error;
  }
}
