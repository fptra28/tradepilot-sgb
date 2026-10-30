import { describe, expect, it } from "vitest";
import type { StandardTradingRuleInstrument } from "../standard-trading-rules";
import type { FundamentalContext, TradePlan } from "../adaptive-position-plan";

/** Event kalender lengkap dari feed; mesin hanya membaca impact & waktu. */
type CalendarEventFixture = FundamentalContext["calendarEvents"][number];
import { BROKER_CONTRACT_TIERS } from "@workspace/instrument-taxonomy";
import {
  buildAdaptivePlanRecommendation as buildAdaptivePlanRecommendationCore,
  buildAdaptivePositionPlan,
  createAdaptivePlanFingerprint,
  getAdaptiveChartCandidatePrices,
  getAdaptiveMarginCapacity,
  getAdaptiveMarketRule,
  getAdaptiveStandardRuleCode,
  getStandardTradingRuleCode,
  isAdaptivePositionInstrument,
  isXauUsdMiniAdaptiveInstrument,
} from "../adaptive-position-plan";

const CHART_CANDIDATES = {
  buy: [2299, 2297, 2295],
  sell: [2303, 2305, 2307],
};

const TRADE_PLAN: TradePlan = {
  preferredSide: "buy",
  buy: {
    entryZone: "2,300.00–2,302.00",
    stopLoss: "2,290.00",
    takeProfit1: "2,315.00",
    takeProfit2: "2,325.00",
    riskRewardRatio: "1:1.5",
    rationale: "Example",
  },
  sell: {
    entryZone: "2,300.00–2,302.00",
    stopLoss: "2,312.00",
    takeProfit1: "2,290.00",
    takeProfit2: "2,280.00",
    riskRewardRatio: "1:1.2",
    rationale: "Example",
  },
};

const GOLD_RULE: StandardTradingRuleInstrument = {
  code: "XUL10",
  product: "Gold (Loco London)",
  contractSize: 10,
  contractUnit: "troy ounce",
  tradingDays: "Monday–Friday",
  tradingHours: { summer: "06:00–03:30 WIB", winter: "06:00–04:30 WIB" },
  initialMarginUsdPerLot: 100,
  facilityFeeUsdPerLotPerSide: 1.5,
  vatPercent: 11,
  rolloverUsdPerLotPerNight: 0.5,
  priceSource: "Telequote",
  priceGuidance: "Last Trade",
  minimumSpread: "USD 0.40 / troy ounce / side",
  maximumSpread: "USD 1.00 / troy ounce / side",
  hecticSpread: "Based on market conditions",
  minimumPriceMovement: "USD 0.01 / troy ounce",
  limitStopRange: "USD 6–USD 20",
  deliveryBy: "Cash settlement",
};

const BRENT_RULE: StandardTradingRuleInstrument = {
  ...GOLD_RULE,
  code: "BCO10_BBJ",
  product: "Brent Crude Oil",
  contractSize: 100,
  contractUnit: "barrel",
  minimumSpread: "USD 0.10 / pip / barrel / side",
  maximumSpread: "USD 0.30 / pip / barrel / side",
  minimumPriceMovement: "USD 0.01 / barrel",
  limitStopRange: "USD 1–USD 20",
};

const BRENT_TRADE_PLAN: TradePlan = {
  preferredSide: "buy",
  buy: {
    ...TRADE_PLAN.buy,
    entryZone: "80.10–80.20",
    stopLoss: "79.00",
    takeProfit1: "81.50",
    takeProfit2: "82.40",
  },
  sell: {
    ...TRADE_PLAN.sell,
    entryZone: "80.10–80.20",
    stopLoss: "81.20",
    takeProfit1: "79.00",
    takeProfit2: "78.20",
  },
};

const HSI_RULE: StandardTradingRuleInstrument = {
  ...GOLD_RULE,
  code: "HKK50_BBJ",
  product: "Hang Seng Index",
  contractSize: 5,
  contractUnit: "USD/point",
  facilityFeeUsdPerLotPerSide: null,
  minimumSpread: "5 points / side",
  maximumSpread: "25 points / side",
  minimumPriceMovement: "1 point",
  limitStopRange: "20–500 points",
};

const NIKKEI_RULE: StandardTradingRuleInstrument = {
  ...HSI_RULE,
  code: "JPK50_BBJ",
  product: "Nikkei Index",
  minimumSpread: "10 points / side",
  minimumPriceMovement: "5 points",
};

function indexTradePlan(entryLow: number, entryHigh: number): TradePlan {
  return {
    preferredSide: "buy",
    buy: {
      ...TRADE_PLAN.buy,
      entryZone: `${entryLow}–${entryHigh}`,
      stopLoss: String(entryLow - 100),
      takeProfit1: String(entryHigh + 150),
      takeProfit2: String(entryHigh + 250),
    },
    sell: {
      ...TRADE_PLAN.sell,
      entryZone: `${entryLow}–${entryHigh}`,
      stopLoss: String(entryHigh + 100),
      takeProfit1: String(entryLow - 150),
      takeProfit2: String(entryLow - 250),
    },
  };
}

const SUPPORTIVE_CONTEXT = {
  timeframe: "1h",
  validUntil: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  marketCondition: "trending_up",
  riskLevel: "low",
  tradingBias: "bullish_strong",
  confidenceMin: 65,
  confidenceMax: 78,
  techBuyCount: 14,
  techSellCount: 4,
  techNeutralCount: 3,
  fundamentalContext: { newsItems: [], calendarEvents: [] },
};

const VALID_INPUT = {
  instrument: "XAU/USD",
  tradePlan: TRADE_PLAN,
  standardRule: GOLD_RULE,
  availableFunds: 5_000,
  maximumLoss: 500,
  existingExposure: 0,
  initialLot: 0.1,
  accountTier: "mini" as const,
  levels: 1,
  checkpointPrices: CHART_CANDIDATES,
};

function buildRecommendation(
  input: Partial<Parameters<typeof buildAdaptivePlanRecommendationCore>[0]> = {},
) {
  return buildAdaptivePlanRecommendationCore({
    instrument: "XAU/USD",
    tradePlan: TRADE_PLAN,
    availableMargin: 5_000,
    maximumLoss: 500,
    existingExposure: 0,
    standardRule: GOLD_RULE,
    context: SUPPORTIVE_CONTEXT,
    checkpointPrices: CHART_CANDIDATES,
    ...input,
  });
}

describe("XAU/USD Micro, Mini, and Regular Adaptive Plan", () => {
  it("uses only the exact canonical XAU/USD identity for Adaptive", () => {
    expect(isXauUsdMiniAdaptiveInstrument("XAU/USD")).toBe(true);
    expect(isXauUsdMiniAdaptiveInstrument(" xau/usd ")).toBe(true);

    for (const alias of ["XAUUSD", "GOLD", "XUL10", "EUR/USD"]) {
      expect(isXauUsdMiniAdaptiveInstrument(alias)).toBe(false);
      expect(getAdaptiveStandardRuleCode(alias)).toBeNull();
    }
    expect(isXauUsdMiniAdaptiveInstrument("HSI")).toBe(false);
    expect(isXauUsdMiniAdaptiveInstrument("NIKKEI")).toBe(false);
    expect(isXauUsdMiniAdaptiveInstrument("BRENT")).toBe(false);
    expect(getAdaptiveStandardRuleCode("XAU/USD")).toBe("XUL10");
  });

  it("enables only supported canonical identities for Adaptive", () => {
    expect(isAdaptivePositionInstrument("XAU/USD")).toBe(true);
    expect(isAdaptivePositionInstrument("BRENT")).toBe(true);
    expect(isAdaptivePositionInstrument("HSI")).toBe(true);
    expect(isAdaptivePositionInstrument("NIKKEI")).toBe(true);
    expect(isAdaptivePositionInstrument(" xau/usd ")).toBe(false);
    expect(isAdaptivePositionInstrument("brent")).toBe(false);
    expect(isAdaptivePositionInstrument("nikkei")).toBe(false);
    expect(getAdaptiveStandardRuleCode("BRENT")).toBe("BCO10_BBJ");
    expect(getAdaptiveStandardRuleCode("HSI")).toBe("HKK50_BBJ");
    expect(getAdaptiveStandardRuleCode("NIKKEI")).toBe("JPK50_BBJ");

    for (const alias of [
      "BCO10_BBJ",
      "BCO",
      "OIL",
      "BRENT CRUDE",
      "HKK50_BBJ",
      "HANG SENG",
      "JPK50_BBJ",
      "NIKKEI 225",
      "EUR/USD",
    ]) {
      expect(isAdaptivePositionInstrument(alias)).toBe(false);
      expect(getAdaptiveStandardRuleCode(alias)).toBeNull();
    }
  });

  it("builds Brent from its own contract, margin, movement, and gap rules", () => {
    const result = buildAdaptivePositionPlan({
      ...VALID_INPUT,
      instrument: "BRENT",
      tradePlan: BRENT_TRADE_PLAN,
      standardRule: BRENT_RULE,
      checkpointPrices: { buy: [79.83], sell: [80.47] },
    });

    expect(result.valid).toBe(true);
    expect(result.market).toBe("brent");
    expect(result.rule).toMatchObject({
      contractSize: 100,
      minimumLot: 0.1,
      marginAtMinimumLot: 100,
      minMovement: 0.01,
      maxGapPercent: 2,
    });
    const isTickAligned = (price: number) =>
      Math.abs(price / 0.01 - Math.round(price / 0.01)) < 1e-8;
    expect(result.buy?.ladder.every((level) => isTickAligned(level.price))).toBe(true);
    expect(result.sell?.ladder.every((level) => isTickAligned(level.price))).toBe(true);
    expect(result.assumptions.join(" ")).toContain("Current open BRENT mini exposure");
  });

  it.each([
    {
      instrument: "HSI",
      market: "hang_seng",
      rule: HSI_RULE,
      tradePlan: indexTradePlan(18_500, 18_510),
      checkpoints: { buy: [18_477.4], sell: [18_533.8] },
      movement: 1,
    },
    {
      instrument: "NIKKEI",
      market: "nikkei",
      rule: NIKKEI_RULE,
      tradePlan: indexTradePlan(38_500, 38_510),
      checkpoints: { buy: [38_477], sell: [38_533] },
      movement: 5,
    },
  ])("builds $instrument with isolated index sizing and tick alignment", ({
    instrument,
    market,
    rule,
    tradePlan,
    checkpoints,
    movement,
  }) => {
    const result = buildAdaptivePositionPlan({
      ...VALID_INPUT,
      instrument,
      tradePlan,
      standardRule: rule,
      checkpointPrices: checkpoints,
      maximumLoss: 5_000,
    });

    expect(result.valid).toBe(true);
    expect(result.market).toBe(market);
    expect(result.rule).toMatchObject({
      contractSize: 5,
      minimumLot: 0.1,
      marginAtMinimumLot: 100,
      minMovement: movement,
      maxGapPercent: null,
    });
    const aligned = (price: number) => price % movement === 0;
    expect(result.buy?.ladder.every((level) => aligned(level.price))).toBe(true);
    expect(result.sell?.ladder.every((level) => aligned(level.price))).toBe(true);
    expect(result.assumptions.join(" ")).toMatch(/no percentage gap limit is assumed/i);
    expect(result.assumptions.join(" ")).toMatch(/facility fee.*external risks/i);
  });

  it("fails closed when an index is paired with another product rule", () => {
    const hsiWithNikkeiRule = buildAdaptivePositionPlan({
      ...VALID_INPUT,
      instrument: "HSI",
      tradePlan: indexTradePlan(18_500, 18_510),
      standardRule: NIKKEI_RULE,
    });
    const nikkeiWithGoldRule = buildAdaptivePositionPlan({
      ...VALID_INPUT,
      instrument: "NIKKEI",
      tradePlan: indexTradePlan(38_500, 38_510),
      standardRule: GOLD_RULE,
    });

    expect(hsiWithNikkeiRule.valid).toBe(false);
    expect(hsiWithNikkeiRule.rule).toBeNull();
    expect(nikkeiWithGoldRule.valid).toBe(false);
    expect(nikkeiWithGoldRule.rule).toBeNull();
  });

  it("rejects stale Mini contract sizes or units for every tier without overriding the API rule", () => {
    const cases = [
      ["XAU/USD", GOLD_RULE, "XUL10"],
      ["BRENT", BRENT_RULE, "BCO10_BBJ"],
      ["HSI", HSI_RULE, "HKK50_BBJ"],
      ["NIKKEI", NIKKEI_RULE, "JPK50_BBJ"],
    ] as const;
    for (const [instrument, standardRule, code] of cases) {
      const contract = BROKER_CONTRACT_TIERS[code];
      for (const tier of ["micro", "mini", "regular"] as const) {
        expect(getAdaptiveMarketRule(instrument, standardRule, tier)).toMatchObject({
          contractSize: contract[tier].size,
          contractUnit: contract.unit,
          contractSource: contract[tier].source,
        });
        expect(getAdaptiveMarketRule(instrument, { ...standardRule, contractSize: contract.mini.size + 1 }, tier)).toBeNull();
        expect(getAdaptiveMarketRule(instrument, { ...standardRule, contractUnit: "barrel" === contract.unit ? "troy ounce" : "barrel" }, tier)).toBeNull();
      }
    }
  });

  it("scales index contract and margin by account tier without using Gold sizing", () => {
    expect(getAdaptiveMarketRule("HSI", HSI_RULE, "micro")).toMatchObject({
      contractSize: 0.5,
      marginAtMinimumLot: 10,
      minimumLot: 0.01,
    });
    expect(getAdaptiveMarketRule("HSI", HSI_RULE, "mini")).toMatchObject({
      contractSize: 5,
      marginAtMinimumLot: 100,
      minimumLot: 0.1,
    });
    expect(getAdaptiveMarketRule("NIKKEI", NIKKEI_RULE, "regular")).toMatchObject({
      contractSize: 5,
      marginAtMinimumLot: 1_000,
      minimumLot: 1,
    });
  });

  it.each([
    ["XAU/USD", GOLD_RULE, TRADE_PLAN, 11, 14, 24, [1, 10, 100]],
    ["BRENT", BRENT_RULE, BRENT_TRADE_PLAN, 1.15, 1.35, 2.25, [10, 100, 1_000]],
    ["HSI", HSI_RULE, indexTradePlan(18_500, 18_510), 105, 155, 255, [0.5, 5, 5]],
    ["NIKKEI", NIKKEI_RULE, indexTradePlan(38_500, 38_510), 105, 155, 255, [0.5, 5, 5]],
  ] as const)("values one minimum %s contract at each tier without double-counting lots", (
    instrument, standardRule, tradePlan, stopDistance, tp1Distance, tp2Distance, sizes,
  ) => {
    for (const [index, tier] of (["micro", "mini", "regular"] as const).entries()) {
      const minimumLot = [0.01, 0.1, 1][index];
      const result = buildAdaptivePositionPlan({
        ...VALID_INPUT, instrument, standardRule, tradePlan, accountTier: tier,
        initialLot: minimumLot, levels: 0, checkpointPrices: {},
        availableFunds: 100_000, maximumLoss: 50_000,
      });
      expect(result.valid).toBe(true);
      expect(result.rule).toMatchObject({
        contractSize: sizes[index], minimumLot,
        contractSource: tier === "micro" ? "micro_assumption" : "broker_document",
      });
      expect(result.buy?.ladder[0].riskToStopForLot).toBeCloseTo(stopDistance * sizes[index]);
      expect(result.buy?.profitToTakeProfit1).toBeCloseTo(tp1Distance * sizes[index]);
      expect(result.buy?.profitToTakeProfit2).toBeCloseTo(tp2Distance * sizes[index]);
      expect(result.assumptions.join(" ")).toMatch(tier === "micro"
        ? /assumption of 1\/10 Mini, not an official broker rule/
        : /broker tier table; the API rule supplies Mini only/);
    }
  });

  it("scales additional minimum positions and minimum-lot diagnostics by tier contract value", () => {
    const result = buildAdaptivePositionPlan({
      ...VALID_INPUT, accountTier: "mini", initialLot: 0.2, levels: 0,
    });
    expect(result.buy?.ladder[0].riskToStopForLot).toBe(220);
    expect(result.buy?.ladder[0].profitToTakeProfit1).toBe(280);
    const assessment = buildRecommendation({ accountTier: "regular", availableMargin: 5_000, maximumLoss: 2_000 });
    expect(assessment.sideEvaluations.sell.diagnostic).toMatchObject({
      lot: 1, riskAtStop: 1_100, marginRequired: 1_000, fundsRequiredAtStop: 2_100,
    });
  });

  it("keeps the broader Standard Plan resolver independent from Adaptive", () => {
    expect(getStandardTradingRuleCode("XAU/USD")).toBe("XUL10");
    expect(getStandardTradingRuleCode("BRENT")).toBe("BCO10_BBJ");
    expect(getStandardTradingRuleCode("HSI")).toBe("HKK50_BBJ");
    expect(getStandardTradingRuleCode("HANG SENG")).toBe("HKK50_BBJ");
    expect(getStandardTradingRuleCode("NIKKEI")).toBe("JPK50_BBJ");
    expect(getStandardTradingRuleCode("EUR/USD")).toBeNull();
  });

  it("exposes source-backed Micro and Mini caps without inventing a Regular cap", () => {
    const micro = getAdaptiveMarketRule("XAU/USD", GOLD_RULE, "micro");
    const mini = getAdaptiveMarketRule("XAU/USD", GOLD_RULE, "mini");
    const regular = getAdaptiveMarketRule("XAU/USD", GOLD_RULE, "regular");

    expect(micro).toMatchObject({
      accountTier: "micro",
      minimumLot: 0.01,
      maximumLot: 0.09,
      lotStep: 0.01,
      contractSize: 1,
      marginAtMinimumLot: 10,
      marginPerLot: 1_000,
      minimumOpeningFunds: 50,
    });
    expect(mini).toMatchObject({
      accountTier: "mini",
      minimumLot: 0.1,
      maximumLot: 0.9,
      lotStep: 0.1,
      contractSize: 10,
      marginAtMinimumLot: 100,
      marginPerLot: 1_000,
    });
    expect(regular).toMatchObject({
      accountTier: "regular",
      minimumLot: 1,
      maximumLot: null,
      lotStep: 1,
      contractSize: 100,
      marginAtMinimumLot: 1_000,
      marginPerLot: 1_000,
    });
    expect(getAdaptiveMarginCapacity(500, micro)).toBe(0.09);
    expect(getAdaptiveMarginCapacity(500, mini)).toBe(0.5);
    expect(getAdaptiveMarginCapacity(100_000, regular)).toBe(100);
  });

  it("scales Micro lot, margin, contract value, and risk from the Mini rule", () => {
    const result = buildAdaptivePositionPlan({
      ...VALID_INPUT,
      accountTier: "micro",
      initialLot: 0.01,
    });

    expect(result.valid).toBe(true);
    expect(result.rule).toMatchObject({
      accountTier: "micro",
      minimumLot: 0.01,
      maximumLot: 0.09,
      contractSize: 1,
      marginAtMinimumLot: 10,
    });
    expect(result.buy?.ladder.map((level) => level.lot)).toEqual([0.01, 0.01]);
    expect(result.buy?.marginRequired).toBe(20);
    expect(result.buy?.estimatedCycleLoss).toBeCloseTo(21);
    expect(result.buy?.totalFundsAtStop).toBeCloseTo(41);
  });

  it("builds candidate-driven Buy positions only at saved distinct levels", () => {
    const assessment = buildRecommendation({ availableMargin: 100_000, maximumLoss: 10_000 });

    expect(assessment.result.valid).toBe(true);
    expect(assessment.recommendation).toMatchObject({
      levels: 4,
      positions: 5,
      marginBudget: 100_000,
      maximumLoss: 10_000,
    });
    expect(assessment.decision).toMatchObject({
      posture: "scaling_allowed",
      preferredSide: "buy",
    });
    expect(assessment.result.buy?.ladder).toHaveLength(5);
    expect(assessment.result.sell).toBeNull();
    expect(assessment.sideEvaluations.sell.status).toBe("not_aligned");
    expect(assessment.result.buy?.totalLots).toBeGreaterThan(0.9);
    expect(assessment.result.buy?.ladder.every((level) => level.lot <= 0.9)).toBe(true);
    expect(assessment.result.buy?.ladder[1]).toMatchObject({
      price: 2300,
      basis: "entry_zone_edge",
    });
    expect(new Set(assessment.result.buy?.ladder.map((level) => level.price)).size).toBe(5);
    expect(assessment.result.buy?.estimatedCycleLoss).toBeLessThanOrEqual(
      assessment.recommendation!.usableRiskBudget,
    );
  });

  it("builds candidate-driven positions for a supported Sell analysis", () => {
    const assessment = buildRecommendation({
      availableMargin: 100_000,
      maximumLoss: 10_000,
      tradePlan: { ...TRADE_PLAN, preferredSide: "sell" },
      context: {
        ...SUPPORTIVE_CONTEXT,
        marketCondition: "trending_down",
        tradingBias: "bearish_strong",
        techBuyCount: 4,
        techSellCount: 14,
      },
    });

    expect(assessment.result.valid).toBe(true);
    expect(assessment.decision.preferredSide).toBe("sell");
    expect(assessment.result.sell?.ladder).toHaveLength(5);
    expect(assessment.result.buy).toBeNull();
    expect(assessment.sideEvaluations.buy.status).toBe("not_aligned");
  });

  it("accepts the aligned side independently when the opposite saved Stop Loss is financially unsafe", () => {
    const assessment = buildRecommendation({
      tradePlan: {
        ...TRADE_PLAN,
        sell: { ...TRADE_PLAN.sell, stopLoss: "10000" },
      },
    });

    expect(assessment.result.valid).toBe(true);
    expect(assessment.result.buy?.ladder.length).toBeGreaterThan(0);
    expect(assessment.result.sell).toBeNull();
    expect(assessment.decision.preferredSide).toBe("buy");
    expect(assessment.sideEvaluations.buy.status).toBe("viable");
    expect(assessment.sideEvaluations.sell.status).toBe("not_aligned");
    expect(assessment.sideEvaluations.sell.conditionalPlan).toBeNull();
    expect(assessment.sideEvaluations.sell.diagnostic?.riskShortfall).toBeGreaterThan(0);
  });

  it("shows conditional minimum-lot numbers for a geometrically valid but directionally disallowed side", () => {
    const assessment = buildRecommendation();
    const sellDiagnostic = assessment.sideEvaluations.sell.diagnostic;

    expect(assessment.result.sell).toBeNull();
    expect(assessment.sideEvaluations.sell.status).toBe("not_aligned");
    expect(sellDiagnostic).toMatchObject({
      lot: 0.1,
      marginRequired: 100,
      riskAtStop: 110,
      fundsRequiredAtStop: 210,
      effectiveLossBudget: 250,
      blocker: "direction",
      nextAction: "wait",
    });
    const conditionalPlan = assessment.sideEvaluations.sell.conditionalPlan;
    expect(conditionalPlan?.ladder.length).toBeGreaterThan(0);
    expect(conditionalPlan?.totalFundsAtStop).toBeLessThanOrEqual(5_000);
    expect(conditionalPlan?.estimatedCycleLoss).toBeLessThanOrEqual(250);
  });

  it("leaves minimum-lot diagnostics unavailable when saved side prices are incomplete", () => {
    const assessment = buildRecommendation({
      tradePlan: {
        ...TRADE_PLAN,
        sell: { ...TRADE_PLAN.sell, entryZone: "not available" },
      },
    });

    expect(assessment.sideEvaluations.sell).toEqual({
      status: "unavailable",
      diagnostic: null,
      conditionalPlan: null,
    });
  });

  it("reports minimum-lot margin and actual final-SL risk when no safe side fits", () => {
    const assessment = buildRecommendation({
      availableMargin: 105,
      maximumLoss: 100,
      checkpointPrices: {},
    });
    const diagnostic = assessment.sideEvaluations.buy.diagnostic;

    expect(assessment.result.valid).toBe(false);
    expect(assessment.recommendation).toBeNull();
    expect(diagnostic).toMatchObject({
      lot: 0.1,
      marginRequired: 100,
      riskAtStop: 110,
      fundsRequiredAtStop: 210,
      effectiveLossBudget: 50,
      marginShortfall: 105,
      riskShortfall: 60,
      blocker: "margin_and_risk",
      nextAction: "funds_and_loss_budget",
    });
  });

  it("applies Model C risk utilization and whole-plan layer allocation", () => {
    const conservative = buildRecommendation({ riskStyle: "conservative" });
    const balanced = buildRecommendation({ riskStyle: "balanced" });
    const aggressive = buildRecommendation({ riskStyle: "aggressive" });

    expect(conservative.recommendation?.riskStyle).toBe("conservative");
    expect(conservative.recommendation?.lotProfile).toBe("decreasing");
    expect(conservative.recommendation).toMatchObject({
      usableRiskBudget: 250,
      riskUtilizationRate: 0.5,
      unusedRiskBuffer: 250,
    });
    expect(balanced.recommendation?.riskStyle).toBe("balanced");
    expect(balanced.recommendation?.lotProfile).toBe("mixed");
    expect(balanced.recommendation).toMatchObject({
      usableRiskBudget: 375,
      riskUtilizationRate: 0.75,
      unusedRiskBuffer: 125,
    });
    expect(aggressive.recommendation?.riskStyle).toBe("aggressive");
    expect(aggressive.recommendation?.lotProfile).toBe("increasing");
    expect(aggressive.recommendation).toMatchObject({
      usableRiskBudget: 500,
      riskUtilizationRate: 1,
      unusedRiskBuffer: 0,
    });

    for (const assessment of [conservative, balanced, aggressive]) {
      const ladder = assessment.result.buy?.ladder ?? [];
      expect(ladder.every((level) => level.lot <= 0.9)).toBe(true);
      expect(assessment.result.buy?.totalLots).toBeGreaterThan(0);
      expect(assessment.result.buy?.estimatedCycleLoss)
        .toBeLessThanOrEqual(assessment.recommendation!.usableRiskBudget);
    }
  });

  it("sizes Regular from explicit risk styles without imposing a derived broker cap", () => {
    const common = {
      accountTier: "regular" as const,
      availableMargin: 200_000,
      maximumLoss: 70_000,
    };
    const conservative = buildRecommendation({ ...common, riskStyle: "conservative" });
    const balanced = buildRecommendation({ ...common, riskStyle: "balanced" });
    const aggressive = buildRecommendation({ ...common, riskStyle: "aggressive" });
    const initialLots = [
      conservative.result.buy?.ladder[0]?.lot,
      balanced.result.buy?.ladder[0]?.lot,
      aggressive.result.buy?.ladder[0]?.lot,
    ];

    expect(conservative.result.valid).toBe(true);
    expect(balanced.result.valid).toBe(true);
    expect(aggressive.result.valid).toBe(true);
    expect(initialLots[0]).toBeLessThan(initialLots[1]!);
    expect(initialLots[1]).toBeLessThan(initialLots[2]!);
    expect(initialLots.every((lot) => lot! < 50)).toBe(true);
  });

  it("derives lot per layer from allocated risk and distance to Stop Loss", () => {
    const assessment = buildRecommendation({
      riskStyle: "aggressive",
      maximumLoss: 10_000,
      availableMargin: 100_000,
    });

    expect(assessment.recommendation).toMatchObject({
      riskStyle: "aggressive",
      lotProfile: "increasing",
      positions: 5,
    });
    expect(assessment.result.buy?.ladder.length).toBe(5);
    expect(assessment.result.buy?.estimatedCycleLoss).toBeLessThanOrEqual(10_000);
  });

  it("changes an aggressive lot profile when the saved analysis is ranging", () => {
    const assessment = buildRecommendation({
      riskStyle: "aggressive",
      maximumLoss: 10_000,
      availableMargin: 100_000,
      context: { ...SUPPORTIVE_CONTEXT, marketCondition: "ranging" },
    });

    expect(assessment.recommendation?.lotProfile).toBe("mixed");
    expect(assessment.result.buy?.ladder.length).toBe(5);
    expect(assessment.result.buy?.estimatedCycleLoss).toBeLessThanOrEqual(10_000);
  });

  it("uses the selected style for Sell while hard limits can still force entry-only", () => {
    const sell = buildRecommendation({
      riskStyle: "aggressive",
      availableMargin: 100_000,
      maximumLoss: 10_000,
      tradePlan: { ...TRADE_PLAN, preferredSide: "sell" },
      context: {
        ...SUPPORTIVE_CONTEXT,
        marketCondition: "trending_down",
        tradingBias: "bearish_strong",
        techBuyCount: 4,
        techSellCount: 14,
      },
    });
    const constrained = buildRecommendation({ riskStyle: "aggressive", maximumLoss: 115 });

    expect(sell.result.sell?.ladder.length).toBe(5);
    expect(sell.result.sell?.ladder.every((level) => level.lot <= 0.9)).toBe(true);
    expect(constrained.recommendation).toMatchObject({
      riskStyle: "aggressive",
      lotProfile: "increasing",
      levels: 0,
      positions: 1,
    });
    expect(constrained.decision.posture).toBe("entry_only");
  });

  it("degrades from three to two total positions when the available funds cannot support all rows", () => {
    const assessment = buildRecommendation({
      availableMargin: 450,
      maximumLoss: 450,
      riskStyle: "aggressive",
    });

    expect(assessment.result.valid).toBe(true);
    expect(assessment.recommendation).toMatchObject({
      levels: 1,
      positions: 2,
    });
    expect(assessment.result.buy?.ladder).toHaveLength(2);
    expect(assessment.result.buy?.totalLots).toBe(0.2);
    expect(assessment.result.buy?.rejectedLadder.length).toBeGreaterThan(0);
  });

  it.each([
    { tier: "micro" as const, funds: 50, loss: 40, extraFunds: 10, plannedPositions: 2, nextLot: 0.01 },
    { tier: "regular" as const, funds: 4_000, loss: 3_000, extraFunds: 100, plannedPositions: 1, nextLot: 1 },
  ])("calculates the $tier next-layer broker-funds shortfall from margin plus final-SL risk", ({
    tier, funds, loss, extraFunds, plannedPositions, nextLot,
  }) => {
    const current = buildRecommendation({
      accountTier: tier, availableMargin: funds, maximumLoss: loss, riskStyle: "balanced",
    });
    const next = current.result.buy?.rejectedLadder[0];
    expect(current.result.valid).toBe(true);
    expect(current.recommendation?.marginBudget).toBe(funds);
    expect(current.result.buy?.ladder).toHaveLength(plannedPositions);
    expect(next).toMatchObject({
      level: plannedPositions,
      lot: nextLot,
      rejectReason: "day_margin",
      financialAlternative: { additionalFundsRequired: extraFunds, additionalLossBudgetRequired: 0 },
    });
    expect(next!.cumulativeDayMargin).toBeLessThan(funds);
    expect(next!.cumulativeFundsAtStop).toBeCloseTo(funds + extraFunds);
    expect(next!.estimatedRiskToStop).toBeLessThanOrEqual(current.recommendation!.usableRiskBudget);

    const recalculated = buildRecommendation({
      accountTier: tier, availableMargin: funds + extraFunds, maximumLoss: loss, riskStyle: "balanced",
    });
    expect(recalculated.result.valid).toBe(true);
    expect(recalculated.result.buy?.ladder).toHaveLength(plannedPositions + 1);
    expect(recalculated.result.buy?.ladder[plannedPositions]).toMatchObject({
      price: next!.price,
      lot: nextLot,
    });
  });

  it.each([
    { tier: "micro" as const, funds: 50.006, loss: 40, rawShortfall: 9.994, displayedShortfall: 10, plannedPositions: 2 },
    { tier: "regular" as const, funds: 4_000.006, loss: 3_000, rawShortfall: 99.994, displayedShortfall: 100, plannedPositions: 1 },
  ])("retains the exact $tier risk decision when the displayed shortfall needs a fraction of a cent", ({
    tier, funds, loss, rawShortfall, displayedShortfall, plannedPositions,
  }) => {
    const input = { accountTier: tier, maximumLoss: loss, riskStyle: "balanced" as const };
    const current = buildRecommendation({ ...input, availableMargin: funds });
    const next = current.result.buy?.rejectedLadder[0];
    expect(next?.rejectReason).toBe("day_margin");
    expect(next?.financialAlternative?.additionalFundsRequired).toBeCloseTo(rawShortfall, 6);
    expect(next?.cumulativeFundsAtStop).toBeCloseTo(
      next!.cumulativeDayMargin + next!.estimatedRiskToStop,
    );
    expect(next!.estimatedRiskToStop).toBeLessThanOrEqual(current.recommendation!.usableRiskBudget);

    const roundedDown = Math.round(rawShortfall * 100) / 100;
    expect(roundedDown).toBeLessThan(rawShortfall);
    expect(buildRecommendation({ ...input, availableMargin: funds + roundedDown }).result.buy?.ladder)
      .toHaveLength(plannedPositions);
    expect(buildRecommendation({ ...input, availableMargin: funds + displayedShortfall }).result.buy?.ladder)
      .toHaveLength(plannedPositions + 1);
  });

  it.each([
    { tier: "micro" as const, funds: 50, loss: 40, extraFunds: 10, plannedPositions: 2, nextPrice: 2303, nextLot: 0.01, nextRisk: 30 },
    { tier: "regular" as const, funds: 4_000, loss: 3_000, extraFunds: 100, plannedPositions: 1, nextPrice: 2302, nextLot: 1, nextRisk: 2_100 },
  ])("uses only Sell checkpoints for the $tier broker-funds alternative", ({
    tier, funds, loss, extraFunds, plannedPositions, nextPrice, nextLot, nextRisk,
  }) => {
    const sellInput = {
      accountTier: tier,
      riskStyle: "balanced" as const,
      tradePlan: { ...TRADE_PLAN, preferredSide: "sell" as const },
      context: {
        ...SUPPORTIVE_CONTEXT,
        marketCondition: "trending_down",
        tradingBias: "bearish_strong",
        techBuyCount: 4,
        techSellCount: 14,
      },
    };
    const current = buildRecommendation({ ...sellInput, availableMargin: funds, maximumLoss: loss });
    const next = current.result.sell?.rejectedLadder[0];
    expect(current.result.valid).toBe(true);
    expect(current.decision.preferredSide).toBe("sell");
    expect(current.result.buy).toBeNull();
    expect(current.sideEvaluations.buy.status).toBe("not_aligned");
    expect(current.result.sell?.ladder).toHaveLength(plannedPositions);
    expect(next).toMatchObject({
      level: plannedPositions,
      price: nextPrice,
      lot: nextLot,
      estimatedRiskToStop: nextRisk,
      rejectReason: "day_margin",
      financialAlternative: { additionalFundsRequired: extraFunds, additionalLossBudgetRequired: 0 },
    });
    expect(next!.cumulativeDayMargin + next!.estimatedRiskToStop).toBeCloseTo(funds + extraFunds);
    expect(next!.cumulativeFundsAtStop).toBeCloseTo(funds + extraFunds);
    expect(next!.estimatedRiskToStop).toBeLessThanOrEqual(current.recommendation!.usableRiskBudget);

    const recalculated = buildRecommendation({
      ...sellInput, availableMargin: funds + extraFunds, maximumLoss: loss,
    });
    expect(recalculated.result.sell?.ladder).toHaveLength(plannedPositions + 1);
    expect(recalculated.result.sell?.ladder[plannedPositions]).toMatchObject({ price: nextPrice, lot: nextLot });
    expect(recalculated.result.buy).toBeNull();
    expect(recalculated.sideEvaluations.buy.status).toBe("not_aligned");

    const riskBlocked = buildRecommendation({
      ...sellInput, availableMargin: tier === "micro" ? 30 : 3_000,
      maximumLoss: tier === "micro" ? 15 : 2_000,
    });
    expect(riskBlocked.result.sell?.rejectedLadder[0]?.financialAlternative?.additionalLossBudgetRequired)
      .toBeGreaterThan(0);
    const analysisBlocked = buildRecommendation({
      ...sellInput,
      availableMargin: funds,
      maximumLoss: loss,
      context: { ...sellInput.context, fundamentalContext: undefined },
    });
    expect(analysisBlocked.sideEvaluations.sell.status).toBe("not_aligned");
    expect(analysisBlocked.result.sell).toBeNull();
  });

  it.each(["micro", "regular"] as const)(
    "keeps $tier analysis and per-position tier guardrails ahead of funding alternatives",
    (accountTier) => {
      const unaligned = buildRecommendation({
        accountTier,
        availableMargin: 100_000,
        maximumLoss: 10_000,
        context: { ...SUPPORTIVE_CONTEXT, fundamentalContext: undefined },
      });
      expect(unaligned.sideEvaluations.buy.status).toBe("not_aligned");
      expect(unaligned.sideEvaluations.buy.conditionalPlan?.rejectedLadder.length).toBeGreaterThan(0);
      const analysisRejected = unaligned.sideEvaluations.buy.conditionalPlan?.rejectedLadder
        .filter((level) => level.rejectReason === "analysis_limit");
      expect(analysisRejected?.length).toBeGreaterThan(0);
      expect(analysisRejected?.every((level) => level.financialAlternative === null)).toBe(true);

      const funded = buildRecommendation({
        accountTier, availableMargin: 100_000, maximumLoss: 10_000, riskStyle: "aggressive",
      });
      expect(funded.result.valid).toBe(true);
      expect(funded.result.rule?.maximumLot).toBe(accountTier === "micro" ? 0.09 : null);
      expect(funded.result.buy?.ladder.every((level) =>
        funded.result.rule?.maximumLot == null || level.lot <= funded.result.rule.maximumLot
      )).toBe(true);
      expect(funded.result.buy?.rejectedLadder.some((level) => level.rejectReason === "tier_limit"))
        .toBe(false);
    },
  );

  it("uses all entered funds as the visible budget without a hidden allocation", () => {
    const assessment = buildRecommendation({ availableMargin: 1_234 });

    expect(assessment.recommendation?.marginBudget).toBe(1_234);
    expect(assessment.result.assumptions.join(" ")).toMatch(/used directly.*reserve part/i);
  });

  it("uses the entered maximum loss as an absolute hard ceiling", () => {
    const entryOnly = buildRecommendation({ maximumLoss: 220 });

    expect(entryOnly.result.valid).toBe(true);
    expect(entryOnly.recommendation).toMatchObject({
      levels: 0,
      positions: 1,
      maximumLoss: 220,
      usableRiskBudget: 110,
    });
    expect(entryOnly.decision.posture).toBe("entry_only");
    expect(entryOnly.result.buy?.ladder).toHaveLength(1);
    expect(entryOnly.result.buy?.rejectedLadder[0]?.rejectReason).toBe("loss_ceiling");
  });

  it("does not subtract existing exposure from the per-position Mini cap", () => {
    const assessment = buildRecommendation({ existingExposure: 0.9, availableMargin: 100_000, maximumLoss: 10_000 });

    expect(assessment.result.valid).toBe(true);
    expect(assessment.result.buy?.ladder.every((level) => level.lot <= 0.9)).toBe(true);
    expect(assessment.result.buy?.totalLots).toBeGreaterThan(0.9);
    expect(assessment.result.assumptions.join(" ")).toMatch(/not subtracted.*per-position cap/i);
  });

  it("caps every requested layer independently instead of capping cumulative lots", () => {
    const result = buildAdaptivePositionPlan({
      ...VALID_INPUT,
      availableFunds: 10_000,
      maximumLoss: 10_000,
      initialLot: 0.9,
      levels: 2,
      sideLevels: { buy: 2, sell: 0 },
      includedSides: { buy: true, sell: false },
      layerLotFactors: [2, 3],
    });

    expect(result.valid).toBe(true);
    expect(result.buy?.ladder.map((level) => level.lot)).toEqual([0.9, 0.9, 0.9]);
    expect(result.buy?.totalLots).toBe(2.7);
  });

  it("fails explicitly when any account input is missing", () => {
    const result = buildAdaptivePositionPlan({
      ...VALID_INPUT,
      availableFunds: null,
      maximumLoss: null,
      existingExposure: null,
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      "Available trading funds are required.",
      "Maximum acceptable loss is required.",
      "Existing exposure is required.",
    ]));
  });

  it("rejects a loss limit larger than the available funds", () => {
    const assessment = buildRecommendation({
      availableMargin: 100,
      maximumLoss: 101,
    });

    expect(assessment.recommendation).toBeNull();
    expect(assessment.result.errors).toContain(
      "Maximum acceptable loss cannot exceed available trading funds.",
    );
  });

  it("shows auditable lot, margin, risk, and target math", () => {
    const result = buildAdaptivePositionPlan(VALID_INPUT);
    const buy = result.buy!;

    expect(result.valid).toBe(true);
    expect(buy.ladder.map((level) => level.lot)).toEqual([0.1, 0.1]);
    expect(buy.ladder[0].basis).toBe("analysis_entry");
    expect(buy.ladder[1].basis).toBe("entry_zone_edge");
    expect(buy.marginRequired).toBe(200);
    expect(buy.estimatedCycleLoss).toBe(210);
    expect(buy.totalFundsAtStop).toBe(410);
    expect(buy.remainingFundsAtStop).toBe(4_590);
    expect(buy.ladder[0]).toMatchObject({
      dayMarginForLot: 100,
      cumulativeDayMargin: 100,
      riskToStopForLot: 110,
      estimatedRiskToStop: 110,
      cumulativeFundsAtStop: 210,
      remainingFundsAtStop: 4_790,
    });
    expect(buy.ladder[1]).toMatchObject({
      dayMarginForLot: 100,
      cumulativeDayMargin: 200,
      riskToStopForLot: 100,
      estimatedRiskToStop: 210,
      cumulativeFundsAtStop: 410,
      remainingFundsAtStop: 4_590,
    });
    expect(buy.profitToTakeProfit1).toBeGreaterThan(0);
    expect(buy.profitToTakeProfit2).toBeGreaterThan(buy.profitToTakeProfit1!);
  });

  it("keeps unavailable take-profit profit values null", () => {
    const result = buildAdaptivePositionPlan({
      ...VALID_INPUT,
      tradePlan: {
        ...TRADE_PLAN,
        buy: { ...TRADE_PLAN.buy, takeProfit2: "n/a" },
      },
    });
    const buy = result.buy!;

    expect(result.valid).toBe(true);
    expect(buy.takeProfit1).toBe(2315);
    expect(buy.takeProfit2).toBeNull();
    expect(buy.profitToTakeProfit1).toBeGreaterThan(0);
    expect(buy.profitToTakeProfit2).toBeNull();
    expect(buy.ladder.every((level) => level.cumulativeProfitToTakeProfit2 === null)).toBe(true);
  });

  it("classifies a candidate blocked by combined margin and SL loss as a funds shortfall", () => {
    const assessment = buildRecommendation({
      availableMargin: 450,
      maximumLoss: 450,
      riskStyle: "aggressive",
    });
    const rejected = assessment.result.buy?.rejectedLadder[0];

    expect(rejected).toBeDefined();
    expect(rejected).toMatchObject({
      dayMarginForLot: 100,
      cumulativeDayMargin: 300,
      riskToStopForLot: 90,
      estimatedRiskToStop: 300,
      cumulativeFundsAtStop: 600,
      remainingFundsAtStop: -150,
      rejectReason: "day_margin",
      financialAlternative: {
        additionalFundsRequired: 150,
        additionalLossBudgetRequired: 0,
      },
    });
  });

  it("does not offer a financial alternative for analysis-only rejection", () => {
    const assessment = buildRecommendation({
      context: {
        ...SUPPORTIVE_CONTEXT,
        fundamentalContext: undefined,
      },
    });

    expect(assessment.result.valid).toBe(false);
    expect(assessment.sideEvaluations.buy.status).toBe("not_aligned");
    expect(assessment.sideEvaluations.buy.conditionalPlan?.rejectedLadder[0]?.rejectReason).toBe("analysis_limit");
    expect(assessment.sideEvaluations.buy.conditionalPlan?.rejectedLadder[0]?.financialAlternative).toBeNull();
  });

  it("bounds additions and accepts a valid Regular tier plan without a 50-lot source cap", () => {
    const tooManyLayers = buildAdaptivePositionPlan({ ...VALID_INPUT, levels: 7 });
    const buySideBypass = buildAdaptivePositionPlan({
      ...VALID_INPUT,
      levels: 6,
      sideLevels: { buy: 7, sell: 0 },
    });
    const sellSideBypass = buildAdaptivePositionPlan({
      ...VALID_INPUT,
      levels: 0,
      sideLevels: { buy: 0, sell: 1 },
    });
    const regular = buildAdaptivePositionPlan({
      ...VALID_INPUT,
      accountTier: "regular",
      initialLot: 1,
      levels: 0,
      maximumLoss: 5_000,
    });

    expect(tooManyLayers.valid).toBe(false);
    expect(tooManyLayers.errors.join(" ")).toMatch(/between 0 and 6/i);
    expect(buySideBypass.valid).toBe(false);
    expect(buySideBypass.errors.join(" ")).toMatch(/Buy additional levels/i);
    expect(sellSideBypass.valid).toBe(false);
    expect(sellSideBypass.errors.join(" ")).toMatch(/Sell additional levels/i);
    expect(regular.valid).toBe(true);
    expect(regular.rule).toMatchObject({ maximumLot: null, contractSize: 100, marginAtMinimumLot: 1_000 });
  });

  it("scales Regular margin, profit, and loss tenfold from the Mini rule", () => {
    const miniMinimum = buildAdaptivePositionPlan({
      ...VALID_INPUT,
      accountTier: "mini",
      initialLot: 0.1,
      levels: 0,
      maximumLoss: 5_000,
    });
    const regularMinimum = buildAdaptivePositionPlan({
      ...VALID_INPUT,
      accountTier: "regular",
      initialLot: 1,
      levels: 0,
      maximumLoss: 5_000,
    });
    // One numeric lot represents ten Mini minimum positions. The tier's
    // minimum contract value must not be multiplied by the numeric lot again.
    const miniPerLot = buildAdaptivePositionPlan({
      ...VALID_INPUT,
      accountTier: "mini",
      initialLot: 1,
      levels: 0,
      maximumLoss: 5_000,
    });
    const regularPerLot = buildAdaptivePositionPlan({
      ...VALID_INPUT,
      accountTier: "regular",
      initialLot: 1,
      levels: 0,
      maximumLoss: 5_000,
    });

    expect(miniMinimum.valid).toBe(true);
    expect(regularMinimum.valid).toBe(true);
    expect(regularMinimum.buy?.marginRequired).toBeCloseTo((miniMinimum.buy?.marginRequired ?? 0) * 10);
    expect(regularMinimum.buy?.estimatedCycleLoss).toBeCloseTo((miniMinimum.buy?.estimatedCycleLoss ?? 0) * 10);
    expect(miniPerLot.valid).toBe(false);
    expect(regularPerLot.valid).toBe(true);
    expect(regularPerLot.buy?.estimatedCycleLoss).toBeCloseTo(miniPerLot.buy?.estimatedCycleLoss ?? 0);
    expect(regularPerLot.buy?.profitToTakeProfit1).toBeCloseTo(miniPerLot.buy?.profitToTakeProfit1 ?? 0);
    expect(regularPerLot.buy?.profitToTakeProfit2).toBeCloseTo(miniPerLot.buy?.profitToTakeProfit2 ?? 0);
  });

  it("preserves Regular insufficient-funds and maximum-loss blockers", () => {
    const insufficientFunds = buildAdaptivePositionPlan({
      ...VALID_INPUT,
      accountTier: "regular",
      initialLot: 1,
      levels: 0,
      availableFunds: 999,
      maximumLoss: 999,
    });
    const insufficientLossBudget = buildAdaptivePositionPlan({
      ...VALID_INPUT,
      accountTier: "regular",
      initialLot: 1,
      levels: 0,
      availableFunds: 5_000,
      maximumLoss: 1_099,
    });

    expect(insufficientFunds.valid).toBe(false);
    expect(insufficientFunds.errors.join(" ")).toMatch(/margin exceeds available trading funds/i);
    expect(insufficientLossBudget.valid).toBe(false);
    expect(insufficientLossBudget.errors.join(" ")).toMatch(/loss at the final Stop Loss exceeds/i);
  });

  it("rejects unsupported products from the Adaptive calculator", () => {
    for (const instrument of ["HANG SENG", "NIKKEI 225", "EUR/USD"]) {
      const result = buildAdaptivePositionPlan({ ...VALID_INPUT, instrument });
      expect(result.valid).toBe(false);
      expect(result.buy).toBeNull();
      expect(result.errors.join(" ")).toMatch(/only for supported canonical instruments/i);
    }
  });

  it("rejects malformed Buy and Sell stop directions", () => {
    const result = buildAdaptivePositionPlan({
      ...VALID_INPUT,
      tradePlan: {
        ...TRADE_PLAN,
        buy: { ...TRADE_PLAN.buy, stopLoss: "2,310.00" },
        sell: { ...TRADE_PLAN.sell, stopLoss: "2,290.00" },
      },
    });

    expect(result.valid).toBe(false);
    expect(result.buy).toBeNull();
    expect(result.sell).toBeNull();
    expect(result.errors).toEqual(expect.arrayContaining([
      "Buy stop loss must be below the Standard Plan entry.",
      "Sell stop loss must be above the Standard Plan entry.",
    ]));
  });

  it("does not treat timeframe labels in Pro descriptions as prices", () => {
    const assessment = buildRecommendation({
      tradePlan: {
        ...TRADE_PLAN,
        buy: { ...TRADE_PLAN.buy, entryZone: "di atas 2,302 setelah breakout H1" },
        sell: { ...TRADE_PLAN.sell, entryZone: "di bawah 2,300 setelah breakdown 4H" },
      },
    });

    expect(assessment.result.valid).toBe(true);
    expect(assessment.result.buy?.entry).toBe(2302);
    expect(assessment.result.sell).toBeNull();
    expect(assessment.sideEvaluations.sell.status).toBe("not_aligned");
  });

  it("uses real chart swing points only inside the saved entry-to-stop path", () => {
    const candidates = getAdaptiveChartCandidatePrices(
      [
        { high: 2306, low: 2302 },
        { high: 2305, low: 2300 },
        { high: 2303, low: 2296 },
        { high: 2304, low: 2299 },
        { high: 2308, low: 2301 },
        { high: 2310, low: 2303 },
        { high: 2307, low: 2300 },
        { high: 2306, low: 2301 },
        { high: 2305, low: 2299 },
      ],
      TRADE_PLAN,
      0.1,
    );

    expect(candidates.buy).toContain(2296);
    expect(candidates.sell).toContain(2310);
    expect(candidates.buy.every((price) => price > 2290 && price < 2301)).toBe(true);
    expect(candidates.sell.every((price) => price < 2312 && price > 2301)).toBe(true);
  });

  it("does not invent a layer when no saved-zone or chart checkpoint exists", () => {
    const assessment = buildRecommendation({
      tradePlan: {
        ...TRADE_PLAN,
        preferredSide: "buy",
        buy: { ...TRADE_PLAN.buy, entryZone: "2301" },
      },
      checkpointPrices: { buy: [], sell: [] },
    });

    expect(assessment.recommendation?.levels).toBe(0);
    expect(assessment.result.buy?.ladder).toHaveLength(1);
    expect(assessment.decision.posture).toBe("entry_only");
  });

  it("does not mirror a checkpoint from the wrong side of the saved risk path", () => {
    const assessment = buildRecommendation({
      checkpointPrices: { buy: [2303], sell: [2299] },
    });

    expect(assessment.recommendation?.levels).toBe(1);
    expect(assessment.result.buy?.ladder.map((level) => level.price)).toEqual([2301, 2300]);
    expect(assessment.result.sell).toBeNull();
  });

  it("keeps both sides conditional and unselected when required analysis context is missing", () => {
    const assessment = buildRecommendation({
      context: { ...SUPPORTIVE_CONTEXT, fundamentalContext: undefined },
    });

    expect(assessment.result.valid).toBe(false);
    expect(assessment.recommendation).toBeNull();
    expect(assessment.decision.posture).toBe("entry_only");
    expect(assessment.decision.preferredSide).toBe("none");
    expect(assessment.decision.reasonCodes).toContain("context_unavailable");
    expect(assessment.result.buy).toBeNull();
    expect(assessment.result.sell).toBeNull();
    expect(assessment.sideEvaluations.buy.status).toBe("not_aligned");
    expect(assessment.sideEvaluations.sell.status).toBe("not_aligned");
    expect(assessment.sideEvaluations.buy.conditionalPlan?.ladder).toHaveLength(1);
    expect(assessment.sideEvaluations.sell.conditionalPlan?.ladder).toHaveLength(1);
  });

  it("does not promote the saved preferred side when current analysis bias is neutral", () => {
    const assessment = buildRecommendation({
      tradePlan: { ...TRADE_PLAN, preferredSide: "buy" },
      context: { ...SUPPORTIVE_CONTEXT, tradingBias: "neutral" },
    });

    expect(assessment.result.valid).toBe(false);
    expect(assessment.recommendation).toBeNull();
    expect(assessment.decision).toMatchObject({
      posture: "entry_only",
      preferredSide: "none",
    });
    expect(assessment.result.buy).toBeNull();
    expect(assessment.result.sell).toBeNull();
    expect(assessment.sideEvaluations.buy.status).toBe("not_aligned");
    expect(assessment.sideEvaluations.sell.status).toBe("not_aligned");
    expect(assessment.sideEvaluations.buy.conditionalPlan?.ladder).toHaveLength(1);
    expect(assessment.sideEvaluations.sell.conditionalPlan?.ladder).toHaveLength(1);
  });

  it("keeps supported layers while applying a soft risk warning", () => {
    const assessment = buildRecommendation({
      context: { ...SUPPORTIVE_CONTEXT, timeframe: "5m" },
      maximumLoss: 10_000,
      availableMargin: 100_000,
    });

    expect(assessment.result.valid).toBe(true);
    expect(assessment.recommendation?.levels).toBeGreaterThan(0);
    expect(assessment.decision.posture).toBe("scaling_allowed");
    expect(assessment.decision.reasonCodes).toContain("short_timeframe");
  });

  it("keeps a $300 Micro account within its $100 loss ceiling and $0.09 per-position cap", () => {
    const result = buildAdaptivePositionPlan({
      ...VALID_INPUT,
      accountTier: "micro",
      availableFunds: 300,
      maximumLoss: 100,
      initialLot: 0.01,
      levels: 2,
    });

    expect(result.valid).toBe(true);
    expect(result.rule).toMatchObject({ accountTier: "micro", maximumLot: 0.09 });
    expect(result.buy?.ladder.every((level) => level.lot <= 0.09)).toBe(true);
    expect(result.buy?.estimatedCycleLoss).toBeLessThanOrEqual(100);
    expect(result.buy?.totalFundsAtStop).toBeLessThanOrEqual(300);
    expect(result.buy?.ladder.every((level) => level.lot >= 0.01)).toBe(true);
  });

  it("calculates three distinct Micro entries against the corrected contract value", () => {
    const tradePlan: TradePlan = {
      ...TRADE_PLAN,
      buy: {
        ...TRADE_PLAN.buy,
        entryZone: "4300",
        stopLoss: "4285",
        takeProfit1: "4320",
        takeProfit2: "4350",
      },
    };
    const result = buildAdaptivePositionPlan({
      ...VALID_INPUT,
      tradePlan,
      accountTier: "micro",
      availableFunds: 600,
      maximumLoss: 300,
      initialLot: 0.09,
      levels: 2,
      includedSides: { buy: true, sell: false },
      checkpointPrices: { buy: [4295, 4290, 4299.9] },
    });
    expect(result.valid).toBe(true);
    expect(result.buy?.ladder.map((level) => level.price)).toEqual([4300, 4295, 4290]);
    expect(result.buy?.ladder.map((level) => level.lot)).toEqual([0.09, 0.09, 0.09]);
    expect(result.buy?.marginRequired).toBeCloseTo(270);
    expect(result.buy?.estimatedCycleLoss).toBeCloseTo(270);
    expect(result.buy?.profitToTakeProfit2).toBeCloseTo(1485);
    expect(tradePlan.buy.stopLoss).toBe("4285");
  });

  it("does not automatically switch account tiers while sizing", () => {
    const micro = buildRecommendation({
      accountTier: "micro",
      availableMargin: 300,
      maximumLoss: 100,
    });
    const mini = buildRecommendation({
      accountTier: "mini",
      availableMargin: 300,
      maximumLoss: 100,
    });

    expect(micro.result.rule?.accountTier).toBe("micro");
    expect(micro.result.buy?.ladder.every((level) => level.lot <= 0.09)).toBe(true);
    expect(mini.result.rule?.accountTier).toBe("mini");
  });

  it("fails closed for missing, invalid, and expired analysis freshness", () => {
    const expired = buildRecommendation({
      context: { ...SUPPORTIVE_CONTEXT, validUntil: new Date(Date.now() - 1_000).toISOString() },
    });
    const missing = buildRecommendation({
      context: { ...SUPPORTIVE_CONTEXT, validUntil: undefined },
    });

    expect(expired.result.valid).toBe(false);
    expect(expired.result.errors).toContain(
      "Saved analysis is expired or has no validUntil timestamp; reanalysis is required.",
    );
    expect(expired.recommendation).toBeNull();
    expect(missing.result.valid).toBe(false);
    expect(missing.recommendation).toBeNull();
  });

  it("counts only high-impact events within the imminent or immediate post-release window", () => {
    const now = new Date();
    const imminent = buildRecommendation({
      context: {
        ...SUPPORTIVE_CONTEXT,
        fundamentalContext: {
          newsItems: [],
          calendarEvents: [<CalendarEventFixture>{
            date: now.toISOString().slice(0, 10),
            time: now.toISOString().slice(11, 16),
            currency: "USD",
            event: "Central-bank rate decision",
            impact: "★★★",
            actual: null,
            forecast: null,
            previous: null,
          }],
        },
      },
    });
    const pastOrDistant = buildRecommendation({
      context: {
        ...SUPPORTIVE_CONTEXT,
        fundamentalContext: {
          newsItems: [],
          calendarEvents: [-30, 45].map((dayOffset) => {
            const date = new Date(Date.now() + dayOffset * 24 * 60 * 60 * 1000);
            return {
              date: date.toISOString().slice(0, 10),
              time: "12:00",
              currency: "USD",
              event: "Old or distant release",
              impact: "★★★",
              actual: null,
              forecast: null,
              previous: null,
            };
          }),
        },
      },
    });

    expect(imminent.context.fundamental.upcomingHighImpactCount).toBe(1);
    expect(imminent.decision.reasonCodes).toContain("fundamental_high_impact");
    expect(pastOrDistant.context.fundamental.upcomingHighImpactCount).toBe(0);
    expect(pastOrDistant.decision.reasonCodes).not.toContain("fundamental_high_impact");
  });

  it("reports volatility from the selected timeframe candles without altering Standard Plan stops", () => {
    const candles = [
      [2304, 2300], [2305, 2301], [2306, 2302], [2303, 2297], [2304, 2299],
      [2307, 2301], [2310, 2302], [2308, 2301], [2305, 2300], [2312, 2303], [2309, 2302],
    ].map(([high, low], index) => ({
      date: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
      open: low,
      high,
      low,
      close: high - 1,
    }));
    const assessment = buildRecommendation({
      candles,
      context: { ...SUPPORTIVE_CONTEXT, timeframe: "4h" },
    });

    expect(assessment.volatilityDiagnostic).toMatchObject({
      status: "observed",
      timeframe: "4h",
      candleCount: 11,
      observedRange: 6,
      buyStopLooksTight: false,
    });
    expect(assessment.result.buy?.stopLoss).toBe(2290);
    expect(assessment.candleAlternative).toMatchObject({
      status: "available",
      side: "buy",
    });
    if (assessment.candleAlternative.status === "available") {
      expect(assessment.candleAlternative.entry).not.toBe(assessment.result.buy?.entry);
      expect(assessment.candleAlternative.stopLoss).toBeLessThan(assessment.candleAlternative.entry);
      expect(assessment.candleAlternative.takeProfit).toBeGreaterThan(assessment.candleAlternative.entry);
    }
  });

  it("reports invalid or insufficient candles and requires reanalysis instead of inventing alternatives", () => {
    const insufficient = buildRecommendation({
      candles: [
        { high: 2303, low: 2300 },
        { high: 2304, low: 2301 },
        { high: 2302, low: 2299 },
        { high: 2305, low: 2300 },
      ],
    });
    const invalid = buildRecommendation({
      candles: Array.from({ length: 8 }, () => ({ high: 10, low: -1 })),
    });

    expect(insufficient.volatilityDiagnostic.status).toBe("unavailable");
    expect(insufficient.candleAlternative.status).toBe("needs_reanalysis");
    expect(invalid.volatilityDiagnostic).toMatchObject({
      status: "unavailable",
      candleCount: 0,
    });
    expect(invalid.candleAlternative.status).toBe("needs_reanalysis");
  });

  it.each(["1m", "5m", "15m", "30m", "1h", "4h", "1D", "1W"])(
    "assesses saved %s against candles from that same timeframe",
    (timeframe) => {
      const candles = Array.from({ length: 7 }, (_, index) => ({
        date: new Date(Date.now() - (7 - index) * 60_000).toISOString(),
        open: 2300,
        high: 2302 + index,
        low: 2298 - index,
        close: 2301,
      }));
      const result = buildRecommendation({
        context: { ...SUPPORTIVE_CONTEXT, timeframe },
        candles,
      });
      expect(result.volatilityDiagnostic.timeframe).toBe(timeframe.toLowerCase());
      expect(result.volatilityDiagnostic.candleCount).toBe(7);
      expect(result.result.buy?.stopLoss).toBe(2290);
      expect(result.context.timeframe).toBe(timeframe);
    },
  );

  it("invalidates saved recommendations when analysis context changes", () => {
    const base = {
      instrument: "XAU/USD",
      tradePlan: TRADE_PLAN,
      context: SUPPORTIVE_CONTEXT,
      standardRule: GOLD_RULE,
    };
    const original = createAdaptivePlanFingerprint(base);

    expect(createAdaptivePlanFingerprint({
      ...base,
      context: { ...SUPPORTIVE_CONTEXT, timeframe: "4h" },
    })).not.toBe(original);
    expect(createAdaptivePlanFingerprint({
      ...base,
      context: { ...SUPPORTIVE_CONTEXT, validUntil: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString() },
    })).not.toBe(original);
    expect(createAdaptivePlanFingerprint({
      ...base,
      tradePlan: {
        ...TRADE_PLAN,
        buy: { ...TRADE_PLAN.buy, stopLoss: "2,288.00" },
      },
    })).not.toBe(original);
    expect(createAdaptivePlanFingerprint({
      ...base,
      riskStyle: "balanced",
    })).not.toBe(original);
    expect(createAdaptivePlanFingerprint({
      ...base,
      riskStyle: "aggressive",
    })).not.toBe(original);
    expect(createAdaptivePlanFingerprint({
      ...base,
      accountTier: "micro",
    })).not.toBe(original);
  });
});