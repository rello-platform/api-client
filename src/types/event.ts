export interface CreateEventInput {
  type: string;
  leadId?: string;
  data?: Record<string, unknown>;
  source?: string;
  actorType?: "SYSTEM" | "USER" | "AGENT" | "MLO" | "LEAD" | "ENGINE" | "API";
  actorId?: string;
  title?: string;
  description?: string;
  visibility?: "ALL" | "AGENT_ONLY" | "SYSTEM_ONLY";
}

export interface Event {
  id: string;
  leadId: string | null;
  tenantId: string;
  eventType: string;
  sourceApp: string;
  actorType: string;
  title: string | null;
  description: string | null;
  data: Record<string, unknown> | null;
  createdAt: string;
}
