/** All money values are integer paise to avoid float rounding. */
export type Paise = number;

export type MandateFailureCode =
  | "INSUFFICIENT_FUNDS"
  | "MANDATE_PAUSED_BY_USER"
  | "ACCOUNT_DORMANT"
  | "BANK_DOWNTIME"
  | "MANDATE_REVOKED";

export interface Customer {
  id: string;
  name: string;
  phone: string;
  languagePref: "hinglish" | "hindi" | "english";
  /** Day of month salary usually lands (1-31), if known. */
  salaryDay?: number;
  /** Customer has previously asked not to be contacted. Hard stop. */
  optedOut: boolean;
}

export interface FailedMandate {
  id: string;
  customerId: string;
  merchant: string;
  amount: Paise;
  failureCode: MandateFailureCode;
  failedAt: string; // ISO
  /** NPCI-style retry attempts already consumed. */
  retriesUsed: number;
}

export type PromiseStatus = "pending" | "kept" | "broken" | "cancelled";

export interface PromiseToPay {
  id: string;
  mandateId: string;
  customerId: string;
  amount: Paise;
  /** The raw Hinglish phrase the customer used ("parso kar dunga"). */
  quotedPhrase: string;
  /** Resolved concrete retry timestamp (ISO, IST). */
  promisedAt: string;
  createdAt: string;
  status: PromiseStatus;
  confidence: "high" | "medium" | "low";
}

export type ConversationOutcome =
  | { kind: "promise"; promise: PromiseToPay }
  | { kind: "opt_out" }
  | { kind: "dispute_escalated"; reason: string }
  | { kind: "no_commitment" }
  | { kind: "blocked_by_compliance"; rule: string };

export interface AuditEvent {
  at: string; // ISO (virtual clock)
  actor: "agent" | "compliance" | "scheduler" | "customer";
  mandateId: string;
  action: string;
  detail: string;
  /** The compliance rule that permitted or blocked this action. */
  ruleApplied?: string;
}
