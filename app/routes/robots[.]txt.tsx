import type { LoaderFunctionArgs } from "react-router";

/**
 * Browsers and bots request /robots.txt; without a route the server logs 404 noise.
 * This app is embedded in Shopify Admin — not meant for public indexing.
 */
export async function loader(_args: LoaderFunctionArgs) {
  const body = "User-agent: *\nDisallow: /\n";
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=86400",
    },
  });
}

export default function RobotsTxt() {
  return null;
}
