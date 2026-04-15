/** Input for POST /api/admin/ai/usage-log */
export interface LogAiUsageInput {
  /** Calling app identifier (e.g., "home-stretch", "milo-engine"). */
  callerApp: string;
  /** API endpoint that was called. */
  endpoint: string;
  /** Prompt slug used (if applicable). */
  promptSlug?: string | null;
  /** AI model used (e.g., "claude-sonnet-4-20250514"). */
  model?: string | null;
  /** Total tokens used. */
  tokensUsed?: number | null;
  /** Input/prompt tokens. */
  inputTokens?: number | null;
  /** Output/completion tokens. */
  outputTokens?: number | null;
  /** Estimated cost in USD. */
  estimatedCost?: number | null;
  /** Latency in milliseconds. */
  latencyMs?: number | null;
  /** Associated lead ID (if applicable). */
  leadId?: string | null;
  /** Whether the AI call succeeded. Defaults to true. */
  success?: boolean;
  /** Error type if the call failed. */
  errorType?: string | null;
}

/** Response from POST /api/admin/ai/usage-log */
export interface LogAiUsageResponse {
  logged: boolean;
  costCapExceeded: boolean;
  dailyCost: number;
  monthlyCost: number;
}
