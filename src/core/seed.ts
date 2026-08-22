import type { Customer, FailedMandate } from "./types.js";

export const customers: Customer[] = [
  { id: "c1", name: "Ramesh Gupta", phone: "+91-98xxxx1001", languagePref: "hinglish", salaryDay: 1, optedOut: false },
  { id: "c2", name: "Priya Sharma", phone: "+91-98xxxx1002", languagePref: "hinglish", salaryDay: 7, optedOut: false },
  { id: "c3", name: "Arjun Verma", phone: "+91-98xxxx1003", languagePref: "hinglish", optedOut: false },
  { id: "c4", name: "Sunita Devi", phone: "+91-98xxxx1004", languagePref: "hindi", salaryDay: 5, optedOut: false },
  { id: "c5", name: "Imran Khan", phone: "+91-98xxxx1005", languagePref: "hinglish", optedOut: true },
  { id: "c6", name: "Kavita Nair", phone: "+91-98xxxx1006", languagePref: "english", salaryDay: 30, optedOut: false },
  { id: "c7", name: "Deepak Yadav", phone: "+91-98xxxx1007", languagePref: "hinglish", optedOut: false },
  { id: "c8", name: "Meena Joshi", phone: "+91-98xxxx1008", languagePref: "hinglish", salaryDay: 10, optedOut: false },
];

/** Batch of failed UPI autopay mandates. Reference "now" for the demo is 2026-08-20T11:00 IST. */
export const failedMandates: FailedMandate[] = [
  { id: "m1", customerId: "c1", merchant: "FitLife Gym", amount: 149900, failureCode: "INSUFFICIENT_FUNDS", failedAt: "2026-08-19T06:30:00+05:30", retriesUsed: 1 },
  { id: "m2", customerId: "c2", merchant: "StreamBox OTT", amount: 49900, failureCode: "INSUFFICIENT_FUNDS", failedAt: "2026-08-19T07:00:00+05:30", retriesUsed: 0 },
  { id: "m3", customerId: "c3", merchant: "LearnKids EdTech", amount: 299900, failureCode: "MANDATE_PAUSED_BY_USER", failedAt: "2026-08-18T10:00:00+05:30", retriesUsed: 0 },
  { id: "m4", customerId: "c4", merchant: "SwasthBima Insurance", amount: 99900, failureCode: "INSUFFICIENT_FUNDS", failedAt: "2026-08-19T05:45:00+05:30", retriesUsed: 2 },
  { id: "m5", customerId: "c5", merchant: "FitLife Gym", amount: 149900, failureCode: "INSUFFICIENT_FUNDS", failedAt: "2026-08-19T06:00:00+05:30", retriesUsed: 0 },
  { id: "m6", customerId: "c6", merchant: "CloudDrive Pro", amount: 209900, failureCode: "BANK_DOWNTIME", failedAt: "2026-08-19T02:00:00+05:30", retriesUsed: 0 },
  { id: "m7", customerId: "c7", merchant: "StreamBox OTT", amount: 49900, failureCode: "MANDATE_REVOKED", failedAt: "2026-08-17T09:00:00+05:30", retriesUsed: 0 },
  { id: "m8", customerId: "c8", merchant: "SwasthBima Insurance", amount: 199900, failureCode: "INSUFFICIENT_FUNDS", failedAt: "2026-08-19T08:15:00+05:30", retriesUsed: 1 },
];
