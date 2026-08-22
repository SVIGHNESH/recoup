import { describe, expect, it } from "vitest";
import { parseHinglishWhen, formatIst } from "../src/core/hinglish-time.js";

// Reference: Thursday 2026-08-20 11:00 IST
const NOW = new Date("2026-08-20T11:00:00+05:30");

describe("parseHinglishWhen", () => {
  it("parses 'parso' as day after tomorrow", () => {
    const r = parseHinglishWhen("parso kar dunga", NOW);
    expect(formatIst(r!.when)).toBe("2026-08-22 11:00 IST");
    expect(r!.confidence).toBe("high");
  });

  it("parses 'parso shaam ko' with evening slot", () => {
    const r = parseHinglishWhen("parso shaam ko kar dungi", NOW);
    expect(formatIst(r!.when)).toBe("2026-08-22 18:00 IST");
  });

  it("parses 'kal subah'", () => {
    const r = parseHinglishWhen("kal subah pakka", NOW);
    expect(formatIst(r!.when)).toBe("2026-08-21 10:00 IST");
  });

  it("parses salary-linked promise using the customer's salary day", () => {
    const r = parseHinglishWhen("salary aane ke baad pakka kar dunga", NOW, 1);
    // Next salary day is Sep 1; retry the day after
    expect(formatIst(r!.when)).toBe("2026-09-02 11:00 IST");
    expect(r!.confidence).toBe("high");
  });

  it("salary promise without known salary day is medium confidence", () => {
    const r = parseHinglishWhen("tankhwah ke baad", NOW);
    expect(r!.confidence).toBe("medium");
  });

  it("parses weekday 'somvar ko' as next Monday", () => {
    const r = parseHinglishWhen("somvar ko resume kar dunga", NOW);
    expect(formatIst(r!.when)).toBe("2026-08-24 11:00 IST");
  });

  it("parses 'do din baad' with a Hindi number word", () => {
    const r = parseHinglishWhen("do din baad kar do", NOW);
    expect(formatIst(r!.when)).toBe("2026-08-22 11:00 IST");
  });

  it("parses 'abhi' as +1 hour", () => {
    const r = parseHinglishWhen("abhi karta hoon", NOW);
    expect(formatIst(r!.when)).toBe("2026-08-20 12:00 IST");
  });

  it("clamps 'raat ko' into the compliant contact window", () => {
    const r = parseHinglishWhen("kal raat ko", NOW);
    expect(formatIst(r!.when)).toBe("2026-08-21 18:00 IST");
  });

  it("parses '25 tarikh ko' as day of month", () => {
    const r = parseHinglishWhen("25 tarikh ko kar dunga", NOW);
    expect(formatIst(r!.when)).toBe("2026-08-25 11:00 IST");
  });

  it("returns null for unparseable phrases", () => {
    expect(parseHinglishWhen("hmm pata nahi yaar", NOW)).toBeNull();
  });
});
