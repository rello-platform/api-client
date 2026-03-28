import { RelloUnavailableError } from "./errors.js";

type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

/**
 * Circuit breaker state machine.
 *
 * CLOSED  (normal)     → 5 consecutive failures → OPEN
 * OPEN    (rejecting)  → 30s elapsed           → HALF_OPEN
 * HALF_OPEN (testing)  → success               → CLOSED
 * HALF_OPEN (testing)  → failure               → OPEN
 */
export class CircuitBreaker {
  private state: CircuitState = "CLOSED";
  private failureCount: number = 0;
  private lastFailureTime: number = 0;

  constructor(
    private readonly failureThreshold: number = 5,
    private readonly cooldownMs: number = 30_000
  ) {}

  /**
   * Execute a function through the circuit breaker.
   * Throws RelloUnavailableError if the circuit is open.
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === "OPEN") {
      const elapsed = Date.now() - this.lastFailureTime;
      if (elapsed < this.cooldownMs) {
        const retryAfter = Math.ceil((this.cooldownMs - elapsed) / 1000);
        throw new RelloUnavailableError(
          "Rello is unavailable (circuit breaker open)",
          retryAfter
        );
      }
      // Cooldown elapsed — allow one test request
      this.state = "HALF_OPEN";
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      // Only count server errors (5xx) and network failures toward the
      // circuit breaker threshold. Client errors (4xx) are the caller's
      // fault and should never trip the breaker.
      if (this.isServerError(error)) {
        this.onFailure();
      } else {
        // Client error — still reset the failure count since the server
        // is responding correctly (it rejected a bad request).
        this.onSuccess();
      }
      throw error;
    }
  }

  private onSuccess(): void {
    this.failureCount = 0;
    this.state = "CLOSED";
  }

  private onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.state === "HALF_OPEN") {
      // Test request failed — reopen circuit
      this.state = "OPEN";
    } else if (this.failureCount >= this.failureThreshold) {
      this.state = "OPEN";
    }
  }

  /**
   * Returns true for errors that indicate the server is unhealthy:
   * 5xx status codes, network failures, and timeouts.
   * Returns false for 4xx client errors (the server is fine, the request was bad).
   */
  private isServerError(error: unknown): boolean {
    if (error && typeof error === "object" && "statusCode" in error) {
      const code = (error as { statusCode: number }).statusCode;
      return code >= 500;
    }
    // Network errors, timeouts, and unknown errors are treated as server failures
    return true;
  }

  getState(): CircuitState {
    return this.state;
  }
}
