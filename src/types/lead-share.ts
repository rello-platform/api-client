export interface LeadShareOwner {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
}

export interface LeadShareLead {
  id: string;
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  stage: string;
  score: number;
  owner: LeadShareOwner;
  tags?: Array<{ tag: { id: string; name: string; slug: string; color: string } }>;
}

export interface LeadShare {
  id: string;
  leadId: string;
  guestMLOId?: string;
  sharedWithTenantId?: string;
  permission: "none" | "notify" | "limited" | "full";
  allowMLONewsletters: boolean;
  autoShared: boolean;
  createdAt: string;
  lead: LeadShareLead;
  sharedBy: LeadShareOwner;
}

export interface LeadSharesListParams {
  guestMLOId?: string;
  permission?: string;
  allowMLONewsletters?: boolean;
  includeRevoked?: boolean;
  limit?: number;
  offset?: number;
}
