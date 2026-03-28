export interface EmitSignalInput {
  type: string;
  leadId?: string;
  priority?: "low" | "normal" | "high" | "critical";
  data?: Record<string, unknown>;
  source?: string;
}
