export interface EnrollFlowInput {
  leadId: string;
  flowSlug: string;
  source?: string;
  context?: Record<string, unknown>;
}

export interface EnrollJourneyInput {
  leadId: string;
  journeySlug: string;
  source?: string;
  context?: Record<string, unknown>;
  goalContext?: {
    intent: string;
    constraints: string[];
    urgency: string;
  };
}

export interface Enrollment {
  id: string;
  journeyId: string;
  leadId: string;
  tenantId: string;
  status: string;
  enrollmentSource: string;
  enrolledAt: string;
}
