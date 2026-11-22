// src/transport.ts
import { randomUUID } from "crypto";

// src/errors.ts
var RelloError = class extends Error {
  constructor(message, statusCode, path, requestId, body) {
    super(message);
    this.name = "RelloError";
    this.statusCode = statusCode;
    this.path = path;
    this.requestId = requestId;
    this.body = body;
  }
};
var RelloNotFoundError = class extends RelloError {
  constructor(path, requestId, body) {
    super(`Not found: ${path}`, 404, path, requestId, body);
    this.name = "RelloNotFoundError";
  }
};
var RelloAuthError = class extends RelloError {
  constructor(path, requestId, body) {
    super(`Unauthorized: ${path}`, 401, path, requestId, body);
    this.name = "RelloAuthError";
  }
};
var RelloForbiddenError = class extends RelloError {
  constructor(path, requestId, body) {
    super(`Forbidden: ${path}`, 403, path, requestId, body);
    this.name = "RelloForbiddenError";
  }
};
var RelloValidationError = class extends RelloError {
  constructor(path, requestId, body, details) {
    super(`Validation error: ${path}`, 400, path, requestId, body);
    this.name = "RelloValidationError";
    this.details = details ?? body?.details;
  }
};
var RelloRateLimitError = class extends RelloError {
  constructor(path, requestId, body, retryAfter) {
    super(`Rate limited: ${path} (retry after ${retryAfter}s)`, 429, path, requestId, body);
    this.name = "RelloRateLimitError";
    this.retryAfter = retryAfter;
  }
};
var RelloUnavailableError = class extends RelloError {
  constructor(message, retryAfter) {
    super(message, 503, "", null, null);
    this.name = "RelloUnavailableError";
    this.retryAfter = retryAfter;
  }
};
var PlanSwitchApiError = class extends RelloError {
  constructor(cause, body) {
    const code = body ? ` ${body.error}` : "";
    super(`Plan switch refused (${cause.statusCode}${code}): ${cause.path}`, cause.statusCode, cause.path, cause.requestId, body);
    this.name = "PlanSwitchApiError";
    this.status = cause.statusCode;
    this.raw = cause.body;
    this.cause = cause;
  }
};

// src/retry.ts
async function withRetry(fn, maxAttempts = 3, delays = [0, 1e3, 3e3]) {
  let lastError;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (isClientError(error)) {
        throw error;
      }
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
function isClientError(error) {
  if (error && typeof error === "object" && "statusCode" in error) {
    const code = error.statusCode;
    return code >= 400 && code < 500;
  }
  return false;
}
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// src/circuit-breaker.ts
var CircuitBreaker = class {
  constructor(failureThreshold = 5, cooldownMs = 3e4) {
    this.failureThreshold = failureThreshold;
    this.cooldownMs = cooldownMs;
    this.state = "CLOSED";
    this.failureCount = 0;
    this.lastFailureTime = 0;
  }
  /**
   * Execute a function through the circuit breaker.
   * Throws RelloUnavailableError if the circuit is open.
   */
  async execute(fn) {
    if (this.state === "OPEN") {
      const elapsed = Date.now() - this.lastFailureTime;
      if (elapsed < this.cooldownMs) {
        const retryAfter = Math.ceil((this.cooldownMs - elapsed) / 1e3);
        throw new RelloUnavailableError(
          "Rello is unavailable (circuit breaker open)",
          retryAfter
        );
      }
      this.state = "HALF_OPEN";
    }
    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      if (this.isServerError(error)) {
        this.onFailure();
      } else {
        this.onSuccess();
      }
      throw error;
    }
  }
  onSuccess() {
    this.failureCount = 0;
    this.state = "CLOSED";
  }
  onFailure() {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    if (this.state === "HALF_OPEN") {
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
  isServerError(error) {
    if (error && typeof error === "object" && "statusCode" in error) {
      const code = error.statusCode;
      return code >= 500;
    }
    return true;
  }
  getState() {
    return this.state;
  }
};

// src/transport.ts
var DEFAULT_TIMEOUTS = {
  default: 1e4,
  read: 1e4,
  write: 15e3,
  long: 3e4
};
var Transport = class {
  constructor(config) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.apiKey = config.apiKey;
    this.appSlug = config.appSlug;
    this.timeouts = { ...DEFAULT_TIMEOUTS, ...config.timeouts };
    this.retryAttempts = config.retryAttempts ?? 3;
    this.circuitBreaker = new CircuitBreaker(
      config.circuitBreakerThreshold ?? 5,
      config.circuitBreakerCooldownMs ?? 3e4
    );
  }
  /** Returns the app slug used for X-App-Slug header and signal source attribution. */
  getAppSlug() {
    return this.appSlug;
  }
  /** Returns the API key used for Authorization headers. Used by PlatformResource to create ServiceClients. */
  getApiKey() {
    return this.apiKey;
  }
  /**
   * Make an authenticated request to Rello.
   */
  async request(method, path, options) {
    const requestId = randomUUID();
    const timeoutMs = this.timeouts[options.timeout ?? "default"];
    let url = `${this.baseUrl}${options.apiPrefix ?? "/api/v1"}${path}`;
    if (options.query) {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(options.query)) {
        if (value !== void 0) {
          params.set(key, value);
        }
      }
      const qs = params.toString();
      if (qs) url += `?${qs}`;
    }
    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.apiKey}`,
      "X-App-Slug": this.appSlug,
      "X-Tenant-Id": options.tenantId,
      "X-API-Version": "v1",
      "X-Request-Id": requestId,
      ...options.headers
    };
    const fetchOptions = {
      method,
      headers,
      signal: AbortSignal.timeout(timeoutMs)
    };
    if (options.body !== void 0) {
      fetchOptions.body = JSON.stringify(options.body);
    }
    return this.circuitBreaker.execute(
      () => withRetry(
        () => this.doFetch(url, fetchOptions, path, requestId),
        this.retryAttempts
      )
    );
  }
  async doFetch(url, fetchOptions, path, requestId) {
    let res;
    try {
      res = await fetch(url, fetchOptions);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new RelloUnavailableError(
          `Request timed out: ${path}`,
          5
        );
      }
      throw new RelloUnavailableError(
        `Network error: ${error instanceof Error ? error.message : "fetch failed"}`,
        5
      );
    }
    if (res.ok) {
      if (res.status === 204) {
        return void 0;
      }
      return res.json();
    }
    let body = null;
    const text = await res.text().catch(() => null);
    if (text !== null && text !== "") {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }
    const responseRequestId = res.headers.get("X-Request-Id") ?? requestId;
    switch (res.status) {
      case 400:
        throw new RelloValidationError(path, responseRequestId, body);
      case 401:
        throw new RelloAuthError(path, responseRequestId, body);
      case 403:
        throw new RelloForbiddenError(path, responseRequestId, body);
      case 404:
        throw new RelloNotFoundError(path, responseRequestId, body);
      case 429: {
        const retryAfter = parseInt(res.headers.get("Retry-After") ?? "60", 10);
        throw new RelloRateLimitError(path, responseRequestId, body, retryAfter);
      }
      default:
        throw new RelloError(
          `Rello API error ${res.status}: ${path}`,
          res.status,
          path,
          responseRequestId,
          body
        );
    }
  }
  // Convenience methods
  async get(path, tenantId, query, timeout) {
    return this.request("GET", path, { tenantId, query, timeout });
  }
  async post(path, tenantId, body, timeout) {
    return this.request("POST", path, { tenantId, body, timeout: timeout ?? "write" });
  }
  async patch(path, tenantId, body, timeout) {
    return this.request("PATCH", path, { tenantId, body, timeout: timeout ?? "write" });
  }
  async delete(path, tenantId, timeout) {
    return this.request("DELETE", path, { tenantId, timeout: timeout ?? "write" });
  }
  /**
   * GET a non-v1 route (uses `/api` prefix instead of `/api/v1`).
   */
  async getRaw(path, tenantId, query, timeout) {
    return this.request("GET", path, { tenantId, query, timeout, apiPrefix: "/api" });
  }
  /**
   * POST to a non-v1 route (uses `/api` prefix instead of `/api/v1`).
   */
  async postRaw(path, tenantId, body, timeout) {
    return this.request("POST", path, { tenantId, body, timeout, apiPrefix: "/api" });
  }
};

// src/resources/leads.ts
function unwrapData(res) {
  return res && typeof res === "object" && "success" in res && "data" in res ? res.data : res;
}
function unwrapLead(res) {
  const payload = unwrapData(res);
  return payload && typeof payload === "object" && "lead" in payload ? payload.lead : payload;
}
var LeadsResource = class {
  constructor(transport) {
    this.transport = transport;
  }
  async create(tenantId, data) {
    const res = await this.transport.post("/leads", tenantId, data);
    return unwrapLead(res);
  }
  async get(tenantId, id) {
    const res = await this.transport.get(`/leads/${id}`, tenantId);
    return unwrapLead(res);
  }
  async update(tenantId, id, data) {
    const res = await this.transport.patch(`/leads/${id}`, tenantId, data);
    return unwrapLead(res);
  }
  /**
   * Find a lead by exact email match within a tenant.
   *
   * Calls `GET /api/v1/leads?email={email}&search={email}` — sends BOTH the
   * new dedicated `email` query param AND the legacy `search` param so the
   * lookup works against both new and old Rello servers without coordinated
   * deployment:
   *   - New Rello (with `?email=` support): the server applies a
   *     case-insensitive exact match against the unique `(tenantId, email)`
   *     index and returns 0 or 1 lead. The redundant `search` filter is
   *     AND'd in but is a no-op once the email match has constrained the
   *     result to a single row.
   *   - Old Rello (pre Spoke App Integration Standard): the server silently
   *     strips the unknown `email` param and falls back to the legacy
   *     fuzzy `search` behavior — case-insensitive `contains` across
   *     firstName/lastName/email. The client-side exact-match filter below
   *     then validates the result for dedup safety.
   *
   * The dual-param send is a transition aid. It can be reduced to
   * `{ email }` once every Rello deployment has shipped the new query param
   * (target: after the v1.x.y rollout completes).
   *
   * Returns null when no lead with that exact email exists.
   */
  async findByEmail(tenantId, email) {
    if (!email) return null;
    try {
      const res = await this.transport.get(
        "/leads",
        tenantId,
        { email, search: email, limit: "25" }
      );
      const leads = Array.isArray(res) ? res : res.data ?? res.leads ?? [];
      const normalizedEmail = email.toLowerCase().trim();
      return leads.find(
        (l) => typeof l.email === "string" && l.email.toLowerCase().trim() === normalizedEmail
      ) ?? null;
    } catch (error) {
      if (error && typeof error === "object" && "statusCode" in error && error.statusCode === 404) {
        return null;
      }
      throw error;
    }
  }
  /**
   * Find an existing lead by email, or create a new one if not found.
   *
   * Deduplication is by exact email match (case-insensitive). If the input
   * has no email, a new lead is always created (cannot dedup without email).
   *
   * Handles the TOCTOU race condition: if another process creates the same
   * lead between our findByEmail and create calls, and Rello returns a
   * conflict (409) or validation error (400), we retry findByEmail once.
   * This prevents duplicate creation under concurrent writes.
   *
   * @returns The lead and whether it was newly created.
   *
   * @example
   *   const { lead, created } = await rello.leads.createOrFind(tenantId, {
   *     email: "buyer@example.com",
   *     firstName: "Jane",
   *     source: "the-home-scout",
   *   });
   *   if (!created) console.log("Existing lead:", lead.id);
   */
  async createOrFind(tenantId, data) {
    if (data.email) {
      const existing = await this.findByEmail(tenantId, data.email);
      if (existing) {
        return { lead: existing, created: false };
      }
    }
    try {
      const lead = await this.create(tenantId, data);
      return { lead, created: true };
    } catch (error) {
      if (data.email && error && typeof error === "object" && "statusCode" in error) {
        const code = error.statusCode;
        if (code === 409 || code === 400) {
          const retryFind = await this.findByEmail(tenantId, data.email);
          if (retryFind) {
            return { lead: retryFind, created: false };
          }
        }
      }
      throw error;
    }
  }
  async list(tenantId, params = {}) {
    const res = await this.listWithPagination(tenantId, params);
    return res.leads;
  }
  /**
   * List leads with the full pagination envelope.
   *
   * GET /api/v1/leads
   *
   * Unlike list() which returns Lead[], this preserves { leads, total, page, totalPages }
   * for callers that need pagination metadata (e.g., Newsletter Studio's lead browser).
   */
  async listWithPagination(tenantId, params = {}) {
    const query = {};
    if (params.limit !== void 0) query.limit = String(params.limit);
    if (params.offset !== void 0) query.offset = String(params.offset);
    if (params.page !== void 0) query.page = String(params.page);
    if (params.tags?.length) query.tags = params.tags.join(",");
    if (params.stage) query.stage = params.stage;
    if (params.sortBy) query.sortBy = params.sortBy;
    if (params.sortOrder) query.sortOrder = params.sortOrder;
    const ownerFilter = params.ownerId ?? params.agentId;
    if (ownerFilter) query.ownerId = ownerFilter;
    if (params.source) query.source = params.source;
    if (params.email) query.email = params.email;
    if (params.search) {
      query.search = params.search;
    } else if (params.email) {
      query.search = params.email;
    }
    const res = await this.transport.get("/leads", tenantId, query);
    const leads = res.data ?? res.leads ?? [];
    return {
      leads,
      total: res.meta?.total ?? res.total ?? leads.length,
      page: res.meta?.page ?? res.page ?? 1,
      totalPages: res.meta?.totalPages ?? res.totalPages ?? 1
    };
  }
  async applyTags(tenantId, id, tags) {
    await this.transport.post(`/leads/${id}/tags`, tenantId, { tags });
  }
  async setCustomFields(tenantId, id, fields) {
    await this.transport.patch(`/leads/${id}/custom-fields`, tenantId, { customFields: fields });
  }
  async getConversionScore(tenantId, id) {
    const res = await this.transport.get(
      `/leads/${id}/conversion-score`,
      tenantId
    );
    return unwrapData(res);
  }
  /**
   * Fetch the lead's Rello-platform-closed loans from the
   * `ClosingTransaction` model.
   *
   * GET /api/leads/:id/closed-loans (non-v1 route — uses `getRaw`)
   *
   * Server query: `status: "CLOSING_COMPLETED"`, ordered by `closedAt` desc
   * with `actualClosingDate` desc fallback. Returns null when no closed-loan
   * row exists for the lead (Hub then falls back to Flueid `hh_lien1_*`
   * customFields or the "unavailable" empty-state).
   *
   * Used by HS Hub data-assembly (`fetchMortgageBlock`) per HHUB B-04
   * amended lock — ClosingTransaction is highest-fidelity mortgage source
   * (real ARIVE LOS data); Flueid is secondary public-records fallback.
   */
  async getClosedLoans(tenantId, id) {
    const res = await this.transport.getRaw(
      `/leads/${id}/closed-loans`,
      tenantId
    );
    const payload = unwrapData(res);
    return payload?.closedLoans ?? null;
  }
  /**
   * Remove tags from a lead by tag name.
   *
   * DELETE /api/v1/leads/:id/tags
   *
   * Sends tag names in the request body. The v1 handler resolves names to IDs
   * and removes each matching tag from the lead.
   */
  async removeTags(tenantId, id, tags) {
    await this.transport.request("DELETE", `/leads/${id}/tags`, {
      tenantId,
      body: { tags },
      timeout: "write"
    });
  }
  /**
   * Fetch recent Milo nurture decisions for a lead.
   *
   * GET /api/v1/leads/:id/nurture-decisions
   *
   * Used by Newsletter Studio's editorial pass (C3) to provide decision history
   * context to Milo when generating personalized content.
   * Returns empty array on 404 (lead has no decisions yet).
   */
  async getNurtureDecisions(tenantId, id, params = {}) {
    const query = {};
    if (params.limit !== void 0) query.limit = String(params.limit);
    if (params.action) query.action = params.action;
    const res = await this.transport.get(
      `/leads/${id}/nurture-decisions`,
      tenantId,
      query
    );
    const payload = unwrapData(res);
    return Array.isArray(payload) ? payload : payload?.decisions ?? [];
  }
  /**
   * Query leads by tag combinations (AND/OR with optional exclusions).
   *
   * POST /api/v1/leads/by-tags
   *
   * Used for audience segmentation in Newsletter Studio's smart content matching.
   */
  async findByTags(tenantId, input) {
    const res = await this.transport.post(
      "/leads/by-tags",
      tenantId,
      input
    );
    if (res && typeof res === "object" && "success" in res && "data" in res) {
      const env = res;
      const leads = env.data ?? [];
      return { leads, total: env.meta?.total ?? leads.length };
    }
    const legacy = res ?? {};
    return { leads: legacy.leads ?? [], total: legacy.total ?? legacy.leads?.length ?? 0 };
  }
  /**
   * Fetch tags for multiple leads in a single call.
   *
   * PUT /api/v1/leads/batch/tags
   *
   * Returns a map of leadId → Tag[] for all found leads.
   * Leads not found are silently omitted from the result.
   * Uses PUT (not GET) because the leadIds array can exceed URL length limits.
   */
  async getBatchTags(tenantId, leadIds) {
    const res = await this.transport.request("PUT", "/leads/batch/tags", {
      tenantId,
      body: { leadIds },
      timeout: "read"
    });
    return res.data;
  }
  /**
   * Get the pre-computed context cache narrative for a lead.
   *
   * GET /api/leads/[id]/context-cache (non-v1 route)
   *
   * Returns the Haiku-polished narrative, emotional state, data source counts,
   * and freshness info. Used by the LeadStoryCard on the lead detail Overview tab.
   */
  async getContextCache(tenantId, leadId) {
    const res = await this.transport.getRaw(`/leads/${leadId}/context-cache`, tenantId);
    return unwrapData(res);
  }
  /**
   * Record an offline interaction for a lead.
   *
   * POST /api/v1/leads/:id/offline-interactions
   *
   * Used by spoke apps to record phone calls, meetings, showings, open house
   * interactions, and notes that occurred outside the platform.
   */
  async recordOfflineInteraction(tenantId, leadId, data) {
    return this.transport.post(
      `/leads/${leadId}/offline-interactions`,
      tenantId,
      data
    );
  }
};

// src/resources/signals.ts
var MAX_BATCH_SIZE = 200;
var SignalsResource = class {
  constructor(transport, signalKey) {
    this.transport = transport;
    this.signalKey = signalKey;
  }
  /**
   * Emit a single signal to Rello's signal router.
   *
   * Uses the standard v1 API key auth (same as leads, events, etc.).
   * The `source` field defaults to the client's appSlug if not provided.
   * If `customFields` is provided, it is embedded inside `payload.customFields`.
   *
   * @throws {Error} If signalType or leadId is missing (validates locally before sending).
   *
   * @example
   *   await rello.signals.emit(tenantId, {
   *     signalType: "homeready.assessment_completed",
   *     leadId: "lead_abc123",
   *     payload: { score: 72 },
   *     customFields: { hr_score: 72 },
   *   });
   */
  async emit(tenantId, signal) {
    if (!signal.signalType) {
      throw new Error(
        "@rello-platform/api-client: signals.emit() requires signalType"
      );
    }
    if (!signal.leadId) {
      throw new Error(
        "@rello-platform/api-client: signals.emit() requires leadId"
      );
    }
    const source = signal.source || this.transport.getAppSlug();
    if (!source) {
      throw new Error(
        "@rello-platform/api-client: signals.emit() requires source (set appSlug in client config or source in the signal)"
      );
    }
    let payload;
    if (signal.customFields) {
      payload = { ...signal.payload ?? {}, customFields: signal.customFields };
    } else {
      payload = signal.payload ?? {};
    }
    await this.transport.post("/signals", tenantId, {
      leadId: signal.leadId,
      source,
      signalType: signal.signalType,
      payload
    });
  }
  /**
   * Emit multiple signals in a single HTTP call.
   *
   * Requires `signalKey` in the client config (or RELLO_SIGNAL_KEY / SIGNAL_ROUTER_SECRET
   * env var). The batch endpoint uses a different auth credential than the standard v1 API.
   *
   * If no signalKey is configured, falls back to sequential single-signal calls
   * using the standard v1 auth. This is slower (N HTTP calls) but works without
   * the separate credential.
   *
   * Maximum 200 signals per call (enforced by Rello's batch endpoint). For larger
   * batches, call emitBatch multiple times.
   *
   * @example
   *   const result = await rello.signals.emitBatch(tenantId, [
   *     { signalType: "email_opened", leadId: "lead_1", payload: { articleId: "a1" } },
   *     { signalType: "email_clicked", leadId: "lead_2", payload: { url: "..." } },
   *   ]);
   *   console.log(result); // { processed: 2, failed: 0, total: 2 }
   */
  async emitBatch(tenantId, signals) {
    if (signals.length === 0) {
      return { processed: 0, failed: 0, total: 0 };
    }
    if (signals.length > MAX_BATCH_SIZE) {
      throw new Error(
        `@rello-platform/api-client: emitBatch() accepts at most ${MAX_BATCH_SIZE} signals (received ${signals.length}). Split into multiple calls.`
      );
    }
    if (this.signalKey) {
      return this.emitBatchDirect(tenantId, signals);
    }
    return this.emitBatchFallback(tenantId, signals);
  }
  /**
   * Batch endpoint: POST /api/v1/signals/batch
   * Auth: Bearer {signalKey} (SIGNAL_ROUTER_SECRET, NOT the standard API key)
   */
  async emitBatchDirect(tenantId, signals) {
    const appSlug = this.transport.getAppSlug();
    const batchPayload = signals.map((s) => {
      let payload;
      if (s.customFields) {
        payload = { ...s.payload ?? {}, customFields: s.customFields };
      } else {
        payload = s.payload ?? {};
      }
      return {
        tenantId,
        leadId: s.leadId,
        signalType: s.signalType,
        priority: s.priority,
        sourceApp: s.source || appSlug,
        payload,
        timestamp: s.timestamp ?? (/* @__PURE__ */ new Date()).toISOString()
      };
    });
    return this.transport.request(
      "POST",
      "/signals/batch",
      {
        tenantId,
        body: { signals: batchPayload },
        timeout: "long",
        headers: {
          Authorization: `Bearer ${this.signalKey}`,
          "X-Source-App": appSlug
        }
      }
    );
  }
  /**
   * Fallback: send each signal individually via the single-signal endpoint.
   * Slower (N HTTP calls) but works with standard v1 API key auth.
   *
   * Collects per-signal errors so callers can build dead-letter queues.
   */
  async emitBatchFallback(tenantId, signals) {
    let processed = 0;
    let failed = 0;
    const errors = [];
    for (const signal of signals) {
      try {
        await this.emit(tenantId, signal);
        processed++;
      } catch (err) {
        failed++;
        errors.push({
          signalType: signal.signalType,
          leadId: signal.leadId,
          error: err instanceof Error ? err.message : String(err)
        });
      }
    }
    const result = { processed, failed, total: signals.length };
    if (errors.length > 0) {
      result.errors = errors;
    }
    return result;
  }
};

// src/resources/events.ts
var EventsResource = class {
  constructor(transport) {
    this.transport = transport;
  }
  async create(tenantId, event) {
    const res = await this.transport.post(
      "/events",
      tenantId,
      event
    );
    return res.event;
  }
};

// src/resources/activities.ts
var ActivitiesResource = class {
  constructor(transport) {
    this.transport = transport;
  }
  async create(tenantId, activity) {
    const res = await this.transport.post(
      "/activities",
      tenantId,
      activity
    );
    return res.event;
  }
};

// src/resources/flows.ts
var FlowsResource = class {
  constructor(transport) {
    this.transport = transport;
  }
  async enroll(tenantId, leadId, flowSlug, context) {
    const input = { leadId, flowSlug, context };
    const res = await this.transport.post(
      "/flows/enroll",
      tenantId,
      input
    );
    return res.enrollment;
  }
};
var JourneysResource = class {
  constructor(transport) {
    this.transport = transport;
  }
  /**
   * List available journeys for a tenant.
   *
   * GET /api/v1/journeys
   *
   * For API key callers, returns JourneyTemplate objects (platform-wide templates
   * available to the tenant). For session callers, returns tenant-specific journeys.
   */
  async list(tenantId, params = {}) {
    const query = {};
    if (params.isActive !== void 0) query.isActive = String(params.isActive);
    if (params.includeArchived) query.includeArchived = "true";
    if (params.search) query.search = params.search;
    const res = await this.transport.get(
      "/journeys",
      tenantId,
      query
    );
    return Array.isArray(res) ? res : res.journeys;
  }
  /**
   * Enroll a lead into a journey by slug.
   *
   * POST /api/v1/journeys/enroll
   *
   * The server resolves the slug to the tenant's journey instance
   * (or a cloned platform template).
   */
  async enroll(tenantId, leadId, journeySlug, context, goalContext) {
    const input = { leadId, journeySlug, context, goalContext };
    const res = await this.transport.post(
      "/journeys/enroll",
      tenantId,
      input
    );
    return res.enrollment;
  }
  /**
   * Enroll a lead into a journey by database ID.
   *
   * POST /api/v1/journeys/enroll
   *
   * Use this when you have the journey's database ID (e.g., from a previous
   * journeys.list() call). The server verifies the journey belongs to the
   * tenant and is active.
   */
  async enrollById(tenantId, leadId, journeyId, context) {
    const res = await this.transport.post(
      "/journeys/enroll",
      tenantId,
      { leadId, journeyId, context }
    );
    return res.enrollment;
  }
};

// src/resources/settings.ts
var SettingsResource = class {
  constructor(transport) {
    this.transport = transport;
  }
  async getEffective(tenantId, keys) {
    const res = await this.transport.get(
      "/settings/effective",
      tenantId,
      { keys: keys.join(",") }
    );
    return res.settings;
  }
};

// src/types/billing-switch.ts
import { z } from "zod";
var PLAN_SWITCH_INTERVALS = ["month", "year"];
var intervalField = z.enum(PLAN_SWITCH_INTERVALS);
var PLAN_SWITCH_KEEP_ADDONS = ["refi-radar"];
var keepAddOnField = z.enum(PLAN_SWITCH_KEEP_ADDONS);
var planSwitchPreviewQuerySchema = z.object({
  targetPlanSlug: z.string().trim().min(1),
  interval: intervalField.optional(),
  keepAddOns: keepAddOnField.optional()
}).strict();
var planSwitchRequestSchema = z.object({
  targetPlanSlug: z.string().min(1),
  /** Absent = the current interval. */
  interval: intervalField.optional(),
  idempotencyKey: z.string().min(8).max(200),
  previewId: z.string().min(1).optional(),
  confirmedChargeChange: z.unknown().optional(),
  /** v2.42.0 (K1): keep Refi Radar through a Pro/Team -> Starter/Rates switch. Absent = drop. */
  keepAddOns: z.array(keepAddOnField).max(1).optional()
}).strict();
var PLAN_SWITCH_ERROR_CODES = [
  "invalid_body",
  "idempotency_key_reused",
  "switch_not_allowed",
  "contact_sales",
  "members_exceed_target",
  "addon_price_not_configured",
  "billing_mode_classic",
  "already_on_plan",
  "confirmation_required",
  "preview_stale",
  "preview_consumed",
  "stale_switch",
  "switch_in_progress",
  "payment_failed",
  "provider_unreadable",
  "not_armed",
  "use_plan_switch",
  "operation_not_found",
  "addon_not_offered",
  "no_plan_subscription"
];
var PREVIEW_STALE_REASONS = ["inputs_changed", "provider_changed", "expired"];
var previewStaleErrorSchema = z.object({
  error: z.literal("preview_stale"),
  reason: z.string().optional()
});
var membersExceedTargetErrorSchema = z.object({
  error: z.literal("members_exceed_target"),
  activeMembers: z.number().int().nonnegative(),
  targetLimit: z.number().int().nonnegative(),
  /** For a person, as on every other plan-switch refusal. */
  message: z.string().optional()
}).strict();
var isoInstant = z.string().min(1);
var minorAmount = z.number().int();
var planSwitchPreviewLineSchema = z.object({
  description: z.string(),
  amount: minorAmount,
  currency: z.string().min(1),
  period: z.object({ start: isoInstant, end: isoInstant }),
  proration: z.boolean()
});
var planSwitchPreviewSubscriptionSchema = z.object({
  kind: z.enum(["plan", "addon"]),
  lines: z.array(planSwitchPreviewLineSchema),
  total: minorAmount
});
var planSwitchPreviewResponseSchema = z.object({
  previewId: z.string().min(1),
  expiresAt: isoInstant,
  prorationDate: isoInstant,
  requiresConfirmation: z.boolean(),
  subscriptions: z.array(planSwitchPreviewSubscriptionSchema),
  planChange: z.object({
    from: z.string().min(1),
    to: z.string().min(1),
    fromInterval: intervalField,
    toInterval: intervalField
  }),
  chargeChange: z.object({ carriedCheckYourRateSeat: z.boolean(), refiRadarDrops: z.boolean(), refiRadarKept: z.boolean().optional() }),
  /** v2.45.0: optional; absent stays absent. */
  apps: z.object({ kept: z.array(z.string().min(1)), added: z.array(z.string().min(1)), dropped: z.array(z.string().min(1)) }).optional(),
  /** v2.45.0: optional; absent stays absent. */
  amountDueNow: minorAmount.optional()
});
var planSwitchStepSchema = z.object({
  index: z.number().int().nonnegative(),
  kind: z.string().min(1),
  state: z.enum(["PENDING", "IN_FLIGHT", "DONE"])
});
var planSwitchAppliedResponseSchema = z.object({
  operationId: z.string().min(1),
  status: z.literal("APPLIED"),
  steps: z.array(planSwitchStepSchema),
  planSlug: z.string().min(1),
  interval: intervalField,
  invoiceIds: z.array(z.string()),
  /** v2.45.0 (§D7): optional; absent stays absent. */
  relloUrl: z.string().min(1).nullable().optional()
});
var planSwitchOpenResponseSchema = z.object({
  operationId: z.string().min(1),
  status: z.literal("OPEN")
});
var planSwitchResponseSchema = z.discriminatedUnion("status", [
  planSwitchAppliedResponseSchema,
  planSwitchOpenResponseSchema
]);
var planSwitchOperationResponseSchema = z.object({
  operationId: z.string().min(1),
  status: z.enum(["OPEN", "APPLIED", "FAILED", "COMPENSATED"]),
  steps: z.array(planSwitchStepSchema),
  previewId: z.string().min(1).nullable(),
  invoiceIds: z.array(z.string()),
  resolutionNeeded: z.boolean(),
  unknownSince: isoInstant.nullable(),
  /** v2.45.0 (§D7): optional; absent stays absent. */
  relloUrl: z.string().min(1).nullable().optional()
});
var switchInProgressErrorSchema = z.object({
  error: z.literal("switch_in_progress"),
  operationId: z.string().min(1)
});
var PLAN_SWITCH_DEDICATED_ERROR_CODES = ["members_exceed_target", "preview_stale", "switch_in_progress"];
var DEDICATED_CODES = new Set(PLAN_SWITCH_DEDICATED_ERROR_CODES);
var planSwitchOtherErrorSchema = z.object({
  error: z.string().min(1).refine((code) => !DEDICATED_CODES.has(code), { message: "this code has its own schema" }),
  message: z.string().optional()
}).loose();
var planSwitchErrorSchema = z.union([
  membersExceedTargetErrorSchema,
  previewStaleErrorSchema,
  switchInProgressErrorSchema,
  planSwitchOtherErrorSchema
]);
function isMembersExceedTargetError(e) {
  return membersExceedTargetErrorSchema.safeParse(e).success;
}
var ADDON_QUANTITY_IDEMPOTENCY_HEADER = "X-Idempotency-Key";
var ADDON_QUANTITY_IDEMPOTENCY_KEY_LENGTH = Object.freeze({ min: 8, max: 128 });
var addOnQuantityRequestSchema = z.object({
  quantity: z.number().int().nonnegative(),
  quantityRev: z.union([z.number().int().nonnegative(), z.string().regex(/^\d{1,18}$/)])
}).strict();
var addOnQuantityResponseSchema = z.object({
  tenantAddOnId: z.string(),
  /** The quantity this revision asked for. */
  quantity: z.number().int().nonnegative(),
  /** The revision, as a decimal string. */
  quantityRev: z.string(),
  /** What Stripe bills now. */
  billedQuantity: z.number().int().nonnegative(),
  /** A newer revision already superseded this one; Stripe converges on the newest. */
  superseded: z.boolean(),
  /** X1: the TenantAddOn status after the change (ACTIVE, TRIALING, PAST_DUE, CANCELED). Absent from R1. */
  status: z.string().optional(),
  /** X1: true when quantity 0 ended the add-on's own subscription. Absent from R1. */
  subscriptionCanceled: z.boolean().optional()
});
var ADDON_QUANTITY_ERROR_CODES = [
  "members_exceed_quantity",
  "extra_mlos_exceed_quantity",
  "stale_quantity_rev",
  "contact_sales",
  "included_in_plan",
  "addon_price_not_configured",
  "addon_not_found",
  "addon_not_active",
  "addon_state_unknown",
  "quantity_not_supported",
  "payment_method_required",
  "stripe_failed"
];
var ADDON_QUANTITY_IDEMPOTENCY_ERROR_CODES = [
  "IDEMPOTENCY_KEY_REQUIRED",
  "IDEMPOTENCY_KEY_INVALID",
  "IDEMPOTENCY_KEY_CONFLICT"
];
var extraMlosExceedQuantityErrorSchema = z.object({
  success: z.literal(false),
  error: z.string(),
  code: z.literal("extra_mlos_exceed_quantity"),
  activeLoginless: z.number().int().nonnegative(),
  quantity: z.number().int().nonnegative()
});
var membersExceedQuantityErrorSchema = z.object({
  success: z.literal(false),
  error: z.string(),
  code: z.literal("members_exceed_quantity"),
  activeMembers: z.number().int().nonnegative(),
  quantity: z.number().int().nonnegative()
});
var addOnQuantityOtherErrorSchema = z.object({
  success: z.literal(false).optional(),
  /** Human-readable. */
  error: z.string(),
  code: z.string().optional()
}).loose();
var addOnQuantityErrorSchema = z.union([
  extraMlosExceedQuantityErrorSchema,
  membersExceedQuantityErrorSchema,
  addOnQuantityOtherErrorSchema
]);
function isExtraMlosExceedQuantityError(e) {
  return extraMlosExceedQuantityErrorSchema.safeParse(e).success;
}
function isMembersExceedQuantityError(e) {
  return membersExceedQuantityErrorSchema.safeParse(e).success;
}

// src/types/addon-charge-once.ts
import { z as z2 } from "zod";
var ADD_ON_CHARGE_ONCE_IDEMPOTENCY_HEADER = "X-Idempotency-Key";
var ADD_ON_CHARGE_ONCE_IDEMPOTENCY_HEADER_ALIAS = "Idempotency-Key";
var addOnChargeOnceRequestIdSchema = z2.string().trim().min(8).max(128);
var addOnChargeOnceRequestSchema = z2.object({
  addOnId: z2.string().min(1),
  /** The one-time price the caller showed, integer cents (>= 0). Never charged; only compared. */
  quoteCents: z2.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
}).strict();
var addOnChargeOnceQuerySchema = z2.object({ requestId: addOnChargeOnceRequestIdSchema }).strict();
var cents = z2.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
var addOnChargeOnceChargedSchema = z2.object({
  status: z2.literal("charged"),
  chargeId: z2.string().min(1),
  amountCents: cents,
  paidAt: z2.string().datetime({ offset: true })
});
var addOnChargeOnceDeclinedSchema = z2.object({
  status: z2.literal("declined"),
  message: z2.string()
});
var addOnChargeOnceUnknownSchema = z2.object({
  status: z2.literal("unknown"),
  chargeId: z2.string().min(1)
});
var ADD_ON_CHARGE_ONCE_MANUAL_REASONS = ["no_stripe_customer", "no_payment_method"];
var addOnChargeOnceManualSchema = z2.object({
  status: z2.literal("manual"),
  reason: z2.enum(ADD_ON_CHARGE_ONCE_MANUAL_REASONS)
});
var addOnChargeOnceAnswerSchema = z2.discriminatedUnion("status", [
  addOnChargeOnceChargedSchema,
  addOnChargeOnceDeclinedSchema,
  addOnChargeOnceUnknownSchema,
  addOnChargeOnceManualSchema
]);
var ADD_ON_CHARGE_ONCE_ERROR_CODES = [
  "price_changed",
  "add_on_not_one_time",
  "add_on_not_found",
  "request_id_in_use",
  "request_id_ambiguous",
  "billing_unavailable",
  "add_on_not_priced"
];
var addOnChargeOnceErrorSchema = z2.object({ error: z2.string().min(1) }).loose();

// src/resources/billing.ts
var BillingResource = class {
  constructor(transport) {
    this.transport = transport;
  }
  async createCheckout(tenantId, input) {
    return this.transport.post(
      "/billing/checkout",
      tenantId,
      input
    );
  }
  async getStatus(tenantId) {
    return this.transport.get("/billing/status", tenantId);
  }
  async reportUsage(tenantId, metric, quantity, metadata) {
    const input = {
      metric,
      quantity,
      metadata,
      tenantId
    };
    await this.transport.post("/billing/usage", tenantId, input);
  }
  async checkEntitlement(tenantId, appSlug) {
    return this.transport.get(
      "/entitlements/check",
      tenantId,
      { app: appSlug }
    );
  }
  /**
   * Charge ONE one-time add-on to the tenant's saved card, once per `requestId` (PFP Gateway "Match
   * my design"; contract and answers in ../types/addon-charge-once.ts).
   *
   * Resolves with the answer: `charged` (200), `manual` (200), `unknown` (202) or `declined` (402; an
   * answer, not an error). Throws on everything else: RelloError 409 (`price_changed` |
   * `add_on_not_one_time`; parse `err.body` with addOnChargeOnceErrorSchema), RelloNotFoundError 404
   * (`add_on_not_found`), RelloValidationError / RelloAuthError / RelloForbiddenError, and
   * RelloUnavailableError or RelloError 5xx when the request failed in flight.
   *
   * ⚠ A throw from a request that left the process (timeout, network, 5xx) is NOT "not charged":
   * Rello may have taken the money. Call getOneTimeAddOnCharge with the same `requestId` and never
   * charge under a new one. A 200/202/402 body this client cannot read is thrown as a RelloError
   * carrying that status, never returned as an answer.
   *
   * The same `requestId` is sent on every transport retry, so a retried POST is the same charge.
   */
  async chargeOneTimeAddOn(tenantId, input, requestId) {
    const path = "/billing/add-on/charge-once";
    const body = addOnChargeOnceRequestSchema.safeParse(input);
    const key = addOnChargeOnceRequestIdSchema.safeParse(requestId);
    if (!body.success || !key.success) {
      throw new RelloValidationError(path, null, {
        error: "invalid_request",
        issues: [...body.success ? [] : body.error.issues, ...key.success ? [] : key.error.issues]
      });
    }
    let raw;
    try {
      raw = await this.transport.request("POST", path, {
        tenantId,
        body: body.data,
        timeout: "write",
        headers: {
          [ADD_ON_CHARGE_ONCE_IDEMPOTENCY_HEADER]: key.data,
          [ADD_ON_CHARGE_ONCE_IDEMPOTENCY_HEADER_ALIAS]: key.data
        }
      });
    } catch (err) {
      if (err instanceof RelloError && err.statusCode === 402) {
        const declined = addOnChargeOnceDeclinedSchema.safeParse(err.body);
        if (declined.success) return declined.data;
      }
      throw err;
    }
    return parseAnswer(raw, path, 200);
  }
  /**
   * The state of a charge by the request id it was made under. Resolves with the same answers as
   * chargeOneTimeAddOn (a 402 `declined` included). Throws RelloNotFoundError (404) when the
   * caller's tenant has no charge under that request id.
   */
  async getOneTimeAddOnCharge(tenantId, requestId) {
    const path = "/billing/add-on/charge-once";
    const query = addOnChargeOnceQuerySchema.safeParse({ requestId });
    if (!query.success) {
      throw new RelloValidationError(path, null, { error: "invalid_request", issues: query.error.issues });
    }
    let raw;
    try {
      raw = await this.transport.get(path, tenantId, { requestId: query.data.requestId });
    } catch (err) {
      if (err instanceof RelloError && err.statusCode === 402) {
        const declined = addOnChargeOnceDeclinedSchema.safeParse(err.body);
        if (declined.success) return declined.data;
      }
      throw err;
    }
    return parseAnswer(raw, path, 200);
  }
  // ─── Plan switch (UPGRADE-TO-RELLO §D6, v2.45.0; contract in ../types/billing-switch.ts) ──────────────
  //
  // The caller's platform ApiKey (it needs `billing:plan-switch:write`) and `tenantId` as X-Tenant-Id, like
  // every method here. A 4xx/5xx answer throws PlanSwitchApiError (status, parsed body or null, raw). A
  // request that got no answer throws RelloUnavailableError. A 2xx body this client cannot read throws a
  // RelloError carrying the body, never returned as an answer.
  /** `GET /api/v1/billing/plan-switch/preview`: Stripe's own numbers for the switch, and a `previewId` to confirm with. */
  async previewPlanSwitch(tenantId, q) {
    const path = "/billing/plan-switch/preview";
    const query = planSwitchPreviewQuerySchema.safeParse(q);
    if (!query.success) {
      throw new RelloValidationError(path, null, { error: "invalid_request", issues: query.error.issues });
    }
    const { targetPlanSlug, interval, keepAddOns } = query.data;
    const raw = await planSwitchCall(
      () => this.transport.get(path, tenantId, { targetPlanSlug, interval, keepAddOns }, "long")
    );
    return parsePlanSwitchAnswer(planSwitchPreviewResponseSchema, raw, path);
  }
  /**
   * `POST /api/v1/billing/plan-switch`. Resolves with APPLIED (200, finished inside the request) or OPEN (202:
   * poll {@link getPlanSwitch}). The body is checked against the strict request schema first; a body it
   * refuses sends nothing. Every transport retry sends the same `idempotencyKey`, so a retried POST is the
   * same switch. ⚠ A RelloUnavailableError (timeout, network) is not "not switched": send the same key again.
   * An unreadable 2xx body is thrown with statusCode 200 (this client cannot tell a 200 from a 202 there).
   */
  async switchPlan(tenantId, body) {
    const path = "/billing/plan-switch";
    const parsed = planSwitchRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new RelloValidationError(path, null, { error: "invalid_request", issues: parsed.error.issues });
    }
    const raw = await planSwitchCall(
      () => this.transport.request("POST", path, { tenantId, body: parsed.data, timeout: "long" })
    );
    return parsePlanSwitchAnswer(planSwitchResponseSchema, raw, path);
  }
  /** `GET /api/v1/billing/plan-switch/[operationId]`. Another tenant's id answers 404 `operation_not_found`. */
  async getPlanSwitch(tenantId, operationId) {
    const base = "/billing/plan-switch/";
    if (typeof operationId !== "string" || operationId.length === 0) {
      throw new RelloValidationError(base, null, { error: "invalid_request", message: "operationId is required" });
    }
    const path = base + encodeURIComponent(operationId);
    const raw = await planSwitchCall(() => this.transport.get(path, tenantId));
    return parsePlanSwitchAnswer(planSwitchOperationResponseSchema, raw, path);
  }
};
async function planSwitchCall(send) {
  try {
    return await send();
  } catch (err) {
    if (err instanceof RelloError && !(err instanceof RelloUnavailableError)) {
      const parsed = planSwitchErrorSchema.safeParse(err.body);
      throw new PlanSwitchApiError(err, parsed.success ? parsed.data : null);
    }
    throw err;
  }
}
function parsePlanSwitchAnswer(schema, raw, path) {
  const parsed = schema.safeParse(raw);
  if (parsed.success) return parsed.data;
  throw new RelloError(`Unreadable plan-switch answer: ${path}`, 200, path, null, raw);
}
function parseAnswer(raw, path, status) {
  const parsed = addOnChargeOnceAnswerSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  throw new RelloError(`Unreadable charge-once answer: ${path}`, status, path, null, raw);
}

// src/resources/communications.ts
var CommunicationsResource = class {
  constructor(transport) {
    this.transport = transport;
  }
  async canSend(tenantId, input) {
    return this.transport.post(
      "/communications/can-send",
      tenantId,
      input
    );
  }
};

// src/resources/prompts.ts
var PromptsResource = class {
  constructor(transport) {
    this.transport = transport;
  }
  async get(slug, tenantId = "") {
    try {
      return await this.transport.get(
        "/prompts",
        tenantId,
        { slug }
      );
    } catch (error) {
      if (error && typeof error === "object" && "statusCode" in error && error.statusCode === 404) {
        return null;
      }
      throw error;
    }
  }
};

// src/resources/webhooks.ts
var WebhooksResource = class {
  constructor(transport) {
    this.transport = transport;
  }
  async documentUpload(tenantId, payload) {
    await this.transport.post(
      "/webhooks/document-upload",
      tenantId,
      payload,
      "long"
    );
  }
};

// src/service-client.ts
import { randomUUID as randomUUID2 } from "crypto";
var ServiceClient = class {
  constructor(config) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.apiKey = config.apiKey;
    this.appSlug = config.appSlug;
    this.timeoutMs = config.timeoutMs ?? 1e4;
    this.retryAttempts = config.retryAttempts ?? 3;
    this.circuitBreaker = new CircuitBreaker();
  }
  async post(path, body, tenantId) {
    return this.request("POST", path, body, tenantId);
  }
  async get(path, tenantId) {
    return this.request("GET", path, void 0, tenantId);
  }
  async patch(path, body, tenantId) {
    return this.request("PATCH", path, body, tenantId);
  }
  /**
   * SPEC-PE-ADDRESS-NORMALIZE — canonical address normalization +
   * platform-shared Parcel resolution + FipsMapping FIPS lookup.
   *
   * Only meaningful when this `ServiceClient` is bound to Property Engine
   * (e.g. via `rello.service("property-engine")`). Other targets will 404.
   *
   * `tenantId` is REQUIRED — Property Engine returns 400 if the
   * `X-Tenant-Id` header is absent. It does NOT narrow the Parcel result;
   * Parcel is a platform-shared registry. Use `tenantId` for the audit
   * trail dimension and to pass the receiver's auth gate.
   */
  async addressNormalize(input, tenantId) {
    return this.post(
      "/api/address-normalize",
      input,
      tenantId
    );
  }
  /**
   * SPEC-PE-PFP-PROPERTY-AUTOFILL — unified address-normalize + MLS lookup +
   * (optional) ATTOM enrichment with caller-declared selected-fields cache.
   *
   * Only meaningful when this `ServiceClient` is bound to Property Engine
   * (e.g. via `rello.service("property-engine")`). Other targets will 404.
   *
   * `tenantId` is REQUIRED — Property Engine returns 400 if the
   * `X-Tenant-Id` header is absent. Property data (parcel + listing + ATTOM)
   * is platform-shared / external-keyed; `tenantId` is for the audit trail
   * dimension and to pass the receiver's auth gate (lookups:read permission).
   *
   * TRID guardrail per Design Call #2: response describes borrower's
   * CURRENT RESIDENCE only — never implies subject-property speculation.
   */
  async propertyAutofill(input, tenantId) {
    return this.post(
      "/api/property-autofill",
      input,
      tenantId
    );
  }
  async request(method, path, body, tenantId) {
    const requestId = randomUUID2();
    const url = `${this.baseUrl}${path}`;
    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.apiKey}`,
      "X-App-Slug": this.appSlug,
      "X-Request-Id": requestId
    };
    if (tenantId) {
      headers["X-Tenant-Id"] = tenantId;
    }
    const fetchOptions = {
      method,
      headers,
      signal: AbortSignal.timeout(this.timeoutMs)
    };
    if (body !== void 0) {
      fetchOptions.body = JSON.stringify(body);
    }
    return this.circuitBreaker.execute(
      () => withRetry(async () => {
        let res;
        try {
          res = await fetch(url, fetchOptions);
        } catch (error) {
          if (error instanceof DOMException && error.name === "AbortError") {
            throw new RelloUnavailableError(`Request timed out: ${path}`, 5);
          }
          throw new RelloUnavailableError(
            `Network error: ${error instanceof Error ? error.message : "fetch failed"}`,
            5
          );
        }
        if (res.ok) {
          if (res.status === 204) return void 0;
          return res.json();
        }
        let errorBody;
        try {
          errorBody = await res.json();
        } catch {
          errorBody = await res.text().catch(() => null);
        }
        switch (res.status) {
          case 400:
            throw new RelloValidationError(path, requestId, errorBody);
          case 401:
            throw new RelloAuthError(path, requestId, errorBody);
          case 403:
            throw new RelloForbiddenError(path, requestId, errorBody);
          case 404:
            throw new RelloNotFoundError(path, requestId, errorBody);
          case 429: {
            const ra = parseInt(res.headers.get("Retry-After") ?? "60", 10);
            throw new RelloRateLimitError(path, requestId, errorBody, ra);
          }
          default:
            throw new RelloError(
              `Service error ${res.status}: ${path}`,
              res.status,
              path,
              requestId,
              errorBody
            );
        }
      }, this.retryAttempts)
    );
  }
};

// src/resources/platform.ts
var CACHE_TTL_MS = 5 * 60 * 1e3;
var PlatformResource = class {
  constructor(transport) {
    this.transport = transport;
    /** In-memory cache: slug → { app, expiresAt }. */
    this.appCache = /* @__PURE__ */ new Map();
    /**
     * Cached ServiceClient instances keyed by slug. Invalidated when the
     * corresponding AppInfo cache expires (baseUrl might have changed).
     * Sharing a ServiceClient per slug means the circuit breaker state
     * persists across calls — if a service goes down, all callers see
     * the open breaker instead of each getting a fresh one.
     */
    this.serviceCache = /* @__PURE__ */ new Map();
  }
  /**
   * Look up a registered platform app by slug.
   *
   * Calls `GET /api/v1/platform/apps/{slug}` on cache miss or stale.
   * Only returns STABLE and BETA apps — DEVELOPMENT/DEPRECATED/RETIRED
   * return RelloNotFoundError (404).
   *
   * @throws {RelloNotFoundError} If the app doesn't exist or isn't production-ready.
   *
   * @example
   *   const pe = await rello.platform.getApp("property-engine");
   *   console.log(pe.baseUrl); // "https://property-engine-production.up.railway.app"
   */
  async getApp(slug) {
    const cached = this.appCache.get(slug);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.app;
    }
    const res = await this.transport.get(
      `/platform/apps/${slug}`,
      ""
    );
    const app = res.app;
    this.appCache.set(slug, {
      app,
      expiresAt: Date.now() + CACHE_TTL_MS
    });
    this.serviceCache.delete(slug);
    return app;
  }
  /**
   * Resolve a ServiceClient for a registered platform app.
   *
   * Looks up the app's baseUrl from the registry and creates a ServiceClient
   * with retry + circuit breaker. The ServiceClient uses the same API key
   * as the RelloClient — spoke-to-spoke auth is validated by the receiving
   * app (which fetches authorized key hashes from Rello's service-keys endpoint).
   *
   * @throws {Error} If the app has no baseUrl configured.
   * @throws {RelloNotFoundError} If the app doesn't exist or isn't production-ready.
   *
   * @example
   *   const pe = await rello.platform.resolveService("property-engine");
   *   const data = await pe.get("/api/lookups/123");
   */
  async resolveService(slug) {
    const cachedApp = this.appCache.get(slug);
    const cachedService = this.serviceCache.get(slug);
    if (cachedApp && cachedApp.expiresAt > Date.now() && cachedService) {
      return cachedService;
    }
    const app = await this.getApp(slug);
    if (!app.baseUrl) {
      throw new Error(
        `@rello-platform/api-client: App '${slug}' has no baseUrl configured in the registry`
      );
    }
    const client = new ServiceClient({
      baseUrl: app.baseUrl,
      apiKey: this.transport.getApiKey(),
      appSlug: this.transport.getAppSlug()
    });
    this.serviceCache.set(slug, client);
    return client;
  }
};

// src/resources/agents.ts
var AgentsResource = class {
  constructor(transport) {
    this.transport = transport;
  }
  /**
   * Update an agent's profile in Rello.
   *
   * PATCH /api/v1/agents/:agentId
   *
   * Used by spoke apps to push local profile changes back to the hub
   * (e.g., Newsletter Studio syncing agent bios, Home Scout syncing photos).
   */
  async update(tenantId, agentId, data) {
    const res = await this.transport.patch(
      `/agents/${agentId}`,
      tenantId,
      data
    );
    return res.data;
  }
};

// src/resources/tags.ts
var TagsResource = class {
  constructor(transport) {
    this.transport = transport;
  }
  /**
   * List all tags for a tenant.
   *
   * GET /api/v1/tags
   */
  async list(tenantId, params = {}) {
    const query = {};
    if (params.category) query.category = params.category;
    if (params.search) query.search = params.search;
    if (params.includeArchived) query.includeArchived = "true";
    const res = await this.transport.get(
      "/tags",
      tenantId,
      query
    );
    return Array.isArray(res) ? res : res.tags;
  }
  /**
   * Search tags by name with lead counts.
   *
   * GET /api/v1/tags/search
   *
   * Performs fuzzy matching on tag name and slug.
   */
  async search(tenantId, params = {}) {
    const query = {};
    if (params.query) query.q = params.query;
    if (params.category) query.category = params.category;
    if (params.limit !== void 0) query.limit = String(params.limit);
    const res = await this.transport.get(
      "/tags/search",
      tenantId,
      query
    );
    return Array.isArray(res) ? res : res.tags;
  }
};

// src/resources/segments.ts
var SegmentsResource = class {
  constructor(transport) {
    this.transport = transport;
  }
  /**
   * List saved segments for a tenant.
   *
   * GET /api/v1/segments
   */
  async list(tenantId) {
    const res = await this.transport.get(
      "/segments",
      tenantId
    );
    return Array.isArray(res) ? res : res.segments;
  }
  /**
   * Create a new saved segment.
   *
   * POST /api/v1/segments
   */
  async create(tenantId, data) {
    const res = await this.transport.post(
      "/segments",
      tenantId,
      data
    );
    return "segment" in res ? res.segment : res;
  }
};

// src/resources/milo.ts
var MiloResource = class {
  constructor(transport) {
    this.transport = transport;
  }
  /**
   * Get AI optimization suggestions for a newsletter.
   *
   * POST /api/v1/milo/optimize-newsletter
   *
   * Returns subject line suggestions, optimal send time,
   * content recommendations, and estimated open rate.
   */
  async optimizeNewsletter(tenantId, data) {
    return this.transport.post(
      "/milo/optimize-newsletter",
      tenantId,
      data,
      "long"
    );
  }
  /**
   * Get AI content selection for per-lead newsletter personalization.
   *
   * POST /api/v1/milo/select-content
   *
   * Given a lead and a set of available articles, returns which articles
   * are most relevant to the lead along with reasoning.
   */
  async selectContent(tenantId, data) {
    return this.transport.post(
      "/milo/select-content",
      tenantId,
      data,
      "long"
    );
  }
};

// src/resources/lead-shares.ts
var LeadSharesResource = class {
  constructor(transport) {
    this.transport = transport;
  }
  /**
   * List lead shares for a tenant.
   *
   * GET /api/v1/lead-shares
   *
   * Supports filtering by guest MLO, permission level, and newsletter opt-in.
   * Returns shares with nested lead and sharedBy data.
   */
  async list(tenantId, params = {}) {
    const query = {};
    if (params.guestMLOId) query.guestMLOId = params.guestMLOId;
    if (params.permission) query.permission = params.permission;
    if (params.allowMLONewsletters !== void 0) {
      query.allowMLONewsletters = String(params.allowMLONewsletters);
    }
    if (params.includeRevoked) query.includeRevoked = "true";
    if (params.limit !== void 0) query.limit = String(params.limit);
    if (params.offset !== void 0) query.offset = String(params.offset);
    const res = await this.transport.get("/lead-shares", tenantId, query);
    return res.data;
  }
};

// src/resources/team.ts
var TeamResource = class {
  constructor(transport) {
    this.transport = transport;
  }
  /**
   * List all agents in the tenant's team.
   *
   * GET /api/v1/team/agents
   */
  async listAgents(tenantId) {
    const res = await this.transport.get("/team/agents", tenantId);
    return res.data.agents;
  }
  /**
   * Get a single team agent by ID.
   *
   * GET /api/v1/team/agents/:agentId
   */
  async getAgent(tenantId, agentId) {
    const res = await this.transport.get(`/team/agents/${agentId}`, tenantId);
    return res.data;
  }
  /**
   * Get aggregated team statistics.
   *
   * GET /api/v1/team/stats
   */
  async getStats(tenantId) {
    const res = await this.transport.get("/team/stats", tenantId);
    return res.data;
  }
};

// src/resources/reports.ts
var ReportsResource = class {
  constructor(transport) {
    this.transport = transport;
  }
  /**
   * Ingest a report (daily stats, etc.) into Rello.
   *
   * POST /api/v1/reports/ingest
   *
   * Fire-and-forget from the caller's perspective — the report is
   * stored for dashboard display and trend analysis.
   */
  async ingest(tenantId, data) {
    await this.transport.post("/reports/ingest", tenantId, {
      tenantId,
      ...data
    });
  }
};

// src/resources/auth.ts
var AuthResource = class {
  constructor(transport) {
    this.transport = transport;
  }
  /**
   * Validate a rello_session token for spoke apps.
   *
   * POST /api/auth/validate (non-v1 route)
   *
   * Spoke apps (The Oven, Home Scout, etc.) forward the session cookie and
   * receive the user/tenant context. Returns the user profile including
   * tenantId, role, and tenant metadata.
   *
   * @throws RelloAuthError if the token is invalid or expired.
   */
  async validate(tenantId, input) {
    return this.transport.postRaw(
      "/auth/validate",
      tenantId,
      input
    );
  }
};

// src/resources/admin.ts
var AdminResource = class {
  constructor(transport) {
    this.transport = transport;
  }
  /**
   * Log AI usage for cost tracking and cap enforcement.
   *
   * POST /api/admin/ai/usage-log (non-v1 route)
   *
   * Called by spoke apps (Home Stretch, Milo Engine, etc.) to record AI
   * inference calls. Rello aggregates costs and enforces daily/monthly caps.
   * Returns current cost totals and whether the cap has been exceeded.
   */
  async logAiUsage(tenantId, data) {
    return this.transport.postRaw(
      "/admin/ai/usage-log",
      tenantId,
      data
    );
  }
};

// src/implicit-apikey-telemetry.ts
var uses = /* @__PURE__ */ new Map();
function recordImplicitApiKey(site) {
  const existing = uses.get(site);
  if (existing) {
    existing.count += 1;
    return;
  }
  uses.set(site, { site, count: 1, firstSeenAt: Date.now() });
}
function getImplicitApiKeyUses() {
  return [...uses.values()].sort((a, b) => b.count - a.count);
}
function getImplicitApiKeyCount() {
  return uses.size;
}
function resetImplicitApiKeyUses() {
  uses.clear();
}
function callerSite() {
  const err = new Error();
  const stack = err.stack;
  if (!stack) return "<unknown: no stack available>";
  const lines = stack.split("\n");
  for (const line of lines) {
    if (!line.includes("at ")) continue;
    if (line.includes("implicit-apikey-telemetry")) continue;
    if (line.includes("client.ts") || line.includes("client.js")) continue;
    if (line.includes("/@rello-platform/api-client/")) continue;
    if (line.includes("node:internal")) continue;
    const m = /\(?([^()\s]+:\d+:\d+)\)?\s*$/.exec(line.trim());
    if (m) return m[1];
  }
  return "<unknown: no caller frame outside the package>";
}

// src/client.ts
var RelloClient = class {
  constructor(config = {}) {
    const baseUrl = config.baseUrl ?? process.env.RELLO_API_URL ?? "";
    const apiKeyWasExplicit = config.apiKey !== void 0 && config.apiKey !== "";
    const apiKey = config.apiKey ?? process.env.RELLO_API_KEY ?? "";
    const appSlug = config.appSlug ?? process.env.APP_SLUG ?? process.env.RELLO_APP_SLUG ?? "";
    if (!baseUrl) {
      throw new Error(
        "@rello-platform/api-client: baseUrl is required. Set RELLO_API_URL env var or pass baseUrl in config."
      );
    }
    if (!apiKey) {
      throw new Error(
        "@rello-platform/api-client: apiKey is required. Set RELLO_API_KEY env var or pass apiKey in config."
      );
    }
    if (!apiKeyWasExplicit) {
      const site = callerSite();
      if (config.requireExplicitApiKey) {
        throw new Error(
          `@rello-platform/api-client: apiKey must be passed explicitly (requireExplicitApiKey: true), but it was resolved from the RELLO_API_KEY env var instead.
  constructed at: ${site}
  A spoke that means to use its own <SPOKE>_TO_RELLO_API_KEY and omits it silently authenticates as whatever RELLO_API_KEY holds \u2014 which fails later as a 401, far from this line.`
        );
      }
      recordImplicitApiKey(site);
      console.warn(
        `[@rello-platform/api-client] DEPRECATED: apiKey resolved from the RELLO_API_KEY env var rather than passed explicitly.
  constructed at: ${site}
  Pass the key this caller actually intends. The fallback is removed in v3.0.0, and until then it silently substitutes RELLO_API_KEY for a key you may not have meant.`
      );
    }
    const rawSignalKey = config.signalKey || process.env.RELLO_SIGNAL_KEY || process.env.SIGNAL_ROUTER_SECRET || "";
    const signalKey = rawSignalKey.trim() || void 0;
    const normalizedBaseUrl = baseUrl.replace(/\/api\/?$/, "");
    const transport = new Transport({
      baseUrl: normalizedBaseUrl,
      apiKey,
      appSlug,
      timeouts: config.timeouts,
      retryAttempts: config.retryAttempts,
      circuitBreakerThreshold: config.circuitBreakerThreshold,
      circuitBreakerCooldownMs: config.circuitBreakerCooldownMs
    });
    this.leads = new LeadsResource(transport);
    this.signals = new SignalsResource(transport, signalKey);
    this.events = new EventsResource(transport);
    this.activities = new ActivitiesResource(transport);
    this.flows = new FlowsResource(transport);
    this.journeys = new JourneysResource(transport);
    this.settings = new SettingsResource(transport);
    this.billing = new BillingResource(transport);
    this.communications = new CommunicationsResource(transport);
    this.prompts = new PromptsResource(transport);
    this.webhooks = new WebhooksResource(transport);
    this.platform = new PlatformResource(transport);
    this.agents = new AgentsResource(transport);
    this.tags = new TagsResource(transport);
    this.segments = new SegmentsResource(transport);
    this.milo = new MiloResource(transport);
    this.leadShares = new LeadSharesResource(transport);
    this.team = new TeamResource(transport);
    this.reports = new ReportsResource(transport);
    this.auth = new AuthResource(transport);
    this.admin = new AdminResource(transport);
  }
  /**
   * Resolve a ServiceClient for another platform app by slug.
   *
   * Looks up the app's URL from Rello's registry (cached 5 min) and returns
   * a ServiceClient with retry + circuit breaker. Eliminates the need for
   * per-service URL env vars.
   *
   * @example
   *   const pe = await rello.service("property-engine");
   *   const data = await pe.get("/api/lookups/123");
   */
  async service(slug) {
    return this.platform.resolveService(slug);
  }
};

// src/get-rello-base-url.ts
function getRelloBaseUrl(fallback = "") {
  const raw = (process.env.RELLO_API_URL || fallback).trim();
  return raw.replace(/\/api\/?$/, "").replace(/\/+$/, "");
}

// src/get-milo-base-url.ts
function getMiloBaseUrl(fallback = "") {
  const raw = (process.env.MILO_API_URL || fallback).trim();
  return raw.replace(/\/api\/?$/, "").replace(/\/+$/, "");
}

// src/get-harvest-home-base-url.ts
function getHarvestHomeBaseUrl(fallback = "") {
  const raw = (process.env.HH_INTAKE_URL || fallback).trim();
  return raw.replace(/\/api\/?$/, "").replace(/\/+$/, "");
}

// src/get-pathfinder-pro-base-url.ts
function getPathfinderProBaseUrl(fallback = "") {
  const raw = (process.env.PATHFINDER_PRO_API_URL || fallback).trim();
  return raw.replace(/\/api\/?$/, "").replace(/\/+$/, "");
}

// src/get-oven-base-url.ts
function getOvenBaseUrl(fallback = "") {
  const raw = (process.env.THE_OVEN_API_URL || fallback).trim();
  return raw.replace(/\/api\/?$/, "").replace(/\/+$/, "");
}

// src/get-property-engine-base-url.ts
function getPropertyEngineBaseUrl(fallback = "") {
  const raw = (process.env.PROPERTY_ENGINE_API_URL || fallback).trim();
  return raw.replace(/\/api\/?$/, "").replace(/\/+$/, "");
}

// src/get-property-engine-headers.ts
function getPropertyEngineHeaders(apiKey) {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json"
  };
}

// src/has-property-engine-credentials.ts
function hasPropertyEngineCredentials(apiKey) {
  return typeof apiKey === "string" && apiKey.length > 0;
}

// src/platform-key-validator.ts
import { createHash } from "crypto";
var TOUCH_BATCH_MAX_ENTRIES = 500;
var TOUCH_BATCH_MAX_COUNT = 1e6;
function isInAnchorWindow(epochMs) {
  return new Date(epochMs).getUTCMinutes() % 15 < 5;
}
function callerTenantScope(caller) {
  if (typeof caller.tenantId === "string") return { kind: "tenant", tenantId: caller.tenantId };
  if (caller.tenantId === null) return { kind: "platform" };
  return { kind: "unknown" };
}
function readTenantId(entry) {
  if (!Object.prototype.hasOwnProperty.call(entry, "tenantId")) return void 0;
  const v = entry.tenantId;
  if (v === null) return null;
  if (typeof v === "string" && v.length > 0) return v;
  return void 0;
}
function createPlatformKeyValidator(config) {
  const baseUrl = config.relloApiUrl.replace(/\/+$/, "").replace(/\/api\/?$/, "");
  const targetApp = config.ownAppSlug.toUpperCase().replace(/-/g, "_");
  const cacheTtlMs = config.cacheTtlMs ?? 5 * 60 * 1e3;
  const staleServeMaxMs = config.staleServeMaxMs ?? 30 * 60 * 1e3;
  const batched = config.usage?.mode === "batched";
  const usageWindowMs = config.usage?.windowMs ?? 15 * 60 * 1e3;
  const alignToAnchor = batched && (config.usage?.alignToAnchorWindows ?? true);
  const configDefer = config.usage?.defer;
  const pendingUsage = /* @__PURE__ */ new Map();
  let lastFlushAttemptAt = Date.now();
  let flushInProgress = null;
  let keyCache = [];
  let lastFetchTime = 0;
  let lastSuccessTime = 0;
  let lastFetchStatus = "init";
  let lastFetchHttpStatus = null;
  let staleServeWarningEmitted = false;
  let capExceedWarningEmitted = false;
  let fetchInProgress = null;
  async function refreshCache() {
    const url = `${baseUrl}/api/v1/platform/service-keys?targetApp=${encodeURIComponent(targetApp)}`;
    try {
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${config.relloApiKey}`,
          "Content-Type": "application/json"
        },
        signal: AbortSignal.timeout(1e4)
      });
      lastFetchTime = Date.now();
      if (!res.ok) {
        lastFetchHttpStatus = res.status;
        if (res.status >= 500) {
          lastFetchStatus = "5xx";
          console.warn(
            `[platform-key-validator] Failed to fetch service keys: ${res.status} ${res.statusText} (will stale-serve if cache populated)`
          );
        } else if (res.status === 401 || res.status === 403) {
          lastFetchStatus = "auth-refused";
          console.warn(
            `[platform-key-validator] Failed to fetch service keys: ${res.status} ${res.statusText} (4xx auth refusal \u2014 fail-closed; check RELLO_API_KEY for credential drift)`
          );
        } else {
          lastFetchStatus = "4xx-other";
          console.warn(
            `[platform-key-validator] Failed to fetch service keys: ${res.status} ${res.statusText} (4xx, not an answer about our credential \u2014 will stale-serve if cache populated)`
          );
        }
        return;
      }
      const data = await res.json();
      const keys = data.keys;
      if (!Array.isArray(keys)) {
        lastFetchStatus = "5xx";
        lastFetchHttpStatus = null;
        console.warn("[platform-key-validator] Invalid response: keys is not an array (treating as 5xx)");
        return;
      }
      keyCache = keys.map((k) => {
        const entry = k;
        return {
          id: String(entry.id ?? ""),
          appSource: String(entry.appSource ?? ""),
          keyHash: String(entry.keyHash ?? ""),
          permissions: Array.isArray(entry.permissions) ? entry.permissions.map(String) : [],
          tenantId: readTenantId(entry)
        };
      });
      if (pendingUsage.size > 0) {
        const registered = new Set(keyCache.map((k) => k.id));
        let droppedKeys = 0;
        let droppedCount = 0;
        for (const [keyId, count] of pendingUsage) {
          if (!registered.has(keyId)) {
            pendingUsage.delete(keyId);
            droppedKeys += 1;
            droppedCount += count;
          }
        }
        if (droppedKeys > 0) {
          console.warn(
            `[platform-key-validator] dropped pending usage for ${droppedKeys} key(s) no longer in the registry (count=${droppedCount})`
          );
        }
      }
      lastSuccessTime = lastFetchTime;
      lastFetchStatus = "ok";
      lastFetchHttpStatus = null;
      staleServeWarningEmitted = false;
      capExceedWarningEmitted = false;
    } catch (error) {
      lastFetchTime = Date.now();
      lastFetchHttpStatus = null;
      if (error instanceof DOMException && error.name === "AbortError") {
        lastFetchStatus = "timeout";
        console.warn("[platform-key-validator] Rello request timed out (will stale-serve if cache populated)");
      } else {
        lastFetchStatus = "network";
        console.warn(
          "[platform-key-validator] Rello unreachable (will stale-serve if cache populated):",
          error instanceof Error ? error.message : "unknown error"
        );
      }
    }
  }
  async function ensureFreshCache() {
    const now = Date.now();
    if (now - lastFetchTime < cacheTtlMs) return;
    if (alignToAnchor && lastSuccessTime !== 0 && !isInAnchorWindow(now)) return;
    if (!fetchInProgress) {
      fetchInProgress = refreshCache().finally(() => {
        fetchInProgress = null;
      });
    }
    await fetchInProgress;
  }
  const nullReasons = /* @__PURE__ */ new WeakMap();
  function refuse(request, reason, withStatus) {
    nullReasons.set(request, { reason, httpStatus: withStatus ? lastFetchHttpStatus : null });
    return null;
  }
  async function sendPendingUsage() {
    if (pendingUsage.size === 0) {
      return { outcome: "empty", entries: 0, total: 0, httpStatus: null };
    }
    const entries = [];
    for (const [keyId, count] of pendingUsage) {
      if (entries.length >= TOUCH_BATCH_MAX_ENTRIES) break;
      const sent = Math.min(count, TOUCH_BATCH_MAX_COUNT);
      entries.push({ keyId, count: sent });
      if (count > sent) pendingUsage.set(keyId, count - sent);
      else pendingUsage.delete(keyId);
    }
    const total = entries.reduce((sum, e) => sum + e.count, 0);
    const putBack = () => {
      for (const e of entries) pendingUsage.set(e.keyId, (pendingUsage.get(e.keyId) ?? 0) + e.count);
    };
    try {
      const res = await fetch(`${baseUrl}/api/v1/platform/service-keys/touch-batch`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.relloApiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ entries }),
        signal: AbortSignal.timeout(1e4)
      });
      if (!res.ok) {
        putBack();
        console.warn(
          `[platform-key-validator] usage flush refused: ${res.status} \u2014 kept ${entries.length} key(s), count=${total}, for the next window`
        );
        return { outcome: "failed", entries: entries.length, total, httpStatus: res.status };
      }
      return { outcome: "sent", entries: entries.length, total, httpStatus: res.status };
    } catch (error) {
      putBack();
      console.warn(
        `[platform-key-validator] usage flush got no answer \u2014 kept ${entries.length} key(s), count=${total}, for the next window:`,
        error instanceof Error ? error.message : "unknown error"
      );
      return { outcome: "failed", entries: entries.length, total, httpStatus: null };
    }
  }
  function flushUsage() {
    if (!batched) {
      return Promise.resolve({ outcome: "disabled", entries: 0, total: 0, httpStatus: null });
    }
    if (!flushInProgress) {
      flushInProgress = sendPendingUsage().finally(() => {
        flushInProgress = null;
      });
    }
    return flushInProgress;
  }
  function maybeStartFlush(defer) {
    const now = Date.now();
    if (now - lastFlushAttemptAt < usageWindowMs) return;
    if (alignToAnchor && !isInAnchorWindow(now)) return;
    if (flushInProgress) return;
    lastFlushAttemptAt = now;
    const p = flushUsage();
    if (!defer) return;
    try {
      defer(p);
    } catch (error) {
      console.warn(
        "[platform-key-validator] defer threw; the usage flush runs without it:",
        error instanceof Error ? error.message : "unknown error"
      );
    }
  }
  const validatePlatformCaller = async function validatePlatformCaller2(request, options) {
    nullReasons.delete(request);
    const authHeader = request.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return refuse(request, "no-bearer", false);
    const token = authHeader.slice(7);
    if (!token) return refuse(request, "no-bearer", false);
    const tokenHash = createHash("sha256").update(token).digest("hex");
    await ensureFreshCache();
    if (lastSuccessTime === 0) return refuse(request, "no-cache", true);
    if (lastFetchStatus === "auth-refused") return refuse(request, "auth-refused", true);
    if (lastFetchStatus === "5xx" || lastFetchStatus === "4xx-other" || lastFetchStatus === "network" || lastFetchStatus === "timeout") {
      const staleAgeMs = Date.now() - lastSuccessTime;
      const capMs = cacheTtlMs + staleServeMaxMs;
      const statusPart = lastFetchHttpStatus === null ? "" : ` status=${lastFetchHttpStatus}`;
      if (staleAgeMs > capMs) {
        if (!capExceedWarningEmitted) {
          console.warn(
            `[platform-key-validator] WARN cache exceeded stale-serve cap age_ms=${staleAgeMs} capMs=${capMs} reason=upstream-${lastFetchStatus}${statusPart} \u2014 fail-closed until next successful refresh`
          );
          capExceedWarningEmitted = true;
        }
        return refuse(request, "stale-cap-exceeded", true);
      }
      if (!staleServeWarningEmitted) {
        console.warn(
          `[platform-key-validator] WARN serving stale cache age_ms=${staleAgeMs} reason=upstream-${lastFetchStatus}${statusPart}`
        );
        staleServeWarningEmitted = true;
      }
    }
    const match = keyCache.find((k) => k.keyHash === tokenHash);
    if (!match) return refuse(request, "no-key-match", false);
    const caller = {
      appSource: match.appSource,
      keyId: match.id,
      permissions: match.permissions,
      tenantId: match.tenantId
    };
    if (batched) {
      pendingUsage.set(match.id, (pendingUsage.get(match.id) ?? 0) + 1);
      maybeStartFlush(options?.defer ?? configDefer);
      return caller;
    }
    void (async () => {
      try {
        await fetch(`${baseUrl}/api/v1/platform/service-keys/touch`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.relloApiKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ keyId: match.id }),
          signal: AbortSignal.timeout(5e3)
        });
      } catch (error) {
        console.warn(
          "[PlatformKeyValidator] Failed to record key touch:",
          error instanceof Error ? error.message : "unknown error"
        );
      }
    })();
    return caller;
  };
  return Object.assign(validatePlatformCaller, {
    reasonFor: (request) => nullReasons.get(request),
    flushUsage
  });
}
function callerHasPermission(caller, required) {
  if (caller.permissions.includes("*")) return true;
  return caller.permissions.includes(required);
}
function createServiceBearerGuard(config) {
  return async function requireServiceBearer(request, opts) {
    const authHeader = request.headers.get("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return jsonResponse(
        { success: false, error: "Missing Bearer token", code: "BEARER_MISSING" },
        401
      );
    }
    const validator = config.getValidator();
    if (!validator) {
      return jsonResponse(
        {
          success: false,
          error: "Bearer auth is misconfigured on this service.",
          code: "BEARER_UNAVAILABLE"
        },
        401
      );
    }
    let caller;
    try {
      caller = await validator(request);
    } catch (err) {
      const path = safePath(request);
      console.error(
        `[platform-key-validator] Validator threw while resolving service Bearer on ${request.method} ${path}:`,
        err
      );
      return jsonResponse(
        {
          success: false,
          error: "Bearer validation failed.",
          code: "BEARER_VALIDATION_ERROR"
        },
        401
      );
    }
    if (!caller) {
      return jsonResponse(
        {
          success: false,
          error: "Invalid or expired Bearer token.",
          code: "BEARER_INVALID"
        },
        401
      );
    }
    if (!callerHasPermission(caller, opts.permission)) {
      const path = safePath(request);
      console.warn(
        `[platform-key-validator] Caller ${caller.appSource} (key ${caller.keyId}) lacks "${opts.permission}" on ${request.method} ${path}. Held permissions: ${caller.permissions.join(", ") || "(none)"}.`
      );
      return jsonResponse(
        {
          success: false,
          error: `Missing required permission: ${opts.permission}`,
          code: "PERMISSION_DENIED"
        },
        403
      );
    }
    return caller;
  };
}
function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}
function safePath(request) {
  try {
    return new URL(request.url).pathname;
  } catch {
    return "(unknown)";
  }
}

// src/rello-permission-selfcheck.ts
function toUpperSnake(raw) {
  return raw.toUpperCase().replace(/-/g, "_");
}
async function runRelloPermissionSelfCheck(config) {
  const baseUrl = config.relloApiUrl.replace(/\/+$/, "").replace(/\/api\/?$/, "");
  const url = `${baseUrl}/api/v1/platform/service-keys/self`;
  const timeoutMs = config.timeoutMs ?? 1e4;
  if (!config.relloApiKey) {
    return { ok: false, class: "invalid-key" };
  }
  let res;
  try {
    res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${config.relloApiKey}`,
        "Content-Type": "application/json"
      },
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return { ok: false, class: "rello-unreachable", status: "timeout" };
    }
    return { ok: false, class: "rello-unreachable", status: "network" };
  }
  if (!res.ok) {
    if (res.status === 401) {
      return { ok: false, class: "invalid-key" };
    }
    return { ok: false, class: "rello-unreachable", status: res.status };
  }
  let body;
  try {
    body = await res.json();
  } catch {
    return { ok: false, class: "rello-unreachable", status: res.status };
  }
  if (typeof body?.keyId !== "string" || typeof body?.appSource !== "string") {
    return { ok: false, class: "rello-unreachable", status: res.status };
  }
  const expected = toUpperSnake(config.ownAppSource);
  const actual = toUpperSnake(body.appSource);
  if (expected !== actual) {
    return { ok: false, class: "wrong-pair", expected, actual };
  }
  const returned = body.permissions ?? [];
  const hasWildcard = returned.includes("*");
  const missing = config.requiredPermissions.filter(
    (p) => !hasWildcard && !returned.includes(p)
  );
  if (missing.length > 0) {
    return { ok: false, class: "missing-permissions", keyId: body.keyId, missing: [...missing] };
  }
  return {
    ok: true,
    keyId: body.keyId,
    appSource: body.appSource,
    permissions: returned
  };
}
function createRelloPermissionSelfCheck(config) {
  return () => runRelloPermissionSelfCheck(config);
}

// src/types/property-autofill.ts
var PROPERTY_AUTOFILL_FIELD_KEYS = [
  "beds",
  "baths",
  "sqft",
  "yearBuilt",
  "lotSizeSqft",
  "propertyType",
  "estimatedValue",
  "lastSaleDate",
  "lastSalePrice"
];

// src/types/provisioning.ts
import { z as z4 } from "zod";

// src/types/plan-trial.ts
import { z as z3 } from "zod";
var trialTime = z3.string().datetime({ offset: true });
var planTrialStateSchema = z3.object({
  planSlug: z3.string().min(1),
  startedAt: trialTime,
  endsAt: trialTime
});
var planTrialStartRequestSchema = z3.object({
  trialPlanSlug: z3.string().min(1).max(100).optional()
}).strict();
var planTrialStartResponseSchema = z3.object({
  trialId: z3.string().min(1),
  trialPlanSlug: z3.string().min(1),
  startedAt: trialTime,
  endsAt: trialTime,
  rev: z3.number().int().nonnegative()
});
var PLAN_TRIAL_START_ERROR_CODES = [
  "trial_already_used",
  "already_entitled",
  "not_gateway_tenant",
  "switch_in_progress",
  "switch_not_allowed",
  "unknown_trial_plan",
  "trial_plan_unknown",
  "invalid_body",
  "plan_trial_unavailable"
];
var planTrialStartErrorSchema = z3.object({
  error: z3.string().min(1),
  trial: planTrialStateSchema.extend({ status: z3.string() }).optional()
}).loose();

// src/types/provisioning.ts
var provisionedAgentSchema = z4.object({
  relloAgentId: z4.string(),
  email: z4.string().email(),
  firstName: z4.string(),
  lastName: z4.string(),
  slug: z4.string(),
  role: z4.string(),
  // "MLO" | "BROKER" | "AGENT" — kept as string for forward-compat
  // Rello omits an empty phone on the enable push (PFP Gateway A-195); other
  // senders still send null. Accept all three.
  phone: z4.string().nullable().optional(),
  // Optional profile fields — present when the agent has filled them in
  photoUrl: z4.string().optional(),
  bio: z4.string().optional(),
  title: z4.string().optional(),
  tagline: z4.string().optional(),
  brokerageName: z4.string().optional(),
  brokerageLogoUrl: z4.string().optional(),
  brokerageLicenseNumber: z4.string().optional(),
  licenseNumber: z4.string().optional(),
  licenseState: z4.string().optional(),
  nmlsNumber: z4.string().optional(),
  websiteUrl: z4.string().optional(),
  applicationUrl: z4.string().optional(),
  social: z4.unknown().optional(),
  // Tenant-owner MLO info — applied to ALL agents in the tenant-enable payload.
  // For solo MLOs this is the agent's own NMLS; for brokerages it's the owner's.
  mloName: z4.string().optional(),
  mloNmls: z4.string().optional(),
  // PTA-013 F-06: Milo profile + wizard answers per agent in tenant-enable payloads.
  // Present when agent has completed the Rello Start Wizard. Only sent in
  // tenant-enable (bulk) — per-agent provision carries these at the top level.
  agentProfile: z4.lazy(() => agentProfileSchema).optional(),
  wizardAnswers: z4.array(z4.lazy(() => wizardAnswerSchema)).optional(),
  // PFP Gateway G-6a-pre (spec §G-8 (a) [B8, K-178]; KA prompts 1105/1106).
  // Optional: absent means the sender did not say, never false.
  // hasLinkedUser — the Rello Agent has a linked User (Agent.userId set).
  //   Home Scout's page editor uses it to say a loan officer needs a Rello
  //   login before their page can own leads. A setup message, never a hold.
  hasLinkedUser: z4.boolean().optional(),
  // isTenantOwner — the agent's linked User holds an owner role. PathfinderPro
  //   uses it to pick the account's shared rate source at write time.
  isTenantOwner: z4.boolean().optional(),
  // PFP Gateway X2a (spec rev 10.30 §6 [D30]; KA prompts 1153/1155).
  // loginless — a D30 extra-signature loan officer: a Rello Agent that never has
  //   a login (Agent.loginless, CHECK-guarded to userId NULL). Rello always sends
  //   it, true or false; absent (an older Rello) is UNKNOWN, never "has a login".
  loginless: z4.boolean().optional()
});
var tenantEnablePayloadSchema = z4.object({
  action: z4.literal("enable"),
  relloTenantId: z4.string(),
  tenant: z4.object({
    name: z4.string(),
    slug: z4.string(),
    // Omitted on Rello's enable push when the tenant has no logo (A-195).
    logoUrl: z4.string().nullable().optional(),
    primaryColor: z4.string().nullable(),
    physicalAddress: z4.string().nullable(),
    applicationUrl: z4.string().nullable(),
    type: z4.string(),
    // Rello TenantType enum
    plan: z4.string(),
    // Rello Plan enum
    // PFP Gateway §4.2 (G-2): "pfp-gateway" for a tenant created by a PFP
    // gateway checkout; null for every other tenant. Sticky once set.
    billingOrigin: z4.string().nullable().optional()
  }),
  agents: z4.array(provisionedAgentSchema),
  // PFP Gateway §4.2 (G-2): the tenant's plan grants, from Rello's
  // TenantPlanGrantState. null when the tenant has no grant state. A receiver
  // applies it only when `rev` is newer than the one it holds.
  planGrants: z4.lazy(() => tenantPlanGrantsSchema).nullable().optional(),
  // PFP Gateway §4.2 / §4.3 [A-14] (G-2): the effective Check Your Rate record,
  // the same fields as `billing.addon_changed`. null when the tenant never
  // held it. A receiver applies it only when strictly newer (seq, else occurredAt).
  cyr: z4.lazy(() => tenantCyrStateSchema).nullable().optional(),
  // PFP Gateway G-EXTRAS (PKG-2): every add-on state record the tenant holds
  // (Check Your Rate, Refi Radar, ...), one per featureSlug, same shape as `cyr`.
  // Absent = an older Rello (unknown, never "no add-ons"); none held = [].
  addOns: z4.array(z4.lazy(() => tenantCyrStateSchema)).optional(),
  // HH-specific: initial credit grant for new tenants. Optional — only
  // sent when the spoke app has a credit system (currently only HH).
  // Spokes without credits ignore this field.
  creditAllocation: z4.object({
    initialBalance: z4.number().optional(),
    poolSize: z4.number().nullable().optional()
  }).optional()
});
var tenantPlanGrantsSchema = z4.object({
  /** Strictly increasing per tenant; Rello's TenantPlanGrantState.rev. */
  rev: z4.number().int().nonnegative(),
  grants: z4.array(z4.string()),
  // Null for a tenant with no plan (a cancelled tenant: grants [] and planSlug
  // null; KA ruling G-15). Still a required key.
  planSlug: z4.string().nullable(),
  // KA amendment 1109. plan_change = this grant set replaces another because of
  // a plan switch; absent = any other change. A plain string, never an enum, so
  // a later cause value never makes an older receiver refuse the push.
  cause: z4.string().optional(),
  // PFP Gateway G-10R-2t-A (v2.43.0): the tenant's Full PFP plan trial. null = no trial;
  // ABSENT = an older Rello that does not say (unknown). Never defaulted to null.
  trial: planTrialStateSchema.nullable().optional(),
  // UPGRADE-TO-RELLO (v2.45.0, ./plan-class.ts): "rello" | "app" today. A plain string like `cause`, so a
  // later class never refuses the push; compare with isPlanClass(). ABSENT = an older Rello (today's meaning).
  planClass: z4.string().min(1).optional()
});
var tenantCyrStateSchema = z4.object({
  /** The feature this record is for (a `FEATURE_SLUGS` value, e.g. "check-your-rate"); a plain string so an older slugs release still parses. */
  featureSlug: z4.string().min(1),
  status: z4.enum(["ACTIVE", "TRIALING", "PAST_DUE", "CANCELED"]),
  quantity: z4.number().int().nonnegative(),
  trialEndsAt: z4.string().nullable(),
  canceledAt: z4.string().nullable(),
  /** ISO with milliseconds. */
  occurredAt: z4.string(),
  /** Strictly increasing integer per (tenant, feature). */
  seq: z4.number().int().nonnegative(),
  /** Display only; never used to decide serving. */
  source: z4.enum(["addon", "plan", "both"]),
  /** plan_change = changed because of a plan switch; absent = any other change. A plain string, never an enum. */
  cause: z4.string().optional()
});
var tenantDisablePayloadSchema = z4.object({
  action: z4.literal("disable"),
  relloTenantId: z4.string(),
  reason: z4.string().optional()
});
var tenantProvisioningPayloadSchema = z4.discriminatedUnion("action", [
  tenantEnablePayloadSchema,
  tenantDisablePayloadSchema
]);
var agentProfileSchema = z4.object({
  specialtySentence: z4.string().optional(),
  experienceStatement: z4.string().optional(),
  typicalClient: z4.unknown().optional(),
  areasServed: z4.unknown().optional(),
  designations: z4.unknown().optional(),
  emailTone: z4.string().optional(),
  soloOrTeam: z4.string().optional(),
  preferredContactMethod: z4.string().optional(),
  calendarLink: z4.string().optional(),
  aboutMeFacts: z4.unknown().optional(),
  avoidTopics: z4.unknown().optional(),
  emphasizeTopics: z4.unknown().optional(),
  sensitiveTopics: z4.unknown().optional(),
  introductionDraft: z4.string().optional(),
  signoffStyle: z4.string().optional(),
  successStorySeeds: z4.unknown().optional(),
  sendFrequency: z4.string().optional(),
  newsletterTemplateId: z4.string().optional(),
  brandColors: z4.unknown().optional(),
  leadSourceContext: z4.unknown().optional()
});
var wizardAnswerSchema = z4.object({
  questionId: z4.string(),
  question: z4.string(),
  answer: z4.unknown()
});
var agentProvisionPayloadSchema = z4.object({
  action: z4.enum(["add", "update", "remove"]),
  relloTenantId: z4.string(),
  agent: provisionedAgentSchema,
  agentProfile: agentProfileSchema.optional(),
  wizardAnswers: z4.array(wizardAnswerSchema).optional(),
  // PTA-013 F-05: Tenant physical address sent alongside per-agent sync.
  // CAN-SPAM compliance — spokes persist this on their local Tenant model.
  physicalAddress: z4.unknown().nullable().optional()
});
function parseTenantPayload(body) {
  const result = tenantProvisioningPayloadSchema.safeParse(body);
  if (result.success) {
    return { success: true, data: result.data };
  }
  const issues = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
  return { success: false, error: `Payload validation failed: ${issues}` };
}
function parseAgentPayload(body) {
  const result = agentProvisionPayloadSchema.safeParse(body);
  if (result.success) {
    return { success: true, data: result.data };
  }
  const issues = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
  return { success: false, error: `Payload validation failed: ${issues}` };
}

// src/types/roster.ts
import { z as z5 } from "zod";
var rosterIdField = (name) => z5.string({ error: `${name} is required and must be a string` }).trim().min(1, `${name} is required`).max(128, `${name} is too long`);
var rosterNameField = (name) => z5.string({ error: `${name} is required and must be a string` }).trim().min(1, `${name} is required`).max(100, `${name} is too long`);
var rosterEmailField = z5.string({ error: "email is required and must be a string" }).trim().toLowerCase().max(254, "email is too long").pipe(z5.email("email is not a valid address"));
var rosterRequestIdField = z5.string({ error: "requestId is required and must be a string" }).trim().min(8, "requestId must be 8 to 200 characters").max(200, "requestId must be 8 to 200 characters");
var loginlessAgentCreateRequestSchema = z5.object({
  tenantId: rosterIdField("tenantId"),
  actingRelloUserId: rosterIdField("actingRelloUserId"),
  firstName: rosterNameField("firstName"),
  lastName: rosterNameField("lastName"),
  email: rosterEmailField,
  requestId: rosterRequestIdField
}).strict();
var loginlessAgentRemoveRequestSchema = z5.object({ tenantId: rosterIdField("tenantId"), actingRelloUserId: rosterIdField("actingRelloUserId") }).strict();
var teamMemberCreateRequestSchema = z5.object({
  tenantId: rosterIdField("tenantId"),
  actingRelloUserId: rosterIdField("actingRelloUserId"),
  email: rosterEmailField,
  firstName: rosterNameField("firstName"),
  lastName: rosterNameField("lastName"),
  requestId: rosterRequestIdField
}).strict();
var teamMemberSignInLinkRequestSchema = z5.object({
  tenantId: rosterIdField("tenantId"),
  actingRelloUserId: rosterIdField("actingRelloUserId"),
  requestId: rosterRequestIdField
}).strict();
var teamMemberRemoveRequestSchema = z5.object({ tenantId: rosterIdField("tenantId"), actingRelloUserId: rosterIdField("actingRelloUserId") }).strict();
var teamLoginRosterQuerySchema = z5.object({ tenantId: rosterIdField("tenantId"), actingRelloUserId: rosterIdField("actingRelloUserId") }).strict();
var ROSTER_ERROR_CODES = [
  "invalid_body",
  // 400
  "unauthorized",
  // 401: no, invalid, expired or revoked key
  "key_not_scoped",
  // 403: targetApp is not RELLO
  "missing_permission",
  // 403
  "unknown_app",
  // 403: the key's appSource matches no App
  "tenant_mismatch",
  // 403: a tenant-bound key named another tenant
  "app_not_enabled",
  // 403: the calling app is not enabled for the tenant
  "actor_not_owner",
  // 403: actingRelloUserId is not an active owner of the tenant
  "agent_not_found",
  // 404
  "member_not_found",
  // 404
  "cannot_remove_owner",
  // 409: an owner's login (yours included) is not removed through the roster (v2.35.0)
  "signature_quantity_needed",
  // 409: buy one more extra signature first
  "login_quantity_needed",
  // 409: buy one more extra login first
  "email_in_use",
  // 409: an agent of this tenant already has the email
  "already_member",
  // 409
  "email_registered_elsewhere",
  // 409
  "idempotency_key_reused",
  // 409: same requestId, different body
  "internal_error"
  // 500: nothing was saved; try again
];
var loginlessAgentCreateResponseSchema = z5.object({
  relloAgentId: z5.string().min(1),
  slug: z5.string().min(1),
  email: z5.string().min(1),
  replayed: z5.boolean()
});
var loginlessAgentRemoveResponseSchema = z5.object({
  relloAgentId: z5.string().min(1),
  status: z5.literal("INACTIVE"),
  alreadyInactive: z5.boolean()
});
var teamMemberCreateResponseSchema = z5.object({
  userId: z5.string().min(1),
  relloAgentId: z5.string().min(1),
  email: z5.string().min(1),
  signInEmail: z5.literal("queued"),
  replayed: z5.boolean()
});
var teamMemberSignInLinkResponseSchema = z5.object({
  userId: z5.string().min(1),
  signInEmail: z5.literal("queued"),
  replayed: z5.boolean()
});
var teamMemberRemoveResponseSchema = z5.object({
  userId: z5.string().min(1),
  isActive: z5.literal(false),
  alreadyInactive: z5.boolean()
});
var rosterCount = z5.number().int().nonnegative();
var teamLoginRosterMemberSchema = z5.object({
  userId: z5.string().min(1),
  relloAgentId: z5.string().min(1).nullable(),
  email: z5.string(),
  firstName: z5.string(),
  lastName: z5.string(),
  role: z5.string(),
  isOwner: z5.boolean()
});
var teamLoginRosterResponseSchema = z5.object({
  included: rosterCount.nullable(),
  purchased: rosterCount,
  capacity: rosterCount.nullable(),
  members: rosterCount,
  overBy: rosterCount,
  addOnCatalogKey: z5.literal("pfp-extra-team-login"),
  people: z5.array(teamLoginRosterMemberSchema)
}).refine((r) => r.included === null === (r.capacity === null), {
  message: "included and capacity are null together"
});
var rosterErrorSchema = z5.object({
  code: z5.string().min(1),
  /** For a person. */
  error: z5.string()
}).loose();
function isRosterErrorCode(code) {
  return typeof code === "string" && ROSTER_ERROR_CODES.includes(code);
}
var signatureQuantityNeededSchema = z5.object({
  code: z5.literal("signature_quantity_needed"),
  error: z5.string(),
  purchased: rosterCount,
  extras: rosterCount,
  addOnCatalogKey: z5.literal("pfp-extra-signature")
});
var alreadyMemberSchema = z5.object({
  code: z5.literal("already_member"),
  error: z5.string(),
  userId: z5.string().min(1),
  isActive: z5.boolean()
});
var loginQuantityNeededSchema = z5.object({
  code: z5.literal("login_quantity_needed"),
  error: z5.string(),
  included: rosterCount,
  purchased: rosterCount,
  members: rosterCount,
  addOnCatalogKey: z5.literal("pfp-extra-team-login")
});

// src/types/sms-setup.ts
import { z as z6 } from "zod";
var smsSetupId = z6.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/);
var smsSetupSlug = z6.string().min(1).max(64).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/);
var smsSetupTime = z6.iso.datetime({ offset: true });
var smsSetupRev = z6.number().int().min(1);
var quoteVersion = z6.number().int().min(1);
var setupChargeRequest = z6.strictObject({
  tenantId: smsSetupId,
  relloAgentId: smsSetupId,
  feeSlug: smsSetupSlug,
  quoteVersion
});
var setupChargeStatus = z6.enum(["pending", "paid", "failed", "unknown", "manual", "refunded", "voided"]);
var setupChargeEnvelope = z6.strictObject({
  tenantId: smsSetupId,
  relloAgentId: smsSetupId,
  feeSlug: smsSetupSlug,
  status: setupChargeStatus,
  /** true only when a PAID row is asked again. */
  alreadyPaid: z6.boolean().optional(),
  /** failed: Stripe's decline message (never card data); manual: the reason in words. */
  message: z6.string().max(500).optional(),
  chargeId: z6.string().nullable(),
  rev: smsSetupRev,
  /** Display only; order by `rev`. */
  occurredAt: smsSetupTime
});
var chargeConflict = z6.strictObject({
  error: z6.enum(["registration_rejected", "refund_in_progress", "business_suspended", "business_suspension_final"]),
  envelope: setupChargeEnvelope.nullable()
});
var feeSlugQuery = z6.strictObject({ feeSlug: smsSetupSlug });
var oneTimeFeeQuote = z6.strictObject({
  feeSlug: smsSetupSlug,
  label: z6.string().min(1).max(120),
  amountCents: z6.number().int().positive(),
  currency: z6.string().regex(/^[a-z]{3}$/),
  isActive: z6.boolean(),
  quoteVersion
});
var feeChangedConflict = z6.strictObject({ error: z6.literal("fee_changed"), quote: oneTimeFeeQuote });
var feeNotFound = z6.strictObject({ error: z6.literal("fee_not_found") });
var internalError = z6.strictObject({ error: z6.string().min(1), requestId: z6.string().min(1) });
var smsSetupE164Us = z6.string().regex(/^\+1[2-9]\d{9}$/, "Use a US number like +18015550101");
var smsSetupEmail = z6.email().max(254);
var smsSetupAddress = z6.strictObject({
  street: z6.string().min(1).max(100),
  street2: z6.string().max(100).optional(),
  city: z6.string().min(1).max(60),
  region: z6.string().regex(/^[A-Z]{2}$/, "Use the 2-letter state"),
  postalCode: z6.string().regex(/^\d{5}(-\d{4})?$/),
  country: z6.literal("US")
});
var businessType = z6.enum([
  "Co-operative",
  "Corporation",
  "Limited Liability Corporation",
  "Non-profit Corporation",
  "Partnership"
]);
var businessIndustry = z6.enum([
  "AGRICULTURE",
  "AUTOMOTIVE",
  "BANKING",
  "CONSTRUCTION",
  "CONSUMER",
  "EDUCATION",
  "ELECTRONICS",
  "ENGINEERING",
  "ENERGY",
  "FAST_MOVING_CONSUMER_GOODS",
  "FINANCIAL",
  "FINTECH",
  "FOOD_AND_BEVERAGE",
  "GOVERNMENT",
  "HEALTHCARE",
  "HOSPITALITY",
  "INSURANCE",
  "JEWELRY",
  "LEGAL",
  "MANUFACTURING",
  "MEDIA",
  "NOT_FOR_PROFIT",
  "OIL_AND_GAS",
  "ONLINE",
  "PROFESSIONAL_SERVICES",
  "RAW_MATERIALS",
  "REAL_ESTATE",
  "RELIGION",
  "RETAIL",
  "TECHNOLOGY",
  "TELECOMMUNICATIONS",
  "TRANSPORTATION",
  "TRAVEL"
]);
var smsSetupBusiness = z6.strictObject({
  /** Exactly as on the IRS CP 575. */
  legalName: z6.string().min(2).max(255),
  businessType,
  industry: businessIndustry,
  ein: z6.string().regex(/^\d{2}-\d{7}$/, "EIN must look like 12-3456789"),
  websiteUrl: z6.url().max(255).refine((u) => u.startsWith("https://"), "The website must start with https://"),
  companyType: z6.enum(["private", "public", "non-profit"]),
  stockExchange: z6.string().min(1).max(20).optional(),
  stockTicker: z6.string().min(1).max(10).optional(),
  brandContactEmail: smsSetupEmail.optional(),
  address: smsSetupAddress
});
var smsSetupAuthorizedRep = z6.strictObject({
  firstName: z6.string().min(1).max(50),
  lastName: z6.string().min(1).max(50),
  businessTitle: z6.string().min(1).max(60),
  jobPosition: z6.enum(["Director", "GM", "VP", "CEO", "CFO", "General Counsel", "Other"]),
  phone: smsSetupE164Us,
  email: smsSetupEmail
});
var smsSetupSoleProprietor = z6.strictObject({
  firstName: z6.string().min(1).max(50),
  lastName: z6.string().min(1).max(50),
  brandName: z6.string().min(2).max(255),
  email: smsSetupEmail,
  phone: smsSetupE164Us,
  /** Receives Twilio's YES text; can't be a Twilio/CPaaS number; ≤ 3 uses across TCR. */
  mobilePhone: smsSetupE164Us,
  address: smsSetupAddress
});
var smsRegistrationRequest = z6.strictObject({
  tenantId: smsSetupId,
  relloAgentId: smsSetupId,
  brandType: z6.enum(["STANDARD", "SOLE_PROPRIETOR"]),
  business: smsSetupBusiness.optional(),
  authorizedRep: smsSetupAuthorizedRep.optional(),
  soleProprietor: smsSetupSoleProprietor.optional()
}).superRefine((b, ctx) => {
  const issue = (path, message) => ctx.addIssue({ code: "custom", path, message });
  if (b.brandType === "STANDARD") {
    if (b.business && !b.authorizedRep) issue(["authorizedRep"], "An authorized representative is required with the business details");
    if (b.authorizedRep && !b.business) issue(["business"], "Business details are required with an authorized representative");
    if (b.soleProprietor) issue(["soleProprietor"], "Send either the EIN details or the sole-proprietor details, not both");
    if (b.business?.companyType === "public" && !(b.business.stockExchange && b.business.stockTicker && b.business.brandContactEmail))
      issue(["business", "stockExchange"], "A public company needs its stock exchange, ticker and a brand contact email");
  } else {
    if (b.business?.businessType === "Limited Liability Corporation") issue(["brandType"], "An LLC must register with its EIN.");
    if (b.business || b.authorizedRep) issue(["business"], "Send either the EIN details or the sole-proprietor details, not both");
    if (!b.soleProprietor) issue(["soleProprietor"], "Sole-proprietor details are required");
  }
});
var smsOtpRequest = z6.strictObject({ tenantId: smsSetupId, relloAgentId: smsSetupId });
var smsRegistrationStatus = z6.enum([
  "details_received",
  "payment_pending",
  "submitted",
  "brand_pending",
  "brand_approved",
  "otp_pending",
  "campaign_pending",
  "number_pending",
  "live",
  "action_needed",
  "suspended",
  "rejected",
  "refunded"
]);
var smsRegistrationEnvelope = z6.strictObject({
  tenantId: smsSetupId,
  relloAgentId: smsSetupId,
  brandType: z6.enum(["STANDARD", "SOLE_PROPRIETOR"]),
  status: smsRegistrationStatus,
  /** Twilio's code + text, sanitized. */
  reason: z6.string().max(1e3).nullable(),
  fieldsToFix: z6.array(z6.string()).nullable(),
  /** STANDARD: 3 − the BUSINESS's used count (shared by the team); SOLE_PROPRIETOR: null. */
  remainingFreeUpdates: z6.number().int().min(0).max(3).nullable(),
  /** Only when `live`. */
  phoneNumber: z6.string().regex(/^\+1\d{10}$/).nullable(),
  /** Only for SOLE_PROPRIETOR. Expires 24 h after; a new code is available 60 s after. */
  otpSentAt: smsSetupTime.nullable(),
  rev: smsSetupRev,
  occurredAt: smsSetupTime
});
var registrationConflict = z6.strictObject({
  error: z6.enum(["business_rejected", "business_suspended", "business_suspension_final", "in_review", "no_free_updates", "not_otp_pending"]),
  envelope: smsRegistrationEnvelope.nullable()
});
var setupChargeChangedEvent = z6.strictObject({
  id: z6.uuid(),
  type: z6.literal("billing.setup_charge_changed"),
  tenantId: smsSetupId,
  occurredAt: smsSetupTime,
  data: setupChargeEnvelope
});
var smsRegistrationChangedEvent = z6.strictObject({
  id: z6.uuid(),
  type: z6.literal("sms.registration_changed"),
  tenantId: smsSetupId,
  occurredAt: smsSetupTime,
  data: smsRegistrationEnvelope
});

// src/types/v1-billing-reads.ts
import { z as z7 } from "zod";
var V1_TENANT_MATCH_ERRORS = Object.freeze({
  /** A tenant-scoped key sent an X-Tenant-Id naming another tenant. Nothing was read for either. */
  tenantHeaderMismatch: "Forbidden \u2014 tenant header does not match credential",
  /** The key's app is not one these routes serve (pathfinder-pro today). */
  callerAppNotAllowed: "Forbidden \u2014 caller app not allowed"
});
function appNotEnabledForTenantError(appSlug) {
  return `Forbidden \u2014 app '${appSlug}' is not enabled for tenant`;
}
var v1TenantMatchErrorSchema = z7.object({ error: z7.string().min(1) });
var planGrantsReadResponseSchema = z7.object({
  rev: z7.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  grants: z7.array(z7.string().min(1)),
  planSlug: z7.string().min(1),
  cyr: tenantCyrStateSchema.nullable(),
  /** v2.43.0 (G-10R-2t-A): the Full PFP plan trial. null = none; ABSENT = an older Rello (unknown); never defaulted to null. */
  trial: planTrialStateSchema.nullable().optional(),
  /** v2.45.0 (UPGRADE-TO-RELLO, ./plan-class.ts): "rello" | "app" today; a plain string, compare with isPlanClass(). ABSENT = an older Rello. */
  planClass: z7.string().min(1).optional()
});
var PLAN_GRANTS_READ_ERROR_CODES = ["no_plan_grants", "plan_grants_unavailable"];
var planGrantsReadErrorSchema = z7.object({ error: z7.enum(PLAN_GRANTS_READ_ERROR_CODES) });
var addOnUnitPriceSchema = z7.object({
  monthly: z7.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable(),
  yearly: z7.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable()
});
var addOnOneTimePriceSchema = z7.object({
  monthly: z7.null(),
  yearly: z7.null(),
  once: z7.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable()
});
var TENANT_ADD_ON_STATUSES = ["ACTIVE", "TRIALING", "PAST_DUE", "CANCELED", "INCOMPLETE"];
var v1AddOnTenantSubscriptionSchema = z7.object({
  status: z7.string().min(1),
  quantity: z7.number().int().nonnegative(),
  requestedQuantity: z7.number().int().nonnegative().nullable(),
  quantityRev: z7.string().regex(/^\d{1,19}$/).nullable(),
  trialEndsAt: z7.string().datetime({ offset: true }).nullable()
});
var v1AddOnReadFields = {
  id: z7.string().min(1),
  appSlug: z7.string().min(1),
  name: z7.string().min(1),
  isActive: z7.boolean(),
  tenantAddOn: v1AddOnTenantSubscriptionSchema.nullable()
};
var v1AddOnReadSchema = z7.discriminatedUnion("type", [
  z7.object({ ...v1AddOnReadFields, type: z7.literal("RECURRING"), price: addOnUnitPriceSchema }),
  z7.object({ ...v1AddOnReadFields, type: z7.literal("ONE_TIME"), price: addOnOneTimePriceSchema })
]);
var v1AddOnsReadResponseSchema = z7.object({ addOns: z7.array(v1AddOnReadSchema) });
var ADD_ONS_READ_ERROR_CODES = ["add_ons_unavailable"];
var addOnsReadErrorSchema = z7.object({ error: z7.enum(ADD_ONS_READ_ERROR_CODES) });
var ADD_ON_START_IDEMPOTENCY_HEADER = "X-Idempotency-Key";
var addOnStartRequestSchema = z7.object({
  addOnId: z7.string().min(1),
  quantity: z7.number().int().positive().optional(),
  trial: z7.boolean().optional(),
  quantityRev: z7.union([z7.number().int().nonnegative(), z7.string().regex(/^\d{1,18}$/)]).optional()
}).strict();
var addOnStartResponseSchema = z7.object({
  success: z7.literal(true),
  data: z7.object({
    tenantAddOnId: z7.string().min(1),
    status: z7.string().min(1),
    trialEndsAt: z7.string().datetime({ offset: true }).nullable().optional()
  })
});
var addOnStartErrorSchema = z7.object({
  success: z7.literal(false),
  error: z7.string().min(1),
  code: z7.string().min(1).optional()
}).loose();
var ADD_ON_START_ERROR_CODES = [
  "not_a_check_your_rate_addon",
  "payment_method_required",
  "tenant_not_found",
  "addon_already_active",
  "addon_state_unknown",
  "already_entitled",
  "engine_required",
  "trial_already_used",
  "addon_price_not_configured",
  "stripe_failed"
];

// src/types/plan-class.ts
var PLAN_CLASSES = ["rello", "app"];
var KNOWN = new Set(PLAN_CLASSES);
function isPlanClass(value) {
  return KNOWN.has(value);
}

// src/types/embed-token.ts
import { z as z8 } from "zod";
var embedTokenId = z8.string().min(1);
var embedTokenTime = z8.iso.datetime({ offset: true });
var EMBED_SURFACES = ["identity", "rate-widget"];
var EMBED_TOKEN_SCOPES = ["hs:identity-editor", "hs:rate-widget"];
var EMBED_SURFACE_SCOPE = Object.freeze({
  identity: "hs:identity-editor",
  "rate-widget": "hs:rate-widget"
});
var EMBED_TOKEN_AUDIENCE = "home-scout";
var EMBED_TOKEN_PREFIX = "rpe_";
var embedTokenScope = z8.enum(EMBED_TOKEN_SCOPES);
var embedTokenMintRequestSchema = z8.object({
  agentId: embedTokenId,
  surface: z8.enum(EMBED_SURFACES)
}).strict();
var embedTokenMintResponseSchema = z8.object({
  token: z8.string().startsWith(EMBED_TOKEN_PREFIX).min(EMBED_TOKEN_PREFIX.length + 1),
  /** ISO-8601. */
  expiresAt: embedTokenTime,
  audience: z8.literal(EMBED_TOKEN_AUDIENCE),
  scope: embedTokenScope,
  tenantId: embedTokenId,
  agentId: embedTokenId
}).strict();
var embedTokenVerifyRequestSchema = z8.object({
  token: z8.string().min(1)
}).strict();
var EMBED_TOKEN_INVALID_REASONS = ["expired", "revoked", "unknown_token"];
var embedTokenVerifyValidSchema = z8.object({
  valid: z8.literal(true),
  tenantId: embedTokenId,
  agentId: embedTokenId,
  scope: embedTokenScope,
  /** ISO-8601. */
  expiresAt: embedTokenTime
}).strict();
var embedTokenVerifyInvalidSchema = z8.object({
  valid: z8.literal(false),
  reason: z8.enum(EMBED_TOKEN_INVALID_REASONS)
}).strict();
var embedTokenVerifyResponseSchema = z8.discriminatedUnion("valid", [
  embedTokenVerifyValidSchema,
  embedTokenVerifyInvalidSchema
]);
var tenantAppAccessResponseSchema = z8.object({
  tenantId: embedTokenId,
  servable: z8.boolean()
}).strict();
var EMBED_TOKEN_ERRORS = Object.freeze({
  UNKNOWN_FIELD: "UNKNOWN_FIELD",
  INVALID_BODY: "invalid_body",
  AGENT_NOT_IN_TENANT: "agent_not_in_tenant",
  AGENT_INACTIVE: "agent_inactive",
  HOME_SCOUT_NOT_ENABLED: "home_scout_not_enabled",
  TENANT_NOT_SERVABLE: "tenant_not_servable",
  EMBED_TOKEN_UNAVAILABLE: "embed_token_unavailable",
  TENANT_APP_ACCESS_UNAVAILABLE: "tenant_app_access_unavailable"
});
var EMBED_TOKEN_ERROR_STATUS = Object.freeze({
  UNKNOWN_FIELD: 400,
  invalid_body: 400,
  agent_not_in_tenant: 404,
  agent_inactive: 409,
  home_scout_not_enabled: 409,
  tenant_not_servable: 409,
  embed_token_unavailable: 503,
  tenant_app_access_unavailable: 503
});
var EMBED_TOKEN_REFRESH_MESSAGE = "pfp-embed:token-refresh";
var EMBED_TOKEN_MESSAGE = "pfp-embed:token";
var EMBED_SESSION_EXPIRED_MESSAGE = "pfp-embed:session-expired";

// src/index.ts
function createRelloClient(config) {
  return new RelloClient(config);
}
function createServiceClient(config) {
  return new ServiceClient(config);
}
export {
  ADDON_QUANTITY_ERROR_CODES,
  ADDON_QUANTITY_IDEMPOTENCY_ERROR_CODES,
  ADDON_QUANTITY_IDEMPOTENCY_HEADER,
  ADDON_QUANTITY_IDEMPOTENCY_KEY_LENGTH,
  ADD_ONS_READ_ERROR_CODES,
  ADD_ON_CHARGE_ONCE_ERROR_CODES,
  ADD_ON_CHARGE_ONCE_IDEMPOTENCY_HEADER,
  ADD_ON_CHARGE_ONCE_IDEMPOTENCY_HEADER_ALIAS,
  ADD_ON_CHARGE_ONCE_MANUAL_REASONS,
  ADD_ON_START_ERROR_CODES,
  ADD_ON_START_IDEMPOTENCY_HEADER,
  AdminResource,
  AuthResource,
  EMBED_SESSION_EXPIRED_MESSAGE,
  EMBED_SURFACES,
  EMBED_SURFACE_SCOPE,
  EMBED_TOKEN_AUDIENCE,
  EMBED_TOKEN_ERRORS,
  EMBED_TOKEN_ERROR_STATUS,
  EMBED_TOKEN_INVALID_REASONS,
  EMBED_TOKEN_MESSAGE,
  EMBED_TOKEN_PREFIX,
  EMBED_TOKEN_REFRESH_MESSAGE,
  EMBED_TOKEN_SCOPES,
  PLAN_CLASSES,
  PLAN_GRANTS_READ_ERROR_CODES,
  PLAN_SWITCH_DEDICATED_ERROR_CODES,
  PLAN_SWITCH_ERROR_CODES,
  PLAN_SWITCH_INTERVALS,
  PLAN_SWITCH_KEEP_ADDONS,
  PLAN_TRIAL_START_ERROR_CODES,
  PREVIEW_STALE_REASONS,
  PROPERTY_AUTOFILL_FIELD_KEYS,
  PlanSwitchApiError,
  ROSTER_ERROR_CODES,
  RelloAuthError,
  RelloClient,
  RelloError,
  RelloForbiddenError,
  RelloNotFoundError,
  RelloRateLimitError,
  RelloUnavailableError,
  RelloValidationError,
  ServiceClient,
  TENANT_ADD_ON_STATUSES,
  V1_TENANT_MATCH_ERRORS,
  addOnChargeOnceAnswerSchema,
  addOnChargeOnceChargedSchema,
  addOnChargeOnceDeclinedSchema,
  addOnChargeOnceErrorSchema,
  addOnChargeOnceManualSchema,
  addOnChargeOnceQuerySchema,
  addOnChargeOnceRequestIdSchema,
  addOnChargeOnceRequestSchema,
  addOnChargeOnceUnknownSchema,
  addOnOneTimePriceSchema,
  addOnQuantityErrorSchema,
  addOnQuantityOtherErrorSchema,
  addOnQuantityRequestSchema,
  addOnQuantityResponseSchema,
  addOnStartErrorSchema,
  addOnStartRequestSchema,
  addOnStartResponseSchema,
  addOnUnitPriceSchema,
  addOnsReadErrorSchema,
  agentProvisionPayloadSchema,
  alreadyMemberSchema,
  appNotEnabledForTenantError,
  businessIndustry,
  businessType,
  callerHasPermission,
  callerTenantScope,
  chargeConflict,
  createPlatformKeyValidator,
  createRelloClient,
  createRelloPermissionSelfCheck,
  createServiceBearerGuard,
  createServiceClient,
  embedTokenMintRequestSchema,
  embedTokenMintResponseSchema,
  embedTokenVerifyInvalidSchema,
  embedTokenVerifyRequestSchema,
  embedTokenVerifyResponseSchema,
  embedTokenVerifyValidSchema,
  extraMlosExceedQuantityErrorSchema,
  feeChangedConflict,
  feeNotFound,
  feeSlugQuery,
  getHarvestHomeBaseUrl,
  getImplicitApiKeyCount,
  getImplicitApiKeyUses,
  getMiloBaseUrl,
  getOvenBaseUrl,
  getPathfinderProBaseUrl,
  getPropertyEngineBaseUrl,
  getPropertyEngineHeaders,
  getRelloBaseUrl,
  hasPropertyEngineCredentials,
  internalError,
  isExtraMlosExceedQuantityError,
  isInAnchorWindow,
  isMembersExceedQuantityError,
  isMembersExceedTargetError,
  isPlanClass,
  isRosterErrorCode,
  loginQuantityNeededSchema,
  loginlessAgentCreateRequestSchema,
  loginlessAgentCreateResponseSchema,
  loginlessAgentRemoveRequestSchema,
  loginlessAgentRemoveResponseSchema,
  membersExceedQuantityErrorSchema,
  membersExceedTargetErrorSchema,
  oneTimeFeeQuote,
  parseAgentPayload,
  parseTenantPayload,
  planGrantsReadErrorSchema,
  planGrantsReadResponseSchema,
  planSwitchAppliedResponseSchema,
  planSwitchErrorSchema,
  planSwitchOpenResponseSchema,
  planSwitchOperationResponseSchema,
  planSwitchOtherErrorSchema,
  planSwitchPreviewLineSchema,
  planSwitchPreviewQuerySchema,
  planSwitchPreviewResponseSchema,
  planSwitchPreviewSubscriptionSchema,
  planSwitchRequestSchema,
  planSwitchResponseSchema,
  planSwitchStepSchema,
  planTrialStartErrorSchema,
  planTrialStartRequestSchema,
  planTrialStartResponseSchema,
  planTrialStateSchema,
  previewStaleErrorSchema,
  provisionedAgentSchema,
  quoteVersion,
  registrationConflict,
  resetImplicitApiKeyUses,
  rosterErrorSchema,
  runRelloPermissionSelfCheck,
  setupChargeChangedEvent,
  setupChargeEnvelope,
  setupChargeRequest,
  setupChargeStatus,
  signatureQuantityNeededSchema,
  smsOtpRequest,
  smsRegistrationChangedEvent,
  smsRegistrationEnvelope,
  smsRegistrationRequest,
  smsRegistrationStatus,
  switchInProgressErrorSchema,
  teamLoginRosterMemberSchema,
  teamLoginRosterQuerySchema,
  teamLoginRosterResponseSchema,
  teamMemberCreateRequestSchema,
  teamMemberCreateResponseSchema,
  teamMemberRemoveRequestSchema,
  teamMemberRemoveResponseSchema,
  teamMemberSignInLinkRequestSchema,
  teamMemberSignInLinkResponseSchema,
  tenantAppAccessResponseSchema,
  tenantCyrStateSchema,
  tenantDisablePayloadSchema,
  tenantEnablePayloadSchema,
  tenantPlanGrantsSchema,
  tenantProvisioningPayloadSchema,
  v1AddOnReadSchema,
  v1AddOnTenantSubscriptionSchema,
  v1AddOnsReadResponseSchema,
  v1TenantMatchErrorSchema
};
//# sourceMappingURL=index.js.map