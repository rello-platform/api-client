export interface TeamAgent {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  role: string;
  status: string;
  slug?: string;
  joinedAt?: string;
  lastActiveAt?: string;
  leadCount?: number;
  openDealsCount?: number;
  closedDealsThisMonth?: number;
}

export interface TeamStats {
  agentCount: number;
  leadCount: number;
  activeLeads: number;
  totalAgents?: number;
  activeAgents?: number;
  newslettersSentThisMonth?: number;
  avgOpenRate?: number;
  avgClickRate?: number;
}
