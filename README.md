# paisa-wapas 💸

**Hinglish voice recovery agent with a promise-to-pay ledger** — built for the Razorpay Buildathon (Track 03: AI Revenue Recovery).

An agent that contacts customers with failed UPI autopay mandates, negotiates in natural Hinglish, extracts a promise-to-pay ("parso kar dunga"), resolves that vague phrase into a concrete retry timestamp, and executes a bounded, RBI-compliant recovery workflow — with measured money recovered across a batch and a full audit trail.

## The magic moment

The customer says something vague and human:

> "salary aane ke baad pakka kar dunga"

The agent turns it into a scheduled, compliant action:

> parsed by rule `salary-linked → day after salary day (1)` → retry at `2026-09-02 11:00 IST` (24h pre-debit notice sent first)

## What's inside

| Piece | File | What it does |
|---|---|---|
| Hinglish time parser | `src/core/hinglish-time.ts` | Deterministic rules for `parso`, `kal shaam`, `somvar ko`, `do din baad`, `salary ke baad`, `25 tarikh ko`, and more — all resolved in IST |
| Compliance guard | `src/core/compliance.ts` | Hard rules the agent cannot override: contact hours 08:00–19:00 IST, max 3 contacts/week, opt-out hard stop, max 3 mandate retries, 24h pre-debit notice, dispute freeze |
| Negotiation agent | `src/agent/negotiator.ts` | A free-tier LLM (Gemini `gemini-2.5-flash` by default) drives a tool-calling loop in Hinglish; tools: `record_promise`, `mark_opt_out`, `escalate_dispute`. A second LLM call plays the customer |
| Promise-to-pay ledger | `src/core/ledger.ts` | Every promise with the exact quoted phrase, resolved time, confidence, and status (pending/kept/broken/cancelled) |
| Retry scheduler | `src/demo/run.ts` | Virtual clock executes retries exactly at promised times, handles broken promises with one bounded follow-up |
| Audit trail | `data/audit-trail.json` | Append-only log: every action, the evidence, and the compliance rule that permitted or blocked it |

## Run it

```bash
pnpm install

# Offline demo — scripted Hinglish personas, no API key needed.
pnpm demo

# Live demo — a free-tier LLM plays both the agent and the customers.
# Default provider is Google Gemini: get a free key at https://aistudio.google.com/apikey
export LLM_API_KEY=your-free-gemini-key
pnpm demo:live

# Other free providers (OpenAI-compatible), no code changes:
#   Groq:   LLM_BASE_URL=https://api.groq.com/openai/v1 LLM_MODEL=llama-3.3-70b-versatile LLM_API_KEY=gsk_...
#   Ollama: LLM_BASE_URL=http://localhost:11434/v1 LLM_MODEL=llama3.1 LLM_API_KEY=ollama

# Tests (Hinglish time parser)
pnpm test
```

## What the demo shows

A batch of 8 failed mandates (₹12,090 at risk) goes through the loop:

- **Insufficient funds** → Hinglish call → promise extracted → retry scheduled at the promised slot.
- **Salary-cycle aware** — "salary ke baad" resolves against the customer's known salary day, retrying the day *after* funds land.
- **Opted-out customer** → contact blocked by rule R3 before any call is made.
- **Revoked mandate** → never retried (rule R5), escalated to the merchant instead.
- **Disputed charge** → agent stops negotiating immediately, escalates to a human, all retries frozen (rule R7).
- **Broken promise** → detected at the promised slot, one bounded follow-up retry within the weekly contact cap.
- **Recovery P&L** — rupees at risk vs recovered vs intervention cost, printed at the end.

## The bar (Track 03)

- ✅ Measured money recovered across a batch — the P&L block, computed from ledger events.
- ✅ Compliant escalation — disputes go to humans; revoked mandates go to the merchant.
- ✅ Stopping rules — opt-out, contact caps, retry caps, quiet hours; the agent *cannot* override them (they run outside the model).
- ✅ Audit trail — `data/audit-trail.json` answers "why did the agent do X at time T?" with the rule ID that permitted it.

## Honest scope notes

- "Voice" is simulated as call transcripts (text). The same loop plugs into a telephony/TTS stack (e.g. Exotel + an Indic TTS) without changing the agent, parser, or compliance layer.
- Payments are simulated deterministically; in production the scheduler would call Razorpay's mandate re-presentation API and the pre-debit notification webhook.
