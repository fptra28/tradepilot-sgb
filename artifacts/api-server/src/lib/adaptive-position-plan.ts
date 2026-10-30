/*
 * Adaptive Position Plan (dipindah dari web TP lama ke backend).
 *
 * Mesin hitung deterministik: AI hanya memberi arah & level harga; lot,
 * margin, risiko di SL, profit TP, dan layer entry dihitung di sini dari
 * TP Standard Trading Rules (dokumen trading rules broker). Tidak ada angka
 * uang yang dibuat oleh model AI.
 */
import type { StandardTradingRuleInstrument } from "./standard-trading-rules";

export interface TradeSide {
  entryZone: string;
  stopLoss: string;
  takeProfit1: string;
  takeProfit2: string;
  riskRewardRatio: string;
  rationale: string;
}

export interface TradePlan {
  preferredSide: "buy" | "sell" | "wait";
  buy: TradeSide;
  sell: TradeSide;
}

export interface FundamentalContext {
  newsItems: unknown[];
  calendarEvents: Array<{
    impact: string | null;
    date?: string | null;
    time?: string | null;
    epochMs?: number | null;
  }>;
}
import { BROKER_CONTRACT_TIERS } from "@workspace/instrument-taxonomy";
import type { BrokerAccountTier, BrokerContractCode } from "@workspace/instrument-taxonomy";

export type AdaptiveMarket = "gold" | "brent" | "hang_seng" | "nikkei";
export type AccountTier = BrokerAccountTier;
export type AdaptiveRiskStyle = "conservative" | "balanced" | "aggressive";
export type AdaptiveLotProfile = "decreasing" | "mixed" | "increasing";
export type AdaptivePlanPosture = "scaling_allowed" | "entry_only" | "not_recommended";
export type AdaptiveLayerBasis = "analysis_entry" | "entry_zone_edge" | "current_chart_swing";
export type AdaptiveLayerRejectReason = "day_margin" | "loss_ceiling" | "tier_limit" | "analysis_limit";
export type AdaptivePlanReasonCode =
  | "context_unavailable"
  | "short_timeframe"
  | "high_risk"
  | "volatile_market"
  | "low_confidence"
  | "range_supports_scaling"
  | "trend_favors_buy"
  | "trend_favors_sell"
  | "trend_opposes_buy"
  | "trend_opposes_sell"
  | "technical_supports_buy"
  | "technical_supports_sell"
  | "technical_mixed"
  | "technical_unavailable"
  | "neutral_bias"
  | "fundamental_high_impact"
  | "fundamental_present"
  | "fundamental_clear"
  | "fundamental_unavailable"
  | "directional_conflict"
  | "staged_add_condition";

export interface AdaptiveAnalysisContext {
  timeframe?: string | null;
  validUntil?: string | Date | null;
  marketCondition?: string | null;
  riskLevel?: string | null;
  tradingBias?: string | null;
  confidenceMin?: number | null;
  confidenceMax?: number | null;
  techBuyCount?: number | null;
  techSellCount?: number | null;
  techNeutralCount?: number | null;
  fundamentalContext?: FundamentalContext | null;
}

export type AdaptiveCandleFreshnessReason =
  | "bar_missing" | "bar_old" | "source_missing" | "source_old" | "feed_unavailable";

const MAX_ADAPTIVE_BAR_AGE_MS: Record<string, number> = {
  "1m": 6 * 60 * 60_000, "5m": 6 * 60 * 60_000,
  "15m": 6 * 60 * 60_000, "30m": 8 * 60 * 60_000,
  "1h": 12 * 60 * 60_000, "4h": 36 * 60 * 60_000,
  "1d": 4 * 24 * 60 * 60_000, "1w": 14 * 24 * 60 * 60_000,
};

const MAX_ADAPTIVE_SOURCE_AGE_MS: Record<string, number> = {
  "1m": 30_000, "5m": 60_000, "15m": 3 * 60_000,
  "30m": 4 * 60_000, "1h": 5 * 60_000,
  "4h": 15 * 60_000, "1d": 60 * 60_000, "1w": 60 * 60_000,
};

export function assessAdaptiveCandleFreshness(
  candles: readonly { date?: string | null }[],
  timeframe: string | null | undefined,
  source: { sourceFetchedAt?: unknown; sourceMaxAgeMs?: unknown; isStale?: unknown; staleReason?: unknown },
  now = Date.now(),
): { reason: AdaptiveCandleFreshnessReason | null; expiresAt: number | null } {
  const tf = timeframe?.toLowerCase() ?? "";
  const barAge = MAX_ADAPTIVE_BAR_AGE_MS[tf];
  const barTime = candles.length ? Math.max(...candles.map((c) => Date.parse(c.date ?? ""))) : NaN;
  if (!barAge || !Number.isFinite(barTime) || barTime > now + 60_000) {
    return { reason: "bar_missing", expiresAt: null };
  }
  if (barTime + barAge <= now) return { reason: "bar_old", expiresAt: null };

  const fetched = typeof source.sourceFetchedAt === "string" ? Date.parse(source.sourceFetchedAt) : NaN;
  const localMaxAge = MAX_ADAPTIVE_SOURCE_AGE_MS[tf];
  if (!Number.isFinite(fetched) || fetched > now + 60_000 || !localMaxAge ||
      typeof source.sourceMaxAgeMs !== "number" || !Number.isFinite(source.sourceMaxAgeMs) ||
      source.sourceMaxAgeMs <= 0 || typeof source.isStale !== "boolean") {
    return { reason: "source_missing", expiresAt: null };
  }
  const sourceExpiry = fetched + Math.min(localMaxAge, source.sourceMaxAgeMs);
  if (source.staleReason === "feed_unavailable") return { reason: "feed_unavailable", expiresAt: null };
  if (source.isStale || source.staleReason != null || sourceExpiry <= now) {
    return { reason: "source_old", expiresAt: null };
  }
  return { reason: null, expiresAt: Math.min(sourceExpiry, barTime + barAge) };
}

export interface AdaptivePlanContext {
  timeframe: string | null;
  validUntil: string | null;
  marketCondition: string | null;
  riskLevel: string | null;
  tradingBias: string | null;
  confidenceMin: number | null;
  confidenceMax: number | null;
  technical: { buy: number; sell: number; neutral: number } | null;
  fundamental: {
    available: boolean;
    newsCount: number;
    eventCount: number;
    highImpactCount: number;
    upcomingHighImpactCount: number;
  };
}

export interface AdaptiveVolatilityDiagnostic {
  status: "unavailable" | "observed" | "tight_stop";
  timeframe: string | null;
  candleCount: number;
  observedRange: number | null;
  buyStopDistance: number | null;
  sellStopDistance: number | null;
  buyStopLooksTight: boolean | null;
  sellStopLooksTight: boolean | null;
}

export type AdaptiveCandleAlternative =
  | {
      status: "available";
      side: "buy" | "sell";
      entry: number;
      stopLoss: number;
      takeProfit: number;
      riskReward: number;
      lot: number;
      estimatedLoss: number;
      dayMargin: number;
    }
  | { status: "needs_reanalysis"; reason: string };

export interface AdaptivePlanDecision {
  posture: AdaptivePlanPosture;
  preferredSide: "buy" | "sell" | "both" | "none";
  reasonCodes: AdaptivePlanReasonCode[];
}

export interface AdaptiveMinimumLotDiagnostic {
  lot: number;
  marginRequired: number;
  riskAtStop: number;
  fundsRequiredAtStop: number;
  effectiveLossBudget: number;
  marginShortfall: number;
  riskShortfall: number;
  maximumLossShortfall: number;
  blocker: "margin" | "risk" | "margin_and_risk" | "analysis" | "direction";
  nextAction: "funds" | "loss_budget" | "funds_and_loss_budget" | "reanalysis" | "wait";
}

export interface AdaptiveSideEvaluation {
  status: "viable" | "blocked" | "not_aligned" | "unavailable";
  diagnostic: AdaptiveMinimumLotDiagnostic | null;
  conditionalPlan: AdaptiveSidePositionPlan | null;
}

export interface AdaptiveRule {
  market: AdaptiveMarket;
  label: string;
  accountTier: AccountTier;
  marginBasis: "day";
  contractSize: number;
  contractUnit: "troy ounce" | "barrel" | "USD/point";
  contractSource: "broker_document" | "micro_assumption";
  minMovement: number;
  marginPerLot: number;
  marginAtMinimumLot: number;
  minimumLot: number;
  maximumLot: number | null;
  lotStep: number;
  minimumOpeningFunds: number | null;
  maxGapPercent: number | null;
  source: "TP Standard Trading Rules";
}

export interface AdaptivePositionPlanInput {
  instrument: string;
  tradePlan: TradePlan;
  standardRule: StandardTradingRuleInstrument | null;
  availableFunds: number | null;
  maximumLoss: number | null;
  existingExposure: number | null;
  initialLot: number | null;
  accountTier: AccountTier;
  levels: number;
  sideLevels?: { buy?: number; sell?: number };
  includedSides?: { buy: boolean; sell: boolean };
  layerLotFactors?: readonly number[];
  layerRiskWeights?: readonly number[];
  checkpointPrices?: { buy?: number[]; sell?: number[] };
}

export interface AdaptiveChartCandle {
  date?: string;
  open?: number;
  high: number;
  low: number;
  close?: number;
}

export interface AdaptiveLadderLevel {
  level: number;
  price: number;
  lot: number;
  cumulativeLots: number;
  estimatedRiskToStop: number;
  distanceFromEntry: number;
  riskToStopForLot: number;
  dayMarginForLot: number;
  cumulativeDayMargin: number;
  cumulativeFundsAtStop: number;
  remainingFundsAtStop: number | null;
  profitToTakeProfit1: number | null;
  profitToTakeProfit2: number | null;
  cumulativeProfitToTakeProfit1: number | null;
  cumulativeProfitToTakeProfit2: number | null;
  basis: AdaptiveLayerBasis;
  invalidationProgress: number;
  reason: string;
}

export interface AdaptiveRejectedLadderLevel extends AdaptiveLadderLevel {
  rejectReason: AdaptiveLayerRejectReason;
  financialAlternative: {
    additionalFundsRequired: number;
    additionalLossBudgetRequired: number;
  } | null;
}

export interface AdaptiveSidePositionPlan {
  side: "buy" | "sell";
  entry: number;
  stopLoss: number;
  takeProfit1: number | null;
  takeProfit2: number | null;
  totalLots: number;
  marginRequired: number;
  estimatedCycleLoss: number;
  weightedAverageEntry: number;
  totalFundsAtStop: number;
  remainingFundsAtStop: number | null;
  profitToTakeProfit1: number | null;
  profitToTakeProfit2: number | null;
  riskRewardToTakeProfit1: number | null;
  riskRewardToTakeProfit2: number | null;
  ladder: AdaptiveLadderLevel[];
  rejectedLadder: AdaptiveRejectedLadderLevel[];
}

export interface AdaptivePositionPlanResult {
  valid: boolean;
  market: AdaptiveMarket | null;
  rule: AdaptiveRule | null;
  errors: string[];
  assumptions: string[];
  buy: AdaptiveSidePositionPlan | null;
  sell: AdaptiveSidePositionPlan | null;
}

export interface AdaptivePlanRecommendation {
  result: AdaptivePositionPlanResult;
  recommendation: {
    initialLot: number;
    levels: number;
    positions: number;
    marginBudget: number;
    maximumLoss: number;
    usableRiskBudget: number;
    riskUtilizationRate: number;
    contextRiskMultiplier: number;
    unusedRiskBuffer: number;
    riskStyle: AdaptiveRiskStyle;
    lotProfile: AdaptiveLotProfile;
  } | null;
  context: AdaptivePlanContext;
  decision: AdaptivePlanDecision;
  sideEvaluations: { buy: AdaptiveSideEvaluation; sell: AdaptiveSideEvaluation };
  volatilityDiagnostic: AdaptiveVolatilityDiagnostic;
  candleAlternative: AdaptiveCandleAlternative;
}

const MAX_ADDITIONAL_LAYERS = 6;

const ADAPTIVE_LOT_PROFILE_FACTORS: Record<AdaptiveLotProfile, readonly number[]> = {
  decreasing: [0.75, 0.5],
  mixed: [1.25, 0.75],
  increasing: [1.25, 1.5],
};

const ADAPTIVE_RISK_POLICIES: Record<
  AdaptiveRiskStyle,
  { utilizationRate: number; layerRiskWeights: readonly number[] }
> = {
  conservative: { utilizationRate: 0.5, layerRiskWeights: [0.4, 0.35, 0.25] },
  balanced: { utilizationRate: 0.75, layerRiskWeights: [0.5, 0.3, 0.2] },
  aggressive: { utilizationRate: 1, layerRiskWeights: [0.6, 0.25, 0.15] },
};

export function isAdaptiveRiskStyle(value: unknown): value is AdaptiveRiskStyle {
  return value === "conservative" || value === "balanced" || value === "aggressive";
}

export function isAdaptiveLotProfile(value: unknown): value is AdaptiveLotProfile {
  return value === "decreasing" || value === "mixed" || value === "increasing";
}

export function getAdaptiveLayerLotFactors(
  riskStyle: AdaptiveRiskStyle = "conservative",
): readonly number[] {
  return ADAPTIVE_LOT_PROFILE_FACTORS[getAdaptiveLotProfile(riskStyle)];
}

export function getAdaptiveLotProfile(
  riskStyle: AdaptiveRiskStyle = "conservative",
): AdaptiveLotProfile {
  return riskStyle === "conservative"
    ? "decreasing"
    : riskStyle === "balanced"
      ? "mixed"
      : "increasing";
}

function resolveAdaptiveLotProfile(
  riskStyle: AdaptiveRiskStyle,
  context: AdaptivePlanContext,
  preferredSide: AdaptivePlanDecision["preferredSide"],
): AdaptiveLotProfile {
  if (riskStyle === "conservative") return "decreasing";
  if (context.marketCondition === "ranging") return "mixed";

  const trendAligned =
    (preferredSide === "buy" &&
      context.marketCondition === "trending_up" &&
      (context.technical?.buy ?? 0) > (context.technical?.sell ?? 0)) ||
    (preferredSide === "sell" &&
      context.marketCondition === "trending_down" &&
      (context.technical?.sell ?? 0) > (context.technical?.buy ?? 0));
  const strongContext =
    trendAligned &&
    context.riskLevel === "low" &&
    (context.confidenceMin ?? 0) >= 65 &&
    context.fundamental.highImpactCount === 0;

  if (!strongContext) return "decreasing";
  return riskStyle === "aggressive" ? "increasing" : "mixed";
}

const MARKET_GUARDRAILS: Record<AdaptiveMarket, Pick<AdaptiveRule, "label" | "maxGapPercent">> = {
  gold: {
    label: "Gold",
    maxGapPercent: 1,
  },
  brent: {
    label: "Brent Oil",
    maxGapPercent: 2,
  },
  hang_seng: {
    label: "Hang Seng Index",
    maxGapPercent: null,
  },
  nikkei: {
    label: "Nikkei Index",
    maxGapPercent: null,
  },
};

const ACCOUNT_TIER_SPECS: Record<AccountTier, {
  minimumLot: number;
  maximumLot: number | null;
  lotStep: number;
  marginMultiplierFromMini: number;
  minimumOpeningFunds: number | null;
}> = {
  micro: {
    minimumLot: 0.01,
    maximumLot: 0.09,
    lotStep: 0.01,
    marginMultiplierFromMini: 0.1,
    minimumOpeningFunds: 50,
  },
  mini: {
    minimumLot: 0.1,
    maximumLot: 0.9,
    lotStep: 0.1,
    marginMultiplierFromMini: 1,
    minimumOpeningFunds: null,
  },
  regular: {
    minimumLot: 1,
    maximumLot: null,
    lotStep: 1,
    marginMultiplierFromMini: 10,
    minimumOpeningFunds: null,
  },
};

function contractValueForLot(rule: AdaptiveRule, lot: number): number {
  return rule.contractSize * (lot / rule.minimumLot);
}

function standardMarketForInstrument(instrument: string): AdaptiveMarket | null {
  const normalized = instrument.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (normalized.includes("XUL10") || normalized.includes("XAU") || normalized.includes("GOLD")) {
    return "gold";
  }
  if (
    normalized.includes("BCO10BBJ") ||
    normalized.includes("BCO") ||
    normalized.includes("BRENT") ||
    normalized.includes("OIL")
  ) {
    return "brent";
  }
  if (
    normalized.includes("HKK50BBJ") ||
    normalized === "HSI" ||
    normalized.includes("HANGSENG")
  ) {
    return "hang_seng";
  }
  if (
    normalized.includes("JPK50BBJ") ||
    normalized.includes("NIKKEI")
  ) {
    return "nikkei";
  }
  return null;
}

/**
 * Adaptive is intentionally narrower than the Standard Plan. The saved
 * analysis identity must match a canonical product symbol; aliases and broker
 * rule codes must not silently enable it.
 */
export function isXauUsdAdaptiveInstrument(instrument: string): boolean {
  return instrument.trim().toUpperCase() === "XAU/USD";
}

// Keep the original export for callers that still use the old Mini-only name.
export const isXauUsdMiniAdaptiveInstrument = isXauUsdAdaptiveInstrument;

export function isAdaptivePositionInstrument(instrument: string): boolean {
  return instrument === "XAU/USD" ||
    instrument === "BRENT" ||
    instrument === "HSI" ||
    instrument === "NIKKEI";
}

function adaptiveMarketForInstrument(instrument: string): AdaptiveMarket | null {
  const canonical = instrument.trim().toUpperCase();
  if (canonical === "XAU/USD") return "gold";
  if (canonical === "BRENT") return "brent";
  if (canonical === "HSI") return "hang_seng";
  if (canonical === "NIKKEI") return "nikkei";
  return null;
}

function standardCodeForMarket(market: AdaptiveMarket): BrokerContractCode {
  switch (market) {
    case "gold": return "XUL10";
    case "brent": return "BCO10_BBJ";
    case "hang_seng": return "HKK50_BBJ";
    case "nikkei": return "JPK50_BBJ";
  }
}

export function getStandardTradingRuleCode(
  instrument: string,
): StandardTradingRuleInstrument["code"] | null {
  const market = standardMarketForInstrument(instrument);
  return market ? standardCodeForMarket(market) : null;
}

export function getAdaptiveStandardRuleCode(
  instrument: string,
): StandardTradingRuleInstrument["code"] | null {
  const market = adaptiveMarketForInstrument(instrument);
  return market ? standardCodeForMarket(market) : null;
}

function numericValues(value: string | number | null | undefined): number[] {
  if (value == null) return [];
  return String(value)
    .replace(/,/g, "")
    // Level descriptions from Pro commonly include a timeframe, such as
    // "di atas 4680 setelah breakout H1" or "pullback 4H". Those digits are
    // metadata, not part of the price. Without stripping them, an entry
    // zone can be parsed as a range between the price and the timeframe
    // number, producing an incorrect distance and a false "no safe plan".
    .replace(/\b[HMDWhmdw]\d{1,3}\b/g, " ")
    .replace(/\b\d{1,3}[mhdwMHDW]\b/g, " ")
    .match(/-?\d+(?:\.\d+)?/g)
    ?.map(Number)
    .filter(Number.isFinite) ?? [];
}

function ruleFromStandardTradingRules(
  instrument: string,
  standardRule: StandardTradingRuleInstrument | null | undefined,
  accountTier: AccountTier,
): AdaptiveRule | null {
  const market = adaptiveMarketForInstrument(instrument);
  if (!market || !standardRule || standardRule.code !== standardCodeForMarket(market)) return null;

  const minMovement = numericValues(standardRule.minimumPriceMovement)[0];
  const tier = ACCOUNT_TIER_SPECS[accountTier];
  const contract = BROKER_CONTRACT_TIERS[standardCodeForMarket(market)];
  if (standardRule.contractSize !== contract.mini.size ||
      standardRule.contractUnit !== contract.unit) return null;
  const marginAtMinimumLot = standardRule.initialMarginUsdPerLot * tier.marginMultiplierFromMini;
  const marginPerLot = marginAtMinimumLot / tier.minimumLot;
  const tierContract = contract[accountTier];
  const contractSize = tierContract.size;
  if (
    !Number.isFinite(contractSize) ||
    contractSize <= 0 ||
    !Number.isFinite(minMovement) ||
    minMovement <= 0 ||
    !Number.isFinite(marginAtMinimumLot) ||
    marginAtMinimumLot <= 0 ||
    !Number.isFinite(marginPerLot) ||
    marginPerLot <= 0
  ) {
    return null;
  }

  return {
    market,
    label: MARKET_GUARDRAILS[market].label,
    accountTier,
    marginBasis: "day",
    contractSize,
    contractUnit: contract.unit,
    contractSource: tierContract.source,
    minMovement,
    marginPerLot,
    marginAtMinimumLot,
    minimumLot: tier.minimumLot,
    maximumLot: tier.maximumLot,
    lotStep: tier.lotStep,
    minimumOpeningFunds: tier.minimumOpeningFunds,
    maxGapPercent: MARKET_GUARDRAILS[market].maxGapPercent,
    source: "TP Standard Trading Rules",
  };
}

function priceFromTradeSide(side: TradeSide, field: "entryZone" | "stopLoss" | "takeProfit1" | "takeProfit2"): number | null {
  const values = numericValues(side[field]);
  if (values.length === 0) return null;
  if (field === "entryZone" && values.length > 1) {
    return (values[0] + values[1]) / 2;
  }
  return values[0];
}

function entryRangeFromTradeSide(side: TradeSide): { low: number; high: number; midpoint: number } | null {
  const values = numericValues(side.entryZone);
  if (values.length === 0) return null;
  const low = Math.min(values[0], values[1] ?? values[0]);
  const high = Math.max(values[0], values[1] ?? values[0]);
  return { low, high, midpoint: (low + high) / 2 };
}

function roundPrice(value: number, minMovement: number): number {
  const decimals = Math.max(0, (String(minMovement).split(".")[1] ?? "").length);
  return Number((Math.round(value / minMovement) * minMovement).toFixed(decimals));
}

function roundLot(value: number, step = 0.01): number {
  return Number((Math.round(value / step) * step).toFixed(2));
}

function floorLot(value: number, step = 0.01): number {
  return Number((Math.floor((value + Number.EPSILON) / step) * step).toFixed(2));
}

function isLotAligned(value: number, step: number): boolean {
  const scaled = value / step;
  return Math.abs(scaled - Math.round(scaled)) < 1e-9;
}

function normalizeBias(value: string | null | undefined): "bearish" | "bullish" | "neutral" | null {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === "strong_sell" || normalized === "bearish" || normalized === "bearish_strong" || normalized === "sell") return "bearish";
  if (normalized === "strong_buy" || normalized === "bullish" || normalized === "bullish_strong" || normalized === "buy") return "bullish";
  if (normalized === "neutral") return "neutral";
  return null;
}

function normalizeContext(input?: AdaptiveAnalysisContext): AdaptivePlanContext {
  const technicalValues = [input?.techBuyCount, input?.techSellCount, input?.techNeutralCount];
  const hasTechnical = technicalValues.every((value) => value != null && Number.isFinite(value) && value >= 0);
  const fundamentalContext = input?.fundamentalContext;
  const calendarEvents = fundamentalContext?.calendarEvents ?? [];
  const now = Date.now();
  const validUntilDate = input?.validUntil == null ? null : new Date(input.validUntil);
  const upcomingHighImpactCount = calendarEvents.filter((event) => {
    const candidate = event as typeof event & {
      epochMs?: number | null;
      date?: string | null;
      time?: string | null;
    };
    if (candidate.impact !== "★★★") return false;
    const eventTime = Number.isFinite(candidate.epochMs)
      ? candidate.epochMs!
      : typeof candidate.date === "string" && typeof candidate.time === "string"
        ? Date.parse(`${candidate.date}T${candidate.time}:00Z`)
        : Number.NaN;
    return Number.isFinite(eventTime) &&
      eventTime >= now - 2 * 60 * 60 * 1000 &&
      eventTime <= now + 24 * 60 * 60 * 1000;
  }).length;
  return {
    timeframe: input?.timeframe ?? null,
    validUntil: validUntilDate && Number.isFinite(validUntilDate.getTime())
      ? validUntilDate.toISOString()
      : null,
    marketCondition: input?.marketCondition ?? null,
    riskLevel: input?.riskLevel ?? null,
    tradingBias: normalizeBias(input?.tradingBias),
    confidenceMin: input?.confidenceMin ?? null,
    confidenceMax: input?.confidenceMax ?? null,
    technical: hasTechnical
      ? { buy: input!.techBuyCount!, sell: input!.techSellCount!, neutral: input!.techNeutralCount! }
      : null,
    fundamental: {
      available: fundamentalContext != null,
      newsCount: fundamentalContext?.newsItems?.length ?? 0,
      eventCount: calendarEvents.length,
      highImpactCount: upcomingHighImpactCount,
      upcomingHighImpactCount,
    },
  };
}

function hasCompleteContext(context: AdaptivePlanContext): boolean {
  const hasSupportedTimeframe = context.timeframe != null &&
    SUPPORTED_ADAPTIVE_TIMEFRAMES.has(context.timeframe.toLowerCase());
  const hasValidMarketCondition = ["trending_up", "trending_down", "ranging", "volatile"].includes(context.marketCondition ?? "");
  const hasValidRiskLevel = ["low", "medium", "high"].includes(context.riskLevel ?? "");
  const hasValidConfidence = Number.isFinite(context.confidenceMin) &&
    Number.isFinite(context.confidenceMax) &&
    context.confidenceMin! >= 0 &&
    context.confidenceMax! <= 100 &&
    context.confidenceMin! <= context.confidenceMax!;
  const validUntilMs = context.validUntil == null ? Number.NaN : Date.parse(context.validUntil);
  const isFresh = Number.isFinite(validUntilMs) && validUntilMs > Date.now();
  return Boolean(
    hasSupportedTimeframe &&
      hasValidMarketCondition &&
      hasValidRiskLevel &&
      context.tradingBias &&
      hasValidConfidence &&
      context.technical &&
      context.fundamental.available &&
      isFresh,
  );
}

function timeframeIsShort(timeframe: string | null): boolean {
  return timeframe != null && ["1m", "5m", "15m"].includes(timeframe.toLowerCase());
}

const SUPPORTED_ADAPTIVE_TIMEFRAMES = new Set(["1m", "5m", "15m", "30m", "1h", "4h", "1d", "1w"]);

export function getAdaptiveChartCandidatePrices(
  candles: AdaptiveChartCandle[],
  tradePlan: TradePlan,
  minMovement: number,
): { buy: number[]; sell: number[] } {
  const recent = validCandles(candles);
  const candidates: { buy: number[]; sell: number[] } = { buy: [], sell: [] };
  if (recent.length < 5 || !Number.isFinite(minMovement) || minMovement <= 0) return candidates;

  const collect = (side: "buy" | "sell"): number[] => {
    const tradeSide = tradePlan[side];
    const entry = priceFromTradeSide(tradeSide, "entryZone");
    const stop = priceFromTradeSide(tradeSide, "stopLoss");
    if (entry == null || stop == null) return [];
    const distance = Math.abs(entry - stop);
    const minimumSeparation = Math.max(minMovement * 2, distance * 0.025);
    const raw: number[] = [];
    for (let index = 2; index < recent.length - 2; index += 1) {
      const candle = recent[index];
      const neighbors = [
        recent[index - 2],
        recent[index - 1],
        recent[index + 1],
        recent[index + 2],
      ];
      const isSwing = side === "buy"
        ? neighbors.every((neighbor) => candle.low <= neighbor.low)
        : neighbors.every((neighbor) => candle.high >= neighbor.high);
      const price = side === "buy" ? candle.low : candle.high;
      const insideSavedRiskPath = side === "buy"
        ? price > stop && price < entry
        : price < stop && price > entry;
      if (isSwing && insideSavedRiskPath) raw.push(roundPrice(price, minMovement));
    }
    const ordered = [...new Set(raw)].sort((a, b) =>
      side === "buy" ? b - a : a - b,
    );
    return ordered.filter((price, index, accepted) =>
      index === 0 || accepted.slice(0, index).every((other) => Math.abs(other - price) >= minimumSeparation),
    ).slice(0, 6);
  };

  candidates.buy = collect("buy");
  candidates.sell = collect("sell");
  return candidates;
}

function sideGeometryError(side: "buy" | "sell", tradeSide: TradeSide): string | null {
  const entry = priceFromTradeSide(tradeSide, "entryZone");
  const stopLoss = priceFromTradeSide(tradeSide, "stopLoss");
  if (entry == null || stopLoss == null || entry === stopLoss) {
    return `${side === "buy" ? "Buy" : "Sell"} levels are incomplete in the Standard Plan.`;
  }
  if (side === "buy" && stopLoss >= entry) {
    return "Buy stop loss must be below the Standard Plan entry.";
  }
  if (side === "sell" && stopLoss <= entry) {
    return "Sell stop loss must be above the Standard Plan entry.";
  }
  return null;
}

function sidePlan(
  side: "buy" | "sell",
  tradeSide: TradeSide,
  input: AdaptivePositionPlanInput,
  rule: AdaptiveRule,
  levels = input.levels,
): AdaptiveSidePositionPlan | null {
  const entryRange = entryRangeFromTradeSide(tradeSide);
  const rawEntry = entryRange?.midpoint ?? null;
  const rawStopLoss = priceFromTradeSide(tradeSide, "stopLoss");
  if (rawEntry == null || rawStopLoss == null || rawEntry === rawStopLoss || input.initialLot == null) return null;
  const entry = roundPrice(rawEntry, rule.minMovement);
  const stopLoss = roundPrice(rawStopLoss, rule.minMovement);
  const takeProfit1Value = priceFromTradeSide(tradeSide, "takeProfit1");
  const takeProfit2Value = priceFromTradeSide(tradeSide, "takeProfit2");
  const takeProfit1 = takeProfit1Value == null ? null : roundPrice(takeProfit1Value, rule.minMovement);
  const takeProfit2 = takeProfit2Value == null ? null : roundPrice(takeProfit2Value, rule.minMovement);

  const distance = side === "buy" ? entry - stopLoss : stopLoss - entry;
  const ladder: AdaptiveLadderLevel[] = [];
  const lotStep = rule.lotStep;
  const initialLot = roundLot(input.initialLot, lotStep);
  const profitForLot = (price: number, target: number | null, lot: number): number | null => {
    if (target == null) return null;
    const move = side === "buy" ? target - price : price - target;
    return move > 0 ? move * contractValueForLot(rule, lot) : null;
  };
  const checkpointProgress: Array<{ progress: number; basis: AdaptiveLayerBasis }> = [];
  const minimumSeparation = Math.max(rule.minMovement * 2, distance * 0.025);
  const priceAtProgress = (progress: number) =>
    roundPrice(side === "buy" ? entry - distance * progress : entry + distance * progress, rule.minMovement);
  const adverseEdge = entryRange == null
    ? entry
    : roundPrice(side === "buy" ? entryRange.low : entryRange.high, rule.minMovement);
  const edgeProgress = Math.abs(entry - adverseEdge) / distance;
  if (
    adverseEdge !== entry &&
    adverseEdge !== stopLoss &&
    edgeProgress > 0 &&
    edgeProgress < 1 &&
    Math.abs(entry - adverseEdge) >= minimumSeparation
  ) {
    checkpointProgress.push({ progress: edgeProgress, basis: "entry_zone_edge" });
  }
  for (const price of input.checkpointPrices?.[side] ?? []) {
    const roundedPrice = roundPrice(price, rule.minMovement);
    const progress = (side === "buy" ? entry - roundedPrice : roundedPrice - entry) / distance;
    if (!Number.isFinite(progress) || progress <= 0 || progress >= 1 ||
        Math.abs(entry - roundedPrice) < minimumSeparation) continue;
    if (checkpointProgress.some((candidate) =>
      Math.abs(priceAtProgress(candidate.progress) - roundedPrice) < minimumSeparation,
    )) continue;
    checkpointProgress.push({ progress, basis: "current_chart_swing" });
  }
  checkpointProgress.sort((a, b) => a.progress - b.progress);

  const plannedEntries = [
    { price: entry, lot: initialLot, basis: "analysis_entry" as const, invalidationProgress: 0 },
    ...checkpointProgress.slice(0, levels).map(({ progress, basis }, index) => {
      const requestedFactor = input.layerLotFactors?.[index] ?? 1;
      const requestedLot = initialLot * Math.max(0, requestedFactor);
      const cappedLot = rule.maximumLot == null
        ? requestedLot
        : Math.min(requestedLot, rule.maximumLot);
      return {
        price: priceAtProgress(progress),
        lot: Math.max(rule.minimumLot, floorLot(cappedLot, lotStep)),
        basis,
        invalidationProgress: progress,
      };
    }),
  ];

  if (input.layerRiskWeights?.length && input.maximumLoss != null) {
    const weights = input.layerRiskWeights.slice(0, plannedEntries.length);
    const normalizedWeights = plannedEntries.map((_, index) =>
      Math.max(0, weights[index] ?? 1),
    );
    const totalWeight = normalizedWeights.reduce((sum, weight) => sum + weight, 0);
    if (totalWeight > 0) {
      for (const [index, planned] of plannedEntries.entries()) {
        const riskPerLot =
          (side === "buy" ? planned.price - stopLoss : stopLoss - planned.price) *
          rule.contractSize / rule.minimumLot;
        const allocatedRisk = input.maximumLoss * (normalizedWeights[index] / totalWeight);
        const requestedLot = riskPerLot > 0 ? allocatedRisk / riskPerLot : 0;
        const cappedLot = rule.maximumLot == null
          ? requestedLot
          : Math.min(requestedLot, rule.maximumLot);
        planned.lot = Math.max(rule.minimumLot, floorLot(cappedLot, lotStep));
      }
    }
  }

  let cumulativeLots = 0;
  let cumulativeRisk = 0;
  let cumulativeDayMargin = 0;
  let cumulativeProfitToTakeProfit1: number | null = takeProfit1 == null ? null : 0;
  let cumulativeProfitToTakeProfit2: number | null = takeProfit2 == null ? null : 0;
  let weightedEntryTotal = 0;
  for (const [level, planned] of plannedEntries.entries()) {
    cumulativeLots = roundLot(cumulativeLots + planned.lot, lotStep);
    const riskToStopForLot =
      (side === "buy" ? planned.price - stopLoss : stopLoss - planned.price) *
      contractValueForLot(rule, planned.lot);
    const dayMarginForLot = planned.lot * rule.marginPerLot;
    const profitToTakeProfit1 = profitForLot(planned.price, takeProfit1, planned.lot);
    const profitToTakeProfit2 = profitForLot(planned.price, takeProfit2, planned.lot);
    cumulativeRisk += riskToStopForLot;
    cumulativeDayMargin += dayMarginForLot;
    const cumulativeFundsAtStop = cumulativeDayMargin + cumulativeRisk;
    const remainingFundsAtStop =
      input.availableFunds == null ? null : input.availableFunds - cumulativeFundsAtStop;
    weightedEntryTotal += planned.price * planned.lot;
    cumulativeProfitToTakeProfit1 =
      cumulativeProfitToTakeProfit1 == null || profitToTakeProfit1 == null
        ? null
        : cumulativeProfitToTakeProfit1 + profitToTakeProfit1;
    cumulativeProfitToTakeProfit2 =
      cumulativeProfitToTakeProfit2 == null || profitToTakeProfit2 == null
        ? null
        : cumulativeProfitToTakeProfit2 + profitToTakeProfit2;
    ladder.push({
      level,
      price: planned.price,
      lot: planned.lot,
      cumulativeLots,
      estimatedRiskToStop: cumulativeRisk,
      distanceFromEntry: Math.abs(entry - planned.price),
      riskToStopForLot,
      dayMarginForLot,
      cumulativeDayMargin,
      cumulativeFundsAtStop,
      remainingFundsAtStop,
      profitToTakeProfit1,
      profitToTakeProfit2,
      cumulativeProfitToTakeProfit1,
      cumulativeProfitToTakeProfit2,
      basis: planned.basis,
      invalidationProgress: planned.invalidationProgress,
      reason: planned.basis === "analysis_entry"
        ? "Initial entry from the saved Standard Plan."
        : planned.basis === "entry_zone_edge"
          ? "Conditional checkpoint at the adverse edge of the saved analysis entry zone."
          : `Conditional current-chart swing inside the saved analysis entry-to-stop path (${Math.round(planned.invalidationProgress * 100)}% toward the final stop).`,
    });
  }

  const weightedAverageEntry = weightedEntryTotal / cumulativeLots;
  const profitToTakeProfit1 = ladder.at(-1)?.cumulativeProfitToTakeProfit1 ?? null;
  const profitToTakeProfit2 = ladder.at(-1)?.cumulativeProfitToTakeProfit2 ?? null;

  return {
    side,
    entry,
    stopLoss,
    takeProfit1,
    takeProfit2,
    totalLots: cumulativeLots,
    marginRequired: cumulativeLots * rule.marginPerLot,
    estimatedCycleLoss: cumulativeRisk,
    weightedAverageEntry: roundPrice(weightedAverageEntry, rule.minMovement),
    totalFundsAtStop: cumulativeDayMargin + cumulativeRisk,
    remainingFundsAtStop:
      input.availableFunds == null
        ? null
        : input.availableFunds - (cumulativeDayMargin + cumulativeRisk),
    profitToTakeProfit1,
    profitToTakeProfit2,
    riskRewardToTakeProfit1:
      profitToTakeProfit1 == null || cumulativeRisk <= 0 ? null : profitToTakeProfit1 / cumulativeRisk,
    riskRewardToTakeProfit2:
      profitToTakeProfit2 == null || cumulativeRisk <= 0 ? null : profitToTakeProfit2 / cumulativeRisk,
    ladder,
    rejectedLadder: [],
  };
}

export function getAdaptiveMarketRule(
  instrument: string,
  standardRule: StandardTradingRuleInstrument | null | undefined,
  accountTier: AccountTier = "mini",
): AdaptiveRule | null {
  return ruleFromStandardTradingRules(instrument, standardRule, accountTier);
}

export function getAdaptiveMarginCapacity(
  availableMargin: number | null,
  rule: AdaptiveRule | null,
): number {
  if (availableMargin == null || availableMargin <= 0 || !rule) return 0;
  const affordable = availableMargin / rule.marginPerLot;
  const capped = rule.maximumLot == null
    ? affordable
    : Math.min(affordable, rule.maximumLot);
  const units = Math.floor((capped + Number.EPSILON) / rule.lotStep);
  const lot = roundLot(units * rule.lotStep, rule.lotStep);
  return lot >= rule.minimumLot ? lot : 0;
}

/**
 * A saved browser recommendation is only valid for the exact saved analysis
 * snapshot and source-rule inputs that produced it. This includes the full
 * fundamental snapshot, which changes after a fundamental refresh.
 */
export function createAdaptivePlanFingerprint({
  instrument,
  tradePlan,
  context,
  standardRule,
  checkpointPrices,
  candles,
  accountTier = "mini",
  riskStyle = "conservative",
}: {
  instrument: string;
  tradePlan: TradePlan;
  context: AdaptiveAnalysisContext;
  standardRule: StandardTradingRuleInstrument | null | undefined;
  checkpointPrices?: { buy?: number[]; sell?: number[] };
  candles?: AdaptiveChartCandle[];
  accountTier?: AccountTier;
  riskStyle?: AdaptiveRiskStyle;
}): string {
  return JSON.stringify({
    instrument,
    tradePlan,
    context: {
      timeframe: context.timeframe ?? null,
      validUntil: context.validUntil instanceof Date
        ? context.validUntil.toISOString()
        : context.validUntil ?? null,
      marketCondition: context.marketCondition ?? null,
      riskLevel: context.riskLevel ?? null,
      tradingBias: context.tradingBias ?? null,
      confidenceMin: context.confidenceMin ?? null,
      confidenceMax: context.confidenceMax ?? null,
      techBuyCount: context.techBuyCount ?? null,
      techSellCount: context.techSellCount ?? null,
      techNeutralCount: context.techNeutralCount ?? null,
      fundamentalContext: context.fundamentalContext ?? null,
    },
    standardRule: standardRule
      ? {
          code: standardRule.code,
          contractSize: standardRule.contractSize,
          initialMarginUsdPerLot: standardRule.initialMarginUsdPerLot,
          minimumPriceMovement: standardRule.minimumPriceMovement,
        }
      : null,
    checkpointPrices: checkpointPrices ?? null,
    candles: candles ?? null,
    accountTier,
    riskStyle,
  });
}

export function buildAdaptivePositionPlan(input: AdaptivePositionPlanInput): AdaptivePositionPlanResult {
  const market = adaptiveMarketForInstrument(input.instrument);
  const rule = ruleFromStandardTradingRules(input.instrument, input.standardRule, input.accountTier);
  const errors: string[] = [];
  const includeBuy = input.includedSides?.buy ?? true;
  const includeSell = input.includedSides?.sell ?? true;

  if (!market) errors.push("Adaptive position planning is available only for supported canonical instruments.");
  if (!rule) errors.push("TP Standard Trading Rules are unavailable for this instrument.");
  if (!includeBuy && !includeSell) errors.push("At least one trade-plan side must be included.");
  if (input.availableFunds == null || input.availableFunds <= 0) errors.push("Available trading funds are required.");
  if (input.maximumLoss == null || input.maximumLoss <= 0) errors.push("Maximum acceptable loss is required.");
  if (
    input.availableFunds != null &&
    input.maximumLoss != null &&
    input.maximumLoss > input.availableFunds
  ) {
    errors.push("Maximum acceptable loss cannot exceed available trading funds.");
  }
  if (input.existingExposure == null || input.existingExposure < 0) errors.push("Existing exposure is required.");
  if (input.initialLot == null || input.initialLot <= 0) errors.push("Initial lot is required.");
  if (!Number.isInteger(input.levels) || input.levels < 0 || input.levels > MAX_ADDITIONAL_LAYERS) {
    errors.push(`Number of additional levels must be between 0 and ${MAX_ADDITIONAL_LAYERS}.`);
  }
  for (const [side, sideLevel] of Object.entries(input.sideLevels ?? {})) {
    if (
      sideLevel !== undefined &&
      (!Number.isInteger(sideLevel) || sideLevel < 0 || sideLevel > MAX_ADDITIONAL_LAYERS || sideLevel > input.levels)
    ) {
      errors.push(`${side === "buy" ? "Buy" : "Sell"} additional levels must be an integer between 0 and the requested level count (maximum ${MAX_ADDITIONAL_LAYERS}).`);
    }
  }

  const minimumLot = rule?.minimumLot ?? ACCOUNT_TIER_SPECS[input.accountTier].minimumLot;
  const maximumLot = rule?.maximumLot ?? ACCOUNT_TIER_SPECS[input.accountTier].maximumLot;
  const lotStep = rule?.lotStep ?? ACCOUNT_TIER_SPECS[input.accountTier].lotStep;
  if (input.initialLot != null && (input.initialLot < minimumLot || (maximumLot != null && input.initialLot > maximumLot))) {
    errors.push(`Initial lot must be within the ${input.accountTier} tier range.`);
  }
  if (input.initialLot != null && input.initialLot > 0 && !isLotAligned(input.initialLot, lotStep)) {
    errors.push(`Initial lot must use ${lotStep.toFixed(2)} lot increments for the ${input.accountTier} tier.`);
  }

  if (!rule) {
    return { valid: false, market, rule: null, errors, assumptions: [], buy: null, sell: null };
  }

  const maxCycleLoss = input.maximumLoss ?? 0;
  const buyGeometryError = includeBuy ? sideGeometryError("buy", input.tradePlan.buy) : null;
  const sellGeometryError = includeSell ? sideGeometryError("sell", input.tradePlan.sell) : null;
  if (buyGeometryError) errors.push(buyGeometryError);
  if (sellGeometryError) errors.push(sellGeometryError);
  const buy = !includeBuy || buyGeometryError ? null : sidePlan("buy", input.tradePlan.buy, input, rule, input.sideLevels?.buy);
  const sell = !includeSell || sellGeometryError ? null : sidePlan("sell", input.tradePlan.sell, input, rule, input.sideLevels?.sell);

  const tierMax = rule.maximumLot;
  const plans = [buy, sell].filter((plan): plan is AdaptiveSidePositionPlan => plan != null);
  for (const plan of plans) {
    if (tierMax != null && plan.ladder.some((level) => level.lot > tierMax)) {
      errors.push(`${plan.side === "buy" ? "Buy" : "Sell"} has a position above the ${input.accountTier} per-position limit.`);
    }
    if (plan.marginRequired > (input.availableFunds ?? 0)) {
      errors.push(`${plan.side === "buy" ? "Buy" : "Sell"} margin exceeds available trading funds.`);
    }
    if (plan.estimatedCycleLoss > maxCycleLoss) {
      errors.push(`${plan.side === "buy" ? "Buy" : "Sell"} loss at the final Stop Loss exceeds the entered maximum loss.`);
    }
    if (plan.totalFundsAtStop > (input.availableFunds ?? 0)) {
      errors.push(`${plan.side === "buy" ? "Buy" : "Sell"} day margin plus loss at the final Stop Loss exceeds available trading funds.`);
    }
    if (plan.ladder.some((level) => level.price === plan.stopLoss)) {
      errors.push(`${plan.side === "buy" ? "Buy" : "Sell"} ladder overlaps the Standard Plan stop loss.`);
    }
  }

  const tierText = tierMax == null ? `${rule.minimumLot.toFixed(2)} lot and above` : `${rule.minimumLot.toFixed(2)}–${tierMax.toFixed(2)} lot`;
  const movementAssumption = rule.maxGapPercent == null
    ? `Minimum movement from ${rule.source}: ${rule.minMovement}; no percentage gap limit is assumed because the source rule does not provide one.`
    : `Minimum movement from ${rule.source}: ${rule.minMovement}; a gap above ${rule.maxGapPercent}% is treated as an external execution risk.`;
  const assumptions = [
    `${input.accountTier[0].toUpperCase()}${input.accountTier.slice(1)} profile: USD ${rule.marginAtMinimumLot} margin for ${rule.minimumLot.toFixed(2)} lot; contract value ${rule.contractSize} ${rule.contractUnit} for one minimum-size position (${rule.minimumLot.toFixed(2)} lot). ${rule.contractSource === "micro_assumption" ? "Micro contract value is an assumption of 1/10 Mini, not an official broker rule." : "Contract value comes from the broker tier table; the API rule supplies Mini only."}`,
    movementAssumption,
    `Initial entry uses the Standard Plan; up to ${MAX_ADDITIONAL_LAYERS} manual additions are limited to distinct saved entry-zone or chart-swing prices. The ${tierText} range applies separately to each position, not to cumulative planned lots.`,
    `The entered USD ${maxCycleLoss} maximum loss is a hard amount for every position in the complete plan.`,
    "Available trading funds are used directly; the recommendation may reserve part of the entered loss ceiling according to risk style and market context.",
    `Current open ${input.instrument} ${input.accountTier} exposure is ${input.existingExposure ?? 0} lot. It is not subtracted from the ${tierMax ?? "unlimited"}-lot per-position cap; entered free funds must already exclude margin committed elsewhere.`,
    "This Adaptive Position Plan is for day trading only: it uses the day/initial margin and excludes overnight holding, rollover, and overnight fees from every calculation.",
    "Broker auto-liquidation, spread, facility fee, VAT, slippage, and rejected orders are external risks and are not used to move ladder levels.",
  ];

  return {
    valid: errors.length === 0,
    market,
    rule,
    errors,
    assumptions,
    buy,
    sell,
  };
}

function addRejectedCandidates(
  accepted: AdaptivePositionPlanResult,
  candidate: AdaptivePositionPlanResult,
  marginBudget: number,
  maximumLoss: number,
  analysisLevelLimit: number,
): AdaptivePositionPlanResult {
  const decorate = (
    acceptedSide: AdaptiveSidePositionPlan | null,
    candidateSide: AdaptiveSidePositionPlan | null,
  ): AdaptiveSidePositionPlan | null => {
    if (!acceptedSide || !candidateSide) return acceptedSide;
    const rejectedLadder = candidateSide.ladder
      .slice(acceptedSide.ladder.length)
      .map((level): AdaptiveRejectedLadderLevel => {
        const rejectReason =
          level.level > analysisLevelLimit
            ? "analysis_limit"
            : candidate.rule?.maximumLot != null && level.lot > candidate.rule.maximumLot
              ? "tier_limit"
              : level.cumulativeFundsAtStop > marginBudget
                ? "day_margin"
                : level.estimatedRiskToStop > maximumLoss
                  ? "loss_ceiling"
                  : "analysis_limit";
        return {
          ...level,
          rejectReason,
          financialAlternative:
            rejectReason === "day_margin" || rejectReason === "loss_ceiling"
              ? {
                  additionalFundsRequired: Math.max(0, level.cumulativeFundsAtStop - marginBudget),
                  additionalLossBudgetRequired: Math.max(0, level.estimatedRiskToStop - maximumLoss),
                }
              : null,
        };
      });
    return { ...acceptedSide, rejectedLadder };
  };

  return {
    ...accepted,
    buy: decorate(accepted.buy, candidate.buy),
    sell: decorate(accepted.sell, candidate.sell),
  };
}

function validCandles(candles: AdaptiveChartCandle[] | undefined): AdaptiveChartCandle[] {
  return (candles ?? []).filter((candle) =>
    Number.isFinite(candle.high) &&
    Number.isFinite(candle.low) &&
    candle.low > 0 &&
    candle.high >= candle.low &&
    (candle.open == null || (
      Number.isFinite(candle.open) && candle.open >= candle.low && candle.open <= candle.high
    )) &&
    (candle.close == null || (
      Number.isFinite(candle.close) && candle.close >= candle.low && candle.close <= candle.high
    )) &&
    (candle.date == null || Number.isFinite(Date.parse(candle.date))),
  ).slice(-160);
}

function getVolatilityDiagnostic(
  candles: AdaptiveChartCandle[] | undefined,
  timeframe: string | null,
  tradePlan: TradePlan,
): AdaptiveVolatilityDiagnostic {
  const normalizedTimeframe = timeframe?.toLowerCase() ?? null;
  const recent = validCandles(candles);
  if (
    !normalizedTimeframe ||
    !SUPPORTED_ADAPTIVE_TIMEFRAMES.has(normalizedTimeframe) ||
    recent.length < 5
  ) {
    return {
      status: "unavailable",
      timeframe: normalizedTimeframe,
      candleCount: recent.length,
      observedRange: null,
      buyStopDistance: null,
      sellStopDistance: null,
      buyStopLooksTight: null,
      sellStopLooksTight: null,
    };
  }
  // A multi-month or multi-week high-to-low span is not one candle's noise
  // envelope. Compare the saved stop to the typical bar at THIS timeframe.
  const ranges = recent.map(({ high, low }) => high - low).sort((a, b) => a - b);
  const middle = Math.floor(ranges.length / 2);
  const observedRange = ranges.length % 2
    ? ranges[middle]
    : (ranges[middle - 1] + ranges[middle]) / 2;
  const stopDistance = (side: "buy" | "sell"): number | null => {
    const entry = priceFromTradeSide(tradePlan[side], "entryZone");
    const stop = priceFromTradeSide(tradePlan[side], "stopLoss");
    if (entry == null || stop == null || entry <= 0 || stop <= 0) return null;
    return Math.abs(entry - stop);
  };
  const buyStopDistance = stopDistance("buy");
  const sellStopDistance = stopDistance("sell");
  const buyStopLooksTight = buyStopDistance == null ? null : buyStopDistance < observedRange;
  const sellStopLooksTight = sellStopDistance == null ? null : sellStopDistance < observedRange;
  return {
    status: buyStopLooksTight || sellStopLooksTight ? "tight_stop" : "observed",
    timeframe: normalizedTimeframe,
    candleCount: recent.length,
    observedRange,
    buyStopDistance,
    sellStopDistance,
    buyStopLooksTight,
    sellStopLooksTight,
  };
}

function getCandleAlternative(
  candles: AdaptiveChartCandle[] | undefined,
  timeframe: string | null,
  side: "buy" | "sell" | "both" | "none",
  tradePlan: TradePlan,
  rule: AdaptiveRule,
  availableFunds: number,
  usableRiskBudget: number,
): AdaptiveCandleAlternative {
  const normalizedTimeframe = timeframe?.toLowerCase() ?? null;
  const recent = validCandles(candles);
  if (
    !normalizedTimeframe ||
    !SUPPORTED_ADAPTIVE_TIMEFRAMES.has(normalizedTimeframe) ||
    recent.length < 7 ||
    side === "none" ||
    side === "both"
  ) {
    return {
      status: "needs_reanalysis",
      reason: "A single supported direction and at least seven valid candles at the saved analysis timeframe are required to derive independent swing-based entry, stop, and target levels.",
    };
  }
  const swings = { lows: [] as number[], highs: [] as number[] };
  for (let index = 2; index < recent.length - 2; index += 1) {
    const candle = recent[index];
    const neighbors = [recent[index - 2], recent[index - 1], recent[index + 1], recent[index + 2]];
    if (neighbors.every((neighbor) => candle.low <= neighbor.low)) swings.lows.push(candle.low);
    if (neighbors.every((neighbor) => candle.high >= neighbor.high)) swings.highs.push(candle.high);
  }
  const rawEntry = priceFromTradeSide(tradePlan[side], "entryZone");
  if (rawEntry == null || rawEntry <= 0) {
    return { status: "needs_reanalysis", reason: "The saved entry is incomplete." };
  }
  const savedStop = priceFromTradeSide(tradePlan[side], "stopLoss");
  if (savedStop == null) return { status: "needs_reanalysis", reason: "The saved stop is incomplete." };
  const savedRange = entryRangeFromTradeSide(tradePlan[side]);
  const tolerance = Math.max(rule.minMovement * 2, Math.abs(rawEntry - savedStop) * 0.25);
  const entryCandidates = (side === "buy" ? swings.lows : swings.highs)
    .filter((price) => savedRange
      ? price >= savedRange.low && price <= savedRange.high
      : Math.abs(price - rawEntry) <= tolerance)
    .sort((a, b) => Math.abs(a - rawEntry) - Math.abs(b - rawEntry));
  for (const rawEntryCandidate of entryCandidates) {
    const entry = roundPrice(rawEntryCandidate, rule.minMovement);
    const stopCandidates = side === "buy"
      ? swings.lows.filter((price) => price < entry - rule.minMovement * 2).sort((a, b) => b - a)
      : swings.highs.filter((price) => price > entry + rule.minMovement * 2).sort((a, b) => a - b);
    const targetCandidates = side === "buy"
      ? swings.highs.filter((price) => price > entry + rule.minMovement * 2).sort((a, b) => a - b)
      : swings.lows.filter((price) => price < entry - rule.minMovement * 2).sort((a, b) => b - a);
    for (const rawStop of stopCandidates) {
      for (const rawTarget of targetCandidates) {
      const stopLoss = roundPrice(rawStop, rule.minMovement);
      const takeProfit = roundPrice(rawTarget, rule.minMovement);
      const riskDistance = Math.abs(entry - stopLoss);
      const targetDistance = Math.abs(takeProfit - entry);
      const riskReward = riskDistance > 0 ? targetDistance / riskDistance : 0;
      if (riskReward < 1) continue;
      const lot = rule.minimumLot;
      const estimatedLoss = riskDistance * contractValueForLot(rule, lot);
      const dayMargin = lot * rule.marginPerLot;
      if (estimatedLoss > usableRiskBudget || estimatedLoss + dayMargin > availableFunds) {
        continue;
      }
      return {
        status: "available",
        side,
        entry,
        stopLoss,
        takeProfit,
        riskReward,
        lot,
        estimatedLoss,
        dayMargin,
      };
      }
    }
  }
  return {
    status: "needs_reanalysis",
    reason: "The candles do not provide independent swing entry, stop and target levels with at least 1:1 reward-to-risk that fit the current funds and loss ceiling.",
  };
}

function availableLayerCount(
  side: "buy" | "sell",
  tradeSide: TradeSide,
  checkpointPrices: { buy?: number[]; sell?: number[] } | undefined,
  minMovement: number,
): number {
  const range = entryRangeFromTradeSide(tradeSide);
  const stop = priceFromTradeSide(tradeSide, "stopLoss");
  if (!range || stop == null || !Number.isFinite(minMovement) || minMovement <= 0) return 0;
  const entry = roundPrice(range.midpoint, minMovement);
  const roundedStop = roundPrice(stop, minMovement);
  const distance = side === "buy" ? entry - roundedStop : roundedStop - entry;
  if (distance <= 0) return 0;
  const prices = new Set<number>();
  const minimumSeparation = Math.max(minMovement * 2, distance * 0.025);
  const adverseEdge = roundPrice(side === "buy" ? range.low : range.high, minMovement);
  const edgeProgress = (side === "buy" ? entry - adverseEdge : adverseEdge - entry) / distance;
  if (
    adverseEdge !== entry &&
    adverseEdge !== roundedStop &&
    edgeProgress > 0 &&
    edgeProgress < 1 &&
    Math.abs(entry - adverseEdge) >= minimumSeparation
  ) {
    prices.add(adverseEdge);
  }
  for (const price of checkpointPrices?.[side] ?? []) {
    if (!Number.isFinite(price)) continue;
    const rounded = roundPrice(price, minMovement);
    const progress = (side === "buy" ? entry - rounded : rounded - entry) / distance;
    if (
      progress > 0 &&
      progress < 1 &&
      Math.abs(entry - rounded) >= minimumSeparation &&
      [...prices].every((other) => Math.abs(other - rounded) >= minimumSeparation)
    ) prices.add(rounded);
  }
  return Math.min(MAX_ADDITIONAL_LAYERS, prices.size);
}

/**
 * Builds a practical position-size recommendation from the user's available
 * margin and the entry/stop levels already produced by the AI analysis.
 * The user enters a hard USD loss ceiling. Risk style determines how much of
 * that ceiling may be used and how the usable risk is allocated across the
 * complete layer plan.
 */
export function buildAdaptivePlanRecommendation({
  instrument,
  tradePlan,
  availableMargin,
  maximumLoss,
  existingExposure,
  standardRule,
  context: analysisContext,
  checkpointPrices,
  candles,
  accountTier = "mini",
  riskStyle = "conservative",
}: {
  instrument: string;
  tradePlan: TradePlan;
  availableMargin: number | null;
  maximumLoss: number | null;
  existingExposure: number | null;
  standardRule: StandardTradingRuleInstrument | null;
  context?: AdaptiveAnalysisContext;
  checkpointPrices?: { buy?: number[]; sell?: number[] };
  candles?: AdaptiveChartCandle[];
  accountTier?: AccountTier;
  riskStyle?: AdaptiveRiskStyle;
}): AdaptivePlanRecommendation {
  const market = adaptiveMarketForInstrument(instrument);
  const rule = ruleFromStandardTradingRules(instrument, standardRule, accountTier);
  const context = normalizeContext(analysisContext);
  const volatilityDiagnostic = getVolatilityDiagnostic(candles, context.timeframe, tradePlan);
  const buildCandleAlternative = (preferred: AdaptivePlanDecision["preferredSide"], usableRiskBudget: number) =>
    rule ? getCandleAlternative(
      candles,
      context.timeframe,
      preferred,
      tradePlan,
      rule!,
      availableMargin ?? 0,
      usableRiskBudget,
    ) : { status: "needs_reanalysis" as const, reason: "Instrument rule is unavailable." };
  const reasonCodes: AdaptivePlanReasonCode[] = [];
  const unavailableSides = {
    buy: { status: "unavailable" as const, diagnostic: null, conditionalPlan: null },
    sell: { status: "unavailable" as const, diagnostic: null, conditionalPlan: null },
  };
  let posture: AdaptivePlanPosture = "scaling_allowed";
  let preferredSide: AdaptivePlanDecision["preferredSide"] = "both";
  if (
    availableMargin == null ||
    availableMargin <= 0 ||
    maximumLoss == null ||
    maximumLoss <= 0 ||
    existingExposure == null ||
    existingExposure < 0
  ) {
    const errors = [];
    if (availableMargin == null || availableMargin <= 0) errors.push("Available trading funds are required.");
    if (maximumLoss == null || maximumLoss <= 0) errors.push("Maximum acceptable loss is required.");
    if (existingExposure == null || existingExposure < 0) errors.push("Existing exposure is required.");
    return {
      result: {
        valid: false,
        market,
        rule,
        errors,
        assumptions: [],
        buy: null,
        sell: null,
      },
      recommendation: null,
      context,
      decision: { posture: "entry_only", preferredSide: "none", reasonCodes: ["context_unavailable"] },
      sideEvaluations: unavailableSides,
      volatilityDiagnostic,
      candleAlternative: { status: "needs_reanalysis", reason: "Account inputs are incomplete." },
    };
  }
  if (!rule) {
    return {
      result: {
        valid: false,
        market,
        rule: null,
        errors: ["TP Standard Trading Rules are unavailable for this instrument."],
        assumptions: [],
        buy: null,
        sell: null,
      },
      recommendation: null,
      context,
      decision: { posture: "entry_only", preferredSide: "none", reasonCodes: ["context_unavailable"] },
      sideEvaluations: unavailableSides,
      volatilityDiagnostic,
      candleAlternative: { status: "needs_reanalysis", reason: "Instrument rule is unavailable." },
    };
  }
  if (maximumLoss > availableMargin) {
    return {
      result: {
        valid: false,
        market,
        rule,
        errors: ["Maximum acceptable loss cannot exceed available trading funds."],
        assumptions: [],
        buy: null,
        sell: null,
      },
      recommendation: null,
      context,
      decision: { posture: "entry_only", preferredSide: "none", reasonCodes: ["context_unavailable"] },
      sideEvaluations: unavailableSides,
      volatilityDiagnostic,
      candleAlternative: { status: "needs_reanalysis", reason: "Maximum loss exceeds available trading funds." },
    };
  }
  if (context.validUntil == null || Date.parse(context.validUntil) <= Date.now()) {
    return {
      result: {
        valid: false,
        market,
        rule,
        errors: ["Saved analysis is expired or has no validUntil timestamp; reanalysis is required."],
        assumptions: [],
        buy: null,
        sell: null,
      },
      recommendation: null,
      context,
      decision: { posture: "not_recommended", preferredSide: "none", reasonCodes: ["context_unavailable"] },
      sideEvaluations: unavailableSides,
      volatilityDiagnostic,
      candleAlternative: { status: "needs_reanalysis", reason: "The saved analysis is expired or lacks validUntil." },
    };
  }

  const requestedLevels = Math.max(
    availableLayerCount("buy", tradePlan.buy, checkpointPrices, rule?.minMovement ?? 0),
    availableLayerCount("sell", tradePlan.sell, checkpointPrices, rule?.minMovement ?? 0),
  );
  let levels = requestedLevels;

  if (!hasCompleteContext(context)) {
    posture = "entry_only";
    levels = 0;
    preferredSide = "none";
    reasonCodes.push("context_unavailable");
    if (!context.technical) reasonCodes.push("technical_unavailable");
    if (!context.fundamental.available) reasonCodes.push("fundamental_unavailable");
  } else {
    if (timeframeIsShort(context.timeframe)) {
      reasonCodes.push("short_timeframe");
    }
    if (context.riskLevel === "high") {
      reasonCodes.push("high_risk");
    }
    if (context.marketCondition === "volatile") {
      reasonCodes.push("volatile_market");
    }
    if (context.confidenceMax != null && context.confidenceMax < 70) {
      reasonCodes.push("low_confidence");
    }

    const marketDirection = context.marketCondition === "trending_up"
      ? "buy"
      : context.marketCondition === "trending_down"
        ? "sell"
        : null;
    const biasDirection = context.tradingBias === "bullish"
      ? "buy"
      : context.tradingBias === "bearish"
        ? "sell"
        : null;
    let hasDirectionalConflict = Boolean(marketDirection && biasDirection && marketDirection !== biasDirection);

    if (context.tradingBias === "neutral") {
      preferredSide = "none";
      posture = "entry_only";
      levels = 0;
      reasonCodes.push("neutral_bias");
    } else if (biasDirection === "buy") {
      preferredSide = "buy";
      reasonCodes.push("trend_favors_buy", "trend_opposes_sell");
    } else if (biasDirection === "sell") {
      preferredSide = "sell";
      reasonCodes.push("trend_favors_sell", "trend_opposes_buy");
    }

    if (context.marketCondition === "ranging") reasonCodes.push("range_supports_scaling");

    if (context.technical && context.tradingBias === "neutral") {
      const { buy, sell } = context.technical;
      if (buy > sell) reasonCodes.push("technical_supports_buy");
      else if (sell > buy) reasonCodes.push("technical_supports_sell");
      else reasonCodes.push("technical_mixed");
    } else if (context.technical && !hasDirectionalConflict) {
      const { buy, sell } = context.technical;
      const totalDirectional = buy + sell;
      const imbalance = totalDirectional > 0 ? Math.abs(buy - sell) / totalDirectional : 0;
      if (totalDirectional === 0 || imbalance < 0.2) {
        reasonCodes.push("technical_mixed");
      } else if (buy > sell) {
        reasonCodes.push("technical_supports_buy");
        if (preferredSide === "sell") {
          hasDirectionalConflict = true;
        } else {
          preferredSide = "buy";
        }
      } else {
        reasonCodes.push("technical_supports_sell");
        if (preferredSide === "buy") {
          hasDirectionalConflict = true;
        } else {
          preferredSide = "sell";
        }
      }
    }
    if (hasDirectionalConflict) {
      levels = 0;
      posture = "not_recommended";
      preferredSide = "none";
      reasonCodes.push("directional_conflict");
    }

    if (context.fundamental.highImpactCount > 0) {
      reasonCodes.push("fundamental_high_impact");
    } else if (context.fundamental.newsCount + context.fundamental.eventCount > 0) {
      reasonCodes.push("fundamental_present");
    } else {
      reasonCodes.push("fundamental_clear");
    }
  }

  if (posture !== "not_recommended" && posture !== "entry_only") {
    if (preferredSide === "buy") {
      levels = availableLayerCount("buy", tradePlan.buy, checkpointPrices, rule.minMovement);
    } else if (preferredSide === "sell") {
      levels = availableLayerCount("sell", tradePlan.sell, checkpointPrices, rule.minMovement);
    } else if (preferredSide === "both") {
      levels = Math.max(
        availableLayerCount("buy", tradePlan.buy, checkpointPrices, rule.minMovement),
        availableLayerCount("sell", tradePlan.sell, checkpointPrices, rule.minMovement),
      );
    } else {
      levels = 0;
    }
  }
  if (levels > 0) reasonCodes.push("staged_add_condition");
  const lotProfile = resolveAdaptiveLotProfile(riskStyle, context, preferredSide);
  const layerLotFactors = ADAPTIVE_LOT_PROFILE_FACTORS[lotProfile];
  const riskPolicy = ADAPTIVE_RISK_POLICIES[riskStyle];
  const contextRiskMultiplier =
    reasonCodes.includes("high_risk") || reasonCodes.includes("fundamental_high_impact")
      ? 0.5
      : reasonCodes.some((code) =>
          ["short_timeframe", "volatile_market", "low_confidence", "technical_mixed"].includes(code),
        )
        ? 0.75
        : 1;
  const riskUtilizationRate = riskPolicy.utilizationRate * contextRiskMultiplier;
  const usableRiskBudget = maximumLoss * riskUtilizationRate;

  const marginBudget = availableMargin;
  type Side = "buy" | "sell";
  type SideResult = { result: AdaptivePositionPlanResult; levels: number; lotProfile: AdaptiveLotProfile } | null;
  const sideNames: Side[] = ["buy", "sell"];
  const sideEvaluations: AdaptivePlanRecommendation["sideEvaluations"] = {
    buy: { status: "unavailable", diagnostic: null, conditionalPlan: null },
    sell: { status: "unavailable", diagnostic: null, conditionalPlan: null },
  };
  const sideResults: Record<Side, SideResult> = { buy: null, sell: null };
  const sideIsAligned = (side: Side) => preferredSide === side;
  const buildSideInput = (side: Side, candidateLevels: number, budget: number) => ({
    instrument,
    tradePlan,
    standardRule,
    availableFunds: marginBudget,
    maximumLoss: budget,
    existingExposure,
    initialLot: rule.minimumLot,
    accountTier,
    levels: candidateLevels,
    sideLevels: side === "buy"
      ? { buy: candidateLevels, sell: 0 }
      : { buy: 0, sell: candidateLevels },
    includedSides: side === "buy"
      ? { buy: true, sell: false }
      : { buy: false, sell: true },
    layerLotFactors: layerLotFactors.slice(0, candidateLevels),
    layerRiskWeights: riskPolicy.layerRiskWeights.slice(0, candidateLevels + 1),
    checkpointPrices,
  });

  for (const side of sideNames) {
    const geometryError = sideGeometryError(side, tradePlan[side]);
    if (geometryError) {
      sideEvaluations[side] = { status: "unavailable", diagnostic: null, conditionalPlan: null };
      continue;
    }

    const minimumPlan = buildAdaptivePositionPlan({
      ...buildSideInput(side, 0, usableRiskBudget),
      layerLotFactors: [],
      layerRiskWeights: [],
    });
    const minimumSidePlan = minimumPlan[side];
    if (
      !minimumSidePlan ||
      !Number.isFinite(minimumSidePlan.marginRequired) ||
      minimumSidePlan.marginRequired <= 0 ||
      !Number.isFinite(minimumSidePlan.estimatedCycleLoss) ||
      minimumSidePlan.estimatedCycleLoss <= 0 ||
      !Number.isFinite(minimumSidePlan.totalFundsAtStop)
    ) {
      sideEvaluations[side] = { status: "unavailable", diagnostic: null, conditionalPlan: null };
      continue;
    }
    const minMargin = minimumSidePlan.marginRequired;
    const minRisk = minimumSidePlan.estimatedCycleLoss;
    const marginShortfall = Math.max(0, minimumSidePlan.totalFundsAtStop - marginBudget);
    const riskShortfall = Math.max(0, minRisk - usableRiskBudget);
    const hasAnalysisBlock = posture === "not_recommended" ||
      reasonCodes.some((code) => ["context_unavailable", "short_timeframe", "high_risk", "volatile_market", "low_confidence", "neutral_bias", "fundamental_high_impact", "directional_conflict"].includes(code));
    const directionBlock = !sideIsAligned(side) || posture === "not_recommended" || reasonCodes.includes("directional_conflict");
    const blocker = directionBlock
      ? "direction" as const
      : hasAnalysisBlock
        ? "analysis" as const
      : marginShortfall > 0 && riskShortfall > 0
        ? "margin_and_risk" as const
        : marginShortfall > 0
          ? "margin" as const
          : "risk" as const;
    sideEvaluations[side] = {
      status: "blocked",
      conditionalPlan: null,
      diagnostic: {
        lot: rule.minimumLot,
        marginRequired: minMargin,
        riskAtStop: minRisk,
        fundsRequiredAtStop: minimumSidePlan.totalFundsAtStop,
        effectiveLossBudget: usableRiskBudget,
        marginShortfall,
        riskShortfall,
        maximumLossShortfall: Math.max(0, minRisk / riskUtilizationRate - maximumLoss),
        blocker,
        nextAction: directionBlock
          ? "wait"
          : hasAnalysisBlock
            ? "reanalysis"
          : marginShortfall > 0 && riskShortfall > 0
            ? "funds_and_loss_budget"
            : marginShortfall > 0
              ? "funds"
              : "loss_budget",
      },
    };

    if (!sideIsAligned(side)) {
      let conditionalPlan: AdaptiveSidePositionPlan | null = null;
      if (posture !== "not_recommended") {
        const requestedLevels = availableLayerCount(side, tradePlan[side], checkpointPrices, rule.minMovement);
        const candidates = posture === "entry_only"
          ? [0]
          : Array.from({ length: requestedLevels + 1 }, (_, index) => requestedLevels - index);
        for (const candidateLevels of candidates) {
          let accepted: AdaptivePositionPlanResult | null = null;
          for (let scalePercent = 100; scalePercent >= 1; scalePercent -= 1) {
            const candidate = buildAdaptivePositionPlan(buildSideInput(
              side,
              candidateLevels,
              usableRiskBudget * (scalePercent / 100),
            ));
            if (candidate.valid) {
              accepted = candidate;
              break;
            }
          }
          if (!accepted) continue;
          const fullCandidate = candidateLevels < requestedLevels
            ? buildAdaptivePositionPlan(buildSideInput(side, requestedLevels, usableRiskBudget))
            : accepted;
          const withRejected = addRejectedCandidates(accepted, fullCandidate, marginBudget, usableRiskBudget, requestedLevels);
          conditionalPlan = withRejected[side];
          break;
        }
      }
      sideEvaluations[side] = {
        ...sideEvaluations[side],
        status: "not_aligned",
        conditionalPlan,
      };
      continue;
    }
    if (!minimumPlan.valid || posture === "not_recommended") continue;
    const sideRequestedLevels = availableLayerCount(side, tradePlan[side], checkpointPrices, rule.minMovement);
    const candidates = posture === "entry_only"
      ? [0]
      : Array.from({ length: sideRequestedLevels + 1 }, (_, index) => sideRequestedLevels - index);
    for (const candidateLevels of candidates) {
      let accepted: AdaptivePositionPlanResult | null = null;
      for (let scalePercent = 100; scalePercent >= 1; scalePercent -= 1) {
        const candidate = buildAdaptivePositionPlan(buildSideInput(
          side,
          candidateLevels,
          usableRiskBudget * (scalePercent / 100),
        ));
        if (candidate.valid) {
          accepted = candidate;
          break;
        }
      }
      if (!accepted) continue;
      const fullCandidate = candidateLevels < sideRequestedLevels
        ? buildAdaptivePositionPlan(buildSideInput(side, sideRequestedLevels, usableRiskBudget))
        : accepted;
      const withRejected = addRejectedCandidates(accepted, fullCandidate, marginBudget, usableRiskBudget, sideRequestedLevels);
      sideResults[side] = {
        result: withRejected,
        levels: (withRejected[side]?.ladder.length ?? 1) - 1,
        lotProfile: resolveAdaptiveLotProfile(riskStyle, context, side),
      };
      sideEvaluations[side] = { status: "viable", diagnostic: null, conditionalPlan: null };
      break;
    }
  }

  const selectedSide = preferredSide === "buy" || preferredSide === "sell"
    ? (sideResults[preferredSide] ? preferredSide : null)
    : null;
  if (!selectedSide || posture === "not_recommended") {
    const sideWord = (side: Side) => side === "buy" ? "Buy" : "Sell";
    const errors = sideNames
      .filter((side) => sideIsAligned(side) && sideEvaluations[side].status === "blocked")
      .map((side) => `${sideWord(side)} minimum lot exceeds the effective margin and/or Stop Loss risk budget.`);
    if (!errors.length) errors.push(
      posture === "not_recommended"
        ? "The technical snapshot conflicts with the market direction."
        : "No directionally supported side has a safe minimum-lot plan.",
    );
    return {
      result: {
        valid: false,
        market,
        rule,
        errors,
        assumptions: [],
        buy: null,
        sell: null,
      },
      recommendation: null,
      context,
      decision: { posture: posture === "scaling_allowed" ? "not_recommended" : posture, preferredSide, reasonCodes },
      sideEvaluations,
      volatilityDiagnostic,
      candleAlternative: buildCandleAlternative("none", usableRiskBudget),
    };
  }

  const selected = sideResults[selectedSide]!;
  const acceptedLevels = selected.levels;
  const effectivePosture = acceptedLevels === 0 && posture === "scaling_allowed" ? "entry_only" : posture;
  const effectiveReasonCodes = acceptedLevels === 0
    ? reasonCodes.filter((code) => code !== "staged_add_condition")
    : reasonCodes;
  const result: AdaptivePositionPlanResult = {
    ...selected.result,
    valid: true,
    errors: [],
    buy: sideResults.buy?.result.buy ?? null,
    sell: sideResults.sell?.result.sell ?? null,
  };
  return {
    result,
    recommendation: {
      initialLot: selected.result[selectedSide]?.ladder[0]?.lot ?? rule.minimumLot,
      levels: acceptedLevels,
      positions: acceptedLevels + 1,
      marginBudget,
      maximumLoss,
      usableRiskBudget,
      riskUtilizationRate,
      contextRiskMultiplier,
      unusedRiskBuffer: maximumLoss - usableRiskBudget,
      riskStyle,
      lotProfile: selected.lotProfile,
    },
    context,
    decision: {
      posture: effectivePosture,
      preferredSide: selectedSide,
      reasonCodes: effectiveReasonCodes,
    },
    sideEvaluations,
    volatilityDiagnostic,
    candleAlternative: buildCandleAlternative(selectedSide, usableRiskBudget),
  };
}