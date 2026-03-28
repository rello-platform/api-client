export interface Lead {
  id: string;
  email: string | null;
  phone: string | null;
  firstName: string | null;
  lastName: string | null;
  currentStage: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  referralSource: string | null;
  customFields: Record<string, unknown> | null;
  tenantId: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateLeadInput {
  email?: string;
  phone?: string;
  firstName?: string;
  lastName?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  referralSource?: string;
  source?: string;
  tags?: string[];
  customFields?: Record<string, unknown>;
}

export interface UpdateLeadInput {
  email?: string;
  phone?: string;
  firstName?: string;
  lastName?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  currentStage?: string;
  customFields?: Record<string, unknown>;
  coBorrowerFirstName?: string;
  coBorrowerLastName?: string;
  coBorrowerSource?: string;
  coBorrowerUpdatedAt?: string;
  [key: string]: unknown;
}

export interface ListLeadsParams {
  limit?: number;
  offset?: number;
  page?: number;
  tags?: string[];
  email?: string;
  search?: string;
  stage?: string;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}

export interface ConversionScore {
  score: number;
  factors: Record<string, unknown>;
  updatedAt: string;
}
