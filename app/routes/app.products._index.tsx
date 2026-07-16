import type { CSSProperties } from "react";
import { useEffect, useMemo, useState } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useLocation } from "react-router";
import { EmbeddedNavLink } from "../embedded-nav-link";
import { withEmbeddedSearch } from "../embedded-nav";
import { productPathSegmentFromGid } from "../shopify-ids";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";
import { getEffectivePlan } from "../plan-helpers";

const PAGE_SIZE = 25;

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

type PageInfo = {
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  startCursor: string | null;
  endCursor: string | null;
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const qRaw = url.searchParams.get("q")?.trim() ?? "";
  const query = qRaw.length > 0 ? qRaw : null;
  const after = url.searchParams.get("after");
  const before = url.searchParams.get("before");

  const response = await admin.graphql(
    `#graphql
      query AiSeoAppProductsList(
        $first: Int
        $last: Int
        $after: String
        $before: String
        $query: String
      ) {
        products(
          first: $first
          last: $last
          after: $after
          before: $before
          query: $query
          sortKey: UPDATED_AT
          reverse: true
        ) {
          pageInfo {
            hasNextPage
            hasPreviousPage
            startCursor
            endCursor
          }
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
    {
      variables: before
        ? {
            last: PAGE_SIZE,
            before,
            ...(query ? { query } : {}),
          }
        : {
            first: PAGE_SIZE,
            ...(after ? { after } : {}),
            ...(query ? { query } : {}),
          },
    },
  );

  const json = (await response.json()) as {
    data?: {
      products?: { nodes?: ProductRow[]; pageInfo?: PageInfo };
    };
    errors?: { message: string }[];
  };

  const usage = await prisma.storeUsage.upsert({
    where: { shop: session.shop },
    update: {},
    create: { shop: session.shop },
  });
  const aiUsed = usage.aiSeoUsed + usage.aiImageUsed;

  const pageInfo = json.data?.products?.pageInfo ?? {
    hasNextPage: false,
    hasPreviousPage: false,
    startCursor: null,
    endCursor: null,
  };

  return {
    products: json.data?.products?.nodes ?? [],
    pageInfo,
    q: qRaw,
    pageSize: PAGE_SIZE,
    errors: json.errors ?? null,
    usage: { aiUsed, freeQuotaLimit: usage.freeQuotaLimit, plan: getEffectivePlan(usage) },
  };
};

const pageShellStyle: CSSProperties = {
  backgroundColor: "#f1f2f4",
  minHeight: "100%",
};

function useDebouncedValue<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

/** Path for fetcher.load / assign: embedded params + q, no cursors. */
function productsListPathWithQ(locationSearch: string, q: string): string {
  const p = new URLSearchParams(
    locationSearch.startsWith("?") ? locationSearch.slice(1) : locationSearch,
  );
  const t = q.trim();
  if (t) p.set("q", t);
  else p.delete("q");
  p.delete("after");
  p.delete("before");
  const qs = p.toString();
  return withEmbeddedSearch("/app/products", qs ? `?${qs}` : "");
}

function productListHref(
  currentSearch: string,
  listQ: string,
  patch: { after?: string; before?: string },
): string {
  const p = new URLSearchParams(
    currentSearch.startsWith("?") ? currentSearch.slice(1) : currentSearch,
  );
  const t = listQ.trim();
  if (t) p.set("q", t);
  else p.delete("q");
  if (patch.after !== undefined) {
    p.delete("before");
    if (patch.after) p.set("after", patch.after);
    else p.delete("after");
  }
  if (patch.before !== undefined) {
    p.delete("after");
    if (patch.before) p.set("before", patch.before);
    else p.delete("before");
  }
  const qs = p.toString();
  return withEmbeddedSearch("/app/products", qs ? `?${qs}` : "");
}

export default function ProductsListPage() {
  const loaderData = useLoaderData<typeof loader>();
  const location = useLocation();
  const fetcher = useFetcher<typeof loader>();

  const [inputValue, setInputValue] = useState(loaderData.q);
  useEffect(() => {
    setInputValue(loaderData.q);
  }, [loaderData.q]);

  const debouncedInput = useDebouncedValue(inputValue, 320);

  const urlHasPagination = useMemo(() => {
    const p = new URLSearchParams(
      location.search.startsWith("?")
        ? location.search.slice(1)
        : location.search,
    );
    return p.has("after") || p.has("before");
  }, [location.search]);

  const typingOverridesPagination =
    urlHasPagination && debouncedInput.trim() !== loaderData.q;
  const liveSearchActive = !urlHasPagination || typingOverridesPagination;

  useEffect(() => {
    if (!liveSearchActive) return;
    const path = productsListPathWithQ(location.search, debouncedInput);
    fetcher.load(path);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-fetch when debounced query / URL mode changes
  }, [debouncedInput, location.search, liveSearchActive]);

  const useLive =
    liveSearchActive &&
    fetcher.state === "idle" &&
    fetcher.data !== undefined &&
    fetcher.data.q === debouncedInput.trim();

  const display = useLive ? fetcher.data! : loaderData;
  const { pageInfo, q, pageSize, errors, usage } = display;

  const searchingLive =
    liveSearchActive &&
    fetcher.state === "loading" &&
    debouncedInput.trim() !== loaderData.q;

  const listProducts = searchingLive ? [] : display.products;

  const commitSearchToUrl = () => {
    window.location.assign(productsListPathWithQ(location.search, inputValue));
  };

  const prevHref =
    pageInfo.hasPreviousPage && pageInfo.startCursor
      ? productListHref(location.search, q, { before: pageInfo.startCursor })
      : null;
  const nextHref =
    pageInfo.hasNextPage && pageInfo.endCursor
      ? productListHref(location.search, q, { after: pageInfo.endCursor })
      : null;

  return (
    <div style={pageShellStyle}>
      <s-page heading="Products">
        <s-section>
          <s-text tone="subdued">
            AI used: {usage.aiUsed} / {usage.freeQuotaLimit}
          </s-text>
        </s-section>

        <s-section heading="Search">
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "0.5rem",
              alignItems: "flex-end",
              maxWidth: "32rem",
            }}
          >
            <label style={{ flex: "1", minWidth: "12rem" }}>
              <s-text font-weight="bold">Find products</s-text>
              <input
                type="search"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder="Type to filter — title, SKU, type…"
                autoComplete="off"
                style={{
                  display: "block",
                  width: "100%",
                  marginTop: "0.35rem",
                  padding: "0.5rem",
                }}
              />
            </label>
            <s-button type="button" variant="secondary" onClick={commitSearchToUrl}>
              Update URL
            </s-button>
          </div>
          {q ? (
            <s-text tone="subdued">
              Filter: &quot;{q}&quot; — up to {pageSize} per page.
            </s-text>
          ) : (
            <s-text tone="subdued">
              Up to {pageSize} products per page, newest updated first. Results
              refresh as you type.
            </s-text>
          )}
        </s-section>

        <s-section>
          {errors && (
            <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
              <s-text tone="critical">
                Could not load products. {errors[0]?.message || "Unknown error"}
              </s-text>
            </s-box>
          )}

          {!errors && searchingLive && (
            <s-text tone="subdued">Loading matches…</s-text>
          )}

          {!errors && !searchingLive && listProducts.length === 0 && (
            <s-text tone="subdued">
              {q
                ? "No products match your search. Try different keywords."
                : "No products found yet. Create a product in your store to get started."}
            </s-text>
          )}

          {!errors && !searchingLive && listProducts.length > 0 && (
            <s-stack direction="block" gap="base">
              {listProducts.map((product) => {
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
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "0.5rem",
                  alignItems: "center",
                  marginTop: "0.5rem",
                }}
              >
                <s-button
                  type="button"
                  variant="secondary"
                  disabled={!prevHref}
                  onClick={() => {
                    if (prevHref) window.location.assign(prevHref);
                  }}
                >
                  Previous
                </s-button>
                <s-button
                  type="button"
                  variant="secondary"
                  disabled={!nextHref}
                  onClick={() => {
                    if (nextHref) window.location.assign(nextHref);
                  }}
                >
                  Next
                </s-button>
                <s-text tone="subdued">
                  {pageInfo.hasPreviousPage || pageInfo.hasNextPage
                    ? "More pages available — use Previous / Next."
                    : "End of list for this search."}
                </s-text>
              </div>
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
