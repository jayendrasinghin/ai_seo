import { MARKETING_ORIGIN } from "../marketing/shopify-public";
import { paysyncEnabled } from "../paysync-feature.server";

/**
 * Public marketing pages may be indexed. Embedded app routes stay disallowed.
 */
export async function loader() {
  const lines = [
    "User-agent: *",
    "Allow: /",
    "Allow: /shopify-seo",
    paysyncEnabled() ? "Allow: /shopify-paypal-tracking" : null,
    "Allow: /sitemap.xml",
    "Disallow: /app",
    "Disallow: /admin",
    "Disallow: /auth",
    "Disallow: /api",
    "Disallow: /webhooks",
    `Sitemap: ${MARKETING_ORIGIN}/sitemap.xml`,
    "",
  ].filter((line): line is string => line != null);

  return new Response(lines.join("\n"), {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}

export default function RobotsTxt() {
  return null;
}
