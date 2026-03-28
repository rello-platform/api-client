export interface CreateActivityInput {
  leadId: string;
  type: string;
  title?: string;
  description?: string;
  data?: Record<string, unknown>;
  source?: string;
}
