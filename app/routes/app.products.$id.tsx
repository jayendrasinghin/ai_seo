import { useEffect, useRef, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData, useRevalidator } from "react-router";
import { AiSpinner } from "../AiSpinner";
import { EmbeddedNavLink } from "../embedded-nav-link";
import { productGidFromRouteParam, productPathSegmentFromGid } from "../shopify-ids";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import { generateProductCopy, generateProductImage, resolveAiImageSource } from "../ai.server";
import {
  AI_IMAGE_MONTHLY_INCLUDED,
  AI_IMAGE_PLAN_LABEL,
} from "../pricing";
import prisma from "../db.server";
import { getEffectivePlan, planImageAllowed, planSeoUsesFreeQuota } from "../plan-helpers";
import { isPartnerDevelopmentStore } from "../billing.server";

type ProductImageNode = {
  id: string;
  url: string;
  altText: string | null;
};

type LoaderProduct = {
  id: string;
  title: string;
  status: string;
  /** Sum of available across variants and locations; null if not fetched (no inventory scope). */
  availableStockSum: number | null;
  descriptionHtml: string | null;
  images: {
    nodes: ProductImageNode[];
  } | null;
  seo: {
    title: string | null;
    description: string | null;
  } | null;
};

type ProductFromQuery = {
  id: string;
  title: string;
  status: string;
  descriptionHtml: string | null;
  images?: LoaderProduct["images"];
  media?: {
    nodes?: Array<{
      id?: string | null;
      alt?: string | null;
      image?: { url?: string | null; altText?: string | null } | null;
    } | null>;
  };
  seo: LoaderProduct["seo"];
  variants?: {
    nodes?: Array<{
      inventoryItem?: {
        inventoryLevels?: {
          nodes?: Array<{
            quantities?: Array<{ name?: string; quantity?: number }>;
          }>;
        };
      };
    }>;
  };
};

function mediaNodesToImages(
  media: ProductFromQuery["media"] | null | undefined,
): ProductImageNode[] {
  return (media?.nodes ?? [])
    .filter((node): node is NonNullable<typeof node> => Boolean(node?.id && node.image?.url))
    .map((node) => ({
      id: node.id as string,
      url: node.image?.url as string,
      altText: node.alt?.trim() || node.image?.altText || null,
    }));
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchProductImages(
  admin: AdminApiContext,
  productId: string,
): Promise<ProductImageNode[]> {
  const response = await admin.graphql(
    `#graphql
      query AiSeoAppProductImages($id: ID!) {
        product(id: $id) {
          media(first: 50) {
            nodes {
              ... on MediaImage {
                id
                alt
                image {
                  url
                  altText
                }
              }
            }
          }
        }
      }`,
    { variables: { id: productId } },
  );
  const json = (await response.json()) as {
    data?: { product?: { media?: ProductFromQuery["media"] } };
  };
  return mediaNodesToImages(json.data?.product?.media);
}

async function fetchProductImagesUntilChanged(
  admin: AdminApiContext,
  productId: string,
  previousCount: number,
  options?: { expectIncrease?: boolean; attempts?: number; delayMs?: number },
): Promise<ProductImageNode[]> {
  const attempts = options?.attempts ?? 6;
  const delayMs = options?.delayMs ?? 900;
  const expectIncrease = options?.expectIncrease ?? true;
  let images = await fetchProductImages(admin, productId);

  for (let i = 0; i < attempts; i += 1) {
    const changed = expectIncrease
      ? images.length > previousCount
      : images.length < previousCount;
    if (changed || (expectIncrease && images.length >= previousCount + 1)) {
      return images;
    }
    await sleep(delayMs);
    images = await fetchProductImages(admin, productId);
  }

  return images;
}

function sumAvailableStock(product: ProductFromQuery): number {
  let sum = 0;
  for (const v of product.variants?.nodes ?? []) {
    for (const lvl of v.inventoryItem?.inventoryLevels?.nodes ?? []) {
      for (const q of lvl.quantities ?? []) {
        if (q.name === "available" && typeof q.quantity === "number") {
          sum += q.quantity;
        }
      }
    }
  }
  return sum;
}

type OtherProductRow = {
  id: string;
  title: string;
  status: string;
  featuredImage: { url: string; altText: string | null } | null;
  images: { nodes: Array<{ url: string; altText: string | null }> } | null;
  media: {
    nodes: Array<{
      image?: { url: string; altText: string | null } | null;
    }>;
  } | null;
  seo: { title: string | null; description: string | null } | null;
};

export const loader = async ({ params, request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const partnerDevelopment = await isPartnerDevelopmentStore(admin);

  const rawId = params.id;
  const decodedId = productGidFromRouteParam(rawId);

  const usageRow = await prisma.storeUsage.upsert({
    where: { shop: session.shop },
    update: {},
    create: { shop: session.shop },
  });
  const usagePayload = {
    aiUsed: usageRow.aiSeoUsed + usageRow.aiImageUsed,
    freeQuotaLimit: usageRow.freeQuotaLimit,
    plan: getEffectivePlan(usageRow),
    partnerDevelopment,
    aiImageUsed: usageRow.aiImageUsed,
    aiImageMonthlyLimit: AI_IMAGE_MONTHLY_INCLUDED,
  };

  if (!decodedId) {
    return {
      product: null,
      otherProducts: [] as OtherProductRow[],
      shopifyError: null as string | null,
      usage: usagePayload,
    };
  }

  try {
    const response = await admin.graphql(
      `#graphql
      query AiSeoAppProductWithList($id: ID!) {
        product(id: $id) {
          id
          title
          status
          descriptionHtml
          media(first: 50) {
            nodes {
              ... on MediaImage {
                id
                alt
                image {
                  url
                  altText
                }
              }
            }
          }
          variants(first: 50) {
            nodes {
              inventoryItem {
                inventoryLevels(first: 25) {
                  nodes {
                    quantities(names: ["available"]) {
                      name
                      quantity
                    }
                  }
                }
              }
            }
          }
          seo {
            title
            description
          }
        }
        products(first: 20) {
          nodes {
            id
            title
            status
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
        variables: {
          id: decodedId,
        },
      },
    );

    const json = await response.json();
    const rawProduct = json.data?.product as ProductFromQuery | null | undefined;
    const product: LoaderProduct | null = rawProduct
      ? {
          id: rawProduct.id,
          title: rawProduct.title,
          status: rawProduct.status,
          availableStockSum: sumAvailableStock(rawProduct),
          descriptionHtml: rawProduct.descriptionHtml,
          images: { nodes: mediaNodesToImages(rawProduct.media) },
          seo: rawProduct.seo,
        }
      : null;
    const otherProducts = (json.data?.products?.nodes ??
      []) as OtherProductRow[];

    return {
      product,
      otherProducts,
      usage: usagePayload,
      shopifyError: null as string | null,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not reach Shopify.";
    return {
      product: null,
      otherProducts: [] as OtherProductRow[],
      shopifyError: message.includes("fetch failed")
        ? "Could not connect to Shopify from this server (network error). On WSL, check internet access, VPN, firewall, and DNS. Retry or run the app from Windows if the problem persists."
        : message,
      usage: usagePayload,
    };
  }
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "generate") {
    const { admin, session } = await authenticate.admin(request);
    const partnerDevelopment = await isPartnerDevelopmentStore(admin);
    const decodedId = productGidFromRouteParam(params.id);

    if (!decodedId) return null;

    const shopDomain = session.shop;

    const usage = await prisma.storeUsage.upsert({
      where: { shop: shopDomain },
      update: {},
      create: { shop: shopDomain },
    });

    const totalAiUsed = usage.aiSeoUsed + usage.aiImageUsed;
    if (
      !partnerDevelopment &&
      totalAiUsed >= usage.freeQuotaLimit &&
      planSeoUsesFreeQuota(getEffectivePlan(usage))
    ) {
      return { status: "quota_exceeded" as const };
    }

    const response = await admin.graphql(
      `#graphql
        query AiSeoAppProductForAi($id: ID!) {
          product(id: $id) {
            title
            descriptionHtml
          }
        }`,
      {
        variables: {
          id: decodedId,
        },
      },
    );

    const json = await response.json();
    const product = json.data?.product;

    if (!product) return null;

    let ai;
    try {
      ai = await generateProductCopy({
        title: product.title,
        currentDescription: product.descriptionHtml,
      });
    } catch (error) {
      return {
        status: "error" as const,
        userErrors: [
          {
            message:
              error instanceof Error
                ? `AI unavailable: ${error.message}`
                : "AI is temporarily unavailable. Please try again in a minute.",
          },
        ],
      };
    }

    await prisma.storeUsage.update({
      where: { shop: shopDomain },
      data: {
        usedCredits: { increment: 1 },
        aiSeoUsed: { increment: 1 },
      },
    });

    return { ai, status: "generated" as const };
  }

  if (intent === "generate_image" || intent === "generate_image_auto") {
    const { admin, session } = await authenticate.admin(request);
    const partnerDevelopment = await isPartnerDevelopmentStore(admin);
    const decodedId = productGidFromRouteParam(params.id);

    if (!decodedId) return null;

    const shopDomain = session.shop;

    const usage = await prisma.storeUsage.upsert({
      where: { shop: shopDomain },
      update: {},
      create: { shop: shopDomain },
    });

    if (!partnerDevelopment && !planImageAllowed(getEffectivePlan(usage))) {
      return { status: "image_plan_required" as const };
    }

    if (usage.aiImageUsed >= AI_IMAGE_MONTHLY_INCLUDED) {
      return { status: "image_quota_exceeded" as const };
    }

    const productResponse = await admin.graphql(
      `#graphql
        query AiSeoAppProductForImage($id: ID!) {
          product(id: $id) {
            title
          }
        }`,
      { variables: { id: decodedId } },
    );

    const productJson = await productResponse.json();
    const productTitle = productJson.data?.product?.title as string | undefined;
    if (!productTitle) return null;

    const background = String(formData.get("background") || "").trim().slice(0, 300);
    const description = String(formData.get("description") || "").trim().slice(0, 800);
    const previousImages = await fetchProductImages(admin, decodedId);

    let imageUrl: string;
    try {
      const generated = await generateProductImage({
        title: productTitle,
        background: background || undefined,
        description: description || undefined,
      });
      imageUrl = await resolveAiImageSource(admin, generated);
    } catch (error) {
      return {
        status: "ai_image_error" as const,
        message:
          error instanceof Error
            ? `AI image unavailable: ${error.message}`
            : "AI image generation failed. Try again in a minute.",
      };
    }

    if (intent === "generate_image_auto") {
      const mediaResponse = await admin.graphql(
        `#graphql
          mutation AiSeoAddAiProductImage($productId: ID!, $media: [CreateMediaInput!]!) {
            productCreateMedia(productId: $productId, media: $media) {
              media {
                status
              }
              mediaUserErrors {
                field
                message
              }
            }
          }`,
        {
          variables: {
            productId: decodedId,
            media: [
              {
                originalSource: imageUrl,
                mediaContentType: "IMAGE",
                alt: productTitle
                  ? `AI generated: ${productTitle}`
                  : "AI generated image",
              },
            ],
          },
        },
      );

      const mediaJson = await mediaResponse.json();
      const mediaErrors = mediaJson.data?.productCreateMedia?.mediaUserErrors ?? [];
      const mediaStatuses = (
        mediaJson.data?.productCreateMedia?.media ?? []
      ).map((m: { status?: string }) => m.status);

      if (mediaErrors.length > 0) {
        return {
          status: "ai_image_error" as const,
          message: mediaErrors[0]?.message || "Could not add AI image to the product.",
        };
      }

      await prisma.storeUsage.update({
        where: { shop: shopDomain },
        data: {
          usedCredits: { increment: 1 },
          aiImageUsed: { increment: 1 },
        },
      });

      const images = await fetchProductImagesUntilChanged(
        admin,
        decodedId,
        previousImages.length,
        { expectIncrease: true },
      );

      if (mediaStatuses.includes("FAILED")) {
        return {
          status: "ai_image_error" as const,
          message:
            "Shopify accepted the request but failed to process this image. Please try again.",
          images,
        };
      }

      if (mediaStatuses.includes("PROCESSING") && images.length <= previousImages.length) {
        return {
          status: "image_processing" as const,
          appliedMode: "auto" as const,
          images,
        };
      }

      return {
        status: "image_generated" as const,
        appliedMode: "auto" as const,
        images,
      };
    }

    return {
      status: "image_preview" as const,
      imageUrl,
      productTitle,
      images: previousImages,
    };
  }

  if (intent === "apply_ai_image") {
    const { admin, session } = await authenticate.admin(request);
    const partnerDevelopment = await isPartnerDevelopmentStore(admin);
    const decodedId = productGidFromRouteParam(params.id);

    if (!decodedId) return null;

    const shopDomain = session.shop;

    const usage = await prisma.storeUsage.upsert({
      where: { shop: shopDomain },
      update: {},
      create: { shop: shopDomain },
    });

    if (!partnerDevelopment && !planImageAllowed(getEffectivePlan(usage))) {
      return { status: "image_plan_required" as const };
    }

    if (usage.aiImageUsed >= AI_IMAGE_MONTHLY_INCLUDED) {
      return { status: "image_quota_exceeded" as const };
    }

    const imageUrl = String(formData.get("imageUrl") || "");
    const productTitle = String(formData.get("productTitle") || "").slice(0, 512);

    if (!imageUrl) {
      return {
        status: "ai_image_error" as const,
        message: "Missing AI image URL. Please generate a new image.",
      };
    }

    const previousImages = await fetchProductImages(admin, decodedId);

    const mediaResponse = await admin.graphql(
      `#graphql
        mutation AiSeoAddAiProductImage($productId: ID!, $media: [CreateMediaInput!]!) {
          productCreateMedia(productId: $productId, media: $media) {
            media {
              status
            }
            mediaUserErrors {
              field
              message
            }
          }
        }`,
      {
        variables: {
          productId: decodedId,
          media: [
            {
              originalSource: imageUrl,
              mediaContentType: "IMAGE",
              alt: productTitle ? `AI generated: ${productTitle}` : "AI generated image",
            },
          ],
        },
      },
    );

    const mediaJson = await mediaResponse.json();
    const mediaErrors = mediaJson.data?.productCreateMedia?.mediaUserErrors ?? [];
    const mediaStatuses = (
      mediaJson.data?.productCreateMedia?.media ?? []
    ).map((m: { status?: string }) => m.status);

    if (mediaErrors.length > 0) {
      return {
        status: "ai_image_error" as const,
        message: mediaErrors[0]?.message || "Could not add AI image to the product.",
      };
    }

    if (mediaStatuses.includes("FAILED")) {
      return {
        status: "ai_image_error" as const,
        message:
          "Shopify accepted the request but failed to process this image. Please try again.",
      };
    }

    await prisma.storeUsage.update({
      where: { shop: shopDomain },
      data: {
        usedCredits: { increment: 1 },
        aiImageUsed: { increment: 1 },
      },
    });

    const images = await fetchProductImagesUntilChanged(
      admin,
      decodedId,
      previousImages.length,
      { expectIncrease: true },
    );

    if (mediaStatuses.includes("PROCESSING") && images.length <= previousImages.length) {
      return {
        status: "image_processing" as const,
        appliedMode: "manual" as const,
        images,
      };
    }

    return {
      status: "image_generated" as const,
      appliedMode: "manual" as const,
      images,
    };
  }

  if (intent === "apply") {
    const { admin, session } = await authenticate.admin(request);
    const decodedId = productGidFromRouteParam(params.id);

    if (!decodedId) return null;

    const descriptionHtml = formData.get("descriptionHtml");
    const seoTitle = formData.get("seoTitle");
    const seoDescription = formData.get("seoDescription");

    const response = await admin.graphql(
      `#graphql
        mutation AiSeoUpdateProduct(
          $id: ID!
          $descriptionHtml: String!
          $seoTitle: String!
          $seoDescription: String!
        ) {
          productUpdate(
            input: {
              id: $id
              descriptionHtml: $descriptionHtml
              seo: { title: $seoTitle, description: $seoDescription }
            }
          ) {
            product {
              handle
              onlineStoreUrl
            }
            userErrors {
              field
              message
            }
          }
        }`,
      {
        variables: {
          id: decodedId,
          descriptionHtml,
          seoTitle,
          seoDescription,
        },
      },
    );

    const json = await response.json();
    const userErrors = json.data?.productUpdate?.userErrors ?? [];

    const applySource =
      formData.get("applySource") === "manual" ? ("manual" as const) : ("ai" as const);

    if (userErrors.length > 0) {
      return { status: "error" as const, userErrors, applySource };
    }

    try {
      const { maybeAutoPingProductUrl, buildProductOnlineStoreUrl } =
        await import("../indexnow.server");
      const product = json.data?.productUpdate?.product as
        | { handle?: string; onlineStoreUrl?: string | null }
        | undefined;
      const pingUrl =
        product?.onlineStoreUrl ||
        (await buildProductOnlineStoreUrl(
          session.shop,
          product?.handle,
          admin,
        ));
      await maybeAutoPingProductUrl(session.shop, pingUrl);
    } catch (error) {
      console.error("IndexNow ping after SEO apply failed", error);
    }

    return { status: "applied" as const, applySource };
  }

  if (intent === "add_images") {
    const { admin } = await authenticate.admin(request);
    const decodedId = productGidFromRouteParam(params.id);

    if (!decodedId) return null;

    const imageUrlsRaw = String(formData.get("imageUrls") || "");
    const imageUrls = imageUrlsRaw
      .split("\n")
      .map((url) => url.trim())
      .filter((url) => /^https?:\/\//.test(url));

    if (imageUrls.length === 0) {
      return {
        status: "image_error" as const,
        message:
          "Please provide at least one valid image URL (https://...). One URL per line.",
      };
    }

    const previousImages = await fetchProductImages(admin, decodedId);

    const response = await admin.graphql(
      `#graphql
        mutation AiSeoAddProductImages($productId: ID!, $media: [CreateMediaInput!]!) {
          productCreateMedia(productId: $productId, media: $media) {
            media {
              alt
              mediaContentType
              status
            }
            mediaUserErrors {
              field
              message
            }
            product {
              id
            }
          }
        }`,
      {
        variables: {
          productId: decodedId,
          media: imageUrls.map((url) => ({
            originalSource: url,
            mediaContentType: "IMAGE",
            alt: "Product image",
          })),
        },
      },
    );

    const json = await response.json();
    const userErrors = json.data?.productCreateMedia?.mediaUserErrors ?? [];

    if (userErrors.length > 0) {
      return {
        status: "image_error" as const,
        message: userErrors[0]?.message || "Could not add images.",
      };
    }

    const images = await fetchProductImagesUntilChanged(
      admin,
      decodedId,
      previousImages.length,
      { expectIncrease: true },
    );

    return {
      status: "images_added" as const,
      addedCount: imageUrls.length,
      images,
    };
  }

  if (intent === "remove_image") {
    const { admin } = await authenticate.admin(request);
    const decodedId = productGidFromRouteParam(params.id);
    const mediaId = String(formData.get("mediaId") || "");

    if (!decodedId || !mediaId) return null;

    const previousImages = await fetchProductImages(admin, decodedId);

    const response = await admin.graphql(
      `#graphql
        mutation AiSeoDeleteProductMedia($productId: ID!, $mediaIds: [ID!]!) {
          productDeleteMedia(productId: $productId, mediaIds: $mediaIds) {
            deletedMediaIds
            mediaUserErrors {
              field
              message
            }
          }
        }`,
      {
        variables: {
          productId: decodedId,
          mediaIds: [mediaId],
        },
      },
    );

    const json = (await response.json()) as {
      data?: {
        productDeleteMedia?: {
          deletedMediaIds?: string[];
          mediaUserErrors?: Array<{ message?: string }>;
        };
      };
      errors?: Array<{ message?: string }>;
    };

    if (json.errors?.length) {
      return {
        status: "image_error" as const,
        message: json.errors[0]?.message || "Could not remove image.",
      };
    }

    const userErrors = json.data?.productDeleteMedia?.mediaUserErrors ?? [];
    if (userErrors.length > 0) {
      return {
        status: "image_error" as const,
        message: userErrors[0]?.message || "Could not remove image.",
      };
    }

    const images = await fetchProductImagesUntilChanged(
      admin,
      decodedId,
      previousImages.length,
      { expectIncrease: false },
    );

    return {
      status: "image_removed" as const,
      images,
    };
  }

  if (intent === "upload_images") {
    try {
      const { admin } = await authenticate.admin(request);
      const decodedId = productGidFromRouteParam(params.id);

      if (!decodedId) return null;

      const files = formData
        .getAll("images")
        .filter((value): value is File => value instanceof File && value.size > 0);

      if (files.length === 0) {
        return {
          status: "image_error" as const,
          message: "Please select at least one image file to upload.",
        };
      }

      const previousImages = await fetchProductImages(admin, decodedId);

      const stagedResponse = await admin.graphql(
        `#graphql
          mutation AiSeoStagedUploadsCreate($input: [StagedUploadInput!]!) {
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
      const stagedTargets = stagedJson.data?.stagedUploadsCreate?.stagedTargets ?? [];

      if (stagedErrors.length > 0 || stagedTargets.length !== files.length) {
        return {
          status: "image_error" as const,
          message: stagedErrors[0]?.message || "Could not prepare image uploads.",
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
            status: "image_error" as const,
            message: "Failed while uploading one of the selected images.",
          };
        }

        uploadedResourceUrls.push(target.resourceUrl);
      }

      const createMediaResponse = await admin.graphql(
        `#graphql
          mutation AiSeoCreateProductMedia($productId: ID!, $media: [CreateMediaInput!]!) {
            productCreateMedia(productId: $productId, media: $media) {
              mediaUserErrors {
                field
                message
              }
            }
          }`,
        {
          variables: {
            productId: decodedId,
            media: uploadedResourceUrls.map((resourceUrl) => ({
              originalSource: resourceUrl,
              mediaContentType: "IMAGE",
              alt: "Uploaded product image",
            })),
          },
        },
      );

      const createMediaJson = await createMediaResponse.json();
      const createMediaErrors =
        createMediaJson.data?.productCreateMedia?.mediaUserErrors ?? [];

      if (createMediaErrors.length > 0) {
        return {
          status: "image_error" as const,
          message: createMediaErrors[0]?.message || "Could not attach images to product.",
        };
      }

      const images = await fetchProductImagesUntilChanged(
        admin,
        decodedId,
        previousImages.length,
        { expectIncrease: true },
      );

      return {
        status: "images_uploaded" as const,
        uploadedCount: uploadedResourceUrls.length,
        images,
      };
    } catch (error) {
      return {
        status: "image_error" as const,
        message:
          error instanceof Error
            ? error.message
            : "Unexpected error while uploading images.",
      };
    }
  }

  return null;
};

export default function ProductPage() {
  const { product, otherProducts, usage, shopifyError } =
    useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const revalidator = useRevalidator();
  const uploadFileInputRef = useRef<HTMLInputElement>(null);
  const [uploadFileCount, setUploadFileCount] = useState(0);
  const [autoAttachAiImage, setAutoAttachAiImage] = useState(false);
  const [imageBackground, setImageBackground] = useState(
    "Clean white studio background",
  );
  const [imageDescription, setImageDescription] = useState("");
  const [displayImages, setDisplayImages] = useState<ProductImageNode[]>(
    product?.images?.nodes ?? [],
  );
  const loaderImageKey = (product?.images?.nodes ?? []).map((img) => img.id).join("|");
  const removingMediaId =
    fetcher.state !== "idle" &&
    fetcher.formData?.get("intent") === "remove_image"
      ? String(fetcher.formData.get("mediaId") || "")
      : "";

  useEffect(() => {
    setDisplayImages(product?.images?.nodes ?? []);
  }, [product?.id, loaderImageKey, product?.images?.nodes]);

  useEffect(() => {
    if (fetcher.data?.status === "images_uploaded") {
      setUploadFileCount(0);
      if (uploadFileInputRef.current) uploadFileInputRef.current.value = "";
    }
  }, [fetcher.data?.status]);

  useEffect(() => {
    const data = fetcher.data;
    if (!data || !("images" in data) || !Array.isArray(data.images)) return;
    setDisplayImages(data.images);
  }, [fetcher.data]);

  useEffect(() => {
    if (fetcher.data?.status === "image_error") {
      setDisplayImages(product?.images?.nodes ?? []);
    }
  }, [fetcher.data?.status, loaderImageKey, product?.images?.nodes]);

  useEffect(() => {
    const status = fetcher.data?.status;
    if (
      status !== "image_generated" &&
      status !== "image_processing" &&
      status !== "images_added" &&
      status !== "images_uploaded" &&
      status !== "image_removed"
    ) {
      return;
    }

    revalidator.revalidate();

    if (status !== "image_processing") return;

    const timers = [1500, 3500, 6000].map((ms) =>
      window.setTimeout(() => {
        revalidator.revalidate();
      }, ms),
    );
    return () => {
      for (const timer of timers) window.clearTimeout(timer);
    };
  }, [fetcher.data, revalidator]);

  const isUploadSubmitting =
    fetcher.state === "submitting" &&
    fetcher.formData?.get("intent") === "upload_images";
  const isGeneratingImage =
    fetcher.state === "submitting" &&
    (fetcher.formData?.get("intent") === "generate_image" ||
      fetcher.formData?.get("intent") === "generate_image_auto");
  const isApplyingAiImage =
    fetcher.state === "submitting" &&
    fetcher.formData?.get("intent") === "apply_ai_image";
  const isGeneratingSeo =
    fetcher.state === "submitting" &&
    fetcher.formData?.get("intent") === "generate";
  const isSavingManualSeo =
    fetcher.state === "submitting" &&
    fetcher.formData?.get("intent") === "apply" &&
    fetcher.formData?.get("applySource") === "manual";
  const isSavingAiSeoToProduct =
    fetcher.state === "submitting" &&
    fetcher.formData?.get("intent") === "apply" &&
    fetcher.formData?.get("applySource") !== "manual";
  const aiResult = fetcher.data?.ai;

  if (!product) {
    return (
      <div>
        <s-page
          heading={shopifyError ? "Could not load product" : "Product not found"}
        >
          <s-section>
            <EmbeddedNavLink hrefPathname="/app/products">
              ← Back to product list
            </EmbeddedNavLink>
          </s-section>
          {shopifyError ? (
            <s-section heading="Connection problem">
              <s-text tone="critical">{shopifyError}</s-text>
              <s-text tone="neutral">
                This usually means the machine running your app cannot reach
                Shopify over HTTPS (offline Wi‑Fi, corporate firewall, VPN, or
                WSL networking). The admin session is fine; the outbound request
                failed before Shopify replied.
              </s-text>
            </s-section>
          ) : (
            <s-section>
              <s-paragraph>
                We couldn&apos;t find this product. Try navigating from the
                products list again.
              </s-paragraph>
            </s-section>
          )}
        </s-page>
      </div>
    );
  }

  return (
    <div>
    <s-page heading={`Optimize: ${product.title}`}>
      <div className="seoi-page-hero">
        <div className="seoi-page-hero__content">
          <span className="seoi-eyebrow">Product optimization</span>
          <h2>{product.title}</h2>
          <p>
            Improve content, metadata, ALT text, imagery, and inventory from one
            focused product workspace.
          </p>
        </div>
        <span className="seoi-status">{product.status}</span>
      </div>

      <s-section>
        <EmbeddedNavLink hrefPathname="/app/products">
          ← Back to product list
        </EmbeddedNavLink>
      </s-section>
      <s-section>
        <s-stack direction="block" gap="base">
          <s-text tone="neutral">
            AI used: {usage.aiUsed} / {usage.freeQuotaLimit}
            {usage.plan === "seo_image"
                ? " (SEO Pro Plus Image)"
                : usage.plan === "seo"
                  ? " (AI SEO Starter)"
                  : usage.plan === "image"
                    ? " (SEO Pro Plus Image)"
                    : " (SEO Starter Free)"}
          </s-text>
          {usage.partnerDevelopment ? (
            <s-text tone="neutral">
              Development store detected. Billing checks are bypassed for testing.
            </s-text>
          ) : null}
          {usage.partnerDevelopment || planImageAllowed(usage.plan) ? (
            <s-text tone="neutral">
              AI images this month: {usage.aiImageUsed} / {usage.aiImageMonthlyLimit}
            </s-text>
          ) : null}
        </s-stack>
      </s-section>
      <s-section heading="Current product content">
        <s-text tone="neutral">
          Shop inventory (available, summed across all locations):{" "}
          {product.availableStockSum}
        </s-text>
        <s-text font-weight="bold">Description</s-text>
        <s-box
          padding="base"
          borderWidth="base"
          borderRadius="base"
          background="subdued"
        >
          <div
            style={{ whiteSpace: "pre-wrap" }}
            dangerouslySetInnerHTML={{
              __html: product.descriptionHtml || "<p>No description yet.</p>",
            }}
          />
        </s-box>

        <s-stack direction="block" gap="base">
          <s-text font-weight="bold">Current images</s-text>
          {displayImages.length ? (
            <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
              {displayImages.map((img) => (
                <div
                  key={img.id}
                  style={{
                    position: "relative",
                    width: 72,
                    height: 72,
                  }}
                >
                  <img
                    src={img.url}
                    alt={img.altText || product.title}
                    style={{
                      width: 72,
                      height: 72,
                      objectFit: "cover",
                      borderRadius: 8,
                      border: "1px solid #ddd",
                      display: "block",
                    }}
                  />
                  <button
                    type="button"
                    aria-label="Remove image"
                    disabled={Boolean(removingMediaId)}
                    onClick={() => {
                      setDisplayImages((prev) =>
                        prev.filter((image) => image.id !== img.id),
                      );
                      fetcher.submit(
                        { intent: "remove_image", mediaId: img.id },
                        { method: "post" },
                      );
                    }}
                    style={{
                      position: "absolute",
                      top: -6,
                      right: -6,
                      width: 22,
                      height: 22,
                      borderRadius: 999,
                      border: "1px solid #fecaca",
                      background: "#fee2e2",
                      color: "#991b1b",
                      fontSize: 12,
                      fontWeight: 700,
                      lineHeight: 1,
                      cursor: removingMediaId ? "not-allowed" : "pointer",
                      opacity: removingMediaId === img.id ? 0.6 : 1,
                    }}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <s-text tone="neutral">No images found for this product.</s-text>
          )}
          {fetcher.data?.status === "image_removed" ? (
            <s-text tone="success">Image removed from this product.</s-text>
          ) : null}

          <s-text font-weight="bold">SEO title</s-text>
          <s-text>
            {product.seo?.title || "No SEO title set. AI will suggest one."}
          </s-text>

          <s-text font-weight="bold">SEO description</s-text>
          <s-text>
            {product.seo?.description ||
              "No SEO description set. AI will suggest one."}
          </s-text>
        </s-stack>
      </s-section>

      <s-section heading="AI SEO">
        <s-stack direction="block" gap="base">
          {fetcher.data?.status === "quota_exceeded" && (
            <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
              <s-text tone="critical">
                Your free AI quota is over. Upgrade to AI SEO Starter to continue AI generation.
              </s-text>
              <div style={{ marginTop: "0.5rem" }}>
                <EmbeddedNavLink
                  hrefPathname="/app/billing/plans"
                  style={{ fontWeight: 600, textDecoration: "underline", color: "#1d4ed8" }}
                >
                  Open Plans and billing
                </EmbeddedNavLink>
              </div>
            </s-box>
          )}

          <button
            type="button"
            disabled={isGeneratingSeo}
            onClick={() => {
              fetcher.submit({ intent: "generate" }, { method: "post" });
            }}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.5rem",
              backgroundColor: "#2563eb",
              borderColor: "#2563eb",
              color: "#ffffff",
              borderWidth: 1,
              borderStyle: "solid",
              borderRadius: 8,
              padding: "0.6rem 1rem",
              fontWeight: 600,
              fontSize: "0.875rem",
              cursor: isGeneratingSeo ? "not-allowed" : "pointer",
              opacity: isGeneratingSeo ? 0.9 : 1,
            }}
          >
            {isGeneratingSeo ? (
              <>
                <AiSpinner size={16} variant="onDark" aria-hidden />
                Generating…
              </>
            ) : (
              "Generate SEO with AI"
            )}
          </button>

          {fetcher.data?.status === "applied" &&
            fetcher.data.applySource !== "manual" && (
            <s-text tone="success">
              AI SEO changes saved to the product in Shopify.
            </s-text>
          )}

          {fetcher.data?.status === "error" &&
            fetcher.data.applySource !== "manual" && (
            <s-text tone="critical">
              Could not save changes:{" "}
              {fetcher.data.userErrors?.[0]?.message || "Unknown error"}
            </s-text>
          )}

          {aiResult && (
            <>
              <s-heading>AI description</s-heading>
              <s-box
                padding="base"
                borderWidth="base"
                borderRadius="base"
                background="subdued"
              >
                <div
                  dangerouslySetInnerHTML={{
                    __html: aiResult.descriptionHtml,
                  }}
                />
              </s-box>

              <s-heading>AI SEO title</s-heading>
              <s-text>{aiResult.seoTitle}</s-text>

              <s-heading>AI SEO description</s-heading>
              <s-text>{aiResult.seoDescription}</s-text>

              <button
                type="button"
                disabled={isSavingAiSeoToProduct}
                onClick={() => {
                  fetcher.submit(
                    {
                      intent: "apply",
                      applySource: "ai",
                      descriptionHtml: aiResult.descriptionHtml,
                      seoTitle: aiResult.seoTitle,
                      seoDescription: aiResult.seoDescription,
                    },
                    { method: "post" },
                  );
                }}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "0.5rem",
                  backgroundColor: "#2563eb",
                  borderColor: "#2563eb",
                  color: "#ffffff",
                  borderWidth: 1,
                  borderStyle: "solid",
                  borderRadius: 8,
                  padding: "0.55rem 1rem",
                  fontWeight: 600,
                  fontSize: "0.875rem",
                  cursor: isSavingAiSeoToProduct ? "not-allowed" : "pointer",
                  opacity: isSavingAiSeoToProduct ? 0.9 : 1,
                }}
              >
                {isSavingAiSeoToProduct ? (
                  <>
                    <AiSpinner size={16} variant="onDark" aria-hidden />
                    Saving…
                  </>
                ) : (
                  "Save to product"
                )}
              </button>

            </>
          )}
        </s-stack>
      </s-section>

      <s-section heading="Generate Image AI">
        <s-stack direction="block" gap="base">
          <s-text tone="neutral">
            Create a new product photo with AI and attach it to this product.
            Describe the background and any extras (logo, packaging, lifestyle
            scene) before generating.
          </s-text>

          <label style={{ display: "grid", gap: "0.35rem" }}>
            <s-text font-weight="bold">Background</s-text>
            <input
              type="text"
              value={imageBackground}
              onChange={(e) => setImageBackground(e.currentTarget.value)}
              placeholder="e.g. Clean white studio, soft wood table, transparent"
              style={{
                width: "100%",
                maxWidth: 520,
                padding: "0.55rem 0.7rem",
                borderRadius: 8,
                border: "1px solid #d1d5db",
                fontSize: "0.875rem",
              }}
            />
          </label>

          <label style={{ display: "grid", gap: "0.35rem" }}>
            <s-text font-weight="bold">Image description</s-text>
            <textarea
              value={imageDescription}
              onChange={(e) => setImageDescription(e.currentTarget.value)}
              rows={3}
              placeholder="e.g. Add brand logo in corner, show product with packaging, lifestyle outdoor shot"
              style={{
                width: "100%",
                maxWidth: 520,
                padding: "0.55rem 0.7rem",
                borderRadius: 8,
                border: "1px solid #d1d5db",
                fontSize: "0.875rem",
                resize: "vertical",
              }}
            />
          </label>

          {(isGeneratingImage || isApplyingAiImage) && (
            <s-box
              padding="base"
              borderWidth="base"
              borderRadius="base"
              background="subdued"
            >
              <div
                className="ai-loading-row"
                style={{ gap: "0.65rem", alignItems: "center" }}
              >
                <AiSpinner
                  size={22}
                  variant="muted"
                  aria-label={
                    isGeneratingImage ? "Generating image" : "Updating product"
                  }
                />
                <s-text font-weight="bold">
                  {isGeneratingImage
                    ? "Generating AI image…"
                    : "Updating product…"}
                </s-text>
              </div>
              <p
                style={{
                  margin: "0.35rem 0 0",
                  color: "var(--p-color-text-secondary, #616161)",
                  fontSize: "0.875rem",
                }}
              >
                {isGeneratingImage
                  ? "Please wait — this usually takes a few seconds."
                  : "Attaching the image to this product in Shopify. Please wait."}
              </p>
            </s-box>
          )}

          {fetcher.data?.status === "image_preview" && fetcher.data.imageUrl && (
            <s-box
              padding="base"
              borderWidth="base"
              borderRadius="base"
              background="subdued"
            >
              <s-text font-weight="bold">AI image preview</s-text>
              <p
                style={{
                  margin: "0.35rem 0 0",
                  color: "var(--p-color-text-success, #008060)",
                  fontSize: "0.875rem",
                }}
              >
                Image created. Review it below, tick the box, then click &quot;Update
                image&quot; to save it to this product.
              </p>
              <div
                style={{
                  marginTop: "0.75rem",
                  display: "flex",
                  gap: "1rem",
                  alignItems: "flex-start",
                  flexWrap: "wrap",
                }}
              >
                <img
                  src={fetcher.data.imageUrl}
                  alt={fetcher.data.productTitle || product.title}
                  style={{
                    width: 160,
                    height: 160,
                    objectFit: "cover",
                    borderRadius: 12,
                    border: "1px solid #d0d4d9",
                    background: "#fff",
                  }}
                />
                <div style={{ flex: "1 1 180px", minWidth: "180px" }}>
                  <s-text tone="neutral">
                    Tick to confirm you want to attach this AI image to the product, then
                    click Update image.
                  </s-text>
                  <fetcher.Form method="post">
                    <input type="hidden" name="intent" value="apply_ai_image" />
                    <input
                      type="hidden"
                      name="imageUrl"
                      value={fetcher.data.imageUrl}
                    />
                    <input
                      type="hidden"
                      name="productTitle"
                      value={fetcher.data.productTitle || product.title}
                    />
                    <label
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "0.5rem",
                        marginBottom: "0.75rem",
                      }}
                    >
                      <input
                        type="checkbox"
                        name="confirmAttach"
                        value="yes"
                        required
                      />
                      <s-text>Update product images with this AI image</s-text>
                    </label>
                    {/*
                      Native submit: Polaris s-button defaults to type="button" and does not
                      submit fetcher.Form, so "Update image" did nothing after preview.
                    */}
                    <button
                      type="submit"
                      disabled={isApplyingAiImage}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "0.5rem",
                        backgroundColor: "#15803d",
                        borderColor: "#15803d",
                        color: "#ffffff",
                        borderWidth: 1,
                        borderStyle: "solid",
                        borderRadius: 8,
                        padding: "0.55rem 1rem",
                        fontWeight: 600,
                        fontSize: "0.875rem",
                        cursor: isApplyingAiImage ? "not-allowed" : "pointer",
                        opacity: isApplyingAiImage ? 0.88 : 1,
                      }}
                    >
                      {isApplyingAiImage ? (
                        <>
                          <AiSpinner size={16} variant="onDark" aria-hidden />
                          Updating…
                        </>
                      ) : (
                        "Update image"
                      )}
                    </button>
                  </fetcher.Form>
                </div>
              </div>
            </s-box>
          )}

          {fetcher.data?.status === "image_plan_required" && (
            <s-box
              padding="base"
              borderWidth="base"
              borderRadius="base"
              background="subdued"
            >
              <s-text tone="critical">
                AI image generation requires SEO Pro Plus Image ({AI_IMAGE_PLAN_LABEL},{" "}
                {AI_IMAGE_MONTHLY_INCLUDED} images/month).
              </s-text>
              <div style={{ marginTop: "0.5rem" }}>
                <EmbeddedNavLink
                  hrefPathname="/app/billing/plans"
                  style={{ fontWeight: 600, textDecoration: "underline", color: "#1d4ed8" }}
                >
                  Open Plans and billing
                </EmbeddedNavLink>
              </div>
            </s-box>
          )}

          {fetcher.data?.status === "image_quota_exceeded" && (
            <s-box
              padding="base"
              borderWidth="base"
              borderRadius="base"
              background="subdued"
            >
              <s-text tone="critical">
                You have used all {AI_IMAGE_MONTHLY_INCLUDED} AI images for this period.
                Add a top-up or wait for the next billing cycle.
              </s-text>
            </s-box>
          )}

          {fetcher.data?.status === "image_generated" && (
            <s-box
              padding="base"
              borderWidth="base"
              borderRadius="base"
              background="subdued"
            >
              <s-text tone="success" font-weight="bold">
                {fetcher.data.appliedMode === "auto"
                  ? "Product updated automatically"
                  : "Product updated"}
              </s-text>
              <p
                style={{
                  margin: "0.35rem 0 0",
                  color: "var(--p-color-text-success, #008060)",
                  fontSize: "0.875rem",
                }}
              >
                {fetcher.data.appliedMode === "auto"
                  ? "The AI image was added to this product. Current images above are updated."
                  : "The AI image was attached to this product. Current images above are updated."}
              </p>
            </s-box>
          )}

          {fetcher.data?.status === "image_processing" && (
            <s-box
              padding="base"
              borderWidth="base"
              borderRadius="base"
              background="subdued"
            >
              <s-text font-weight="bold">Image processing</s-text>
              <p
                style={{
                  margin: "0.35rem 0 0",
                  color: "var(--p-color-text-secondary, #616161)",
                  fontSize: "0.875rem",
                }}
              >
                Shopify is still processing the image. Current images will refresh
                automatically in a few seconds.
              </p>
            </s-box>
          )}

          {fetcher.data?.status === "ai_image_error" && (
            <s-text tone="critical">{fetcher.data.message}</s-text>
          )}

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.75rem",
              flexWrap: "wrap",
            }}
          >
            <button
              type="button"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.5rem",
                backgroundColor: "#dc2626",
                borderColor: "#b91c1c",
                color: "#ffffff",
                borderWidth: 1,
                borderStyle: "solid",
                borderRadius: 8,
                padding: "0.6rem 1rem",
                fontWeight: 600,
                cursor: isGeneratingImage ? "not-allowed" : "pointer",
                opacity: isGeneratingImage ? 0.75 : 1,
              }}
              disabled={isGeneratingImage}
              onClick={() => {
                fetcher.submit(
                  {
                    intent: autoAttachAiImage
                      ? "generate_image_auto"
                      : "generate_image",
                    background: imageBackground,
                    description: imageDescription,
                  },
                  { method: "post" },
                );
              }}
            >
              {isGeneratingImage ? (
                <>
                  <AiSpinner size={16} variant="onDark" aria-hidden />
                  Generating…
                </>
              ) : (
                "Generate Image with AI"
              )}
            </button>

            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.4rem",
              }}
            >
              <input
                type="checkbox"
                checked={autoAttachAiImage}
                onChange={(e) =>
                  setAutoAttachAiImage(e.currentTarget.checked)
                }
              />
              <s-text>Update automatically (no preview)</s-text>
            </label>
          </div>
        </s-stack>
      </s-section>

      <s-section heading="Update SEO manually">
        <fetcher.Form method="post">
          <s-stack direction="block" gap="base">
            <input type="hidden" name="intent" value="apply" />
            <input type="hidden" name="applySource" value="manual" />

            {isSavingManualSeo && (
              <s-box
                padding="base"
                borderWidth="base"
                borderRadius="base"
                background="subdued"
              >
                <div
                  className="ai-loading-row"
                  style={{ gap: "0.65rem", alignItems: "center" }}
                >
                  <AiSpinner size={22} variant="muted" aria-label="Saving manual SEO" />
                  <s-text font-weight="bold">Saving to Shopify…</s-text>
                </div>
                <p
                  style={{
                    margin: "0.35rem 0 0",
                    color: "var(--p-color-text-secondary, #616161)",
                    fontSize: "0.875rem",
                  }}
                >
                  Updating description and SEO fields on this product.
                </p>
              </s-box>
            )}

            <label>
              <s-text font-weight="bold">Description (HTML)</s-text>
              <textarea
                name="descriptionHtml"
                rows={8}
                defaultValue={product.descriptionHtml || ""}
                style={{ width: "100%", padding: "0.5rem" }}
              />
            </label>

            <label>
              <s-text font-weight="bold">SEO title</s-text>
              <input
                name="seoTitle"
                defaultValue={product.seo?.title || ""}
                style={{ width: "100%", padding: "0.5rem" }}
              />
            </label>

            <label>
              <s-text font-weight="bold">SEO description</s-text>
              <textarea
                name="seoDescription"
                rows={4}
                defaultValue={product.seo?.description || ""}
                style={{ width: "100%", padding: "0.5rem" }}
              />
            </label>

            <button
              type="submit"
              disabled={isSavingManualSeo}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.5rem",
                backgroundColor: "#2563eb",
                borderColor: "#2563eb",
                color: "#ffffff",
                borderWidth: 1,
                borderStyle: "solid",
                borderRadius: 8,
                padding: "0.55rem 1rem",
                fontWeight: 600,
                cursor: isSavingManualSeo ? "not-allowed" : "pointer",
                opacity: isSavingManualSeo ? 0.9 : 1,
              }}
            >
              {isSavingManualSeo ? (
                <>
                  <AiSpinner size={16} variant="onDark" aria-hidden />
                  Saving…
                </>
              ) : (
                "Save manual SEO"
              )}
            </button>

            {fetcher.data?.status === "applied" &&
              fetcher.data.applySource === "manual" && (
                <s-box
                  padding="base"
                  borderWidth="base"
                  borderRadius="base"
                  background="subdued"
                >
                  <s-text tone="success" font-weight="bold">
                    Manual SEO updated
                  </s-text>
                  <p
                    style={{
                      margin: "0.35rem 0 0",
                      color: "var(--p-color-text-success, #008060)",
                      fontSize: "0.875rem",
                    }}
                  >
                    Description and SEO title/description were saved to this product in
                    Shopify.
                  </p>
                </s-box>
              )}

            {fetcher.data?.status === "error" &&
              fetcher.data.applySource === "manual" && (
                <s-text tone="critical">
                  Could not save manual SEO:{" "}
                  {fetcher.data.userErrors?.[0]?.message || "Unknown error"}
                </s-text>
              )}
          </s-stack>
        </fetcher.Form>
      </s-section>

      <s-section heading="Update product images">
        <s-stack direction="block" gap="base">
          <s-text>
            Paste one or more public image URLs (one per line), then add them to
            this product.
          </s-text>
          <textarea
            name="imageUrls"
            form="add-images-form"
            rows={5}
            style={{ width: "100%", padding: "0.5rem" }}
            placeholder={`https://example.com/image-1.jpg\nhttps://example.com/image-2.jpg`}
          />
          <form
            id="add-images-form"
            method="post"
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const formData = new FormData(form);
              formData.set("intent", "add_images");
              fetcher.submit(formData, { method: "post" });
            }}
          >
            <input type="hidden" name="intent" value="add_images" />
            <button
              type="submit"
              disabled={
                fetcher.state === "submitting" &&
                fetcher.formData?.get("intent") === "add_images"
              }
              style={{
                padding: "0.5rem 0.85rem",
                fontWeight: 600,
                borderRadius: 8,
                border: "1px solid #cbd5e1",
                background: "#f3f4f6",
                color: "#111827",
                cursor:
                  fetcher.state === "submitting" &&
                  fetcher.formData?.get("intent") === "add_images"
                    ? "not-allowed"
                    : "pointer",
              }}
            >
              {fetcher.state === "submitting" &&
              fetcher.formData?.get("intent") === "add_images"
                ? "Adding…"
                : "Add images from URLs"}
            </button>
          </form>

          {fetcher.data?.status === "images_added" && (
            <s-text tone="success">
              Images updated successfully. Added {fetcher.data.addedCount} image(s).
            </s-text>
          )}

          {fetcher.data?.status === "image_error" && (
            <s-text tone="critical">{fetcher.data.message}</s-text>
          )}

          <s-text font-weight="bold">Upload from computer</s-text>
          <fetcher.Form method="post" encType="multipart/form-data">
            <s-stack direction="block" gap="base">
              <input type="hidden" name="intent" value="upload_images" />
              <input
                ref={uploadFileInputRef}
                type="file"
                name="images"
                accept="image/*"
                multiple
                onChange={(e) =>
                  setUploadFileCount(e.currentTarget.files?.length ?? 0)
                }
              />
              {uploadFileCount > 0 ? (
                <s-text tone="neutral">
                  {uploadFileCount} image
                  {uploadFileCount === 1 ? "" : "s"} selected — ready to upload
                </s-text>
              ) : null}
              <button
                type="submit"
                disabled={uploadFileCount === 0 || isUploadSubmitting}
                style={{
                  padding: "0.55rem 1rem",
                  fontWeight: 600,
                  borderRadius: 8,
                  borderWidth: 1,
                  borderStyle: "solid",
                  borderColor: uploadFileCount > 0 ? "#2563eb" : "#cbd5e1",
                  backgroundColor: uploadFileCount > 0 ? "#2563eb" : "#f3f4f6",
                  color: uploadFileCount > 0 ? "#ffffff" : "#6b7280",
                  cursor:
                    uploadFileCount === 0 || isUploadSubmitting
                      ? "not-allowed"
                      : "pointer",
                  opacity: uploadFileCount === 0 ? 0.7 : 1,
                }}
              >
                {isUploadSubmitting
                  ? "Uploading images…"
                  : "Upload selected images"}
              </button>
            </s-stack>
          </fetcher.Form>

          {fetcher.data?.status === "images_uploaded" && (
            <s-text tone="success">
              Images updated successfully. Uploaded {fetcher.data.uploadedCount} image(s).
            </s-text>
          )}
        </s-stack>
      </s-section>

      <s-section heading="Other products">
        {otherProducts.length <= 1 ? (
          <p
            style={{
              margin: 0,
              color: "var(--p-color-text-subdued, #6d7175)",
              fontSize: "0.875rem",
            }}
          >
            No other products.{" "}
            <EmbeddedNavLink
              hrefPathname="/app/products"
              style={{
                color: "var(--p-color-text-link, #2c6ecb)",
                fontWeight: 600,
              }}
            >
              View all products
            </EmbeddedNavLink>
          </p>
        ) : (
          <s-stack direction="block" gap="base">
            {otherProducts.map((p) => {
              if (p.id === product.id) return null;
              const pathSeg = productPathSegmentFromGid(p.id);
              const firstImageNode = p.images?.nodes?.[0];
              const firstMediaImage = p.media?.nodes?.find(
                (n) => n.image?.url,
              )?.image;
              const thumbUrl =
                p.featuredImage?.url ||
                firstImageNode?.url ||
                firstMediaImage?.url;
              const thumbAlt =
                p.featuredImage?.altText ||
                firstImageNode?.altText ||
                firstMediaImage?.altText ||
                p.title;
              const hasStoreSeo = Boolean(
                p.seo?.title?.trim() || p.seo?.description?.trim(),
              );
              return (
                <s-box
                  key={p.id}
                  padding="base"
                  borderWidth="base"
                  borderRadius="base"
                  background="subdued"
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "1rem",
                      flexWrap: "wrap",
                    }}
                  >
                    <div
                      style={{
                        flexShrink: 0,
                        width: 56,
                        height: 56,
                        borderRadius: 8,
                        overflow: "hidden",
                        background: "#e3e3e3",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      {thumbUrl ? (
                        <img
                          src={thumbUrl}
                          alt={thumbAlt}
                          style={{
                            width: "100%",
                            height: "100%",
                            objectFit: "cover",
                          }}
                        />
                      ) : (
                        <span
                          style={{
                            fontSize: 24,
                            color: "#8c9196",
                          }}
                          aria-hidden
                        >
                          —
                        </span>
                      )}
                    </div>
                    <div style={{ flex: "1", minWidth: "12rem" }}>
                      <div style={{ display: "block" }}>
                        <EmbeddedNavLink
                          hrefPathname={`/app/products/${pathSeg}`}
                          style={{
                            display: "inline-block",
                            fontWeight: 600,
                            color: "var(--p-color-text-link, #2c6ecb)",
                            textDecoration: "none",
                          }}
                        >
                          {p.title}
                        </EmbeddedNavLink>
                      </div>
                      <p
                        style={{
                          margin: "0.35rem 0 0",
                          fontSize: "0.875rem",
                          color: "var(--p-color-text-subdued, #6d7175)",
                          lineHeight: 1.4,
                        }}
                      >
                        Status: {p.status}
                        {" · "}
                        {hasStoreSeo
                          ? "Storefront SEO set"
                          : "Storefront SEO not set"}
                      </p>
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

