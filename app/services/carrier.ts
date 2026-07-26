/** PayPal-supported carrier codes mapped from common Shopify carrier names */
const CARRIER_MAP: Record<string, string> = {
  usps: "USPS",
  "united states postal service": "USPS",
  ups: "UPS",
  "united parcel service": "UPS",
  fedex: "FEDEX",
  "federal express": "FEDEX",
  dhl: "DHL",
  "dhl express": "DHL",
  "dhl ecommerce": "DHL",
  "canada post": "CANADA_POST",
  "royal mail": "ROYAL_MAIL",
  "australia post": "AUSTRALIA_POST",
  "japan post": "JAPAN_POST",
  "china post": "CHINA_POST",
  "la poste": "LA_POSTE",
  "deutsche post": "DEUTSCHE_POST",
  "tnt": "TNT",
  "tnt express": "TNT",
  "ontrac": "ONTRAC",
  "lasership": "LASERSHIP",
  "newgistics": "NEWGISTICS",
  "gls": "GLS",
  "purolator": "PUROLATOR",
  "sf express": "SF_EXPRESS",
  "yanwen": "YANWEN",
  "4px": "FOUR_PX_EXPRESS",
};

export interface NormalizedCarrier {
  carrier: string;
  carrierNameOther?: string;
  isOther: boolean;
}

export function normalizeCarrier(
  rawCarrier: string | null | undefined,
  customMappings: Record<string, string> = {},
): NormalizedCarrier {
  if (!rawCarrier?.trim()) {
    return { carrier: "OTHER", carrierNameOther: "Unknown", isOther: true };
  }

  const original = rawCarrier.trim();
  const key = original.toLowerCase();

  if (customMappings[key]) {
    const mapped = customMappings[key];
    if (mapped === "OTHER") {
      return { carrier: "OTHER", carrierNameOther: original, isOther: true };
    }
    return { carrier: mapped, isOther: false };
  }

  if (CARRIER_MAP[key]) {
    return { carrier: CARRIER_MAP[key], isOther: false };
  }

  for (const [pattern, code] of Object.entries(CARRIER_MAP)) {
    if (key.includes(pattern)) {
      return { carrier: code, isOther: false };
    }
  }

  return { carrier: "OTHER", carrierNameOther: original, isOther: true };
}

export function isValidPayPalOrderId(orderId: string): boolean {
  return /^[A-Z0-9]{10,20}$/i.test(orderId.trim());
}
