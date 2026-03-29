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
  leadId: string;
  tenantId: string;
  eventType: string;
  sourceApp: string;
  actorType: string;
  actorId: string | null;
  title: string | null;
  description: string | null;
  eventData: Record<string, unknown>;
  visibility: string;
  createdAt: string;
}
