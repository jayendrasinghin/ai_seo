import OpenAI from "openai";

type AiCopyResult = {
  descriptionHtml: string;
  seoTitle: string;
  seoDescription: string;
};

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});
const OPENAI_PROMPT_ID =
  process.env.OPENAI_PROMPT_ID ||
  "pmpt_69cd0280d378819399ea2685dcf06b6b067c21d9c3b05936";

export async function generateProductCopy(input: {
  title: string;
  currentDescription?: string | null;
}): Promise<AiCopyResult> {
  const baseTitle = input.title || "Your product";
  const plainDescription =
    input.currentDescription && input.currentDescription !== "null"
      ? input.currentDescription.replace(/<[^>]+>/g, "").trim()
      : "";

  const systemPrompt = `
You are an expert ecommerce copywriter.
You write product descriptions and SEO metadata for Shopify products.
Always respond with ONLY valid JSON, no markdown or extra text.
The JSON must have this exact shape:
{
  "descriptionHtml": "<p>...</p>",
  "seoTitle": "string",
  "seoDescription": "string"
}
`;

  const userPrompt = `
Product title: "${baseTitle}"

Current description (may be empty, HTML allowed):
${plainDescription || "(no current description provided)"}
`;

  let raw: Partial<AiCopyResult> = {};
  try {
    const response = await openai.responses.create({
      prompt: { id: OPENAI_PROMPT_ID, version: "1" },
      input: `${systemPrompt}\n\n${userPrompt}`,
      text: { format: { type: "json_object" } },
    });

    if (response.output_text) {
      raw = JSON.parse(response.output_text) as Partial<AiCopyResult>;
    }
  } catch {
    // Fallback path while prompt deployments/versions propagate.
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });

    const content = completion.choices[0]?.message?.content;
    if (content) {
      try {
        raw = JSON.parse(content) as Partial<AiCopyResult>;
      } catch {
        raw = {};
      }
    }
  }

  const descriptionHtml =
    raw.descriptionHtml ||
    `<p>${baseTitle} is designed to help your customers get more value, every day.</p>`;
  const seoTitle = raw.seoTitle || `${baseTitle} | Online Store`;
  const seoDescription =
    raw.seoDescription ||
    `${baseTitle} – discover features, benefits, and reasons customers love it. Optimized for search and written to increase clicks and conversions.`;

  return {
    descriptionHtml,
    seoTitle,
    seoDescription,
  };
}

export async function generateProductImage(input: {
  title: string;
  background?: string | null;
  description?: string | null;
}): Promise<{ imageUrl?: string; imageBase64?: string }> {
  const name = (input.title || "Product").trim().slice(0, 200);
  const background = (input.background || "clean white or neutral studio background")
    .trim()
    .slice(0, 300);
  const extra = (input.description || "").trim().slice(0, 800);
  const extrasClause = extra
    ? ` Extra creative direction: ${extra}.`
    : "";
  const prompt = `Professional ecommerce product photograph of ${name}. Background: ${background}. Soft commercial lighting, centered composition, sharp focus, high-end catalog style.${extrasClause} Do not invent unrelated products. Avoid unwanted watermarks unless the creative direction explicitly requests a brand logo or text.`;

  // dall-e-3 was removed from the OpenAI API (2026). Use GPT Image models.
  const model = process.env.OPENAI_IMAGE_MODEL || "gpt-image-1";

  const result = await openai.images.generate({
    model,
    prompt,
    n: 1,
    size: "1024x1024",
    quality: "medium",
  });

  const imageUrl = result.data?.[0]?.url ?? undefined;
  const imageBase64 = result.data?.[0]?.b64_json ?? undefined;

  if (!imageUrl && !imageBase64) {
    throw new Error("No image returned from the image model.");
  }

  return { imageUrl, imageBase64 };
}

/**
 * Upload AI image bytes to Shopify staged uploads and return a resource URL
 * suitable for productCreateMedia.originalSource.
 */
export async function uploadImageBytesToShopify(
  admin: {
    graphql: (
      query: string,
      options?: { variables?: Record<string, unknown> },
    ) => Promise<Response>;
  },
  bytes: Buffer,
  filename: string,
  mimeType = "image/png",
): Promise<string> {
  const staged = await admin.graphql(
    `#graphql
      mutation AiImageStagedUpload($input: [StagedUploadInput!]!) {
        stagedUploadsCreate(input: $input) {
          stagedTargets {
            url
            resourceUrl
            parameters { name value }
          }
          userErrors { field message }
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
    throw new Error(`Upload to Shopify failed (HTTP ${uploadRes.status}).`);
  }

  return target.resourceUrl;
}

export async function resolveAiImageSource(
  admin: {
    graphql: (
      query: string,
      options?: { variables?: Record<string, unknown> },
    ) => Promise<Response>;
  },
  image: { imageUrl?: string; imageBase64?: string },
): Promise<string> {
  if (image.imageUrl?.startsWith("http")) {
    return image.imageUrl;
  }
  if (image.imageBase64) {
    const bytes = Buffer.from(image.imageBase64, "base64");
    return uploadImageBytesToShopify(
      admin,
      bytes,
      `seoi-ai-${Date.now()}.png`,
      "image/png",
    );
  }
  throw new Error("Missing AI image data.");
}

export async function generateImageAltText(input: {
  productTitle: string;
  currentAlt?: string | null;
}): Promise<{ altText: string }> {
  const productTitle = (input.productTitle || "Product").trim().slice(0, 200);
  const currentAlt = (input.currentAlt || "").trim().slice(0, 300);

  const systemPrompt = `
You write concise, descriptive alt text for ecommerce product images.
Return ONLY valid JSON with this exact shape:
{
  "altText": "string"
}
Rules:
- 6 to 18 words
- Describe the product clearly for accessibility and SEO
- The alt MUST be unique for this product title (do not reuse generic phrases like "product image" alone)
- Mention the product type or key visible detail when possible
- No keyword stuffing
- No marketing phrases like "best" or "buy now"
- No punctuation at the end unless needed
`;

  const userPrompt = `
Product title: "${productTitle}"
Current alt (optional): "${currentAlt || "(empty)"}"
Write a NEW alt that is different from the current alt and specific to this product.
`;

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });

  let parsed: Partial<{ altText: string }> = {};
  try {
    parsed = JSON.parse(
      completion.choices[0]?.message?.content || "{}",
    ) as Partial<{ altText: string }>;
  } catch {
    parsed = {};
  }

  const altText =
    (parsed.altText as string | undefined)?.trim().slice(0, 512) ||
    `${productTitle} product image`;

  return { altText };
}

