import type { PlanSwitchError, PlanSwitchOtherError } from "./types/billing-switch.js";

/**
 * Base error class for all Rello API errors.
 */
export class RelloError extends Error {
  public readonly statusCode: number;
  public readonly path: string;
  public readonly requestId: string | null;
  public readonly body: unknown;

  constructor(
    message: string,
    statusCode: number,
    path: string,
    requestId: string | null,
    body: unknown
  ) {
    super(message);
    this.name = "RelloError";
    this.statusCode = statusCode;
    this.path = path;
    this.requestId = requestId;
    this.body = body;
  }
}

/**
 * Thrown when the requested resource does not exist (404).
 */
export class RelloNotFoundError extends RelloError {
  constructor(path: string, requestId: string | null, body: unknown) {
    super(`Not found: ${path}`, 404, path, requestId, body);
    this.name = "RelloNotFoundError";
  }
}

/**
 * Thrown when the API key is invalid, expired, or missing (401).
 */
export class RelloAuthError extends RelloError {
  constructor(path: string, requestId: string | null, body: unknown) {
    super(`Unauthorized: ${path}`, 401, path, requestId, body);
    this.name = "RelloAuthError";
  }
}

/**
 * Thrown when the API key lacks required permissions (403).
 */
export class RelloForbiddenError extends RelloError {
  constructor(path: string, requestId: string | null, body: unknown) {
    super(`Forbidden: ${path}`, 403, path, requestId, body);
    this.name = "RelloForbiddenError";
  }
}

/**
 * Thrown when the request is malformed or invalid (400).
 */
export class RelloValidationError extends RelloError {
  public readonly details: unknown;

  constructor(
    path: string,
    requestId: string | null,
    body: unknown,
    details?: unknown
  ) {
    super(`Validation error: ${path}`, 400, path, requestId, body);
    this.name = "RelloValidationError";
    this.details = details ?? (body as Record<string, unknown>)?.details;
  }
}

/**
 * Thrown when the rate limit has been exceeded (429).
 */
export class RelloRateLimitError extends RelloError {
  public readonly retryAfter: number;

  constructor(
    path: string,
    requestId: string | null,
    body: unknown,
    retryAfter: number
  ) {
    super(`Rate limited: ${path} (retry after ${retryAfter}s)`, 429, path, requestId, body);
    this.name = "RelloRateLimitError";
    this.retryAfter = retryAfter;
  }
}

/**
 * Thrown when Rello is unavailable — either the circuit breaker is open
 * or all retry attempts have been exhausted.
 */
export class RelloUnavailableError extends RelloError {
  public readonly retryAfter: number;

  constructor(message: string, retryAfter: number) {
    super(message, 503, "", null, null);
    this.name = "RelloUnavailableError";
    this.retryAfter = retryAfter;
  }
}

/**
 * A plan-switch route answered 4xx or 5xx (UPGRADE-TO-RELLO §D6, Platform KA prompt 1545). Thrown by
 * `billing.previewPlanSwitch`, `billing.switchPlan` and `billing.getPlanSwitch` in place of the transport's
 * RelloError subclass, which stays reachable as `cause` (e.g. a RelloRateLimitError's `retryAfter`).
 *
 *  - `status`: the HTTP status (the same number as `statusCode`).
 *  - `body`: the answer parsed with `planSwitchErrorSchema`: a dedicated refusal exactly, or the open branch
 *    `{ error, message?, … }` for any other code (a later one included; compare against
 *    PLAN_SWITCH_ERROR_CODES). `null` when the answer is not a plan-switch refusal at all (an HTML 502, an
 *    empty body, a malformed dedicated refusal): there is NO code then, and none is made up.
 *  - `raw`: the body as received (parsed JSON, or the text when it was not JSON; null when empty).
 *
 * A request that got no HTTP answer (timeout, network failure, an open circuit) is NOT this error: it stays
 * RelloUnavailableError, and for `switchPlan` it does not mean "not switched": send the same
 * `idempotencyKey` again.
 */
export class PlanSwitchApiError extends RelloError {
  public readonly status: number;
  declare public readonly body: PlanSwitchError | PlanSwitchOtherError | null;
  public readonly raw: unknown;
  public readonly cause: RelloError;

  constructor(cause: RelloError, body: PlanSwitchError | PlanSwitchOtherError | null) {
    const code = body ? ` ${body.error}` : "";
    super(`Plan switch refused (${cause.statusCode}${code}): ${cause.path}`, cause.statusCode, cause.path, cause.requestId, body);
    this.name = "PlanSwitchApiError";
    this.status = cause.statusCode;
    this.raw = cause.body;
    this.cause = cause;
  }
}
