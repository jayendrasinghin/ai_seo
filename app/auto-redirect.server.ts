import prisma from "./db.server";
import { createUrlRedirect } from "./redirects.server";
import { getOrCreateSeoSettings } from "./seo-settings.server";

type AdminGraphql = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

/**
 * When a product is deleted, optionally create a 301 from /products/{handle}
 * to the configured target (default /collections/all).
 */
export async function maybeAutoRedirectDeletedProduct(
  admin: AdminGraphql,
  shop: string,
  handle: string | null | undefined,
) {
  if (!handle?.trim()) return { created: false as const, reason: "missing_handle" };

  const settings = await getOrCreateSeoSettings(shop);
  if (!settings.autoRedirectOnDelete) {
    return { created: false as const, reason: "disabled" };
  }

  const path = `/products/${handle.trim()}`;
  const target = (settings.autoRedirectTarget || "/collections/all").trim() || "/";

  const result = await createUrlRedirect(admin, path, target);
  if (result.error) {
    // Ignore "already exists" style collisions quietly but log row if useful.
    await prisma.productDeleteRedirect.create({
      data: {
        shop,
        handle: handle.trim(),
        path,
        target: `${target} (failed: ${result.error})`,
      },
    });
    return { created: false as const, reason: result.error };
  }

  await prisma.productDeleteRedirect.create({
    data: {
      shop,
      handle: handle.trim(),
      path,
      target,
    },
  });

  return { created: true as const, path, target };
}
