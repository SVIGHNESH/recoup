/**
 * RBI-style guardrails the agent cannot override.
 * Every check returns the rule ID that permitted or blocked the action,
 * so the audit trail can always answer "why was this allowed?".
 */
import type { Customer, FailedMandate } from "./types.js";

export const RULES = {
  CONTACT_HOURS: "R1: contact only 08:00-19:00 IST (RBI recovery-agent norms)",
  MAX_CONTACTS: "R2: max 3 contact attempts per mandate per 7 days",
  OPT_OUT: "R3: hard stop on customer opt-out / do-not-call",
  MAX_RETRIES: "R4: max 3 mandate re-presentations per failure (NPCI-style cap)",
  REVOKED: "R5: never retry a revoked mandate; escalate to merchant",
  PRE_DEBIT_NOTICE: "R6: pre-debit notification at least 24h before retry",
  DISPUTE_FREEZE: "R7: freeze all recovery activity once customer raises a dispute",
} as const;

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function istHour(date: Date): number {
  return new Date(date.getTime() + IST_OFFSET_MS).getUTCHours();
}

export interface ComplianceDecision {
  allowed: boolean;
  rule: string;
  detail: string;
}

export function canContact(
  customer: Customer,
  mandate: FailedMandate,
  now: Date,
  contactsInLast7Days: number,
): ComplianceDecision {
  if (customer.optedOut) {
    return { allowed: false, rule: RULES.OPT_OUT, detail: `${customer.name} is on the do-not-call list` };
  }
  const h = istHour(now);
  if (h < 8 || h >= 19) {
    return { allowed: false, rule: RULES.CONTACT_HOURS, detail: `current IST hour ${h} is outside 08:00-19:00` };
  }
  if (contactsInLast7Days >= 3) {
    return { allowed: false, rule: RULES.MAX_CONTACTS, detail: `${contactsInLast7Days} contacts already made this week` };
  }
  if (mandate.failureCode === "MANDATE_REVOKED") {
    return { allowed: false, rule: RULES.REVOKED, detail: "mandate was revoked by the customer; contact is merchant's job, not recovery's" };
  }
  return { allowed: true, rule: RULES.MAX_CONTACTS, detail: `contact ${contactsInLast7Days + 1}/3 this week, within hours` };
}

export function canRetryMandate(mandate: FailedMandate, retryAt: Date, now: Date): ComplianceDecision {
  if (mandate.failureCode === "MANDATE_REVOKED") {
    return { allowed: false, rule: RULES.REVOKED, detail: "revoked mandates are never re-presented" };
  }
  if (mandate.retriesUsed >= 3) {
    return { allowed: false, rule: RULES.MAX_RETRIES, detail: `${mandate.retriesUsed} retries already consumed` };
  }
  const hoursUntil = (retryAt.getTime() - now.getTime()) / 3600000;
  if (hoursUntil < 24) {
    return {
      allowed: false,
      rule: RULES.PRE_DEBIT_NOTICE,
      detail: `retry in ${hoursUntil.toFixed(1)}h leaves no room for the 24h pre-debit notification`,
    };
  }
  return { allowed: true, rule: RULES.PRE_DEBIT_NOTICE, detail: `retry ${hoursUntil.toFixed(0)}h out; pre-debit notice will be sent 24h prior` };
}

/** Clamp a promised retry time so the 24h pre-debit notice is always possible. */
export function clampRetryTime(promisedAt: Date, now: Date): { at: Date; clamped: boolean } {
  const minAt = new Date(now.getTime() + 24 * 3600000);
  if (promisedAt.getTime() < minAt.getTime()) return { at: minAt, clamped: true };
  return { at: promisedAt, clamped: false };
}
