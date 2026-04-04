import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData, useLocation } from "react-router";
import { EmbeddedNavLink } from "../embedded-nav-link";
import { productPathSegmentFromGid } from "../shopify-ids";
import { applyAvailableQuantityToAllLocations } from "../inventory-locations.server";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";

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

function managePathWithQ(locationSearch: string, q: string): string {
  const p = new URLSearchParams(
    locationSearch.startsWith("?") ? locationSearch.slice(1) : locationSearch,
  );
  const t = q.trim();
  if (t) p.set("q", t);
  else p.delete("q");
  const qs = p.toString();
  return qs.length > 0 ? `/app/manage?${qs}` : "/app/manage";
}

type ManageVariant = {
  id: string;
  label: string;
  inventoryItemId: string | null;
  levels: Array<{
    locationId: string;
    locationName: string;
    available: number;
  }>;
};

type ManageProduct = {
  id: string;
  title: string;
  thumbUrl: string | null;
  thumbAlt: string;
  variants: ManageVariant[];
};

type ManageLocation = { id: string; name: string; isActive: boolean };

function parseProductsFromResponse(data: unknown): ManageProduct[] {
  const root = data as {
    products?: {
      nodes?: Array<{
        id: string;
        title: string;
        featuredImage?: { url: string; altText?: string | null } | null;
        images?: {
          nodes?: Array<{ url: string; altText?: string | null }>;
        } | null;
        media?: {
          nodes?: Array<{
            image?: { url: string; altText?: string | null } | null;
          }>;
        } | null;
        variants?: {
          nodes?: Array<{
            id: string;
            title?: string | null;
            displayName?: string | null;
            inventoryItem?: {
              id: string;
              inventoryLevels?: {
                nodes?: Array<{
                  location?: { id: string; name: string } | null;
                  quantities?: Array<{ name?: string; quantity?: number }> | null;
                }>;
              } | null;
            } | null;
          }>;
        } | null;
      }>;
    } | null;
  };

  const nodes = root.products?.nodes ?? [];
  return nodes.map((p) => {
    const firstImageNode = p.images?.nodes?.[0];
    const firstMediaImage = p.media?.nodes?.find((n) => n.image?.url)?.image;
    const thumbUrl =
      p.featuredImage?.url ||
      firstImageNode?.url ||
      firstMediaImage?.url ||
      null;
    const thumbAlt =
      p.featuredImage?.altText ||
      firstImageNode?.altText ||
      firstMediaImage?.altText ||
      p.title;

    return {
    id: p.id,
    title: p.title,
    thumbUrl,
    thumbAlt: thumbAlt || p.title,
    variants: (p.variants?.nodes ?? []).map((v) => {
      const label =
        (v.displayName && String(v.displayName).trim()) ||
        (v.title && String(v.title).trim()) ||
        "Default";
      const item = v.inventoryItem;
      const levelNodes = item?.inventoryLevels?.nodes ?? [];
      const levels = levelNodes
        .filter((n) => n.location?.id)
        .map((n) => {
          const qtyEntry = (n.quantities ?? []).find(
            (q) => q.name === "available",
          );
          return {
            locationId: n.location!.id,
            locationName: n.location!.name,
            available: qtyEntry?.quantity ?? 0,
          };
        });
      return {
        id: v.id,
        label,
        inventoryItemId: item?.id ?? null,
        levels,
      };
    }),
  };
  });
}

const manageProductsQuery = `#graphql
  query ManageStockProducts($query: String) {
    products(first: 25, query: $query, sortKey: UPDATED_AT, reverse: true) {
      nodes {
        id
        title
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
        variants(first: 20) {
          nodes {
            id
            title
            displayName
            inventoryItem {
              id
              inventoryLevels(first: 15) {
                nodes {
                  location {
                    id
                    name
                  }
                  quantities(names: ["available"]) {
                    name
                    quantity
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const url = new URL(request.url);
  const productSearch = url.searchParams.get("q")?.trim() ?? "";

  // Split into two queries to stay under the single-query cost limit (~1000).
  const [locRes, prodRes] = await Promise.all([
    admin.graphql(
      `#graphql
        query ManageStockLocations {
          locations(first: 25, sortKey: NAME) {
            nodes {
              id
              name
              isActive
            }
          }
        }`,
    ),
    admin.graphql(manageProductsQuery, {
      variables: {
        query: productSearch.length > 0 ? productSearch : null,
      },
    }),
  ]);

  const locJson = (await locRes.json()) as {
    data?: unknown;
    errors?: { message: string }[];
  };
  const prodJson = (await prodRes.json()) as {
    data?: unknown;
    errors?: { message: string }[];
  };

  const errMsg =
    locJson.errors?.[0]?.message ?? prodJson.errors?.[0]?.message ?? null;
  if (errMsg) {
    return {
      error: errMsg,
      locations: [] as ManageLocation[],
      products: [] as ManageProduct[],
      productSearch,
    };
  }

  const data = locJson.data as unknown as {
    locations?: { nodes?: ManageLocation[] };
  };
  const locations = (data.locations?.nodes ?? []).filter((l) => l.isActive);
  const products = parseProductsFromResponse(prodJson.data);

  return {
    error: null as string | null,
    locations,
    products,
    productSearch,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "set_quantity") {
    const inventoryItemId = String(formData.get("inventoryItemId") || "");
    const newQtyRaw = formData.get("newQuantity");
    const newQuantity =
      typeof newQtyRaw === "string" ? Number.parseInt(newQtyRaw, 10) : NaN;

    if (!inventoryItemId || Number.isNaN(newQuantity)) {
      return {
        status: "error" as const,
        intent: "set_quantity" as const,
        message: "Choose a variant and enter a valid quantity.",
      };
    }
    if (newQuantity < 0) {
      return {
        status: "error" as const,
        intent: "set_quantity" as const,
        message: "Quantity cannot be negative.",
      };
    }

    const invResult = await applyAvailableQuantityToAllLocations(
      admin,
      inventoryItemId,
      newQuantity,
    );
    if (!invResult.ok) {
      return {
        status: "error" as const,
        intent: "set_quantity" as const,
        message: invResult.message,
      };
    }
    if (invResult.locationsAdjusted === 0) {
      return {
        status: "quantity_unchanged" as const,
        intent: "set_quantity" as const,
      };
    }

    return {
      status: "quantity_updated" as const,
      intent: "set_quantity" as const,
      newQuantity,
      locationsAdjusted: invResult.locationsAdjusted,
    };
  }

  if (intent === "create_product") {
    const title = String(formData.get("title") || "").trim();
    const descriptionHtml = String(formData.get("descriptionHtml") || "").trim();
    const statusRaw = String(formData.get("status") || "DRAFT").toUpperCase();
    const status =
      statusRaw === "ACTIVE" ? "ACTIVE" : ("DRAFT" as "ACTIVE" | "DRAFT");

    const files = formData
      .getAll("images")
      .filter((value): value is File => value instanceof File && value.size > 0);

    if (!title) {
      return {
        status: "error" as const,
        intent: "create_product" as const,
        message: "Product title is required.",
      };
    }

    const variantOptionName = String(
      formData.get("variantOptionName") || "Title",
    ).trim() || "Title";
    const variantValuesRaw = String(formData.get("variantValues") || "");
    const variantValues = variantValuesRaw
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    const variantPriceRaw = String(formData.get("variantPrice") || "0.00").trim();
    const variantPrice = /^\d+(\.\d{1,2})?$/.test(variantPriceRaw)
      ? variantPriceRaw
      : "0.00";

    const initialQtyRaw = formData.get("initialQuantity");
    const parsedInitial =
      typeof initialQtyRaw === "string"
        ? Number.parseInt(initialQtyRaw, 10)
        : NaN;
    const initialQuantity =
      Number.isNaN(parsedInitial) || parsedInitial < 0 ? 0 : parsedInitial;

    const productInput: Record<string, unknown> = {
      title,
      status,
    };
    if (descriptionHtml) {
      productInput.descriptionHtml = descriptionHtml;
    }
    if (variantValues.length >= 2) {
      productInput.productOptions = [
        {
          name: variantOptionName.slice(0, 255),
          values: variantValues.map((name) => ({ name })),
        },
      ];
    }

    const createRes = await admin.graphql(
      `#graphql
        mutation ManageCreateProduct($product: ProductCreateInput!) {
          productCreate(product: $product) {
            product {
              id
              title
              variants(first: 100) {
                nodes {
                  id
                  inventoryItem {
                    id
                  }
                }
              }
            }
            userErrors {
              field
              message
            }
          }
        }`,
      {
        variables: { product: productInput },
      },
    );
    const createJson = await createRes.json();
    const payload = createJson.data?.productCreate as {
      product?: {
        id: string;
        title: string;
        variants?: {
          nodes?: Array<{
            id: string;
            inventoryItem?: { id: string } | null;
          }>;
        };
      };
      userErrors?: Array<{ message: string }>;
    };
    const userErrors = payload?.userErrors ?? [];
    if (userErrors.length > 0) {
      return {
        status: "error" as const,
        intent: "create_product" as const,
        message: userErrors.map((e: { message: string }) => e.message).join(" "),
      };
    }
    const product = payload?.product;
    const newProductId = product?.id as string | undefined;
    const productTitle = product?.title as string | undefined;

    if (!newProductId) {
      return {
        status: "error" as const,
        intent: "create_product" as const,
        message: "Product was not returned from Shopify.",
      };
    }

    let variantNodes =
      product?.variants?.nodes?.filter((n) => n.id) ?? [];

    if (
      variantNodes.length === 0 ||
      variantNodes.some((v) => !v.inventoryItem?.id)
    ) {
      const refreshRes = await admin.graphql(
        `#graphql
          query ManageProductVariantsInv($id: ID!) {
            product(id: $id) {
              variants(first: 100) {
                nodes {
                  id
                  inventoryItem {
                    id
                  }
                }
              }
            }
          }`,
        { variables: { id: newProductId } },
      );
      const refreshJson = (await refreshRes.json()) as {
        data?: {
          product?: {
            variants?: {
              nodes?: Array<{
                id: string;
                inventoryItem?: { id: string } | null;
              }>;
            };
          };
        };
      };
      variantNodes = refreshJson.data?.product?.variants?.nodes ?? [];
    }

    if (variantNodes.length > 0) {
      const bulkRes = await admin.graphql(
        `#graphql
          mutation ManageBulkVariantPrice(
            $productId: ID!
            $variants: [ProductVariantsBulkInput!]!
          ) {
            productVariantsBulkUpdate(productId: $productId, variants: $variants) {
              userErrors {
                field
                message
              }
            }
          }`,
        {
          variables: {
            productId: newProductId,
            variants: variantNodes.map((v) => ({
              id: v.id,
              price: variantPrice,
            })),
          },
        },
      );
      const bulkJson = await bulkRes.json();
      const bulkErrors =
        bulkJson.data?.productVariantsBulkUpdate?.userErrors ?? [];
      if (bulkErrors.length > 0) {
        return {
          status: "product_created_price_failed" as const,
          intent: "create_product" as const,
          productId: newProductId,
          title: productTitle ?? title,
          message:
            bulkErrors[0]?.message ||
            "Product was created but variant price could not be set.",
        };
      }
    }

    if (initialQuantity > 0) {
      for (const v of variantNodes) {
        const iid = v.inventoryItem?.id;
        if (!iid) continue;
        const inv = await applyAvailableQuantityToAllLocations(
          admin,
          iid,
          initialQuantity,
        );
        if (!inv.ok) {
          return {
            status: "product_created_inventory_failed" as const,
            intent: "create_product" as const,
            productId: newProductId,
            title: productTitle ?? title,
            message: inv.message,
          };
        }
      }
    }

    let imagesUploaded = 0;
    if (files.length > 0) {
      const stagedResponse = await admin.graphql(
        `#graphql
          mutation ManageStagedUploadsCreate($input: [StagedUploadInput!]!) {
            stagedUploadsCreate(input: $input) {
              stagedTargets {
                url
                resourceUrl
                parameters {
                  name
                  value
                }
              }
              userErrors {
                field
                message
              }
            }
          }`,
        {
          variables: {
            input: files.map((file) => ({
              filename: file.name,
              mimeType: file.type || "image/jpeg",
              resource: "PRODUCT_IMAGE",
              fileSize: String(file.size),
              httpMethod: "POST",
            })),
          },
        },
      );

      const stagedJson = await stagedResponse.json();
      const stagedErrors = stagedJson.data?.stagedUploadsCreate?.userErrors ?? [];
      const stagedTargets =
        stagedJson.data?.stagedUploadsCreate?.stagedTargets ?? [];

      if (stagedErrors.length > 0 || stagedTargets.length !== files.length) {
        return {
          status: "product_created_images_failed" as const,
          intent: "create_product" as const,
          productId: newProductId,
          title: productTitle ?? title,
          message:
            stagedErrors[0]?.message ||
            "Product was created but image upload could not start.",
        };
      }

      const uploadedResourceUrls: string[] = [];

      for (let i = 0; i < files.length; i += 1) {
        const file = files[i];
        const target = stagedTargets[i];
        const uploadForm = new FormData();

        for (const param of target.parameters ?? []) {
          uploadForm.append(param.name, param.value);
        }

        uploadForm.append("file", file);

        const uploadResponse = await fetch(target.url, {
          method: "POST",
          body: uploadForm,
        });

        if (!uploadResponse.ok) {
          return {
            status: "product_created_images_failed" as const,
            intent: "create_product" as const,
            productId: newProductId,
            title: productTitle ?? title,
            message:
              "Product was created but uploading one of the images failed.",
          };
        }

        uploadedResourceUrls.push(target.resourceUrl);
      }

      const createMediaResponse = await admin.graphql(
        `#graphql
          mutation ManageCreateProductMedia($productId: ID!, $media: [CreateMediaInput!]!) {
            productCreateMedia(productId: $productId, media: $media) {
              mediaUserErrors {
                field
                message
              }
            }
          }`,
        {
          variables: {
            productId: newProductId,
            media: uploadedResourceUrls.map((resourceUrl) => ({
              originalSource: resourceUrl,
              mediaContentType: "IMAGE",
              alt: "Product image",
            })),
          },
        },
      );

      const createMediaJson = await createMediaResponse.json();
      const createMediaErrors =
        createMediaJson.data?.productCreateMedia?.mediaUserErrors ?? [];

      if (createMediaErrors.length > 0) {
        return {
          status: "product_created_images_failed" as const,
          intent: "create_product" as const,
          productId: newProductId,
          title: productTitle ?? title,
          message:
            createMediaErrors[0]?.message ||
            "Product was created but images could not be attached.",
        };
      }

      imagesUploaded = uploadedResourceUrls.length;
    }

    return {
      status: "product_created" as const,
      intent: "create_product" as const,
      productId: newProductId,
      title: productTitle ?? title,
      imagesUploaded,
      variantCount: variantNodes.length,
      initialQuantityApplied: initialQuantity > 0,
    };
  }

  return null;
};

export default function ManagePage() {
  const loaderData = useLoaderData<typeof loader>();
  const location = useLocation();
  const fetcher = useFetcher<typeof action>();
  const manageSearchFetcher = useFetcher<typeof loader>();

  const [inputValue, setInputValue] = useState(loaderData.productSearch);
  useEffect(() => {
    setInputValue(loaderData.productSearch);
  }, [loaderData.productSearch]);

  const debouncedInput = useDebouncedValue(inputValue, 320);

  useEffect(() => {
    if (loaderData.error) return;
    manageSearchFetcher.load(managePathWithQ(location.search, debouncedInput));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedInput, location.search, loaderData.error]);

  const searchingLive =
    !loaderData.error &&
    manageSearchFetcher.state === "loading" &&
    debouncedInput.trim() !== loaderData.productSearch;

  const useLive =
    !loaderData.error &&
    manageSearchFetcher.state === "idle" &&
    manageSearchFetcher.data &&
    !manageSearchFetcher.data.error &&
    manageSearchFetcher.data.productSearch === debouncedInput.trim();

  const display = useLive && manageSearchFetcher.data
    ? manageSearchFetcher.data
    : loaderData;

  const { error, locations, products, productSearch } = display;

  const [productId, setProductId] = useState("");
  const [variantId, setVariantId] = useState("");
  const createImagesRef = useRef<HTMLInputElement>(null);
  const [createImageCount, setCreateImageCount] = useState(0);

  useEffect(() => {
    if (searchingLive) return;
    if (productId && !products.some((p) => p.id === productId)) {
      setProductId("");
      setVariantId("");
    }
  }, [searchingLive, products, productId]);

  useEffect(() => {
    if (
      fetcher.data?.status === "product_created" ||
      fetcher.data?.status === "product_created_images_failed"
    ) {
      setCreateImageCount(0);
      if (createImagesRef.current) createImagesRef.current.value = "";
    }
  }, [fetcher.data?.status]);

  const commitSearchToUrl = () => {
    window.location.assign(managePathWithQ(location.search, inputValue));
  };

  const selectedProduct = useMemo(
    () => products.find((p) => p.id === productId),
    [products, productId],
  );

  const selectedVariant = useMemo(
    () => selectedProduct?.variants.find((v) => v.id === variantId),
    [selectedProduct, variantId],
  );

  const locationRows = useMemo(() => {
    if (!selectedVariant?.inventoryItemId) return [];
    return locations.map((loc) => {
      const lvl = selectedVariant.levels.find(
        (l) => l.locationId === loc.id,
      );
      return {
        locationId: loc.id,
        locationName: loc.name,
        hasLevel: lvl != null,
        available: lvl?.available ?? 0,
      };
    });
  }, [locations, selectedVariant]);

  const defaultQuantityInput =
    locationRows.find((r) => r.hasLevel)?.available ??
    locationRows[0]?.available ??
    0;

  return (
    <div style={pageShellStyle}>
      <s-page heading="Stock &amp; new product">
        <s-section>
          <EmbeddedNavLink hrefPathname="/app">← Home</EmbeddedNavLink>
        </s-section>

        {error ? (
          <s-section heading="Could not load data">
            <s-text tone="critical">{error}</s-text>
            <s-text tone="neutral">
              Confirm the app has read_products, read_inventory, and
              read_locations scopes, then reinstall the app if you changed
              scopes.
            </s-text>
          </s-section>
        ) : null}

        <s-section heading="Set available quantity">
          <s-stack direction="block" gap="base">
            <s-text tone="neutral">
              You update <strong>one variant at a time</strong> — not your whole
              catalog. The table shows every <strong>active</strong> shop location
              (up to 25) with available stock from this screen’s data (up to 15
              inventory levels per variant). Saving sets that same quantity at{" "}
              <strong>all</strong> active locations in Shopify. Locations marked{" "}
              <strong>Not stocked yet</strong> are activated first, then existing
              levels are adjusted. The product list shows up to 25 matches (recently
              updated first when not filtering). Type to filter — results refresh as you
              type; use <strong>Update URL</strong> to bookmark or share the current
              filter.
            </s-text>

            <div style={{ maxWidth: "28rem" }}>
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "0.5rem",
                  alignItems: "flex-end",
                }}
              >
                <label style={{ flex: "1", minWidth: "12rem" }}>
                  <s-text font-weight="bold">Find a product</s-text>
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
              {productSearch ? (
                <s-text tone="subdued">
                  Filter: &quot;{productSearch}&quot; — up to 25 in the dropdown.
                </s-text>
              ) : (
                <s-text tone="subdued">
                  Up to 25 products in the dropdown, newest updated first. Results
                  refresh as you type.
                </s-text>
              )}
              {searchingLive ? (
                <s-text tone="subdued">Loading matches…</s-text>
              ) : null}
            </div>

            <div
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: "1rem",
                flexWrap: "wrap",
              }}
            >
              {selectedProduct?.thumbUrl ? (
                <div
                  style={{
                    flexShrink: 0,
                    width: 56,
                    height: 56,
                    borderRadius: 8,
                    overflow: "hidden",
                    background: "#e3e3e3",
                    border: "1px solid #c9cccf",
                  }}
                >
                  <img
                    src={selectedProduct.thumbUrl}
                    alt={selectedProduct.thumbAlt}
                    style={{
                      width: "100%",
                      height: "100%",
                      objectFit: "cover",
                    }}
                  />
                </div>
              ) : selectedProduct ? (
                <div
                  style={{
                    flexShrink: 0,
                    width: 56,
                    height: 56,
                    borderRadius: 8,
                    background: "#e3e3e3",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#8c9196",
                    fontSize: 22,
                  }}
                  aria-hidden
                >
                  —
                </div>
              ) : null}
              <label style={{ display: "block", flex: "1", minWidth: "12rem" }}>
                <s-text font-weight="bold">Product</s-text>
                <select
                  disabled={searchingLive}
                  style={{
                    display: "block",
                    width: "100%",
                    maxWidth: "28rem",
                    marginTop: "0.35rem",
                    padding: "0.5rem",
                  }}
                  value={productId}
                  onChange={(e) => {
                    setProductId(e.target.value);
                    setVariantId("");
                  }}
                >
                  <option value="">Select a product</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {selectedProduct ? (
              <label style={{ display: "block" }}>
                <s-text font-weight="bold">Variant</s-text>
                <select
                  style={{
                    display: "block",
                    width: "100%",
                    maxWidth: "28rem",
                    marginTop: "0.35rem",
                    padding: "0.5rem",
                  }}
                  value={variantId}
                  onChange={(e) => {
                    setVariantId(e.target.value);
                  }}
                >
                  <option value="">Select a variant</option>
                  {selectedProduct.variants.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.label}
                      {!v.inventoryItemId ? " (no inventory item)" : ""}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            {selectedVariant?.inventoryItemId && locationRows.length > 0 ? (
              <div style={{ overflowX: "auto" }}>
                <table
                  style={{
                    borderCollapse: "collapse",
                    width: "100%",
                    maxWidth: "36rem",
                    fontSize: "0.875rem",
                  }}
                >
                  <thead>
                    <tr style={{ borderBottom: "1px solid #c9cccf" }}>
                      <th style={{ textAlign: "left", padding: "0.35rem 0.5rem" }}>
                        Location
                      </th>
                      <th style={{ textAlign: "right", padding: "0.35rem 0.5rem" }}>
                        Available now
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {locationRows.map((row) => (
                      <tr key={row.locationId} style={{ borderBottom: "1px solid #e3e5e7" }}>
                        <td style={{ padding: "0.35rem 0.5rem" }}>
                          {row.locationName}
                        </td>
                        <td style={{ textAlign: "right", padding: "0.35rem 0.5rem" }}>
                          {row.hasLevel ? row.available : "Not stocked yet"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}

            {selectedVariant && !selectedVariant.inventoryItemId ? (
            <s-text tone="neutral">
              This variant has no inventory item (often digital or custom
                setup). Use Shopify Admin to enable inventory tracking.
              </s-text>
            ) : null}

            {selectedVariant?.inventoryItemId && locationRows.length > 0 ? (
              <fetcher.Form method="post">
                <input type="hidden" name="intent" value="set_quantity" />
                <input
                  type="hidden"
                  name="inventoryItemId"
                  value={selectedVariant.inventoryItemId}
                />
                <label style={{ display: "block" }}>
                  <s-text font-weight="bold">
                    New available quantity (each active location)
                  </s-text>
                  <input
                    key={variantId}
                    type="number"
                    name="newQuantity"
                    min={0}
                    defaultValue={defaultQuantityInput}
                    style={{
                      display: "block",
                      width: "100%",
                      maxWidth: "12rem",
                      marginTop: "0.35rem",
                      padding: "0.5rem",
                    }}
                  />
                </label>
                <div style={{ marginTop: "0.75rem" }}>
                  <s-button
                    type="submit"
                    variant="primary"
                    {...(fetcher.state === "submitting" &&
                    fetcher.formData?.get("intent") === "set_quantity"
                      ? { loading: true }
                      : {})}
                  >
                    Update all locations
                  </s-button>
                </div>
              </fetcher.Form>
            ) : null}

            {selectedVariant?.inventoryItemId && locations.length === 0 ? (
              <s-text tone="caution">
                No active locations loaded. Check read_locations scope and
                reinstall the app.
              </s-text>
            ) : null}

            {fetcher.data?.status === "quantity_updated" &&
            fetcher.data.intent === "set_quantity" ? (
              <s-text tone="success">
                Set available to {fetcher.data.newQuantity} at{" "}
                {fetcher.data.locationsAdjusted} active location
                {fetcher.data.locationsAdjusted === 1 ? "" : "s"}.
              </s-text>
            ) : null}
            {fetcher.data?.status === "quantity_unchanged" ? (
              <s-text tone="neutral">Quantity already matched — no change.</s-text>
            ) : null}
            {fetcher.data?.status === "error" &&
            fetcher.data.intent === "set_quantity" ? (
              <s-text tone="critical">{fetcher.data.message}</s-text>
            ) : null}
          </s-stack>
        </s-section>

        <s-section heading="Create new product">
          <s-stack direction="block" gap="base">
            <s-text tone="neutral">
              Create a product with one default variant, or add a single option
              (e.g. Size) with several values to create multiple variants. Set a
              price, optional starting quantity at every active location, images,
              then save.
            </s-text>
            <fetcher.Form method="post" encType="multipart/form-data">
              <input type="hidden" name="intent" value="create_product" />
              <s-stack direction="block" gap="base">
                <label style={{ display: "block" }}>
                  <s-text font-weight="bold">Title</s-text>
                  <input
                    name="title"
                    required
                    style={{
                      display: "block",
                      width: "100%",
                      maxWidth: "28rem",
                      marginTop: "0.35rem",
                      padding: "0.5rem",
                    }}
                  />
                </label>
                <label style={{ display: "block" }}>
                  <s-text font-weight="bold">Description (HTML, optional)</s-text>
                  <textarea
                    name="descriptionHtml"
                    rows={4}
                    style={{
                      display: "block",
                      width: "100%",
                      maxWidth: "28rem",
                      marginTop: "0.35rem",
                      padding: "0.5rem",
                    }}
                  />
                </label>
                <label style={{ display: "block" }}>
                  <s-text font-weight="bold">Variant option name (optional)</s-text>
                  <input
                    name="variantOptionName"
                    placeholder="Title"
                    defaultValue="Title"
                    style={{
                      display: "block",
                      width: "100%",
                      maxWidth: "28rem",
                      marginTop: "0.35rem",
                      padding: "0.5rem",
                    }}
                  />
                </label>
                <label style={{ display: "block" }}>
                  <s-text font-weight="bold">Variant values (optional)</s-text>
                  <textarea
                    name="variantValues"
                    rows={3}
                    placeholder={`One per line or comma-separated. Example:\nSmall\nMedium\nLarge\n\nLeave empty for a single default variant. Need at least two values to create multiple variants.`}
                    style={{
                      display: "block",
                      width: "100%",
                      maxWidth: "28rem",
                      marginTop: "0.35rem",
                      padding: "0.5rem",
                    }}
                  />
                </label>
                <label style={{ display: "block" }}>
                  <s-text font-weight="bold">Price per variant (shop currency)</s-text>
                  <input
                    name="variantPrice"
                    type="text"
                    inputMode="decimal"
                    defaultValue="0.00"
                    style={{
                      display: "block",
                      width: "100%",
                      maxWidth: "12rem",
                      marginTop: "0.35rem",
                      padding: "0.5rem",
                    }}
                  />
                </label>
                <label style={{ display: "block" }}>
                  <s-text font-weight="bold">
                    Initial quantity per variant (all active locations)
                  </s-text>
                  <input
                    name="initialQuantity"
                    type="number"
                    min={0}
                    defaultValue={0}
                    style={{
                      display: "block",
                      width: "100%",
                      maxWidth: "12rem",
                      marginTop: "0.35rem",
                      padding: "0.5rem",
                    }}
                  />
                </label>
                <label style={{ display: "block" }}>
                  <s-text font-weight="bold">Status</s-text>
                  <select
                    name="status"
                    style={{
                      display: "block",
                      width: "100%",
                      maxWidth: "28rem",
                      marginTop: "0.35rem",
                      padding: "0.5rem",
                    }}
                    defaultValue="DRAFT"
                  >
                    <option value="DRAFT">Draft</option>
                    <option value="ACTIVE">Active</option>
                  </select>
                </label>
                <label style={{ display: "block" }}>
                  <s-text font-weight="bold">Images (optional)</s-text>
                  <input
                    ref={createImagesRef}
                    type="file"
                    name="images"
                    accept="image/*"
                    multiple
                    onChange={(e) =>
                      setCreateImageCount(e.currentTarget.files?.length ?? 0)
                    }
                    style={{
                      display: "block",
                      width: "100%",
                      maxWidth: "28rem",
                      marginTop: "0.35rem",
                    }}
                  />
                </label>
                {createImageCount > 0 ? (
                  <s-text tone="neutral">
                    {createImageCount} image{createImageCount === 1 ? "" : "s"}{" "}
                    will be uploaded after the product is created.
                  </s-text>
                ) : null}
                <s-button
                  type="submit"
                  variant="primary"
                  {...(fetcher.state === "submitting" &&
                  fetcher.formData?.get("intent") === "create_product"
                    ? { loading: true }
                    : {})}
                >
                  Create product
                </s-button>
              </s-stack>
            </fetcher.Form>
            {fetcher.data?.status === "product_created" &&
            fetcher.data.intent === "create_product" ? (
              <s-text tone="success">
                Created “{fetcher.data.title}” with {fetcher.data.variantCount}{" "}
                variant{fetcher.data.variantCount === 1 ? "" : "s"}.
                {fetcher.data.initialQuantityApplied
                  ? " Initial stock applied at active locations."
                  : ""}
                {fetcher.data.imagesUploaded > 0
                  ? ` Attached ${fetcher.data.imagesUploaded} image(s).`
                  : ""}{" "}
                <EmbeddedNavLink
                  hrefPathname={`/app/products/${productPathSegmentFromGid(fetcher.data.productId)}`}
                >
                  Open in this app
                </EmbeddedNavLink>
              </s-text>
            ) : null}
            {fetcher.data?.status === "product_created_price_failed" &&
            fetcher.data.intent === "create_product" ? (
              <s-text tone="caution">
                {fetcher.data.message}{" "}
                <EmbeddedNavLink
                  hrefPathname={`/app/products/${productPathSegmentFromGid(fetcher.data.productId)}`}
                >
                  Open product to set prices
                </EmbeddedNavLink>
              </s-text>
            ) : null}
            {fetcher.data?.status === "product_created_inventory_failed" &&
            fetcher.data.intent === "create_product" ? (
              <s-text tone="caution">
                {fetcher.data.message}{" "}
                <EmbeddedNavLink
                  hrefPathname={`/app/products/${productPathSegmentFromGid(fetcher.data.productId)}`}
                >
                  Open product to set stock
                </EmbeddedNavLink>
              </s-text>
            ) : null}
            {fetcher.data?.status === "product_created_images_failed" &&
            fetcher.data.intent === "create_product" ? (
              <s-stack direction="block" gap="base">
                <s-text tone="caution">
                  {fetcher.data.message}{" "}
                  <EmbeddedNavLink
                    hrefPathname={`/app/products/${productPathSegmentFromGid(fetcher.data.productId)}`}
                  >
                    Open product to add images
                  </EmbeddedNavLink>
                </s-text>
              </s-stack>
            ) : null}
            {fetcher.data?.status === "error" &&
            fetcher.data.intent === "create_product" ? (
              <s-text tone="critical">{fetcher.data.message}</s-text>
            ) : null}
          </s-stack>
        </s-section>
      </s-page>
    </div>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
