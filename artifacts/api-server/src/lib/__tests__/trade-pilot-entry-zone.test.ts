import { describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({ db: {}, pool: {} }));

import { adaptiveEntryZone } from "../trade-pilot";
import { buildAdaptivePlanRecommendation } from "../adaptive-position-plan";
import { STANDARD_TRADING_RULES } from "../standard-trading-rules";

const output = (entryZone: unknown) => ({ tradePlan: { buy: { entryZone }, sell: { entryZone: "4180" } } });

describe("adaptiveEntryZone", () => {
  it("memakai zona entry asli AI bila titik tengahnya sama dengan entry tersimpan", () => {
    expect(adaptiveEntryZone(output("4,155.00 – 4,165.00 (pullback H1)"), "buy", "4160.00")).toBe("4155.00–4165.00");
  });

  it("kembali ke entry tunggal bila zona tidak ada, satu angka, atau tidak konsisten", () => {
    expect(adaptiveEntryZone(null, "buy", "4160.00")).toBe("4160.00");
    expect(adaptiveEntryZone(output("4160"), "buy", "4160.00")).toBe("4160.00");
    expect(adaptiveEntryZone(output("4100 – 4120"), "buy", "4160.00")).toBe("4160.00");
    expect(adaptiveEntryZone(output(42), "buy", "4160.00")).toBe("4160.00");
    expect(adaptiveEntryZone(output("4180"), "sell", "4180.00")).toBe("4180.00");
  });
});

describe("zona entry membuka layer tambahan", () => {
  const standardRule = STANDARD_TRADING_RULES.instruments.find((item) => item.code === "XUL10")!;
  const side = (entryZone: string) => ({
    entryZone, stopLoss: "4140.00", takeProfit1: "4180.00", takeProfit2: "4200.00", riskRewardRatio: "", rationale: "",
  });
  const plan = (entryZone: string) => buildAdaptivePlanRecommendation({
    instrument: "XAU/USD",
    tradePlan: {
      preferredSide: "buy",
      buy: side(entryZone),
      sell: { entryZone: "4130.00", stopLoss: "4150.00", takeProfit1: "4110.00", takeProfit2: "4100.00", riskRewardRatio: "", rationale: "" },
    },
    availableMargin: 10_000,
    maximumLoss: 2_000,
    existingExposure: 0,
    standardRule,
    accountTier: "mini",
    riskStyle: "balanced",
    context: {
      timeframe: "4h",
      validUntil: new Date(Date.now() + 3_600_000).toISOString(),
      marketCondition: "trending_up",
      riskLevel: "low",
      tradingBias: "bullish",
      confidenceMin: 70,
      confidenceMax: 80,
      techBuyCount: 9,
      techSellCount: 2,
      techNeutralCount: 1,
      fundamentalContext: { newsItems: [], calendarEvents: [] },
    },
  });

  it("entry tunggal hanya entry awal, zona entry memberi layer di tepi zona", () => {
    expect(plan("4160.00").result.buy?.ladder.length ?? 0).toBeLessThanOrEqual(1);
    const zoned = plan("4155.00–4165.00");
    expect(zoned.decision.posture).toBe("scaling_allowed");
    expect(zoned.result.buy?.ladder.length).toBeGreaterThan(1);
    expect(zoned.result.buy?.ladder.map((layer) => layer.price)).toContain(4155);
  });
});
