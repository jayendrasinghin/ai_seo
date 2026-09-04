/**
 * Visual indent for s-app-nav (Shopify does not support nested nav items).
 * Uses figure spaces so leading padding survives sidebar rendering.
 */
export function appNavLabel(
  text: string,
  indent: 0 | 1 | 2 = 0,
): string {
  // Figure space (U+2007) — wider and less likely trimmed than regular spaces.
  const step = "\u2007\u2007\u2007";
  const pad =
    indent === 0 ? "" : indent === 1 ? step : `${step}${step}`;
  return `${pad}${text}`;
}
