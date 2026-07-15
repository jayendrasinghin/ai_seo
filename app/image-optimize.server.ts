import sharp from "sharp";
import prisma from "./db.server";
import { getOrCreateSeoSettings } from "./seo-settings.server";

type AdminGraphql = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

type ProductMedia = {
  productId: string;
  productTitle: string;
  mediaId: string;
  alt: string | null;
  url: string;
  width: number | null;
  height: number | null;
};

const MAX_IMAGES_PER_RUN = 15;

async function listCandidateImages(
  admin: AdminGraphql,
): Promise<ProductMedia[]> {
  const response = await admin.graphql(
    `#graphql
      query ImageOptimizeCandidates {
        products(first: 25, query: "status:active") {
          nodes {
            id
            title
            media(first: 8) {
              nodes {
                ... on MediaImage {
                  id
                  alt
                  image {
                    url
                    width
                    height
                  }
                }
              }
            }
          }
        }
      }`,
  );

  const json = (await response.json()) as {
    data?: {
      products?: {
        nodes?: Array<{
          id: string;
          title?: string;
          media?: {
            nodes?: Array<{
              id?: string;
              alt?: string | null;
              image?: {
                url?: string;
                width?: number | null;
                height?: number | null;
              } | null;
            } | null>;
          };
        }>;
      };
    };
    errors?: { message?: string }[];
  };

  if (json.errors?.length) {
    throw new Error(json.errors[0]?.message || "Failed to list product images.");
  }

  const out: ProductMedia[] = [];
  for (const p of json.data?.products?.nodes ?? []) {
    for (const m of p.media?.nodes ?? []) {
      if (!m?.id || !m.image?.url) continue;
      out.push({
        productId: p.id,
        productTitle: p.title || p.id,
        mediaId: m.id,
        alt: m.alt ?? null,
        url: m.image.url,
        width: m.image.width ?? null,
        height: m.image.height ?? null,
      });
    }
  }
  return out;
}

async function stagedUploadOptimized(
  admin: AdminGraphql,
  filename: string,
  mimeType: string,
  bytes: Buffer,
): Promise<string> {
  const staged = await admin.graphql(
    `#graphql
      mutation ImageOptimizeStagedUpload($input: [StagedUploadInput!]!) {
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
        input: [
          {
            filename,
            mimeType,
            httpMethod: "POST",
            resource: "IMAGE",
            fileSize: String(bytes.length),
          },
        ],
      },
    },
  );

  const stagedJson = (await staged.json()) as {
    data?: {
      stagedUploadsCreate?: {
        stagedTargets?: Array<{
          url?: string;
          resourceUrl?: string;
          parameters?: Array<{ name: string; value: string }>;
        }>;
        userErrors?: Array<{ message?: string }>;
      };
    };
  };

  const errors = stagedJson.data?.stagedUploadsCreate?.userErrors ?? [];
  if (errors.length) {
    throw new Error(errors.map((e) => e.message).filter(Boolean).join(" "));
  }

  const target = stagedJson.data?.stagedUploadsCreate?.stagedTargets?.[0];
  if (!target?.url || !target.resourceUrl) {
    throw new Error("Staged upload target missing.");
  }

  const form = new FormData();
  for (const param of target.parameters ?? []) {
    form.append(param.name, param.value);
  }
  form.append(
    "file",
    new File([new Uint8Array(bytes)], filename, { type: mimeType }),
  );

  const uploadRes = await fetch(target.url, { method: "POST", body: form });
  if (!uploadRes.ok) {
    throw new Error(`Upload failed (HTTP ${uploadRes.status}).`);
  }

  return target.resourceUrl;
}

async function replaceProductImage(
  admin: AdminGraphql,
  productId: string,
  oldMediaId: string,
  resourceUrl: string,
  alt: string | null,
) {
  const create = await admin.graphql(
    `#graphql
      mutation ImageOptimizeCreateMedia($productId: ID!, $media: [CreateMediaInput!]!) {
        productCreateMedia(productId: $productId, media: $media) {
          media {
            ... on MediaImage {
              id
              status
            }
          }
          mediaUserErrors {
            field
            message
          }
        }
      }`,
    {
      variables: {
        productId,
        media: [
          {
            originalSource: resourceUrl,
            alt: alt || "",
            mediaContentType: "IMAGE",
          },
        ],
      },
    },
  );

  const createJson = (await create.json()) as {
    data?: {
      productCreateMedia?: {
        mediaUserErrors?: Array<{ message?: string }>;
      };
    };
  };
  const createErrors =
    createJson.data?.productCreateMedia?.mediaUserErrors ?? [];
  if (createErrors.length) {
    throw new Error(createErrors.map((e) => e.message).filter(Boolean).join(" "));
  }

  const del = await admin.graphql(
    `#graphql
      mutation ImageOptimizeDeleteMedia($productId: ID!, $mediaIds: [ID!]!) {
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
        productId,
        mediaIds: [oldMediaId],
      },
    },
  );

  const delJson = (await del.json()) as {
    data?: {
      productDeleteMedia?: {
        mediaUserErrors?: Array<{ message?: string }>;
      };
    };
  };
  const delErrors = delJson.data?.productDeleteMedia?.mediaUserErrors ?? [];
  if (delErrors.length) {
    throw new Error(delErrors.map((e) => e.message).filter(Boolean).join(" "));
  }
}

/**
 * Compress/resize oversized product images and replace media on Shopify.
 */
export async function runImageOptimizeBatch(admin: AdminGraphql, shop: string) {
  const settings = await getOrCreateSeoSettings(shop);
  const maxWidth = settings.imageMaxWidth || 2048;
  const quality = Math.min(100, Math.max(40, settings.imageQuality || 80));

  const run = await prisma.imageOptimizeRun.create({
    data: { shop, status: "running" },
  });

  try {
    const candidates = await listCandidateImages(admin);
    const toProcess = candidates.slice(0, MAX_IMAGES_PER_RUN);
    let optimized = 0;
    let bytesSaved = 0;
    const items: Array<{
      shop: string;
      runId: string;
      productId: string;
      productTitle: string | null;
      mediaId: string;
      originalUrl: string | null;
      originalBytes: number | null;
      newBytes: number | null;
      status: string;
      message: string | null;
    }> = [];

    for (const media of toProcess) {
      try {
        const already = await prisma.imageOptimizeItem.findFirst({
          where: {
            shop,
            mediaId: media.mediaId,
            status: "optimized",
          },
          orderBy: { createdAt: "desc" },
        });
        // Media IDs change after replace; skip by URL hash of recently optimized originals is weak.
        // Prefer size heuristic: skip if already under maxWidth and we don't know bytes.
        const needsResize =
          typeof media.width === "number" && media.width > maxWidth;

        const response = await fetch(media.url);
        if (!response.ok) {
          items.push({
            shop,
            runId: run.id,
            productId: media.productId,
            productTitle: media.productTitle,
            mediaId: media.mediaId,
            originalUrl: media.url,
            originalBytes: null,
            newBytes: null,
            status: "error",
            message: `Download failed (${response.status}).`,
          });
          continue;
        }

        const originalBuf = Buffer.from(await response.arrayBuffer());
        const originalBytes = originalBuf.length;

        // Skip tiny images unless oversized in pixels.
        if (!needsResize && originalBytes < 180_000) {
          items.push({
            shop,
            runId: run.id,
            productId: media.productId,
            productTitle: media.productTitle,
            mediaId: media.mediaId,
            originalUrl: media.url,
            originalBytes,
            newBytes: originalBytes,
            status: "skipped",
            message: already
              ? "Already optimized previously."
              : "Already small enough.",
          });
          continue;
        }

        let pipeline = sharp(originalBuf).rotate();
        const meta = await pipeline.metadata();
        if ((meta.width || 0) > maxWidth) {
          pipeline = pipeline.resize({
            width: maxWidth,
            withoutEnlargement: true,
          });
        }

        const optimizedBuf = await pipeline
          .jpeg({ quality, mozjpeg: true })
          .toBuffer();

        if (optimizedBuf.length >= originalBytes * 0.97) {
          items.push({
            shop,
            runId: run.id,
            productId: media.productId,
            productTitle: media.productTitle,
            mediaId: media.mediaId,
            originalUrl: media.url,
            originalBytes,
            newBytes: optimizedBuf.length,
            status: "skipped",
            message: "Compression savings too small.",
          });
          continue;
        }

        const filename = `seoi-${Date.now()}-${media.mediaId.split("/").pop()}.jpg`;
        const resourceUrl = await stagedUploadOptimized(
          admin,
          filename,
          "image/jpeg",
          optimizedBuf,
        );

        await replaceProductImage(
          admin,
          media.productId,
          media.mediaId,
          resourceUrl,
          media.alt,
        );

        const saved = originalBytes - optimizedBuf.length;
        bytesSaved += saved;
        optimized += 1;

        items.push({
          shop,
          runId: run.id,
          productId: media.productId,
          productTitle: media.productTitle,
          mediaId: media.mediaId,
          originalUrl: media.url,
          originalBytes,
          newBytes: optimizedBuf.length,
          status: "optimized",
          message: `Saved ${Math.round(saved / 1024)} KB`,
        });
      } catch (error) {
        items.push({
          shop,
          runId: run.id,
          productId: media.productId,
          productTitle: media.productTitle,
          mediaId: media.mediaId,
          originalUrl: media.url,
          originalBytes: null,
          newBytes: null,
          status: "error",
          message: error instanceof Error ? error.message : "Optimize failed.",
        });
      }
    }

    if (items.length) {
      await prisma.imageOptimizeItem.createMany({ data: items });
    }

    await prisma.imageOptimizeRun.update({
      where: { id: run.id },
      data: {
        status: "completed",
        finishedAt: new Date(),
        imagesChecked: toProcess.length,
        imagesOptimized: optimized,
        bytesSaved,
      },
    });

    return {
      runId: run.id,
      imagesChecked: toProcess.length,
      imagesOptimized: optimized,
      bytesSaved,
    };
  } catch (error) {
    await prisma.imageOptimizeRun.update({
      where: { id: run.id },
      data: {
        status: "failed",
        finishedAt: new Date(),
        errorMessage:
          error instanceof Error ? error.message : "Image optimize failed.",
      },
    });
    throw error;
  }
}
