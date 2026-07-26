import { RETRY_DELAYS_MS, MAX_RETRIES } from "./constants";
import { DomainError, type DomainErrorCode, isPermanentFailure } from "./errors";

export function getRetryDelayMs(retryCount: number): number | null {
  if (retryCount >= MAX_RETRIES) return null;
  return RETRY_DELAYS_MS[retryCount] ?? null;
}

export function classifyRetry(
  error: unknown,
  currentRetryCount: number,
): {
  shouldRetry: boolean;
  nextRetryAt: Date | null;
  permanent: boolean;
} {
  if (error instanceof DomainError) {
    if (isPermanentFailure(error.code)) {
      return { shouldRetry: false, nextRetryAt: null, permanent: true };
    }
    if (!error.retryable) {
      return { shouldRetry: false, nextRetryAt: null, permanent: true };
    }
  }

  const delay = getRetryDelayMs(currentRetryCount);
  if (delay === null) {
    return { shouldRetry: false, nextRetryAt: null, permanent: false };
  }

  return {
    shouldRetry: true,
    nextRetryAt: new Date(Date.now() + delay),
    permanent: false,
  };
}

export function errorCodeFromUnknown(error: unknown): DomainErrorCode {
  if (error instanceof DomainError) return error.code;
  return "SHOPIFY_API_ERROR";
}
