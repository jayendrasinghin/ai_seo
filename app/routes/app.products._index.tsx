import type { CSSProperties } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { EmbeddedNavLink } from "../embedded-nav-link";
import { productPathSegmentFromGid } from "../shopify-ids";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";

type ProductRow = {
  id: string;
  title: string;
  status: string;
  handle: string;
  featuredImage: { url: string; altText: string | null } | null;
  images: { nodes: Array<{ url: string; altText: string | null }> } | null;
  media: {
    nodes: Array<{
      image?: { url: string; altText: string | null } | null;
    }>;
  } | null;
  seo: { title: string | null; description: string | null } | null;
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const response = await admin.graphql(
    `#graphql
      query AiSeoAppProductsList {
        products(first: 20) {
          nodes {
            id
            title
            status
            handle
            featuredImage {
              url
              altText
            }
            images(first: 1) {
              nodes {
                url
                altText
              }
            }
            media(first: 5) {
              nodes {
                ... on MediaImage {
                  image {
                    url
                    altText
                  }
                }
              }
            }
            seo {
              title
              description
            }
          }
        }
      }`,
  );

  const json = (await response.json()) as {
    data?: { products?: { nodes?: ProductRow[] } };
    errors?: { message: string }[];
  };

  const usage = await prisma.storeUsage.upsert({
    where: { shop: session.shop },
    update: {},
    create: { shop: session.shop },
  });
  const aiUsed = usage.aiSeoUsed + usage.aiImageUsed;

  return {
    products: json.data?.products?.nodes ?? [],
    errors: json.errors ?? null,
    usage: { aiUsed, freeQuotaLimit: usage.freeQuotaLimit, plan: usage.plan },
  };
};

const pageShellStyle: CSSProperties = {
  backgroundColor: "#f1f2f4",
  minHeight: "100%",
};

export default function ProductsListPage() {
  const { products, errors, usage } = useLoaderData<typeof loader>();

  return (
    <div style={pageShellStyle}>
      <s-page heading="Products">
        <s-section>
          <s-text tone="subdued">
            AI used: {usage.aiUsed} / {usage.freeQuotaLimit}
            {usage.plan === "free" ? " (Free trial)" : " (Paid plan)"}
          </s-text>
        </s-section>

        <s-section>
          {errors && (
            <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
              <s-text tone="critical">
                Could not load products. {errors[0]?.message || "Unknown error"}
              </s-text>
            </s-box>
          )}

          {!errors && products.length === 0 && (
            <s-text tone="subdued">
              No products found yet. Create a product in your store to get started.
            </s-text>
          )}

          {!errors && products.length > 0 && (
            <s-stack direction="block" gap="base">
              {products.map((product) => {
                const pathSeg = productPathSegmentFromGid(product.id);
                const firstImageNode = product.images?.nodes?.[0];
                const firstMediaImage = product.media?.nodes?.find(
                  (n) => n.image?.url,
                )?.image;
                const thumbUrl =
                  product.featuredImage?.url ||
                  firstImageNode?.url ||
                  firstMediaImage?.url;
                const thumbAlt =
                  product.featuredImage?.altText ||
                  firstImageNode?.altText ||
                  firstMediaImage?.altText ||
                  product.title;

                return (
                  <s-box
                    key={product.id}
                    padding="base"
                    borderWidth="base"
                    borderRadius="base"
                    background="subdued"
                  >
                    <div style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
                      <div
                        style={{
                          width: 56,
                          height: 56,
                          borderRadius: 8,
                          overflow: "hidden",
                          background: "var(--p-color-bg-surface-secondary)",
                          flexShrink: 0,
                        }}
                      >
                        {thumbUrl ? (
                          <img
                            src={thumbUrl}
                            alt={thumbAlt}
                            style={{ width: "100%", height: "100%", objectFit: "cover" }}
                          />
                        ) : null}
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <EmbeddedNavLink
                          hrefPathname={`/app/products/${pathSeg}`}
                          style={{
                            display: "inline-block",
                            fontWeight: 600,
                            color: "var(--p-color-text-link, #2c6ecb)",
                            textDecoration: "none",
                          }}
                        >
                          {product.title}
                        </EmbeddedNavLink>
                        <s-text tone="subdued" as="p" style={{ margin: "0.25rem 0 0" }}>
                          Status: {product.status}
                        </s-text>
                      </div>
                    </div>
                  </s-box>
                );
              })}
            </s-stack>
          )}
        </s-section>
      </s-page>
    </div>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
