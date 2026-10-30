import { describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({ db: {}, pool: {} }));

import { confidenceExplanation } from "../trade-pilot";

describe("confidenceExplanation", () => {
  it("maps the stored AI output into the confidence modal payload", () => {
    const result = confidenceExplanation({
      aiInput: { calendarEventDates: [{ event: "FOMC Statement", date: "2026-10-29" }] },
      aiOutput: {
        confidenceMin: 35,
        confidenceMax: 50,
        riskLevel: "high",
        uncertaintyNotes: "• Dasar: sinyal sell dominan\n• Batasan: FOMC besok",
        keyDriversTechnical: "MA dan MACD bearish.",
        keyDriversFundamental: "FOMC berpotensi membalik momentum.",
        risk: "Whipsaw menjelang FOMC.",
        invalidationConditions: "Break resistance 4032 dengan close H1; FOMC surprise hawkish; Volume naik signifikan",
        fundamentalCitations: { newsTitles: ["Emas Turun Jelang The Fed"], calendarEvents: ["FOMC Statement"] },
      },
    });
    expect(result).toEqual({
      min: 35,
      max: 50,
      riskLevel: "high",
      reason: "• Dasar: sinyal sell dominan\n• Batasan: FOMC besok",
      technical: "MA dan MACD bearish.",
      fundamental: "FOMC berpotensi membalik momentum.",
      risk: "Whipsaw menjelang FOMC.",
      invalidation: ["Break resistance 4032 dengan close H1", "FOMC surprise hawkish", "Volume naik signifikan"],
      sources: {
        news: ["Emas Turun Jelang The Fed"],
        calendar: [{ name: "FOMC Statement", date: "2026-10-29" }],
      },
    });
  });

  it("splits bullet-style invalidation conditions", () => {
    const result = confidenceExplanation({
      aiInput: null,
      aiOutput: { invalidationConditions: "• Break 4032\n• FOMC hawkish", fundamentalCitations: {} },
    });
    expect(result?.invalidation).toEqual(["Break 4032", "FOMC hawkish"]);
    expect(result?.sources.calendar).toEqual([]);
  });

  it("returns null for analyses without a stored AI output", () => {
    expect(confidenceExplanation({ aiInput: null, aiOutput: null })).toBeNull();
  });
});
