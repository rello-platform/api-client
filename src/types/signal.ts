/**
 * Input for emitting a single signal to Rello's signal router.
 *
 * Field names match Rello's POST /api/signals contract:
 *   - `signalType` (not "type") — Rello returns 400 if missing
 *   - `leadId` (required) — Rello returns 400 if missing
 *   - `payload` (not "data") — Rello returns 400 if missing or non-object
 *   - `source` — Rello returns 400 if missing; auto-filled from appSlug
 */
export interface EmitSignalInput {
  /** Signal type identifier. Use dotted notation for namespacing (e.g., "homeready.assessment_completed"). */
  signalType: string;
  /** Rello lead ID this signal relates to. */
  leadId: string;
  /** Signal priority. The batch endpoint maps "NORMAL" to "MEDIUM" internally. */
  priority?: "CRITICAL" | "HIGH" | "MEDIUM" | "NORMAL" | "LOW";
  /** Arbitrary signal data. Sent as the `payload` field to Rello. */
  payload?: Record<string, unknown>;
  /** Custom fields to merge into the lead's customFields on Rello. Embedded inside `payload.customFields` before send. */
  customFields?: Record<string, unknown>;
  /** Source app identifier. Defaults to the client's appSlug if omitted. */
  source?: string;
  /** ISO 8601 timestamp. Used by the batch endpoint. Defaults to now if omitted. */
  timestamp?: string;
}

/** Result from a batch signal emission. */
export interface EmitSignalBatchResult {
  /** Number of signals successfully processed by Rello. */
  processed: number;
  /** Number of signals that failed processing. */
  failed: number;
  /** Total signals submitted. */
  total: number;
  /**
   * Per-signal error details. Present only when emitBatch falls back to
   * sequential individual calls (no signalKey configured). Apps can use
   * this to build dead-letter queues for failed signals.
   *
   * Not present when the batch endpoint is used directly — the server
   * returns only aggregate counts.
   */
  errors?: Array<{ signalType: string; leadId: string; error: string }>;
}
