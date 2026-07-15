import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "./shopify.server";
import { getOrCreateSeoSettings } from "./seo-settings.server";
import {
  fetchSitemapItems,
  renderHtmlSitemap,
  renderLlmsTxt,
} from "./sitemap.server";

/** Shared app-proxy handler for /proxy/seoi and /proxy/seoi/*. */
export async function handleSeoiProxyRequest(request: Request) {
  const context = await authenticate.public.appProxy(request);
  const { admin, session } = context;

  if (!admin || !session?.shop) {
    return new Response("Unauthorized", { status: 401 });
  }

  const shop = session.shop;
  const url = new URL(request.url);
  const pathname = url.pathname.replace(/\/+$/, "") || "/";
  let suffix = pathname.replace(/^\/proxy\/seoi/, "").replace(/^\/apps\/seoi/, "");
  if (!suffix.startsWith("/")) suffix = `/${suffix}`;
  if (suffix === "/") {
    // keep as root
  }

  const settings = await getOrCreateSeoSettings(shop);

  if (suffix === "/indexnow-key.txt") {
    if (!settings.indexNowKey) {
      return new Response("Not found", { status: 404 });
    }
    return new Response(settings.indexNowKey, {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "public, max-age=300",
      },
    });
  }

  if (suffix === "/llms.txt") {
    if (!settings.llmsTxtEnabled) {
      return new Response("llms.txt is disabled", { status: 404 });
    }
    const { base, items, shopName } = await fetchSitemapItems(admin);
    const body = renderLlmsTxt({
      shopName,
      base,
      items,
      custom: settings.llmsTxtCustom,
    });
    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "public, max-age=300",
      },
    });
  }

  if (suffix === "/sitemap") {
    if (!settings.sitemapEnabled) {
      return new Response("Sitemap is disabled", { status: 404 });
    }
    const { base, items, shopName } = await fetchSitemapItems(admin);
    const html = renderHtmlSitemap({ shopName, items, base });
    return new Response(html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "public, max-age=300",
      },
    });
  }

  if (suffix === "/") {
    return new Response("Seoi SEO proxy is active.", {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  return new Response("Not found", { status: 404 });
}

export async function seoiProxyLoader({ request }: LoaderFunctionArgs) {
  return handleSeoiProxyRequest(request);
}
