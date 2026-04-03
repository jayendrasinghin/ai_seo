import "dotenv/config";
import OpenAI from "openai";

async function main() {
  // const key = process.env.OPENAI_API_KEY; 

  const key=""



  const client = new OpenAI({ apiKey: key });

  const response = await client.responses.create({
    model: "gpt-4.1-mini",
    input: "Reply only with JSON: {\"ok\": true}",
  });

  console.log("Output:", response.output_text);
}

main().catch((err) => {
  console.error("OpenAI test error:", err?.message || err);
  if (err?.code) console.error("code:", err.code);
  if (err?.type) console.error("type:", err.type);
  process.exit(1);
});