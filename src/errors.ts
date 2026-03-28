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
