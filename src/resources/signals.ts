import type { Transport } from "../transport.js";
import type { EmitSignalInput, EmitSignalBatchResult } from "../types/signal.js";

/** Maximum signals per batch call (enforced by Rello's zod schema). */
const MAX_BATCH_SIZE = 200;

/**
 * Signal emission resource.
 *
 * Single signals are sent to POST /api/v1/signals (v1 auth via database API key).
 * Batch signals are sent to POST /api/v1/signals/batch (requires signalKey —
 * a separate SIGNAL_ROUTER_SECRET credential). If no signalKey is configured,
 * emitBatch falls back to sequential single-signal calls.
 */
export class SignalsResource {
  constructor(
    private readonly transport: Transport,
    private readonly signalKey: string | undefined,
  ) {}

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
  async emit(tenantId: string, signal: EmitSignalInput): Promise<void> {
    // Validate required fields locally — fail fast with a clear message
    // instead of a cryptic 400 from Rello.
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
        "@rello-platform/api-client: signals.emit() requires source " +
        "(set appSlug in client config or source in the signal)"
      );
    }

    // Build payload — Rello requires a non-null object.
    // If customFields is provided, embed it inside payload.
    let payload: Record<string, unknown>;
    if (signal.customFields) {
      payload = { ...(signal.payload ?? {}), customFields: signal.customFields };
    } else {
      payload = signal.payload ?? {};
    }

    await this.transport.post("/signals", tenantId, {
      leadId: signal.leadId,
      source,
      signalType: signal.signalType,
      payload,
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
  async emitBatch(
    tenantId: string,
    signals: EmitSignalInput[],
  ): Promise<EmitSignalBatchResult> {
    if (signals.length === 0) {
      return { processed: 0, failed: 0, total: 0 };
    }

    if (signals.length > MAX_BATCH_SIZE) {
      throw new Error(
        `@rello-platform/api-client: emitBatch() accepts at most ${MAX_BATCH_SIZE} signals ` +
        `(received ${signals.length}). Split into multiple calls.`
      );
    }

    // If signalKey is available, use the batch endpoint (single HTTP call).
    if (this.signalKey) {
      return this.emitBatchDirect(tenantId, signals);
    }

    // No signalKey — fall back to sequential single-signal calls.
    return this.emitBatchFallback(tenantId, signals);
  }

  /**
   * Batch endpoint: POST /api/v1/signals/batch
   * Auth: Bearer {signalKey} (SIGNAL_ROUTER_SECRET, NOT the standard API key)
   */
  private async emitBatchDirect(
    tenantId: string,
    signals: EmitSignalInput[],
  ): Promise<EmitSignalBatchResult> {
    const appSlug = this.transport.getAppSlug();

    const batchPayload = signals.map((s) => {
      let payload: Record<string, unknown>;
      if (s.customFields) {
        payload = { ...(s.payload ?? {}), customFields: s.customFields };
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
        timestamp: s.timestamp ?? new Date().toISOString(),
      };
    });

    return this.transport.request<EmitSignalBatchResult>(
      "POST",
      "/signals/batch",
      {
        tenantId,
        body: { signals: batchPayload },
        timeout: "long",
        headers: {
          Authorization: `Bearer ${this.signalKey}`,
          "X-Source-App": appSlug,
        },
      },
    );
  }

  /**
   * Fallback: send each signal individually via the single-signal endpoint.
   * Slower (N HTTP calls) but works with standard v1 API key auth.
   *
   * Collects per-signal errors so callers can build dead-letter queues.
   */
  private async emitBatchFallback(
    tenantId: string,
    signals: EmitSignalInput[],
  ): Promise<EmitSignalBatchResult> {
    let processed = 0;
    let failed = 0;
    const errors: Array<{ signalType: string; leadId: string; error: string }> = [];

    for (const signal of signals) {
      try {
        await this.emit(tenantId, signal);
        processed++;
      } catch (err) {
        failed++;
        errors.push({
          signalType: signal.signalType,
          leadId: signal.leadId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Only include errors when there are actual failures — an empty array
    // is truthy and would trigger false alarms in callers checking `if (result.errors)`.
    const result: EmitSignalBatchResult = { processed, failed, total: signals.length };
    if (errors.length > 0) {
      result.errors = errors;
    }
    return result;
  }
}
