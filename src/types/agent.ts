export interface UpdateAgentInput {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  slug?: string;
  photoUrl?: string;
  bio?: string;
  brokerage?: string;
  brokerageLogoUrl?: string;
  licenseNumber?: string;
  nmlsNumber?: string;
  role?: string;
  status?: string;
}

export interface Agent {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  slug: string | null;
  photoUrl: string | null;
  bio: string | null;
  brokerage: string | null;
  brokerageLogoUrl: string | null;
  licenseNumber: string | null;
  nmlsNumber: string | null;
  role: string;
  status: string;
  teamName: string | null;
}
