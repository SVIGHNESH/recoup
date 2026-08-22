/**
 * The Hinglish negotiation agent.
 *
 * Live mode: an LLM drives a tool-calling loop — it converses in Hinglish and
 * calls record_promise / mark_opt_out / escalate_dispute when the customer
 * commits, opts out, or disputes. A second LLM call plays the customer, so a
 * full call can be simulated end to end.
 *
 * The client speaks the OpenAI-compatible chat API, so any free provider works
 * via env vars (defaults target Google Gemini's free tier):
 *   LLM_API_KEY   — free key from https://aistudio.google.com/apikey
 *   LLM_BASE_URL  — default Gemini; use https://api.groq.com/openai/v1 for Groq
 *                   or http://localhost:11434/v1 for Ollama
 *   LLM_MODEL     — default gemini-2.5-flash (Groq: llama-3.3-70b-versatile)
 *
 * Offline mode: deterministic scripted personas produce the same wire format
 * (transcript + final customer utterance), so the whole downstream pipeline —
 * Hinglish time parsing, compliance clamps, ledger, scheduler — runs identically
 * without any API key.
 */
import OpenAI from "openai";
import type { Customer, FailedMandate } from "../core/types.js";

export interface Turn {
  speaker: "agent" | "customer";
  text: string;
}

export interface NegotiationResult {
  transcript: Turn[];
  outcome:
    | { kind: "promise"; phrase: string }
    | { kind: "opt_out" }
    | { kind: "dispute"; reason: string }
    | { kind: "no_commitment" };
}

export function makeLlmClient(): OpenAI {
  return new OpenAI({
    apiKey: process.env.LLM_API_KEY ?? process.env.GEMINI_API_KEY ?? "",
    baseURL: process.env.LLM_BASE_URL ?? "https://generativelanguage.googleapis.com/v1beta/openai/",
  });
}

const MODEL = process.env.LLM_MODEL ?? "gemini-2.5-flash";

const AGENT_SYSTEM = `You are "Asha", a polite recovery agent calling on behalf of a merchant about a failed UPI autopay payment. You speak natural Hinglish (Hindi in Latin script mixed with English), warm and respectful — never threatening, never pushy. RBI conduct rules apply: no harassment, no repeated pressure, accept a refusal gracefully.

Your goals, in order:
1. Confirm you are speaking with the right person and state the failed payment plainly (merchant, amount).
2. Understand why it failed from the customer's side.
3. Get a specific promise-to-pay: WHEN can the payment be retried? Gently push vague answers ("dekh lunga") toward something concrete ("parso", "salary ke baad", "somvar ko").
4. When the customer commits, call record_promise with their exact phrase. If they refuse contact or say stop calling, call mark_opt_out immediately and end warmly. If they dispute the charge, call escalate_dispute — do not argue.

Keep each message to 1-3 short sentences. End the call politely after any tool call.`;

const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "record_promise",
      description:
        "Record the customer's promise-to-pay. Call this the moment the customer gives any time commitment, quoting their exact words.",
      parameters: {
        type: "object",
        properties: {
          exact_phrase: { type: "string", description: "The customer's exact Hinglish words, e.g. 'parso shaam ko kar dunga'" },
        },
        required: ["exact_phrase"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "mark_opt_out",
      description: "Customer asked not to be contacted again. Recovery activity must stop immediately.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "escalate_dispute",
      description: "Customer disputes the charge itself (wrong amount, cancelled subscription, fraud claim). Hand off to a human.",
      parameters: {
        type: "object",
        properties: { reason: { type: "string", description: "One-line summary of the dispute" } },
        required: ["reason"],
      },
    },
  },
];

async function customerReply(
  client: OpenAI,
  customer: Customer,
  mandate: FailedMandate,
  transcript: Turn[],
): Promise<string> {
  const persona = `You are ${customer.name}, an Indian customer whose UPI autopay of ₹${(mandate.amount / 100).toFixed(0)} to ${mandate.merchant} failed (${mandate.failureCode}). Reply in natural Hinglish, 1-2 sentences, like a real phone call. Be initially evasive ("haan dekh lunga"), but if the agent is polite and asks for a specific time, commit with a vague-but-real phrase like "parso kar dunga" or "salary aane ke baad pakka". Stay in character; output only your spoken reply.`;
  const response = await client.chat.completions.create({
    model: MODEL,
    max_tokens: 200,
    messages: [
      { role: "system", content: persona },
      {
        role: "user",
        content: `Call so far:\n${transcript.map((t) => `${t.speaker}: ${t.text}`).join("\n")}\n\nYour reply:`,
      },
    ],
  });
  return response.choices[0]?.message?.content?.trim() || "haan theek hai, dekh lunga";
}

export async function negotiateLive(
  client: OpenAI,
  customer: Customer,
  mandate: FailedMandate,
): Promise<NegotiationResult> {
  const transcript: Turn[] = [];
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: AGENT_SYSTEM },
    {
      role: "user",
      content: `New call. Customer: ${customer.name} (${customer.languagePref}). Failed payment: ₹${(mandate.amount / 100).toFixed(0)} to ${mandate.merchant}, reason ${mandate.failureCode}. The customer has just picked up. Begin the call.`,
    },
  ];

  for (let turn = 0; turn < 8; turn++) {
    const response = await client.chat.completions.create({
      model: MODEL,
      max_tokens: 1024,
      messages,
      tools,
    });

    const msg = response.choices[0]?.message;
    if (!msg) return { transcript, outcome: { kind: "no_commitment" } };

    if (msg.content?.trim()) {
      transcript.push({ speaker: "agent", text: msg.content.trim() });
    }

    const toolCall = msg.tool_calls?.[0];
    if (toolCall && toolCall.type === "function") {
      let input: Record<string, string> = {};
      try {
        input = JSON.parse(toolCall.function.arguments || "{}");
      } catch {
        // keep empty input; fall through with sensible defaults
      }
      if (toolCall.function.name === "record_promise") {
        return { transcript, outcome: { kind: "promise", phrase: input.exact_phrase ?? "" } };
      }
      if (toolCall.function.name === "mark_opt_out") {
        return { transcript, outcome: { kind: "opt_out" } };
      }
      if (toolCall.function.name === "escalate_dispute") {
        return { transcript, outcome: { kind: "dispute", reason: input.reason ?? "customer dispute" } };
      }
    }

    const reply = await customerReply(client, customer, mandate, transcript);
    transcript.push({ speaker: "customer", text: reply });
    messages.push({ role: "assistant", content: msg.content ?? "" });
    messages.push({ role: "user", content: `Customer says: "${reply}"` });
  }
  return { transcript, outcome: { kind: "no_commitment" } };
}

/** Scripted personas — same shape as live output, fully deterministic. */
const OFFLINE_SCRIPTS: Record<string, NegotiationResult> = {
  m1: {
    transcript: [
      { speaker: "agent", text: "Namaste Ramesh ji, main Asha bol rahi hoon FitLife Gym ki taraf se. Aapki ₹1499 ki autopay kal fail ho gayi thi — koi dikkat toh nahi?" },
      { speaker: "customer", text: "Haan yaar, month end hai, account mein balance nahi tha." },
      { speaker: "agent", text: "Koi baat nahi, hota hai. Kab retry karein toh aapko theek rahega?" },
      { speaker: "customer", text: "Salary aane ke baad pakka kar dunga, first ko aati hai." },
      { speaker: "agent", text: "Perfect, salary ke agle din retry schedule kar deti hoon. Dhanyavaad Ramesh ji!" },
    ],
    outcome: { kind: "promise", phrase: "salary aane ke baad pakka kar dunga" },
  },
  m2: {
    transcript: [
      { speaker: "agent", text: "Hello Priya ji, StreamBox ki ₹499 payment kal bounce ho gayi. Kab tak ho payega?" },
      { speaker: "customer", text: "Arre haan, parso shaam ko kar dungi, abhi thoda tight hai." },
      { speaker: "agent", text: "Bilkul, parso shaam ka retry laga deti hoon. Thank you!" },
    ],
    outcome: { kind: "promise", phrase: "parso shaam ko kar dungi" },
  },
  m3: {
    transcript: [
      { speaker: "agent", text: "Namaste Arjun ji, aapne LearnKids ki autopay pause ki hui hai. Continue karna chahenge?" },
      { speaker: "customer", text: "Haan bachhe ke exams the isliye pause kiya tha. Somvar ko resume kar dunga." },
      { speaker: "agent", text: "Great, somvar ko retry schedule kar diya. Best of luck for exams!" },
    ],
    outcome: { kind: "promise", phrase: "somvar ko resume kar dunga" },
  },
  m4: {
    transcript: [
      { speaker: "agent", text: "Sunita ji namaste, SwasthBima ki ₹999 premium do baar fail ho chuki hai. Policy lapse na ho jaye — kab retry karein?" },
      { speaker: "customer", text: "Do din baad kar do, paise aa jayenge tab tak." },
      { speaker: "agent", text: "Theek hai, do din baad ka last retry laga rahi hoon. Dhyan rakhiyega!" },
    ],
    outcome: { kind: "promise", phrase: "do din baad kar do" },
  },
  m6: {
    transcript: [
      { speaker: "agent", text: "Hi Kavita, your CloudDrive payment failed due to a bank outage on our side — no action needed from you. We'll simply retry after the mandatory notice period." },
      { speaker: "customer", text: "Oh okay, that's fine. Go ahead." },
    ],
    outcome: { kind: "promise", phrase: "retry after bank recovers (agent-initiated, +24h)" },
  },
  m8: {
    transcript: [
      { speaker: "agent", text: "Meena ji namaste, SwasthBima ki ₹1999 payment fail hui hai. Kab retry kar sakte hain?" },
      { speaker: "customer", text: "Kaunsi payment? Maine yeh policy cancel kar di thi pichhle mahine! Galat charge hai yeh." },
      { speaker: "agent", text: "Maafi chahti hoon Meena ji, main isko turant dispute team ko forward kar rahi hoon. Aapko koi retry nahi hoga jab tak yeh resolve na ho." },
    ],
    outcome: { kind: "dispute", reason: "customer says policy was cancelled last month; charge disputed" },
  },
};

export function negotiateOffline(mandate: FailedMandate): NegotiationResult {
  return (
    OFFLINE_SCRIPTS[mandate.id] ?? {
      transcript: [{ speaker: "agent", text: "(no answer)" }],
      outcome: { kind: "no_commitment" },
    }
  );
}
