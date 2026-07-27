import prisma from "./db.server";

type SessionTokenRow = {
  id: string;
  shop: string;
  accessToken: string;
  refreshToken: string | null;
  expires: Date | null;
  refreshTokenExpires: Date | null;
};

function isExpired(date: Date | null | undefined, skewMs = 60_000): boolean {
  if (!date) return false;
  return date.getTime() <= Date.now() + skewMs;
}

/**
 * Ensure an offline Session has a usable access token.
 * With expiringOfflineAccessTokens, tokens expire ~1 hour and must be refreshed.
 */
export async function ensureFreshOfflineAccessToken(
  session: SessionTokenRow,
): Promise<string | null> {
  if (session.accessToken && !isExpired(session.expires)) {
    return session.accessToken;
  }

  if (!session.refreshToken) return session.accessToken || null;
  if (isExpired(session.refreshTokenExpires, 0)) return null;

  const clientId = process.env.SHOPIFY_API_KEY?.trim();
  const clientSecret = process.env.SHOPIFY_API_SECRET?.trim();
  if (!clientId || !clientSecret) return null;

  try {
    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: session.refreshToken,
    });
    const res = await fetch(`https://${session.shop}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error("[shop-access] refresh failed", session.shop, res.status, text);
      return null;
    }
    const json = (await res.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      refresh_token_expires_in?: number;
    };
    if (!json.access_token) return null;

    const now = Date.now();
    await prisma.session.update({
      where: { id: session.id },
      data: {
        accessToken: json.access_token,
        refreshToken: json.refresh_token || session.refreshToken,
        expires: json.expires_in ? new Date(now + json.expires_in * 1000) : null,
        refreshTokenExpires: json.refresh_token_expires_in
          ? new Date(now + json.refresh_token_expires_in * 1000)
          : session.refreshTokenExpires,
      },
    });
    return json.access_token;
  } catch (error) {
    console.error("[shop-access] refresh error", session.shop, error);
    return null;
  }
}
