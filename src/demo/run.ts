/**
 * Batch demo: takes the seed batch of failed UPI mandates through the full
 * recovery loop — compliance gate → Hinglish negotiation → promise-to-pay
 * ledger → bounded retry scheduler (virtual clock) → recovery P&L + audit trail.
 *
 * Offline by default (scripted personas, no API key). Pass --live to have
 * Claude play both the agent and the customers (needs ANTHROPIC_API_KEY).
 */
import { customers, failedMandates } from "../core/seed.js";
import { parseHinglishWhen, formatIst } from "../core/hinglish-time.js";
import { canContact, canRetryMandate, clampRetryTime, RULES } from "../core/compliance.js";
import { Ledger } from "../core/ledger.js";
import { makeLlmClient, negotiateLive, negotiateOffline, type NegotiationResult } from "../agent/negotiator.js";
import type { FailedMandate, PromiseToPay } from "../core/types.js";

const LIVE = process.argv.includes("--live");
const NOW = new Date("2026-08-20T11:00:00+05:30"); // virtual clock start
const CONTACT_COST = 500; // paise per call (telephony)
const RETRY_COST = 50; // paise per mandate re-presentation

const rupees = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

/** Deterministic "did the customer actually pay when we retried?" — m4 breaks her promise once. */
function paymentSucceeds(mandateId: string, attempt: number): boolean {
  if (mandateId === "m4" && attempt === 0) return false;
  return true;
}

async function main() {
  const ledger = new Ledger();
  const client = LIVE ? makeLlmClient() : null;
  let contactSpend = 0;
  let retrySpend = 0;

  console.log(`\n💸 Recoup — batch recovery run (${LIVE ? "LIVE (LLM)" : "offline scripted"} mode)`);
  console.log(`Batch: ${failedMandates.length} failed mandates, ${rupees(failedMandates.reduce((s, m) => s + m.amount, 0))} at risk\n`);

  // ── Phase 1: contact + negotiate ────────────────────────────────────────
  for (const mandate of failedMandates) {
    const customer = customers.find((c) => c.id === mandate.customerId)!;
    console.log(`── ${mandate.id} · ${customer.name} · ${mandate.merchant} · ${rupees(mandate.amount)} · ${mandate.failureCode}`);

    const gate = canContact(customer, mandate, NOW, ledger.contactsInLast7Days(mandate.id, NOW));
    ledger.log({
      at: NOW.toISOString(), actor: "compliance", mandateId: mandate.id,
      action: gate.allowed ? "contact_permitted" : "contact_blocked",
      detail: gate.detail, ruleApplied: gate.rule,
    });
    if (!gate.allowed) {
      console.log(`   🚫 BLOCKED by ${gate.rule}`);
      console.log(`      ${gate.detail}\n`);
      continue;
    }

    ledger.recordContact(customer.id, mandate.id, NOW);
    contactSpend += CONTACT_COST;

    const result: NegotiationResult = client
      ? await negotiateLive(client, customer, mandate)
      : negotiateOffline(mandate);

    for (const turn of result.transcript) {
      console.log(`   ${turn.speaker === "agent" ? "🎙  Asha" : "👤 " + customer.name.split(" ")[0]}: ${turn.text}`);
    }

    if (result.outcome.kind === "opt_out") {
      ledger.log({ at: NOW.toISOString(), actor: "agent", mandateId: mandate.id, action: "opt_out_recorded", detail: "customer requested no further contact", ruleApplied: RULES.OPT_OUT });
      console.log(`   ✋ Opt-out recorded — recovery stopped for this mandate\n`);
      continue;
    }
    if (result.outcome.kind === "dispute") {
      ledger.log({ at: NOW.toISOString(), actor: "agent", mandateId: mandate.id, action: "dispute_escalated", detail: result.outcome.reason, ruleApplied: RULES.DISPUTE_FREEZE });
      console.log(`   ⚖️  Dispute escalated to human — all retries frozen (${RULES.DISPUTE_FREEZE})\n`);
      continue;
    }
    if (result.outcome.kind === "no_commitment") {
      ledger.log({ at: NOW.toISOString(), actor: "agent", mandateId: mandate.id, action: "no_commitment", detail: "call ended without a promise" });
      console.log(`   ➖ No commitment obtained\n`);
      continue;
    }

    // Promise obtained → parse the Hinglish phrase into a concrete timestamp
    const phrase = result.outcome.phrase;
    const parsed = parseHinglishWhen(phrase, NOW, customer.salaryDay);
    const promisedAt = parsed?.when ?? new Date(NOW.getTime() + 2 * 86400000);
    const { at: retryAt, clamped } = clampRetryTime(promisedAt, NOW);

    const promise: PromiseToPay = {
      id: `p-${mandate.id}`, mandateId: mandate.id, customerId: customer.id,
      amount: mandate.amount, quotedPhrase: phrase,
      promisedAt: retryAt.toISOString(), createdAt: NOW.toISOString(),
      status: "pending", confidence: parsed?.confidence ?? "low",
    };
    ledger.addPromise(promise);
    ledger.log({
      at: NOW.toISOString(), actor: "agent", mandateId: mandate.id, action: "promise_recorded",
      detail: `"${phrase}" → ${formatIst(retryAt)} (${parsed?.matchedRule ?? "no parse; default +2d"})${clamped ? " [clamped +24h for pre-debit notice]" : ""}`,
      ruleApplied: clamped ? RULES.PRE_DEBIT_NOTICE : undefined,
    });
    console.log(`   📌 Promise: "${phrase}"`);
    console.log(`      → parsed by rule [${parsed?.matchedRule ?? "fallback +2 days"}] → retry at ${formatIst(retryAt)}${clamped ? " (clamped for 24h pre-debit notice)" : ""}\n`);
  }

  // ── Phase 2: scheduler executes retries at promised times (virtual clock) ──
  console.log(`\n⏰ Scheduler — advancing virtual clock through promised retry slots\n`);
  let recovered = 0;
  const mandateById = new Map(failedMandates.map((m) => [m.id, m]));

  const queue = ledger.pendingPromises().sort((a, b) => a.promisedAt.localeCompare(b.promisedAt));
  for (const promise of queue) {
    const at = new Date(promise.promisedAt);
    const mandate = mandateById.get(promise.mandateId)!;
    const decision = canRetryMandate(mandate, at, new Date(at.getTime() - 25 * 3600000));
    ledger.log({
      at: at.toISOString(), actor: "scheduler", mandateId: mandate.id,
      action: decision.allowed ? "retry_presented" : "retry_blocked",
      detail: decision.detail, ruleApplied: decision.rule,
    });
    if (!decision.allowed) {
      ledger.updatePromiseStatus(promise.id, "cancelled");
      console.log(`   ${formatIst(at)} · ${mandate.id} 🚫 retry blocked: ${decision.rule}`);
      continue;
    }

    retrySpend += RETRY_COST;
    const ok = paymentSucceeds(mandate.id, 0);
    mandate.retriesUsed += 1;
    if (ok) {
      recovered += promise.amount;
      ledger.updatePromiseStatus(promise.id, "kept");
      ledger.log({ at: at.toISOString(), actor: "scheduler", mandateId: mandate.id, action: "payment_recovered", detail: `${rupees(promise.amount)} collected on promised slot` });
      console.log(`   ${formatIst(at)} · ${mandate.id} ✅ ${rupees(promise.amount)} recovered ("${promise.quotedPhrase}")`);
    } else {
      ledger.updatePromiseStatus(promise.id, "broken");
      ledger.log({ at: at.toISOString(), actor: "scheduler", mandateId: mandate.id, action: "promise_broken", detail: "retry failed at promised time" });
      console.log(`   ${formatIst(at)} · ${mandate.id} ❌ promise broken — retry failed`);
      // One bounded follow-up if compliance still allows it
      const followupAt = new Date(at.getTime() + 2 * 86400000);
      const re = canRetryMandate(mandate, followupAt, at);
      if (re.allowed && ledger.contactsInLast7Days(mandate.id, at) < 3) {
        retrySpend += RETRY_COST;
        mandate.retriesUsed += 1;
        recovered += promise.amount;
        ledger.log({ at: followupAt.toISOString(), actor: "scheduler", mandateId: mandate.id, action: "payment_recovered", detail: `${rupees(promise.amount)} collected on bounded follow-up retry`, ruleApplied: re.rule });
        console.log(`   ${formatIst(followupAt)} · ${mandate.id} ✅ ${rupees(promise.amount)} recovered on follow-up (${re.detail})`);
      } else {
        console.log(`   ${formatIst(followupAt)} · ${mandate.id} ⛔ no follow-up: ${re.allowed ? "weekly contact cap reached" : re.rule}`);
      }
    }
  }

  // ── Phase 3: recovery P&L ───────────────────────────────────────────────
  const atRisk = failedMandates.reduce((s, m) => s + m.amount, 0);
  const cost = contactSpend + retrySpend;
  console.log(`\n📊 Recovery P&L`);
  console.log(`   At risk        ${rupees(atRisk)}`);
  console.log(`   Recovered      ${rupees(recovered)}  (${((recovered / atRisk) * 100).toFixed(1)}%)`);
  console.log(`   Intervention   ${rupees(cost)}  (${contactSpend / 500} calls, ${retrySpend / 50} retries)`);
  console.log(`   Net recovery   ${rupees(recovered - cost)}`);

  const blocked = ledger.auditTrail().filter((e) => e.action.endsWith("_blocked")).length;
  console.log(`   Compliance     ${blocked} action(s) blocked by hard rules; full trail in data/audit-trail.json`);

  ledger.persist();
  console.log(`\n🧾 Artifacts written: data/promises.json, data/audit-trail.json\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
