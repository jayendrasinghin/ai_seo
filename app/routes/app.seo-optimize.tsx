import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { EmbeddedNavLink } from "../embedded-nav-link";
import { HomeButton } from "../HomeButton";

const SEO_TOOLS = [
  {
    title: "Image SEO & ALT text",
    description:
      "Scan the catalog for missing or weak ALT text, generate AI suggestions in bulk, and apply to Shopify in one flow.",
    href: "/app/seo-dashboard",
    cta: "Scan & optimize images",
  },
  {
    title: "Product Optimization",
    description:
      "Write AI product SEO & descriptions, titles, and on-page SEO fields.",
    href: "/app/products",
    cta: "Write & Optimise Products",
  },
  {
    title: "AI SEO Suite",
    description: "IndexNow, redirects, sitemap, schema, speed, and more.",
    href: "/app/seo",
    cta: "Open AI SEO Suite",
  },
  {
    title: "Stock & New Product",
    description: "Inventory alerts, stock levels, and create products.",
    href: "/app/manage",
    cta: "Manage Stock & Products",
  },
  {
    title: "Plans & billing",
    description: "View your plan, free quota, and upgrade options.",
    href: "/app/billing/plans",
    cta: "View Plans",
  },
  {
    title: "Help & support",
    description: "Contact support and track your messages.",
    href: "/app/support?product=seoi",
    cta: "Get Help",
  },
] as const;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return {};
};

export default function SeoOptimizeHub() {
  return (
    <s-page heading="AI SEO & Image Optimization">
      <HomeButton />
      <s-section>
        <p className="seoi-hub-intro">
          All AI SEO, image, product, and inventory tools live in this workspace.
        </p>
        <div className="seoi-tool-grid">
          {SEO_TOOLS.map((tool) => (
            <article key={tool.title} className="seoi-tool-card">
              <h3>{tool.title}</h3>
              <p>{tool.description}</p>
              <EmbeddedNavLink hrefPathname={tool.href} variant="button">
                {tool.cta}
              </EmbeddedNavLink>
            </article>
          ))}
        </div>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
