/** Client-safe marketing constants (do not import shopify.server here). */
export const MARKETING_ORIGIN = "https://seoi.in";

export const DEFAULT_APP_STORE_URL =
  "https://apps.shopify.com/ai-product-descriptions-seo";

export function marketingMeta(input: {
  title: string;
  description: string;
  path: string;
}) {
  const url = `${MARKETING_ORIGIN}${input.path}`;
  return [
    { title: input.title },
    { name: "description", content: input.description },
    { name: "robots", content: "index, follow" },
    { tagName: "link", rel: "canonical", href: url },
    { property: "og:type", content: "website" },
    { property: "og:site_name", content: "SEOi" },
    { property: "og:title", content: input.title },
    { property: "og:description", content: input.description },
    { property: "og:url", content: url },
    { name: "twitter:card", content: "summary" },
    { name: "twitter:title", content: input.title },
    { name: "twitter:description", content: input.description },
  ];
}
