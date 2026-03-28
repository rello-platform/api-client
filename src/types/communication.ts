export interface CanSendInput {
  leadId: string;
  channel: "email" | "sms" | "phone";
  urgency?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  senderId?: string;
  senderType?: string;
}

export interface CanSendResult {
  allowed: boolean;
  checks: Array<{
    name: string;
    passed: boolean;
    reason?: string;
  }>;
  blockedBy?: string;
}
