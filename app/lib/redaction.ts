const SENSITIVE_KEYS = [
  "access_token",
  "accessToken",
  "client_secret",
  "clientSecret",
  "authorization",
  "password",
  "secret",
  "token",
  "refresh_token",
];

export function redactObject<T extends Record<string, unknown>>(
  obj: T,
  depth = 0,
): Record<string, unknown> {
  if (depth > 5) return { _truncated: true };
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (SENSITIVE_KEYS.some((k) => key.toLowerCase().includes(k.toLowerCase()))) {
      result[key] = "[REDACTED]";
    } else if (value && typeof value === "object" && !Array.isArray(value)) {
      result[key] = redactObject(value as Record<string, unknown>, depth + 1);
    } else if (Array.isArray(value)) {
      result[key] = value.map((item) =>
        item && typeof item === "object"
          ? redactObject(item as Record<string, unknown>, depth + 1)
          : item,
      );
    } else {
      result[key] = value;
    }
  }
  return result;
}

export function safeSummary(data: unknown): Record<string, unknown> {
  if (!data || typeof data !== "object") {
    return { value: String(data ?? "") };
  }
  return redactObject(data as Record<string, unknown>);
}
