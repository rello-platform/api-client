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
    let body;
    try {
      body = await res.json();
    } catch {
      body = await res.text().catch(() => null);
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
var LeadsResource = class {
  constructor(transport) {
    this.transport = transport;
  }
  async create(tenantId, data) {
    const res = await this.transport.post(
      "/leads",
      tenantId,
      data
    );
    return "lead" in res ? res.lead : res;
  }
  async get(tenantId, id) {
    return this.transport.get(`/leads/${id}`, tenantId);
  }
  async update(tenantId, id, data) {
    const res = await this.transport.patch(
      `/leads/${id}`,
      tenantId,
      data
    );
    return "lead" in res ? res.lead : res;
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
      const leads = Array.isArray(res) ? res : res.leads;
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
    if (params.agentId) query.agentId = params.agentId;
    if (params.email) query.email = params.email;
    if (params.search) {
      query.search = params.search;
    } else if (params.email) {
      query.search = params.email;
    }
    const res = await this.transport.get(
      "/leads",
      tenantId,
      query
    );
    return {
      leads: res.leads,
      total: res.total,
      page: res.page,
      totalPages: res.totalPages
    };
  }
  async applyTags(tenantId, id, tags) {
    await this.transport.post(`/leads/${id}/tags`, tenantId, { tags });
  }
  async setCustomFields(tenantId, id, fields) {
    await this.transport.patch(`/leads/${id}/custom-fields`, tenantId, { customFields: fields });
  }
  async getConversionScore(tenantId, id) {
    return this.transport.get(
      `/leads/${id}/conversion-score`,
      tenantId
    );
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
    const res = await this.transport.get(`/leads/${id}/nurture-decisions`, tenantId, query);
    return res.decisions;
  }
  /**
   * Query leads by tag combinations (AND/OR with optional exclusions).
   *
   * POST /api/v1/leads/by-tags
   *
   * Used for audience segmentation in Newsletter Studio's smart content matching.
   */
  async findByTags(tenantId, input) {
    return this.transport.post(
      "/leads/by-tags",
      tenantId,
      input
    );
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
    return this.transport.getRaw(`/leads/${leadId}/context-cache`, tenantId);
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
};

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

// src/client.ts
var RelloClient = class {
  constructor(config = {}) {
    const baseUrl = config.baseUrl ?? process.env.RELLO_API_URL ?? "";
    const apiKey = config.apiKey ?? process.env.RELLO_APP_SECRET ?? process.env.RELLO_API_KEY ?? "";
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

// src/platform-key-validator.ts
import { createHash } from "crypto";
function createPlatformKeyValidator(config) {
  const baseUrl = config.relloApiUrl.replace(/\/+$/, "").replace(/\/api\/?$/, "");
  const targetApp = config.ownAppSlug.toUpperCase().replace(/-/g, "_");
  const cacheTtlMs = config.cacheTtlMs ?? 5 * 60 * 1e3;
  let keyCache = [];
  let lastFetchTime = 0;
  let fetchInProgress = null;
  async function refreshCache() {
    try {
      const url = `${baseUrl}/api/v1/platform/service-keys?targetApp=${encodeURIComponent(targetApp)}`;
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${config.relloApiKey}`,
          "Content-Type": "application/json"
        },
        signal: AbortSignal.timeout(1e4)
      });
      if (!res.ok) {
        console.warn(
          `[PlatformKeyValidator] Failed to fetch service keys: ${res.status} ${res.statusText}`
        );
        return;
      }
      const data = await res.json();
      const keys = data.keys;
      if (!Array.isArray(keys)) {
        console.warn("[PlatformKeyValidator] Invalid response: keys is not an array");
        return;
      }
      keyCache = keys.map((k) => {
        const entry = k;
        return {
          id: String(entry.id ?? ""),
          appSource: String(entry.appSource ?? ""),
          keyHash: String(entry.keyHash ?? ""),
          permissions: Array.isArray(entry.permissions) ? entry.permissions.map(String) : []
        };
      });
      lastFetchTime = Date.now();
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        console.warn("[PlatformKeyValidator] Rello request timed out, using cached keys");
      } else {
        console.warn(
          "[PlatformKeyValidator] Rello unreachable, using cached keys:",
          error instanceof Error ? error.message : "unknown error"
        );
      }
    }
  }
  async function ensureFreshCache() {
    if (Date.now() - lastFetchTime < cacheTtlMs) return;
    if (!fetchInProgress) {
      fetchInProgress = refreshCache().finally(() => {
        fetchInProgress = null;
      });
    }
    await fetchInProgress;
  }
  return async function validatePlatformCaller(request) {
    const authHeader = request.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return null;
    const token = authHeader.slice(7);
    if (!token) return null;
    const tokenHash = createHash("sha256").update(token).digest("hex");
    await ensureFreshCache();
    const match = keyCache.find((k) => k.keyHash === tokenHash);
    if (!match) return null;
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
    return {
      appSource: match.appSource,
      keyId: match.id,
      permissions: match.permissions
    };
  };
}
function callerHasPermission(caller, required) {
  if (caller.permissions.includes("*")) return true;
  return caller.permissions.includes(required);
}

// src/types/provisioning.ts
import { z } from "zod";
var provisionedAgentSchema = z.object({
  relloAgentId: z.string(),
  email: z.string().email(),
  firstName: z.string(),
  lastName: z.string(),
  slug: z.string(),
  role: z.string(),
  // "MLO" | "BROKER" | "AGENT" — kept as string for forward-compat
  phone: z.string().nullable(),
  // Optional profile fields — present when the agent has filled them in
  photoUrl: z.string().optional(),
  bio: z.string().optional(),
  title: z.string().optional(),
  tagline: z.string().optional(),
  brokerageName: z.string().optional(),
  brokerageLogoUrl: z.string().optional(),
  brokerageLicenseNumber: z.string().optional(),
  licenseNumber: z.string().optional(),
  licenseState: z.string().optional(),
  nmlsNumber: z.string().optional(),
  websiteUrl: z.string().optional(),
  applicationUrl: z.string().optional(),
  social: z.unknown().optional(),
  // Tenant-owner MLO info — applied to ALL agents in the tenant-enable payload.
  // For solo MLOs this is the agent's own NMLS; for brokerages it's the owner's.
  mloName: z.string().optional(),
  mloNmls: z.string().optional(),
  // PTA-013 F-06: Milo profile + wizard answers per agent in tenant-enable payloads.
  // Present when agent has completed the Rello Start Wizard. Only sent in
  // tenant-enable (bulk) — per-agent provision carries these at the top level.
  agentProfile: z.lazy(() => agentProfileSchema).optional(),
  wizardAnswers: z.array(z.lazy(() => wizardAnswerSchema)).optional()
});
var tenantEnablePayloadSchema = z.object({
  action: z.literal("enable"),
  relloTenantId: z.string(),
  tenant: z.object({
    name: z.string(),
    slug: z.string(),
    logoUrl: z.string().nullable(),
    primaryColor: z.string().nullable(),
    physicalAddress: z.string().nullable(),
    applicationUrl: z.string().nullable(),
    type: z.string(),
    // Rello TenantType enum
    plan: z.string()
    // Rello Plan enum
  }),
  agents: z.array(provisionedAgentSchema),
  // HH-specific: initial credit grant for new tenants. Optional — only
  // sent when the spoke app has a credit system (currently only HH).
  // Spokes without credits ignore this field.
  creditAllocation: z.object({
    initialBalance: z.number().optional(),
    poolSize: z.number().nullable().optional()
  }).optional()
});
var tenantDisablePayloadSchema = z.object({
  action: z.literal("disable"),
  relloTenantId: z.string(),
  reason: z.string().optional()
});
var tenantProvisioningPayloadSchema = z.discriminatedUnion("action", [
  tenantEnablePayloadSchema,
  tenantDisablePayloadSchema
]);
var agentProfileSchema = z.object({
  specialtySentence: z.string().optional(),
  experienceStatement: z.string().optional(),
  typicalClient: z.unknown().optional(),
  areasServed: z.unknown().optional(),
  designations: z.unknown().optional(),
  emailTone: z.string().optional(),
  soloOrTeam: z.string().optional(),
  preferredContactMethod: z.string().optional(),
  calendarLink: z.string().optional(),
  aboutMeFacts: z.unknown().optional(),
  avoidTopics: z.unknown().optional(),
  emphasizeTopics: z.unknown().optional(),
  sensitiveTopics: z.unknown().optional(),
  introductionDraft: z.string().optional(),
  signoffStyle: z.string().optional(),
  successStorySeeds: z.unknown().optional(),
  sendFrequency: z.string().optional(),
  newsletterTemplateId: z.string().optional(),
  brandColors: z.unknown().optional(),
  leadSourceContext: z.unknown().optional()
});
var wizardAnswerSchema = z.object({
  questionId: z.string(),
  question: z.string(),
  answer: z.unknown()
});
var agentProvisionPayloadSchema = z.object({
  action: z.enum(["add", "update", "remove"]),
  relloTenantId: z.string(),
  agent: provisionedAgentSchema,
  agentProfile: agentProfileSchema.optional(),
  wizardAnswers: z.array(wizardAnswerSchema).optional(),
  // PTA-013 F-05: Tenant physical address sent alongside per-agent sync.
  // CAN-SPAM compliance — spokes persist this on their local Tenant model.
  physicalAddress: z.unknown().nullable().optional()
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

// src/index.ts
function createRelloClient(config) {
  return new RelloClient(config);
}
function createServiceClient(config) {
  return new ServiceClient(config);
}
export {
  AdminResource,
  AuthResource,
  RelloAuthError,
  RelloClient,
  RelloError,
  RelloForbiddenError,
  RelloNotFoundError,
  RelloRateLimitError,
  RelloUnavailableError,
  RelloValidationError,
  ServiceClient,
  agentProvisionPayloadSchema,
  callerHasPermission,
  createPlatformKeyValidator,
  createRelloClient,
  createServiceClient,
  parseAgentPayload,
  parseTenantPayload,
  provisionedAgentSchema,
  tenantDisablePayloadSchema,
  tenantEnablePayloadSchema,
  tenantProvisioningPayloadSchema
};
//# sourceMappingURL=index.js.map