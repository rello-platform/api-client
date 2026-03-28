/**
 * Retry a function with exponential backoff.
 *
 * Attempt 1: immediate
 * Attempt 2: 1 second delay
 * Attempt 3: 3 second delay
 *
 * Only retries on transient errors (5xx, network failures, timeouts).
 * Client errors (4xx) are thrown immediately.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts: number = 3,
  delays: number[] = [0, 1000, 3000]
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Don't retry client errors (4xx) — they won't succeed on retry
      if (isClientError(error)) {
        throw error;
      }

      // Don't retry on the last attempt
      if (attempt === maxAttempts - 1) {
        break;
      }

      const delay = delays[attempt] ?? delays[delays.length - 1];
      if (delay > 0) {
        await sleep(delay);
      }
    }
  }

  throw lastError;
}

function isClientError(error: unknown): boolean {
  if (error && typeof error === "object" && "statusCode" in error) {
    const code = (error as { statusCode: number }).statusCode;
    return code >= 400 && code < 500;
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
