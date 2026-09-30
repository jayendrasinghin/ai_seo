import { MARKETING_ORIGIN } from "../marketing/shopify-public";
import { paysyncEnabled } from "../paysync-feature.server";

export async function loader() {
  const urls = [
    { loc: `${MARKETING_ORIGIN}/`, priority: "1.0" },
    { loc: `${MARKETING_ORIGIN}/shopify-seo`, priority: "0.9" },
  ];
  if (paysyncEnabled()) {
    urls.push({
      loc: `${MARKETING_ORIGIN}/shopify-paypal-tracking`,
      priority: "0.9",
    });
  }

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    (u) => `  <url>
    <loc>${u.loc}</loc>
    <changefreq>weekly</changefreq>
    <priority>${u.priority}</priority>
  </url>`,
  )
  .join("\n")}
</urlset>
`;

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}

export default function SitemapXml() {
  return null;
}
