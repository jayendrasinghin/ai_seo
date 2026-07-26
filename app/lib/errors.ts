import { randomUUID } from "node:crypto";

export type DomainErrorCode =
  | "PAYPAL_NOT_CONNECTED"
  | "PAYPAL_MAPPING_MISSING"
  | "PAYPAL_AUTH_FAILED"
  | "PAYPAL_ORDER_NOT_FOUND"
  | "PAYPAL_TRACKING_VALIDATION_FAILED"
  | "UNSUPPORTED_CARRIER"
  | "SHOPIFY_RATE_LIMIT"
  | "SHOPIFY_API_ERROR"
  | "DUPLICATE_WEBHOOK"
  | "RETRY_EXHAUSTED"
  | "VALIDATION_ERROR"
  | "NOT_FOUND";

const ERROR_CATALOG: Record<
  DomainErrorCode,
  { title: string; explanation: string; action: string }
> = {
  PAYPAL_NOT_CONNECTED: {
    title: "PayPal is not connected",
    explanation:
      "PaySync needs PayPal credentials before it can send tracking updates.",
    action: "Connect PayPal on the PayPal connection page.",
  },
  PAYPAL_MAPPING_MISSING: {
    title: "PayPal order mapping is required",
    explanation:
      "We could not find a PayPal order ID linked to this Shopify order.",
    action: "Map the PayPal order from the order details page.",
  },
  PAYPAL_AUTH_FAILED: {
    title: "PayPal authentication failed",
    explanation:
      "PayPal rejected the stored credentials. Tracking sync is paused.",
    action: "Re-enter PayPal credentials and test the connection.",
  },
  PAYPAL_ORDER_NOT_FOUND: {
    title: "PayPal order not found",
    explanation:
      "The mapped PayPal order ID does not exist in your PayPal account.",
    action: "Verify the PayPal order ID and update the mapping.",
  },
  PAYPAL_TRACKING_VALIDATION_FAILED: {
    title: "PayPal rejected the tracking details",
    explanation:
      "PayPal could not accept this tracking number or carrier combination.",
    action: "Review the tracking number and carrier, then retry.",
  },
  UNSUPPORTED_CARRIER: {
    title: "Carrier needs manual mapping",
    explanation:
      "This carrier is not in PayPal's standard list. PaySync will send it as OTHER.",
    action: "Add a carrier mapping in Settings if needed.",
  },
  SHOPIFY_RATE_LIMIT: {
    title: "Shopify rate limit reached",
    explanation: "Shopify temporarily limited API requests.",
    action: "PaySync will retry automatically.",
  },
  SHOPIFY_API_ERROR: {
    title: "Shopify API error",
    explanation: "An error occurred while updating this order in Shopify.",
    action: "Retry the sync or contact support with the correlation ID.",
  },
  DUPLICATE_WEBHOOK: {
    title: "Duplicate webhook ignored",
    explanation: "This webhook was already processed.",
    action: "No action needed.",
  },
  RETRY_EXHAUSTED: {
    title: "Sync retries exhausted",
    explanation:
      "PaySync retried this shipment multiple times without success.",
    action: "Review the error details and retry manually when resolved.",
  },
  VALIDATION_ERROR: {
    title: "Invalid request",
    explanation: "The submitted data failed validation.",
    action: "Correct the highlighted fields and try again.",
  },
  NOT_FOUND: {
    title: "Not found",
    explanation: "The requested resource does not exist.",
    action: "Refresh the page or return to the dashboard.",
  },
};

export class DomainError extends Error {
  readonly code: DomainErrorCode;
  readonly correlationId: string;
  readonly retryable: boolean;
  readonly statusCode: number;

  constructor(
    code: DomainErrorCode,
    options?: {
      message?: string;
      correlationId?: string;
      retryable?: boolean;
      statusCode?: number;
      cause?: unknown;
    },
  ) {
    const catalog = ERROR_CATALOG[code];
    super(options?.message ?? catalog.explanation);
    this.name = "DomainError";
    this.code = code;
    this.correlationId = options?.correlationId ?? randomUUID();
    this.retryable = options?.retryable ?? isRetryable(code);
    this.statusCode = options?.statusCode ?? statusCodeFor(code);
    if (options?.cause) {
      this.cause = options.cause;
    }
  }

  toMerchantPayload() {
    const catalog = ERROR_CATALOG[this.code];
    return {
      code: this.code,
      title: catalog.title,
      explanation: this.message || catalog.explanation,
      action: catalog.action,
      correlationId: this.correlationId,
      retryable: this.retryable,
    };
  }
}

function isRetryable(code: DomainErrorCode): boolean {
  return [
    "SHOPIFY_RATE_LIMIT",
    "SHOPIFY_API_ERROR",
    "PAYPAL_AUTH_FAILED",
  ].includes(code);
}

function statusCodeFor(code: DomainErrorCode): number {
  switch (code) {
    case "NOT_FOUND":
      return 404;
    case "VALIDATION_ERROR":
    case "PAYPAL_TRACKING_VALIDATION_FAILED":
      return 400;
    case "DUPLICATE_WEBHOOK":
      return 200;
    default:
      return 422;
  }
}

export function isPermanentFailure(code: DomainErrorCode): boolean {
  return [
    "PAYPAL_MAPPING_MISSING",
    "PAYPAL_ORDER_NOT_FOUND",
    "PAYPAL_TRACKING_VALIDATION_FAILED",
    "PAYPAL_NOT_CONNECTED",
    "VALIDATION_ERROR",
  ].includes(code);
}
