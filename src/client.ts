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
import { AgentsResource } from "./resources/agents.js";
import { TagsResource } from "./resources/tags.js";
import { SegmentsResource } from "./resources/segments.js";
import { MiloResource } from "./resources/milo.js";
import { LeadSharesResource } from "./resources/lead-shares.js";
import { TeamResource } from "./resources/team.js";
import { ReportsResource } from "./resources/reports.js";
import { AuthResource } from "./resources/auth.js";
import { AdminResource } from "./resources/admin.js";
import type { ServiceClient } from "./service-client.js";
import { callerSite, recordImplicitApiKey } from "./implicit-apikey-telemetry.js";

export interface RelloClientConfig {
  /** Rello API base URL. Default: RELLO_API_URL env var. Must NOT include "/api". */
  baseUrl?: string;
  /** API key for authentication. Default: RELLO_API_KEY env var. */
  apiKey?: string;
  /**
   * Refuse to fall back to the RELLO_API_KEY env var — require `apiKey` to be
   * passed explicitly, and THROW at construction if it is not.
   *
   * Opt-in in v2.26.0 and the default in v3.0.0.
   *
   * WHY THIS EXISTS. The env fallback does not make a missing key silent — the
   * constructor already throws when nothing resolves. What it makes silent is a
   * WRONG key: a caller that means to use its own pair credential
   * (`<SPOKE>_TO_RELLO_API_KEY`) but forgets to pass it silently gets
   * RELLO_API_KEY instead. Both clients construct identically, and the mistake
   * surfaces later as a 401 on a different line in a different file. Three
   * spokes carry comments asking future authors to remember to pass one
   * explicitly, which is the shape this replaces: a rule that must be
   * remembered eventually is not.
   *
   * A startup failure is a fixable Tuesday. A silent deferral is a hundred days.
   */
  requireExplicitApiKey?: boolean;
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
  public readonly agents: AgentsResource;
  public readonly tags: TagsResource;
  public readonly segments: SegmentsResource;
  public readonly milo: MiloResource;
  public readonly leadShares: LeadSharesResource;
  public readonly team: TeamResource;
  public readonly reports: ReportsResource;
  public readonly auth: AuthResource;
  public readonly admin: AdminResource;

  constructor(config: RelloClientConfig = {}) {
    const baseUrl = config.baseUrl
      ?? process.env.RELLO_API_URL
      ?? "";

    const apiKeyWasExplicit = config.apiKey !== undefined && config.apiKey !== "";
    const apiKey = config.apiKey
      ?? process.env.RELLO_API_KEY
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

    // The implicit-fallback path: a key resolved, but not from the caller.
    if (!apiKeyWasExplicit) {
      const site = callerSite();
      if (config.requireExplicitApiKey) {
        throw new Error(
          "@rello-platform/api-client: apiKey must be passed explicitly " +
          "(requireExplicitApiKey: true), but it was resolved from the " +
          "RELLO_API_KEY env var instead.\n" +
          `  constructed at: ${site}\n` +
          "  A spoke that means to use its own <SPOKE>_TO_RELLO_API_KEY and " +
          "omits it silently authenticates as whatever RELLO_API_KEY holds — " +
          "which fails later as a 401, far from this line."
        );
      }
      recordImplicitApiKey(site);
      console.warn(
        "[@rello-platform/api-client] DEPRECATED: apiKey resolved from the " +
        `RELLO_API_KEY env var rather than passed explicitly.\n` +
        `  constructed at: ${site}\n` +
        "  Pass the key this caller actually intends. The fallback is removed " +
        "in v3.0.0, and until then it silently substitutes RELLO_API_KEY for a " +
        "key you may not have meant."
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
  async service(slug: string): Promise<ServiceClient> {
    return this.platform.resolveService(slug);
  }
}
