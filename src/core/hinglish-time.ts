/**
 * Deterministic parser for vague Hinglish time expressions →  concrete IST timestamps.
 * "parso kar dunga" → day after tomorrow, "salary aane ke baad" → day after salary day, etc.
 * Falls back to null when nothing matches (caller may use an LLM fallback or a default).
 */

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

export interface ParsedWhen {
  when: Date;
  matchedRule: string;
  confidence: "high" | "medium" | "low";
}

interface IstParts {
  y: number;
  mo: number; // 1-12
  d: number;
  h: number;
  mi: number;
}

function toIst(date: Date): IstParts {
  const t = new Date(date.getTime() + IST_OFFSET_MS);
  return { y: t.getUTCFullYear(), mo: t.getUTCMonth() + 1, d: t.getUTCDate(), h: t.getUTCHours(), mi: t.getUTCMinutes() };
}

function fromIst(p: IstParts): Date {
  return new Date(Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi) - IST_OFFSET_MS);
}

function addDays(base: Date, days: number, hourIst: number): Date {
  const p = toIst(base);
  const shifted = new Date(fromIst({ ...p, h: 12, mi: 0 }).getTime() + days * 86400000);
  const sp = toIst(shifted);
  return fromIst({ ...sp, h: hourIst, mi: 0 });
}

const HINDI_DIGITS: Record<string, number> = {
  ek: 1, do: 2, teen: 3, char: 4, chaar: 4, paanch: 5, panch: 5,
  che: 6, chhe: 6, saat: 7, aath: 8, nau: 9, das: 10, dus: 10,
};

const WEEKDAYS: Record<string, number> = {
  ravivar: 0, sunday: 0, somvar: 1, monday: 1, mangalvar: 2, tuesday: 2,
  budhvar: 3, wednesday: 3, guruvar: 4, thursday: 4, shukravar: 5, friday: 5,
  shanivar: 6, saturday: 6,
};

/** Default contact-safe hour used when the phrase carries no time of day. */
const DEFAULT_HOUR = 11;

function timeOfDayHour(text: string): number | null {
  if (/\bsubah\b|\bmorning\b/.test(text)) return 10;
  if (/\bdopahar\b|\bafternoon\b/.test(text)) return 13;
  if (/\bshaam\b|\bsham\b|\bevening\b/.test(text)) return 18;
  // "raat" is inside quiet hours; clamp to the latest compliant slot.
  if (/\braat\b|\bnight\b/.test(text)) return 18;
  const baje = text.match(/\b(\d{1,2})\s*baje\b/);
  if (baje) {
    let h = parseInt(baje[1], 10) % 24;
    if (h >= 1 && h <= 7) h += 12; // "4 baje" almost always means 4 PM in this context
    return h;
  }
  return null;
}

function numberIn(text: string): number | null {
  const digit = text.match(/\b(\d{1,2})\b/);
  if (digit) return parseInt(digit[1], 10);
  for (const [word, n] of Object.entries(HINDI_DIGITS)) {
    if (new RegExp(`\\b${word}\\b`).test(text)) return n;
  }
  return null;
}

/**
 * Parse a Hinglish promise phrase relative to `now`.
 * `salaryDay` (day of month) sharpens "salary ke baad" style promises.
 */
export function parseHinglishWhen(raw: string, now: Date, salaryDay?: number): ParsedWhen | null {
  const text = raw.toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
  const tod = timeOfDayHour(text);

  // Immediate: "abhi", "turant", "just now"
  if (/\babhi\b|\bturant\b|\bright now\b|\bimmediately\b/.test(text)) {
    return { when: new Date(now.getTime() + 60 * 60 * 1000), matchedRule: "abhi/turant → +1 hour", confidence: "high" };
  }

  // Salary-linked: "salary aane ke baad", "tankhwah ke baad", "salary aayegi tab"
  if (/salary|tankhwah|tankha|pagar/.test(text)) {
    const p = toIst(now);
    const day = salaryDay ?? 1;
    // Retry the day AFTER salary lands, when funds are actually available.
    let target: IstParts = { y: p.y, mo: p.mo, d: day, h: tod ?? DEFAULT_HOUR, mi: 0 };
    let when = fromIst(target);
    if (when.getTime() <= now.getTime()) {
      target = { ...target, mo: target.mo === 12 ? 1 : target.mo + 1, y: target.mo === 12 ? target.y + 1 : target.y };
      when = fromIst(target);
    }
    when = new Date(when.getTime() + 86400000);
    return {
      when,
      matchedRule: `salary-linked → day after salary day (${day})`,
      confidence: salaryDay ? "high" : "medium",
    };
  }

  // "parso" = day after tomorrow
  if (/\bparso\b|\bparson\b|\bday after tomorrow\b/.test(text)) {
    return { when: addDays(now, 2, tod ?? DEFAULT_HOUR), matchedRule: "parso → +2 days", confidence: "high" };
  }

  // "kal" = tomorrow (in a payment-promise context, never "yesterday")
  if (/\bkal\b|\btomorrow\b/.test(text)) {
    return { when: addDays(now, 1, tod ?? DEFAULT_HOUR), matchedRule: "kal → +1 day", confidence: "high" };
  }

  // "aaj shaam", "aaj", "today evening"
  if (/\baaj\b|\btoday\b/.test(text)) {
    const p = toIst(now);
    const h = tod ?? Math.max(p.h + 2, DEFAULT_HOUR);
    return { when: fromIst({ ...p, h: Math.min(h, 18), mi: 0 }), matchedRule: "aaj → today", confidence: "high" };
  }

  // Weekday: "somvar ko", "friday tak"
  for (const [word, dow] of Object.entries(WEEKDAYS)) {
    if (new RegExp(`\\b${word}\\b`).test(text)) {
      const nowDow = new Date(now.getTime() + IST_OFFSET_MS).getUTCDay();
      let diff = (dow - nowDow + 7) % 7;
      if (diff === 0) diff = 7; // "somvar" on a Monday means next Monday
      return { when: addDays(now, diff, tod ?? DEFAULT_HOUR), matchedRule: `weekday ${word} → +${diff} days`, confidence: "high" };
    }
  }

  // "agle hafte" / "next week"
  if (/agle hafte|agle week|next week|hafte bhar/.test(text)) {
    return { when: addDays(now, 7, tod ?? DEFAULT_HOUR), matchedRule: "agle hafte → +7 days", confidence: "medium" };
  }

  // "agle mahine" / "next month"
  if (/agle mahine|next month/.test(text)) {
    return { when: addDays(now, 30, tod ?? DEFAULT_HOUR), matchedRule: "agle mahine → +30 days", confidence: "low" };
  }

  // "X din baad / mein" — "do din baad kar dunga"
  if (/din (baad|mein|me)|days?\b/.test(text)) {
    const n = numberIn(text);
    if (n !== null && n >= 1 && n <= 31) {
      return { when: addDays(now, n, tod ?? DEFAULT_HOUR), matchedRule: `${n} din baad → +${n} days`, confidence: "high" };
    }
  }

  // "X tarikh ko" — day of month
  const tarikh = text.match(/\b(\d{1,2})\s*(tarikh|tareekh|ko|se pehle|tak)\b/);
  if (tarikh) {
    const day = parseInt(tarikh[1], 10);
    if (day >= 1 && day <= 31) {
      const p = toIst(now);
      let target: IstParts = { y: p.y, mo: p.mo, d: day, h: tod ?? DEFAULT_HOUR, mi: 0 };
      let when = fromIst(target);
      if (when.getTime() <= now.getTime()) {
        target = { ...target, mo: target.mo === 12 ? 1 : target.mo + 1, y: target.mo === 12 ? target.y + 1 : target.y };
        when = fromIst(target);
      }
      return { when, matchedRule: `${day} tarikh → next occurrence of day ${day}`, confidence: "medium" };
    }
  }

  // Time-of-day only: "shaam ko karta hoon" → today at that hour, or tomorrow if passed
  if (tod !== null) {
    const p = toIst(now);
    let when = fromIst({ ...p, h: tod, mi: 0 });
    if (when.getTime() <= now.getTime()) when = addDays(now, 1, tod);
    return { when, matchedRule: "time-of-day only → nearest future slot", confidence: "medium" };
  }

  return null;
}

export function formatIst(date: Date): string {
  const p = toIst(date);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.y}-${pad(p.mo)}-${pad(p.d)} ${pad(p.h)}:${pad(p.mi)} IST`;
}
