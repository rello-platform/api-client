import { Transport, type TransportConfig } from "./transport.js";
import { LeadsResource } from "./resources/leads.js";
import { SignalsResource } from "./resources/signals.js";
import { EventsResource } from "./resources/events.js";
import { ActivitiesResource } from "./resources/activities.js";
import { FlowsResource, JourneysResource } from "./resources/flows.js";
import { SettingsResource } from "./resources/settings.js";
import { BillingResource } from "./resources/billing.js";
import { CommunicationsResource } from "./resources/communications.js";
import { PromptsResource } from "./resources/prompts.js";
import { WebhooksResource } from "./resources/webhooks.js";
import { PlatformResource } from "./resources/platform.js";
import type { ServiceClient } from "./service-client.js";

export interface RelloClientConfig {
  /** Rello API base URL. Default: RELLO_API_URL env var. Must NOT include "/api". */
  baseUrl?: string;
  /** API key for authentication. Default: RELLO_API_KEY or RELLO_APP_SECRET env var. */
  apiKey?: string;
  /** This app's slug identifier. Default: APP_SLUG env var. */
  appSlug?: string;
  /**
   * Signal router secret for batch signal emission.
   * Default: RELLO_SIGNAL_KEY or SIGNAL_ROUTER_SECRET env var.
   *
   * The batch signal endpoint (/api/signals/batch) uses a different credential
   * than the standard v1 API. If not set, emitBatch() falls back to sequential
   * single-signal calls using the standard API key.
   */
  signalKey?: string;
  /** Per-method timeout overrides in milliseconds. */
  timeouts?: Partial<TransportConfig["timeouts"]>;
  /** Number of retry attempts for transient errors. Default: 3. */
  retryAttempts?: number;
  /** Consecutive failures before circuit breaker opens. Default: 5. */
  circuitBreakerThreshold?: number;
  /** Circuit breaker cooldown in ms. Default: 30000. */
  circuitBreakerCooldownMs?: number;
}

export class RelloClient {
  public readonly leads: LeadsResource;
  public readonly signals: SignalsResource;
  public readonly events: EventsResource;
  public readonly activities: ActivitiesResource;
  public readonly flows: FlowsResource;
  public readonly journeys: JourneysResource;
  public readonly settings: SettingsResource;
  public readonly billing: BillingResource;
  public readonly communications: CommunicationsResource;
  public readonly prompts: PromptsResource;
  public readonly webhooks: WebhooksResource;
  public readonly platform: PlatformResource;

  constructor(config: RelloClientConfig = {}) {
    const baseUrl = config.baseUrl
      ?? process.env.RELLO_API_URL
      ?? "";

    const apiKey = config.apiKey
      ?? process.env.RELLO_API_KEY
      ?? process.env.RELLO_APP_SECRET
      ?? "";

    const appSlug = config.appSlug
      ?? process.env.APP_SLUG
      ?? process.env.RELLO_APP_SLUG
      ?? "";

    if (!baseUrl) {
      throw new Error(
        "@rello-platform/api-client: baseUrl is required. " +
        "Set RELLO_API_URL env var or pass baseUrl in config."
      );
    }

    if (!apiKey) {
      throw new Error(
        "@rello-platform/api-client: apiKey is required. " +
        "Set RELLO_API_KEY env var or pass apiKey in config."
      );
    }

    // Resolve signal key — used for batch signal endpoint auth.
    // Treat empty string as unset (env vars can be "" in some runtimes).
    const rawSignalKey = config.signalKey
      || process.env.RELLO_SIGNAL_KEY
      || process.env.SIGNAL_ROUTER_SECRET
      || "";
    const signalKey = rawSignalKey.trim() || undefined;

    // Strip "/api" suffix from baseUrl — the transport appends "/api/v1" internally
    const normalizedBaseUrl = baseUrl.replace(/\/api\/?$/, "");

    const transport = new Transport({
      baseUrl: normalizedBaseUrl,
      apiKey,
      appSlug,
      timeouts: config.timeouts,
      retryAttempts: config.retryAttempts,
      circuitBreakerThreshold: config.circuitBreakerThreshold,
      circuitBreakerCooldownMs: config.circuitBreakerCooldownMs,
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
  async service(slug: string): Promise<ServiceClient> {
    return this.platform.resolveService(slug);
  }
}
