/**
 * Promise-to-pay ledger + append-only audit trail.
 * Persisted as JSON under ./data so a demo run leaves an inspectable artifact.
 */
import fs from "node:fs";
import path from "node:path";
import type { AuditEvent, PromiseToPay } from "./types.js";

export class Ledger {
  private promises: PromiseToPay[] = [];
  private audit: AuditEvent[] = [];
  private contacts: { customerId: string; mandateId: string; at: string }[] = [];

  constructor(private dir = "data") {}

  addPromise(p: PromiseToPay): void {
    this.promises.push(p);
  }

  updatePromiseStatus(id: string, status: PromiseToPay["status"]): void {
    const p = this.promises.find((x) => x.id === id);
    if (p) p.status = status;
  }

  pendingPromises(): PromiseToPay[] {
    return this.promises.filter((p) => p.status === "pending");
  }

  allPromises(): PromiseToPay[] {
    return [...this.promises];
  }

  recordContact(customerId: string, mandateId: string, at: Date): void {
    this.contacts.push({ customerId, mandateId, at: at.toISOString() });
  }

  contactsInLast7Days(mandateId: string, now: Date): number {
    const cutoff = now.getTime() - 7 * 86400000;
    return this.contacts.filter((c) => c.mandateId === mandateId && new Date(c.at).getTime() >= cutoff).length;
  }

  log(event: AuditEvent): void {
    this.audit.push(event);
  }

  auditTrail(): AuditEvent[] {
    return [...this.audit];
  }

  persist(): void {
    fs.mkdirSync(this.dir, { recursive: true });
    fs.writeFileSync(path.join(this.dir, "promises.json"), JSON.stringify(this.promises, null, 2));
    fs.writeFileSync(path.join(this.dir, "audit-trail.json"), JSON.stringify(this.audit, null, 2));
  }
}
