export interface MiloOptimizationInput {
  newsletterId: string;
  flowId?: string;
  leadIds?: string[];
  articles?: Array<{ id: string; title: string; summary?: string; topics?: string[] }>;
  optimizationGoals?: {
    prioritize?: "opens" | "clicks" | "engagement";
    targetAudience?: string[];
  };
  mode?: string;
  currentScheduledTime?: string;
  subject?: string;
  content?: string;
  recipientCount?: number;
}

export interface MiloOptimizationResponse {
  success: boolean;
  suggestedSubject?: string;
  suggestedSendTime?: string;
  contentRecommendations?: string[];
  estimatedOpenRate?: number;
  [key: string]: unknown;
}

export interface MiloContentInput {
  leadId: string;
  newsletterId?: string;
  articles: Array<{ id: string; title: string; summary?: string; topics?: string[] }>;
  customContext?: Record<string, unknown>;
}

export interface MiloContentResponse {
  success: boolean;
  selectedArticles: string[];
  reasoning: string;
  [key: string]: unknown;
}
