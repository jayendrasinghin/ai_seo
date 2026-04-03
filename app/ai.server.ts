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

  let raw: any = {};
  try {
    const response = await openai.responses.create({
      prompt: { id: OPENAI_PROMPT_ID, version: "1" },
      input: `${systemPrompt}\n\n${userPrompt}`,
      text: { format: { type: "json_object" } },
    });

    if (response.output_text) {
      raw = JSON.parse(response.output_text);
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
        raw = JSON.parse(content);
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
}): Promise<{ imageUrl: string }> {
  const name = (input.title || "Product").trim().slice(0, 200);
  const prompt = `Professional ecommerce product photograph, clean white or neutral studio background, soft commercial lighting, centered composition, ${name}, sharp focus, high-end catalog style, no text or watermarks on the image.`;

  const result = await openai.images.generate({
    model: "dall-e-3",
    prompt,
    n: 1,
    size: "1024x1024",
    quality: "standard",
  });

  const imageUrl = result.data?.[0]?.url;
  if (!imageUrl) {
    throw new Error("No image URL returned from the image model.");
  }

  return { imageUrl };
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

  let parsed: any = {};
  try {
    parsed = JSON.parse(completion.choices[0]?.message?.content || "{}");
  } catch {
    parsed = {};
  }

  const altText =
    (parsed.altText as string | undefined)?.trim().slice(0, 512) ||
    `${productTitle} product image`;

  return { altText };
}

