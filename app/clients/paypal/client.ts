import { decrypt } from "../../lib/encryption";
import { getEnv } from "../../lib/env";
import { DomainError } from "../../lib/errors";
import { logger } from "../../lib/logger";
import { safeSummary } from "../../lib/redaction";
import type { PayPalMode } from "@prisma/client";

interface TokenCache {
  token: string;
  expiresAt: number;
}

const tokenCaches = new Map<string, TokenCache>();

export interface PayPalTrackingPayload {
  tracking_number: string;
  carrier: string;
  carrier_name_other?: string;
  status: "SHIPPED" | "ON_HOLD" | "DELIVERED" | "CANCELLED";
  notify_payer: boolean;
  items?: Array<{
    name: string;
    sku?: string;
    quantity: number;
  }>;
}

export class PayPalClient {
  constructor(
    private readonly shopId: string,
    private readonly paypalMode: PayPalMode,
    private readonly clientId: string,
    private readonly clientSecret: string,
  ) {}

  static fromEncrypted(
    shopId: string,
    mode: PayPalMode,
    encryptedClientId: string,
    encryptedClientSecret: string,
  ): PayPalClient {
    return new PayPalClient(
      shopId,
      mode,
      decrypt(encryptedClientId),
      decrypt(encryptedClientSecret),
    );
  }

  private get baseUrl(): string {
    const env = getEnv();
    return this.paypalMode === "LIVE"
      ? env.PAYPAL_LIVE_BASE_URL
      : env.PAYPAL_SANDBOX_BASE_URL;
  }

  async getAccessToken(): Promise<string> {
    const cacheKey = `${this.shopId}:${this.paypalMode}`;
    const cached = tokenCaches.get(cacheKey);
    if (cached && cached.expiresAt > Date.now() + 60_000) {
      return cached.token;
    }

    const auth = Buffer.from(
      `${this.clientId}:${this.clientSecret}`,
    ).toString("base64");

    const response = await fetch(`${this.baseUrl}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });

    if (!response.ok) {
      logger.warn(
        { shopId: this.shopId, status: response.status },
        "PayPal auth failed",
      );
      throw new DomainError("PAYPAL_AUTH_FAILED", { retryable: true });
    }

    const data = (await response.json()) as {
      access_token: string;
      expires_in: number;
    };

    tokenCaches.set(cacheKey, {
      token: data.access_token,
      expiresAt: Date.now() + data.expires_in * 1000,
    });

    return data.access_token;
  }

  async testConnection(): Promise<boolean> {
    await this.getAccessToken();
    return true;
  }

  async getOrder(paypalOrderId: string): Promise<boolean> {
    const token = await this.getAccessToken();
    const response = await fetch(
      `${this.baseUrl}/v2/checkout/orders/${paypalOrderId}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      },
    );
    if (response.status === 404) return false;
    if (!response.ok) {
      throw new DomainError("PAYPAL_ORDER_NOT_FOUND");
    }
    return true;
  }

  /** Resolve checkout order ID from a PayPal capture, authorization, or sale reference. */
  async resolveCheckoutOrderId(paymentRef: string): Promise<string | null> {
    const token = await this.getAccessToken();
    const trimmed = paymentRef.trim();

    const endpoints = [
      `${this.baseUrl}/v2/payments/captures/${trimmed}`,
      `${this.baseUrl}/v2/payments/authorizations/${trimmed}`,
      `${this.baseUrl}/v2/payments/sales/${trimmed}`,
    ];

    for (const url of endpoints) {
      const orderId = await this.extractOrderIdFromPaymentResource(url, token);
      if (orderId) return orderId;
    }

    if (await this.getOrder(trimmed)) {
      return trimmed.toUpperCase();
    }

    return null;
  }

  private async extractOrderIdFromPaymentResource(
    url: string,
    token: string,
  ): Promise<string | null> {
    try {
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });
      if (!response.ok) return null;

      const data = (await response.json()) as {
        supplementary_data?: {
          related_ids?: { order_id?: string };
        };
        links?: Array<{ rel?: string; href?: string }>;
      };

      const related = data.supplementary_data?.related_ids?.order_id;
      if (related) return related.toUpperCase();

      const upLink = data.links?.find((l) => l.rel === "up" && l.href?.includes("/orders/"));
      if (upLink?.href) {
        const match = upLink.href.match(/\/orders\/([A-Z0-9]+)/i);
        if (match?.[1]) return match[1].toUpperCase();
      }
    } catch {
      return null;
    }
    return null;
  }

  async addTrackingToOrder(
    paypalOrderId: string,
    payload: PayPalTrackingPayload,
  ): Promise<{ trackerId?: string; status: number; summary: Record<string, unknown> }> {
    const token = await this.getAccessToken();

    const body = {
      capture_id: undefined,
      tracking_number: payload.tracking_number,
      carrier: payload.carrier,
      ...(payload.carrier_name_other
        ? { carrier_name_other: payload.carrier_name_other }
        : {}),
      status: payload.status,
      notify_payer: payload.notify_payer,
      ...(payload.items?.length
        ? {
            items: payload.items.map((item) => ({
              name: item.name,
              sku: item.sku,
              quantity: String(item.quantity),
            })),
          }
        : {}),
    };

    const response = await fetch(
      `${this.baseUrl}/v2/checkout/orders/${paypalOrderId}/track`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
    );

    const text = await response.text();
    let summary: Record<string, unknown> = {};
    try {
      summary = safeSummary(JSON.parse(text));
    } catch {
      summary = { raw: text.slice(0, 500) };
    }

    if (response.status === 404) {
      throw new DomainError("PAYPAL_ORDER_NOT_FOUND");
    }

    if (response.status === 422 || response.status === 400) {
      throw new DomainError("PAYPAL_TRACKING_VALIDATION_FAILED", {
        message:
          typeof summary.message === "string"
            ? summary.message
            : "PayPal rejected tracking details",
      });
    }

    if (!response.ok) {
      throw new DomainError("PAYPAL_AUTH_FAILED", { retryable: true });
    }

    const trackerId =
      typeof summary.id === "string" ? summary.id : undefined;

    return { trackerId, status: response.status, summary };
  }
}
