import { useEffect, useMemo, useRef, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData, useLocation } from "react-router";
import { EmbeddedNavLink } from "../embedded-nav-link";
import { SeoHomeButton } from "../HomeButton";
import { productPathSegmentFromGid } from "../shopify-ids";
import { applyAvailableQuantityToAllLocations } from "../inventory-locations.server";
import {
  clearResolvedLowStock,
  getInventoryAlertSettings,
  notifyLowStockLines,
  saveInventoryAlertSettings,
  type LowStockLine,
} from "../inventory-stock.server";
import { LOW_STOCK_THRESHOLD, stockBadgeStyle } from "../inventory-stock";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";

function useDebouncedValue<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

function managePathWithParams(
  locationSearch: string,
  opts: { q?: string; cursor?: string | null },
): string {
  const p = new URLSearchParams(
    locationSearch.startsWith("?") ? locationSearch.slice(1) : locationSearch,
  );
  const t = (opts.q ?? p.get("q") ?? "").trim();
  if (t) p.set("q", t);
  else p.delete("q");

  if (opts.cursor) p.set("cursor", opts.cursor);
  else p.delete("cursor");

  const qs = p.toString();
  return qs.length > 0 ? `/app/manage?${qs}` : "/app/manage";
}

function managePathWithQ(locationSearch: string, q: string): string {
  return managePathWithParams(locationSearch, { q, cursor: null });
}

type ManageVariant = {
  id: string;
  label: string;
  sku: string | null;
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

function parseProductsFromResponse(data: unknown): {
  products: ManageProduct[];
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
} {
  const root = data as {
    products?: {
      pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
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
            sku?: string | null;
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
  const products = nodes.map((p) => {
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
          sku: v.sku?.trim() || null,
          inventoryItemId: item?.id ?? null,
          levels,
        };
      }),
    };
  });

  return {
    products,
    pageInfo: {
      hasNextPage: Boolean(root.products?.pageInfo?.hasNextPage),
      endCursor: root.products?.pageInfo?.endCursor ?? null,
    },
  };
}

function collectLowStockLines(
  products: ManageProduct[],
  locations: ManageLocation[],
): LowStockLine[] {
  const lines: LowStockLine[] = [];
  for (const product of products) {
    for (const variant of product.variants) {
      if (!variant.inventoryItemId) continue;
      for (const loc of locations) {
        const lvl = variant.levels.find((l) => l.locationId === loc.id);
        const qty = lvl?.available ?? 0;
        if (qty < LOW_STOCK_THRESHOLD) {
          lines.push({
            inventoryItemId: variant.inventoryItemId,
            locationId: loc.id,
            productTitle: product.title,
            variantLabel: variant.label,
            locationName: loc.name,
            quantity: qty,
          });
        }
      }
    }
  }
  return lines;
}

const manageProductsQuery = `#graphql
  query ManageStockProducts($query: String, $cursor: String) {
    products(first: 20, after: $cursor, query: $query, sortKey: TITLE) {
      pageInfo {
        hasNextPage
        endCursor
      }
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
        variants(first: 50) {
          nodes {
            id
            title
            displayName
            sku
            inventoryItem {
              id
              inventoryLevels(first: 25) {
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
  const { admin, session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const productSearch = url.searchParams.get("q")?.trim() ?? "";
  const cursor = url.searchParams.get("cursor")?.trim() || null;

  const [locRes, prodRes, shopRes, alertSettings] = await Promise.all([
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
        cursor,
      },
    }),
    admin.graphql(
      `#graphql
        query ManageShopEmail {
          shop {
            email
            contactEmail
          }
        }`,
    ),
    getInventoryAlertSettings(session.shop),
  ]);

  const locJson = (await locRes.json()) as {
    data?: unknown;
    errors?: { message: string }[];
  };
  const prodJson = (await prodRes.json()) as {
    data?: unknown;
    errors?: { message: string }[];
  };
  const shopJson = (await shopRes.json()) as {
    data?: { shop?: { email?: string | null; contactEmail?: string | null } };
  };

  const errMsg =
    locJson.errors?.[0]?.message ?? prodJson.errors?.[0]?.message ?? null;
  if (errMsg) {
    return {
      error: errMsg,
      locations: [] as ManageLocation[],
      products: [] as ManageProduct[],
      productSearch,
      pageInfo: { hasNextPage: false, endCursor: null as string | null },
      cursor,
      alertSettings: {
        alertEmail: alertSettings.alertEmail,
        alertsEnabled: alertSettings.alertsEnabled,
        threshold: alertSettings.threshold,
      },
      shopEmailHint:
        shopJson.data?.shop?.contactEmail ||
        shopJson.data?.shop?.email ||
        "",
      lowStockCount: 0,
      alertMailResult: null as { sent: number; skipped: number } | null,
    };
  }

  const data = locJson.data as unknown as {
    locations?: { nodes?: ManageLocation[] };
  };
  const locations = (data.locations?.nodes ?? []).filter((l) => l.isActive);
  const parsed = parseProductsFromResponse(prodJson.data);
  const products = parsed.products;
  const lowStockLines = collectLowStockLines(products, locations);

  let alertMailResult: { sent: number; skipped: number } | null = null;
  const shouldCheck =
    alertSettings.alertsEnabled &&
    Boolean(alertSettings.alertEmail?.includes("@")) &&
    (!alertSettings.lastCheckedAt ||
      Date.now() - alertSettings.lastCheckedAt.getTime() > 15 * 60 * 1000);

  if (shouldCheck && lowStockLines.length > 0) {
    alertMailResult = await notifyLowStockLines(session.shop, lowStockLines);
  }

  return {
    error: null as string | null,
    locations,
    products,
    productSearch,
    pageInfo: parsed.pageInfo,
    cursor,
    alertSettings: {
      alertEmail: alertSettings.alertEmail,
      alertsEnabled: alertSettings.alertsEnabled,
      threshold: alertSettings.threshold,
    },
    shopEmailHint:
      shopJson.data?.shop?.contactEmail || shopJson.data?.shop?.email || "",
    lowStockCount: lowStockLines.length,
    alertMailResult,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "save_alert_settings") {
    const alertEmail = String(formData.get("alertEmail") || "");
    const alertsEnabled = formData.get("alertsEnabled") === "yes";
    if (alertEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(alertEmail.trim())) {
      return {
        status: "error" as const,
        intent: "save_alert_settings" as const,
        message: "Enter a valid alert email address.",
      };
    }
    await saveInventoryAlertSettings(session.shop, {
      alertEmail,
      alertsEnabled,
    });
    return {
      status: "alert_settings_saved" as const,
      intent: "save_alert_settings" as const,
    };
  }

  if (intent === "send_low_stock_now") {
    const productSearch = String(formData.get("productSearch") || "").trim();
    const cursor = String(formData.get("cursor") || "").trim() || null;
    const [locRes, prodRes] = await Promise.all([
      admin.graphql(
        `#graphql
          query ManageStockLocationsAlert {
            locations(first: 25, sortKey: NAME) {
              nodes { id name isActive }
            }
          }`,
      ),
      admin.graphql(manageProductsQuery, {
        variables: {
          query: productSearch.length > 0 ? productSearch : null,
          cursor,
        },
      }),
    ]);
    const locJson = (await locRes.json()) as {
      data?: { locations?: { nodes?: ManageLocation[] } };
    };
    const prodJson = (await prodRes.json()) as { data?: unknown };
    const locations = (locJson.data?.locations?.nodes ?? []).filter(
      (l) => l.isActive,
    );
    const { products } = parseProductsFromResponse(prodJson.data);
    const lines = collectLowStockLines(products, locations);
    const result = await notifyLowStockLines(session.shop, lines);
    return {
      status: "low_stock_checked" as const,
      intent: "send_low_stock_now" as const,
      ...result,
      lowStockCount: lines.length,
    };
  }

  if (intent === "set_quantity") {
    const inventoryItemId = String(formData.get("inventoryItemId") || "");
    const newQtyRaw = formData.get("newQuantity");
    const newQuantity =
      typeof newQtyRaw === "string" ? Number.parseInt(newQtyRaw, 10) : NaN;
    const productTitle = String(formData.get("productTitle") || "Product");
    const variantLabel = String(formData.get("variantLabel") || "Variant");

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

    await clearResolvedLowStock(session.shop, inventoryItemId, newQuantity);

    let alertSent = 0;
    if (newQuantity < LOW_STOCK_THRESHOLD) {
      const locRes = await admin.graphql(
        `#graphql
          query ManageActiveLocationsForAlert {
            locations(first: 25, sortKey: NAME) {
              nodes { id name isActive }
            }
          }`,
      );
      const locJson = (await locRes.json()) as {
        data?: { locations?: { nodes?: ManageLocation[] } };
      };
      const active = (locJson.data?.locations?.nodes ?? []).filter(
        (l) => l.isActive,
      );
      const lines: LowStockLine[] = active.map((loc) => ({
        inventoryItemId,
        locationId: loc.id,
        productTitle,
        variantLabel,
        locationName: loc.name,
        quantity: newQuantity,
      }));
      const mail = await notifyLowStockLines(session.shop, lines);
      alertSent = mail.sent;
    }

    return {
      status: "quantity_updated" as const,
      intent: "set_quantity" as const,
      newQuantity,
      locationsAdjusted: invResult.locationsAdjusted,
      alertSent,
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

  const { error, locations, products, productSearch, pageInfo, cursor, alertSettings, shopEmailHint, lowStockCount, alertMailResult } =
    display;

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

  const inventoryRows = useMemo(() => {
    const rows: Array<{
      key: string;
      productId: string;
      productTitle: string;
      thumbUrl: string | null;
      thumbAlt: string;
      variantId: string;
      variantLabel: string;
      sku: string | null;
      inventoryItemId: string | null;
      total: number;
      byLocation: Array<{
        locationId: string;
        locationName: string;
        available: number;
        hasLevel: boolean;
      }>;
    }> = [];

    for (const product of products) {
      for (const variant of product.variants) {
        const byLocation = locations.map((loc) => {
          const lvl = variant.levels.find((l) => l.locationId === loc.id);
          return {
            locationId: loc.id,
            locationName: loc.name,
            available: lvl?.available ?? 0,
            hasLevel: lvl != null,
          };
        });
        const total = byLocation.reduce((sum, row) => sum + row.available, 0);
        rows.push({
          key: `${product.id}:${variant.id}`,
          productId: product.id,
          productTitle: product.title,
          thumbUrl: product.thumbUrl,
          thumbAlt: product.thumbAlt,
          variantId: variant.id,
          variantLabel: variant.label,
          sku: variant.sku,
          inventoryItemId: variant.inventoryItemId,
          total,
          byLocation,
        });
      }
    }
    return rows;
  }, [products, locations]);

  return (
    <div>
      <s-page heading="Stock &amp; new product">
        <SeoHomeButton />
        <div className="seoi-page-hero">
          <div className="seoi-page-hero__content">
            <span className="seoi-eyebrow">Catalog operations</span>
            <h2>Full inventory by variant and location.</h2>
            <p>
              Review every variant’s available stock by location, update
              quantities, and get emailed when stock falls below{" "}
              {LOW_STOCK_THRESHOLD}.
            </p>
          </div>
          <span className="seoi-status">Shopify synced</span>
        </div>

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

        <s-section heading="Full inventory">
          <s-stack direction="block" gap="base">
            <s-text tone="neutral">
              Shows products with all variants and available stock at each active
              location. Color key:{" "}
              <span style={stockBadgeStyle(2)}>&lt;5</span> low,{" "}
              <span style={stockBadgeStyle(7)}>6–9</span> watch,{" "}
              <span style={stockBadgeStyle(12)}>≥10</span> healthy. Page size: 20
              products (up to 50 variants each).
            </s-text>

            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "0.75rem",
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
            {searchingLive ? (
              <s-text tone="neutral">Loading matches…</s-text>
            ) : null}
            <s-text tone="neutral">
              {lowStockCount > 0
                ? `${lowStockCount} location line(s) below ${LOW_STOCK_THRESHOLD} on this page.`
                : `No low-stock lines below ${LOW_STOCK_THRESHOLD} on this page.`}
              {alertMailResult && alertMailResult.sent > 0
                ? ` Email sent for ${alertMailResult.sent} item(s).`
                : ""}
            </s-text>

            <div style={{ overflowX: "auto" }}>
              <table
                style={{
                  borderCollapse: "collapse",
                  width: "100%",
                  minWidth: Math.max(640, 280 + locations.length * 110),
                  fontSize: "0.8125rem",
                }}
              >
                <thead>
                  <tr style={{ borderBottom: "1px solid #c9cccf", background: "#f6f6f7" }}>
                    <th style={{ textAlign: "left", padding: "0.45rem 0.5rem" }}>
                      Product
                    </th>
                    <th style={{ textAlign: "left", padding: "0.45rem 0.5rem" }}>
                      Variant
                    </th>
                    <th style={{ textAlign: "right", padding: "0.45rem 0.5rem" }}>
                      Total
                    </th>
                    {locations.map((loc) => (
                      <th
                        key={loc.id}
                        style={{ textAlign: "right", padding: "0.45rem 0.5rem" }}
                      >
                        {loc.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {inventoryRows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={3 + locations.length}
                        style={{ padding: "0.75rem 0.5rem", color: "#6d7175" }}
                      >
                        No products found for this filter.
                      </td>
                    </tr>
                  ) : (
                    inventoryRows.map((row) => (
                      <tr
                        key={row.key}
                        style={{ borderBottom: "1px solid #e3e5e7" }}
                      >
                        <td style={{ padding: "0.45rem 0.5rem", verticalAlign: "middle" }}>
                          <div
                            style={{
                              display: "flex",
                              gap: "0.5rem",
                              alignItems: "center",
                            }}
                          >
                            {row.thumbUrl ? (
                              <img
                                src={row.thumbUrl}
                                alt={row.thumbAlt}
                                style={{
                                  width: 36,
                                  height: 36,
                                  objectFit: "cover",
                                  borderRadius: 6,
                                  border: "1px solid #ddd",
                                }}
                              />
                            ) : (
                              <div
                                style={{
                                  width: 36,
                                  height: 36,
                                  borderRadius: 6,
                                  background: "#e3e3e3",
                                }}
                              />
                            )}
                            <div>
                              <div style={{ fontWeight: 600 }}>{row.productTitle}</div>
                              <EmbeddedNavLink
                                hrefPathname={`/app/products/${productPathSegmentFromGid(row.productId)}`}
                                style={{ fontSize: "0.75rem" }}
                              >
                                Open
                              </EmbeddedNavLink>
                            </div>
                          </div>
                        </td>
                        <td style={{ padding: "0.45rem 0.5rem" }}>
                          <div>{row.variantLabel}</div>
                          {row.sku ? (
                            <div style={{ color: "#6d7175", fontSize: "0.75rem" }}>
                              SKU: {row.sku}
                            </div>
                          ) : null}
                          {!row.inventoryItemId ? (
                            <div style={{ color: "#b45309", fontSize: "0.75rem" }}>
                              No inventory tracking
                            </div>
                          ) : null}
                        </td>
                        <td style={{ textAlign: "right", padding: "0.45rem 0.5rem" }}>
                          <span style={stockBadgeStyle(row.total)}>{row.total}</span>
                        </td>
                        {row.byLocation.map((cell) => (
                          <td
                            key={cell.locationId}
                            style={{
                              textAlign: "right",
                              padding: "0.45rem 0.5rem",
                            }}
                          >
                            {cell.hasLevel || cell.available > 0 ? (
                              <span style={stockBadgeStyle(cell.available)}>
                                {cell.available}
                              </span>
                            ) : (
                              <span style={{ color: "#8c9196" }}>—</span>
                            )}
                          </td>
                        ))}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div
              style={{
                display: "flex",
                gap: "0.75rem",
                flexWrap: "wrap",
                alignItems: "center",
              }}
            >
              {cursor ? (
                <EmbeddedNavLink
                  hrefPathname="/app/manage"
                  search={(() => {
                    const p = new URLSearchParams();
                    if (productSearch) p.set("q", productSearch);
                    const qs = p.toString();
                    return qs ? `?${qs}` : undefined;
                  })()}
                >
                  ← First page
                </EmbeddedNavLink>
              ) : null}
              {pageInfo.hasNextPage && pageInfo.endCursor ? (
                <EmbeddedNavLink
                  hrefPathname="/app/manage"
                  search={(() => {
                    const p = new URLSearchParams();
                    if (productSearch) p.set("q", productSearch);
                    p.set("cursor", pageInfo.endCursor);
                    return `?${p.toString()}`;
                  })()}
                >
                  Next 20 products →
                </EmbeddedNavLink>
              ) : (
                <s-text tone="neutral">End of catalog for this filter.</s-text>
              )}
            </div>
          </s-stack>
        </s-section>

        <s-section heading="Low-stock email alerts">
          <s-stack direction="block" gap="base">
            <s-text tone="neutral">
              Email when available quantity is below {LOW_STOCK_THRESHOLD} at any
              location. Alerts are deduplicated for 24 hours per item/location.
              Configure <code>RESEND_API_KEY</code> and <code>MAIL_FROM</code> on
              the server for real delivery (otherwise emails log to the console).
            </s-text>
            <fetcher.Form method="post">
              <input type="hidden" name="intent" value="save_alert_settings" />
              <s-stack direction="block" gap="base">
                <label style={{ display: "block", maxWidth: "28rem" }}>
                  <s-text font-weight="bold">Alert email</s-text>
                  <input
                    type="email"
                    name="alertEmail"
                    defaultValue={
                      alertSettings.alertEmail || shopEmailHint || ""
                    }
                    placeholder={shopEmailHint || "you@example.com"}
                    style={{
                      display: "block",
                      width: "100%",
                      marginTop: "0.35rem",
                      padding: "0.5rem",
                    }}
                  />
                </label>
                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.4rem",
                  }}
                >
                  <input
                    type="checkbox"
                    name="alertsEnabled"
                    value="yes"
                    defaultChecked={alertSettings.alertsEnabled}
                  />
                  <s-text>Enable low-stock emails</s-text>
                </label>
                <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                  <s-button type="submit" variant="primary">
                    Save alert settings
                  </s-button>
                </div>
              </s-stack>
            </fetcher.Form>
            <fetcher.Form method="post">
              <input type="hidden" name="intent" value="send_low_stock_now" />
              <input type="hidden" name="productSearch" value={productSearch} />
              <input type="hidden" name="cursor" value={cursor || ""} />
              <s-button
                type="submit"
                variant="secondary"
                {...(fetcher.state === "submitting" &&
                fetcher.formData?.get("intent") === "send_low_stock_now"
                  ? { loading: true }
                  : {})}
              >
                Check this page &amp; email now
              </s-button>
            </fetcher.Form>
            {fetcher.data?.status === "alert_settings_saved" ? (
              <s-text tone="success">Alert settings saved.</s-text>
            ) : null}
            {fetcher.data?.status === "low_stock_checked" ? (
              <s-text tone="success">
                Found {fetcher.data.lowStockCount} low-stock line(s). Emails sent:{" "}
                {fetcher.data.sent}. Skipped (cooldown/disabled):{" "}
                {fetcher.data.skipped}.
              </s-text>
            ) : null}
            {fetcher.data?.status === "error" &&
            fetcher.data.intent === "save_alert_settings" ? (
              <s-text tone="critical">{fetcher.data.message}</s-text>
            ) : null}
          </s-stack>
        </s-section>

        <s-section heading="Set available quantity">
          <s-stack direction="block" gap="base">
            <s-text tone="neutral">
              Update <strong>one variant</strong> at a time. Saving sets that
              quantity at <strong>all</strong> active locations. Select a product
              from the inventory table filter results below (same list as above).
            </s-text>

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
                          {row.hasLevel ? (
                            <span style={stockBadgeStyle(row.available)}>
                              {row.available}
                            </span>
                          ) : (
                            "Not stocked yet"
                          )}
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
                <input
                  type="hidden"
                  name="productTitle"
                  value={selectedProduct?.title || ""}
                />
                <input
                  type="hidden"
                  name="variantLabel"
                  value={selectedVariant.label}
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
                {"alertSent" in fetcher.data && fetcher.data.alertSent > 0
                  ? ` Low-stock email sent (${fetcher.data.alertSent}).`
                  : ""}
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
