import { createHash, randomBytes } from "node:crypto";
import {
  and,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  lt,
  lte,
  ne,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import {
  tradePilotAnalyses,
  tradePilotCreditBalances,
  tradePilotIdempotency,
  tradePilotPerformanceSnapshots,
  tradePilotPriceAlerts,
  tradePilotTradingPlans,
  tradePilotUsers,
  type TradePilotAnalysis,
  type TradePilotPriceAlert,
  type TradePilotTradingPlan,
} from "@workspace/db/schema";
import { BROKER_CONTRACT_TIERS, type BrokerContractCode } from "@workspace/instrument-taxonomy";
import { db } from "./db";
import {
  generateAnalysis,
  parseLevelPrice,
  PRO_PROMPT_VERSION,
  setOpenAIOutcomeObserver,
  type AIOutput,
  type AnalysisTokenUsage,
  type FundamentalSnapshot,
} from "./openai";
import {
  formatIndicatorsForPrompt,
  getCandleSnapshot,
  getIndicators,
  type IndicatorTimeframe,
} from "./historical";
import { getLivePriceFor } from "./live-prices";
import { getRelevantNews, formatNewsForPrompt, type NewsItem } from "./news";
import { getRelevantCalendar, formatCalendarForPrompt, type CalendarEvent } from "./calendar";
import { estimateCostUsd } from "./model-pricing";
import { STANDARD_TRADING_RULES } from "./standard-trading-rules";
import {
  buildAdaptivePlanRecommendation,
  getAdaptiveChartCandidatePrices,
  getAdaptiveMarketRule,
  type AdaptiveChartCandle,
  type AdaptiveRiskStyle,
  type TradePlan,
} from "./adaptive-position-plan";
import { logger } from "./logger";
import {
  currentAvailabilitySettings,
  currentQuotaSettings,
  refreshTradePilotSettingsIfStale,
} from "./trade-pilot-settings";
import {
  buildMarketContext,
  TRADE_PILOT_DISCLAIMER,
  type TradePilotLanguage,
} from "../locales/trade-pilot";
import {
  cleanupOperationalEvents,
  recordOperationalEvent,
  recordOperationalHealth,
} from "./trade-pilot-observability";

setOpenAIOutcomeObserver(({ success, ...details }) =>
  recordOperationalEvent("openai", success, details),
);

export const TP_MODES = ["demo", "real"] as const;
export const TP_INSTRUMENTS = ["gold", "brent", "hang-seng", "nikkei"] as const;
export const TP_TIMEFRAMES = ["1", "5", "15", "30", "60", "240", "D", "W", "M"] as const;
export const TP_STATUSES = ["still_valid", "take_profit_1", "take_profit_2", "stop_loss", "expired", "invalid"] as const;
export const TP_LEVELS = ["entry", "stopLoss", "takeProfitOne", "takeProfitTwo"] as const;
export const TP_ALERT_CHANNELS = ["push", "email", "whatsapp"] as const;
export const TP_ACCOUNT_TYPES = ["micro", "mini", "regular"] as const;

export type TradePilotMode = typeof TP_MODES[number];
export type TradePilotInstrumentId = typeof TP_INSTRUMENTS[number];
export type TradePilotTimeframe = typeof TP_TIMEFRAMES[number];
export type TradePilotStatus = typeof TP_STATUSES[number];
export type TradePilotSide = "buy" | "sell";
export type LevelName = typeof TP_LEVELS[number];
type Levels = Record<LevelName, string>;
type AllowedModes = ReadonlySet<string> | null;

export type IndicatorItem = {
  key: string;
  label: string;
  group: "oscillator" | "moving_average";
  value: string;
  status: "buy" | "sell" | "neutral";
  marker: number;
};

export type TradePilotErrorCodeFromService =
  | "insufficient_credit"
  | "idempotency_conflict"
  | "upstream_unavailable"
  | "not_found"
  | "invalid_request"
  | "access_denied";

export class TradePilotServiceError extends Error {
  constructor(
    public readonly code: TradePilotErrorCodeFromService,
    public readonly status: number,
  ) {
    super(code);
  }
}

type InstrumentDef = {
  label: string;
  engine: string;
  contractCode: BrokerContractCode;
  quoteSymbols: string[];
  tradingViewSymbol: string;
};

const INSTRUMENTS: Record<TradePilotInstrumentId, InstrumentDef> = {
  gold: { label: "XAU/USD", engine: "XAU/USD", contractCode: "XUL10", quoteSymbols: ["XUL10"], tradingViewSymbol: "OANDA:XAUUSD" },
  brent: { label: "BCO", engine: "BRENT", contractCode: "BCO10_BBJ", quoteSymbols: ["BCO10_BBJ"], tradingViewSymbol: "BLACKBULL:BRENT" },
  "hang-seng": { label: "HKK", engine: "HSI", contractCode: "HKK50_BBJ", quoteSymbols: ["HKK50_BBJ"], tradingViewSymbol: "VANTAGE:HK50" },
  nikkei: { label: "JPK", engine: "NIKKEI", contractCode: "JPK50_BBJ", quoteSymbols: ["JPK50_BBJ"], tradingViewSymbol: "SPREADEX:NIKKEI" },
};

type TimeframeDef = { label: string; engine: IndicatorTimeframe; durationMs: number; candleMs: number };
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const TIMEFRAMES: Record<TradePilotTimeframe, TimeframeDef> = {
  "1": { label: "1m", engine: "1m", durationMs: 4 * MINUTE, candleMs: MINUTE },
  "5": { label: "5m", engine: "5m", durationMs: 20 * MINUTE, candleMs: 5 * MINUTE },
  "15": { label: "15m", engine: "15m", durationMs: HOUR, candleMs: 15 * MINUTE },
  "30": { label: "30m", engine: "30m", durationMs: 2 * HOUR, candleMs: 30 * MINUTE },
  "60": { label: "1h", engine: "1h", durationMs: 4 * HOUR, candleMs: HOUR },
  "240": { label: "4h", engine: "4h", durationMs: 16 * HOUR, candleMs: 4 * HOUR },
  D: { label: "1D", engine: "1D", durationMs: 4 * DAY, candleMs: DAY },
  W: { label: "1W", engine: "1W", durationMs: 28 * DAY, candleMs: 7 * DAY },
  // The market-data engine has no monthly candles yet; monthly analyses use
  // weekly context but keep a four-month validity window.
  M: { label: "1M", engine: "1W", durationMs: 120 * DAY, candleMs: 7 * DAY },
};

// Lot size per account type, mirroring the client-area ACCOUNT_VALUES constant.
const ACCOUNT_LOTS: Record<typeof TP_ACCOUNT_TYPES[number], string> = { micro: "0.01", mini: "0.10", regular: "1.00" };

// ---------------------------------------------------------------------------
// Configuration helpers
// ---------------------------------------------------------------------------

// Kuota standar: pengaturan super_admin (tp_settings) bila ada, selain itu env.
function allowance(mode: TradePilotMode): number {
  return currentQuotaSettings()[mode].allowance;
}

type Period = "daily" | "weekly" | "monthly";

/** Kebijakan kuota aktif per mode (untuk dashboard admin). */
export function tradePilotCreditPolicy(mode: TradePilotMode): { allowance: number; period: Period } {
  return { allowance: allowance(mode), period: configuredPeriod(mode) };
}
function configuredPeriod(mode: TradePilotMode): Period {
  return currentQuotaSettings()[mode].period;
}

const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

/** Tanggal kalender WIB dari sebuah instant. */
function wibDate(ms: number): { year: number; month: number; day: number } {
  const shifted = new Date(ms + WIB_OFFSET_MS);
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth(), day: shifted.getUTCDate() };
}

/** Instant (ms UTC) untuk 00:00 WIB pada tanggal tsb; tanggal di-clamp ke akhir bulan. */
function wibMidnightOf(year: number, month: number, day: number): number {
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return Date.UTC(year, month, Math.min(day, lastDay)) - WIB_OFFSET_MS;
}

/**
 * Jendela periode kredit yang berjangkar pada tanggal pertama kali nasabah
 * memakai TradePilot (00:00 WIB hari itu):
 * - monthly: tanggal yang sama tiap bulan (tgl 31 -> akhir bulan bila tidak ada),
 * - weekly:  tiap 7 hari sejak tanggal pertama pakai,
 * - daily:   tiap hari pukul 00:00 WIB.
 */
export function creditPeriodWindow(period: Period, anchor: Date, now = new Date()): { start: Date; end: Date } {
  const today = wibDate(now.getTime());
  const todayStart = wibMidnightOf(today.year, today.month, today.day);
  if (period === "daily") return { start: new Date(todayStart), end: new Date(todayStart + DAY) };

  const first = wibDate(Math.min(anchor.getTime(), now.getTime()));
  const anchorStart = wibMidnightOf(first.year, first.month, first.day);
  if (period === "weekly") {
    const weeks = Math.floor((todayStart - anchorStart) / (7 * DAY));
    const start = anchorStart + Math.max(0, weeks) * 7 * DAY;
    return { start: new Date(start), end: new Date(start + 7 * DAY) };
  }

  const monthStart = (offset: number) => wibMidnightOf(first.year, first.month + offset, first.day);
  let offset = Math.max(0, (today.year - first.year) * 12 + (today.month - first.month));
  while (offset > 0 && monthStart(offset) > now.getTime()) offset -= 1;
  while (monthStart(offset + 1) <= now.getTime()) offset += 1;
  return { start: new Date(monthStart(offset)), end: new Date(monthStart(offset + 1)) };
}

function periodWindow(mode: TradePilotMode, anchor: Date, now = new Date()): { start: Date; end: Date } {
  return creditPeriodWindow(configuredPeriod(mode), anchor, now);
}

function newId(prefix: "a" | "al" | "tp"): string {
  return `${prefix}_${Date.now().toString(36)}${randomBytes(6).toString("hex")}`;
}

function numberString(value: unknown): string | null {
  const parsed = typeof value === "number" ? value : parseLevelPrice(String(value ?? ""));
  return parsed !== null && Number.isFinite(parsed) && parsed > 0
    ? parsed.toFixed(2)
    : null;
}

function decimal2(value: string | number | null | undefined): string {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toFixed(2) : "0.00";
}

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      () => { clearTimeout(timer); resolve(fallback); },
    );
  });
}

function assertMode(allowed: AllowedModes, mode: string): void {
  if (allowed && !allowed.has(mode)) throw new TradePilotServiceError("access_denied", 403);
}

// ---------------------------------------------------------------------------
// Users & credits (auto-provisioning)
// ---------------------------------------------------------------------------

/** Atomic, idempotent upsert of the opaque user. Parallel calls create one row. */
export async function provisionTradePilotUser(userId: string, mode: TradePilotMode): Promise<void> {
  await db.insert(tradePilotUsers).values({ userId, firstSeenMode: mode }).onConflictDoNothing();
}

/** Marks the first /bootstrap; returns true exactly once per user. */
async function claimFirstBootstrap(userId: string): Promise<boolean> {
  const rows = await db.update(tradePilotUsers)
    .set({ bootstrappedAt: new Date() })
    .where(and(eq(tradePilotUsers.userId, userId), isNull(tradePilotUsers.bootstrappedAt)))
    .returning({ userId: tradePilotUsers.userId });
  return rows.length > 0;
}

async function ensureCredit(userId: string, mode: TradePilotMode) {
  await refreshTradePilotSettingsIfStale();
  await provisionTradePilotUser(userId, mode);
  const now = new Date();
  // Jangkar periode = pertama kali nasabah memakai TradePilot (tp_user.created_at).
  const [user] = await db.select({ createdAt: tradePilotUsers.createdAt }).from(tradePilotUsers)
    .where(eq(tradePilotUsers.userId, userId)).limit(1);
  const window = periodWindow(mode, user?.createdAt ?? now, now);
  await db.insert(tradePilotCreditBalances).values({
    userId, mode, allowance: allowance(mode), consumed: 0,
    periodStart: window.start, resetsAt: window.end,
  }).onConflictDoNothing();
  await db.update(tradePilotCreditBalances).set({
    allowance: allowance(mode), consumed: 0, periodStart: window.start,
    resetsAt: window.end, updatedAt: now,
  }).where(and(
    eq(tradePilotCreditBalances.userId, userId),
    eq(tradePilotCreditBalances.mode, mode),
    lte(tradePilotCreditBalances.resetsAt, now),
  ));
  // Selaraskan saldo periode berjalan yang masih memakai jadwal lama (kalender,
  // atau periode yang baru diubah admin) tanpa menghapus pemakaian kredit.
  await db.update(tradePilotCreditBalances).set({
    periodStart: window.start, resetsAt: window.end, updatedAt: now,
  }).where(and(
    eq(tradePilotCreditBalances.userId, userId),
    eq(tradePilotCreditBalances.mode, mode),
    gt(tradePilotCreditBalances.resetsAt, now),
    ne(tradePilotCreditBalances.resetsAt, window.end),
  ));
  const [row] = await db.select().from(tradePilotCreditBalances).where(and(
    eq(tradePilotCreditBalances.userId, userId), eq(tradePilotCreditBalances.mode, mode),
  )).limit(1);
  return row!;
}

function creditView(mode: TradePilotMode, row: { allowance: number; consumed: number; resetsAt: Date }) {
  return {
    mode,
    allowance: row.allowance,
    consumed: row.consumed,
    remaining: Math.max(0, row.allowance - row.consumed),
    resetsAt: row.resetsAt.toISOString(),
    source: "api" as const,
  };
}

export async function getTradePilotCredit(userId: string, mode: TradePilotMode) {
  return creditView(mode, await ensureCredit(userId, mode));
}

export type TradePilotCreditAdjustment = { type: "reset" } | { type: "set"; remaining: number };

/**
 * Penyesuaian kredit oleh super_admin untuk PERIODE BERJALAN saja.
 * - reset: kuota kembali penuh sesuai kebijakan (allowance standar, consumed 0).
 * - set:   sisa kredit = `remaining` (allowance = consumed + remaining).
 * Saat periode berganti, ensureCredit() mengembalikan kuota ke kebijakan standar.
 * Memakai advisory lock yang sama dengan POST /analyses agar tidak balapan
 * dengan pemotongan kredit.
 */
type CreditAdjustmentResult = {
  before: ReturnType<typeof creditView>;
  after: ReturnType<typeof creditView>;
};

export async function adjustTradePilotCredit(
  userId: string,
  mode: TradePilotMode,
  adjustment: TradePilotCreditAdjustment,
  /**
   * Dijalankan di transaksi yang sama (mis. insert audit). Bila melempar error,
   * perubahan kredit ikut dibatalkan — kredit tidak pernah berubah tanpa audit.
   */
  onAdjusted?: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0], result: CreditAdjustmentResult) => Promise<void>,
): Promise<CreditAdjustmentResult> {
  await ensureCredit(userId, mode);
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${userId}:${mode}`}))`);
    const [row] = await tx.select().from(tradePilotCreditBalances).where(and(
      eq(tradePilotCreditBalances.userId, userId), eq(tradePilotCreditBalances.mode, mode),
    )).limit(1);
    if (!row) throw new TradePilotServiceError("not_found", 404);
    const next = adjustment.type === "reset"
      ? { allowance: allowance(mode), consumed: 0 }
      : { allowance: row.consumed + adjustment.remaining, consumed: row.consumed };
    const [updated] = await tx.update(tradePilotCreditBalances)
      .set({ ...next, updatedAt: new Date() })
      .where(and(eq(tradePilotCreditBalances.userId, userId), eq(tradePilotCreditBalances.mode, mode)))
      .returning();
    const result = {
      before: creditView(mode, row),
      after: creditView(mode, updated!),
    };
    if (onAdjusted) await onAdjusted(tx, result);
    return result;
  });
}

// ---------------------------------------------------------------------------
// Market data
// ---------------------------------------------------------------------------

function signal(value: string): "buy" | "sell" | "neutral" {
  const normalized = value.toLowerCase();
  return normalized === "buy" ? "buy" : normalized === "sell" ? "sell" : "neutral";
}

function markerFor(value: number, status: "buy" | "sell" | "neutral", min = 0, max = 100): number {
  if (Number.isFinite(value) && max > min) return Math.max(0, Math.min(100, Math.round(((value - min) / (max - min)) * 100)));
  return status === "buy" ? 25 : status === "sell" ? 75 : 50;
}

export async function loadTradePilotIndicators(
  instrumentId: TradePilotInstrumentId,
  timeframe: TradePilotTimeframe,
): Promise<{ calculatedAt: string; items: IndicatorItem[]; prompt: string; price: number }> {
  const instrument = INSTRUMENTS[instrumentId];
  const tf = TIMEFRAMES[timeframe];
  const indicators = await getIndicators(instrument.engine, tf.engine);
  if (!indicators) throw new TradePilotServiceError("upstream_unavailable", 503);
  const items: IndicatorItem[] = [];
  const push = (item: IndicatorItem) => items.push(item);
  const rsiStatus = signal(indicators.rsi14.signal);
  push({ key: "rsi_14", label: "RSI (14)", group: "oscillator", value: indicators.rsi14.value.toFixed(2), status: rsiStatus, marker: markerFor(indicators.rsi14.value, rsiStatus) });
  const macdStatus = signal(indicators.macd.action);
  push({ key: "macd_12_26", label: "MACD (12,26)", group: "oscillator", value: indicators.macd.macd.toFixed(4), status: macdStatus, marker: markerFor(Number.NaN, macdStatus) });
  const stochStatus = signal(indicators.stochastic.signal);
  push({ key: "stoch_k", label: "Stochastic %K", group: "oscillator", value: indicators.stochastic.k.toFixed(2), status: stochStatus, marker: markerFor(indicators.stochastic.k, stochStatus) });
  const bollingerStatus = signal(indicators.bollinger.signal);
  push({ key: "bollinger", label: "Bollinger", group: "oscillator", value: `${indicators.bollinger.lower.toFixed(2)}–${indicators.bollinger.upper.toFixed(2)}`, status: bollingerStatus, marker: markerFor(indicators.lastClose, bollingerStatus, indicators.bollinger.lower, indicators.bollinger.upper) });
  for (const ma of indicators.movingAverages) {
    const status = signal(ma.signal);
    push({ key: `${ma.type.toLowerCase()}_${ma.period}`, label: `${ma.type} (${ma.period})`, group: "moving_average", value: ma.value.toFixed(2), status, marker: markerFor(Number.NaN, status) });
  }
  return {
    calculatedAt: new Date().toISOString(),
    items,
    prompt: formatIndicatorsForPrompt(indicators, tf.engine),
    price: indicators.lastClose,
  };
}

/** Public indicator shape from the requirement (`group: oscillator | movingAverage`). */
export function publicIndicator(item: { group: string; label: string; value: string; status: string; marker: number }) {
  return {
    group: item.group === "oscillator" ? "oscillator" as const : "movingAverage" as const,
    label: item.label,
    value: item.value,
    status: item.status as "buy" | "sell" | "neutral",
    marker: item.marker,
  };
}

export async function loadTradePilotCandles(
  instrumentId: TradePilotInstrumentId,
  timeframe: TradePilotTimeframe,
) {
  const instrument = INSTRUMENTS[instrumentId];
  const tf = TIMEFRAMES[timeframe];
  const snapshot = await getCandleSnapshot(instrument.engine, tf.engine);
  if (!snapshot) {
    await recordOperationalHealth(`candle:${instrumentId}:${timeframe}`, false, {
      instrumentId,
      timeframe,
      staleReason: "feed_unavailable",
    });
    throw new TradePilotServiceError("upstream_unavailable", 503);
  }
  await recordOperationalHealth(`candle:${instrumentId}:${timeframe}`, !snapshot.isStale, {
    instrumentId,
    timeframe,
    sourceFetchedAt: snapshot.sourceFetchedAt,
    sourceMaxAgeMs: snapshot.sourceMaxAgeMs,
    isStale: snapshot.isStale,
    staleReason: snapshot.staleReason,
  });

  return {
    instrumentId,
    instrumentLabel: instrument.label,
    timeframe,
    timeframeLabel: tf.label,
    candleTimeframe: tf.engine,
    sourceFetchedAt: snapshot.sourceFetchedAt,
    sourceMaxAgeMs: snapshot.sourceMaxAgeMs,
    isStale: snapshot.isStale,
    staleReason: snapshot.staleReason,
    candles: snapshot.candles.length > 300
      ? snapshot.candles.slice(-300)
      : snapshot.candles,
  };
}

// ---------------------------------------------------------------------------
// Analysis generation (with cross-user AI result cache)
// ---------------------------------------------------------------------------

function mapLevels(output: AIOutput): { buy: Levels; sell: Levels } {
  const plan = output.tradePlan;
  if (!plan) throw new TradePilotServiceError("upstream_unavailable", 503);
  const convert = (side: typeof plan.buy): Levels => {
    const entry = numberString(side.entryZone);
    const stopLoss = numberString(side.stopLoss);
    const takeProfitOne = numberString(side.takeProfit1);
    const takeProfitTwo = numberString(side.takeProfit2);
    if (!entry || !stopLoss || !takeProfitOne || !takeProfitTwo) {
      throw new TradePilotServiceError("upstream_unavailable", 503);
    }
    return { entry, stopLoss, takeProfitOne, takeProfitTwo };
  };
  return { buy: convert(plan.buy), sell: convert(plan.sell) };
}

type GeneratedAnalysis = {
  output: AIOutput;
  model: string;
  usage: AnalysisTokenUsage;
  generatedAt: Date;
  aiInput: Record<string, unknown>;
  indicatorItems: IndicatorItem[];
  price: number;
  candleCount: number;
  candleAsOf: Date;
};

type CacheEntry = { expiresAt: number; value: Promise<GeneratedAnalysis> };
const aiResultCache = new Map<string, CacheEntry>();

function aiCacheEnabled(): boolean {
  return (process.env["TRADE_PILOT_AI_CACHE"] ?? "on").toLowerCase() !== "off";
}

/** Test helper. */
export function _clearTradePilotAiCache(): void {
  aiResultCache.clear();
}

function candleTime(value: unknown): Date | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

async function generateFresh(
  instrumentId: TradePilotInstrumentId,
  timeframe: TradePilotTimeframe,
  mode: TradePilotMode,
  snapshot: { candleCount: number; candleAsOf: Date },
): Promise<GeneratedAnalysis> {
  const instrument = INSTRUMENTS[instrumentId];
  const tf = TIMEFRAMES[timeframe];
  const isFastIntraday = timeframe === "1" || timeframe === "5";
  const [indicatorData, livePrice, news, calendar] = await Promise.all([
    loadTradePilotIndicators(instrumentId, timeframe),
    withTimeout(getLivePriceFor(instrument.engine), 1_500, null),
    isFastIntraday ? Promise.resolve([] as NewsItem[]) : withTimeout(getRelevantNews(instrument.engine), 3_000, [] as NewsItem[]),
    isFastIntraday ? Promise.resolve([] as CalendarEvent[]) : withTimeout(getRelevantCalendar(instrument.engine), 3_000, [] as CalendarEvent[]),
  ]);
  const contextParts = [indicatorData.prompt];
  if (news.length) contextParts.push(formatNewsForPrompt(news, instrument.engine));
  if (calendar.length) contextParts.push(formatCalendarForPrompt(calendar, instrument.engine));
  const indicatorContext = contextParts.join("\n");
  const fundamentalSnapshot: FundamentalSnapshot = { newsItems: news, calendarEvents: calendar };
  const anchor = livePrice ?? indicatorData.price;

  let generated: Awaited<ReturnType<typeof generateAnalysis>>;
  try {
    generated = await generateAnalysis(
      instrument.engine,
      tf.engine,
      "pro",
      undefined,
      indicatorContext,
      fundamentalSnapshot,
      anchor,
      indicatorData.price,
      mode === "real" ? "paid" : "free",
    );
  } catch (error) {
    logger.error({ err: error, instrumentId, timeframe }, "Trade Pilot analysis generation failed");
    throw new TradePilotServiceError("upstream_unavailable", 503);
  }
  return {
    output: generated.output,
    model: generated.model,
    usage: generated.usage,
    generatedAt: new Date(),
    aiInput: {
      instrument: instrument.engine,
      timeframe: tf.engine,
      livePrice,
      selectedTimeframePrice: indicatorData.price,
      indicatorContext,
      newsTitles: news.map((item) => item.title),
      calendarEvents: calendar.map((event) => event.event),
      calendarEventDates: calendar.map((event) => ({ event: event.event, date: event.date })),
      candleCount: snapshot.candleCount,
      candleAsOf: snapshot.candleAsOf.toISOString(),
    },
    indicatorItems: indicatorData.items,
    price: anchor,
    candleCount: snapshot.candleCount,
    candleAsOf: snapshot.candleAsOf,
  };
}

/**
 * Returns an AI analysis for instrument + timeframe + latest candle. Results
 * are shared across users for the lifetime of one candle (capped at 1 hour)
 * to save AI cost; credit is still charged per user by the caller.
 */
async function getOrGenerate(
  instrumentId: TradePilotInstrumentId,
  timeframe: TradePilotTimeframe,
  mode: TradePilotMode,
): Promise<{ generated: GeneratedAnalysis; cacheHit: boolean }> {
  const tf = TIMEFRAMES[timeframe];
  const instrument = INSTRUMENTS[instrumentId];
  const snapshot = await withTimeout(getCandleSnapshot(instrument.engine, tf.engine), 5_500, null);
  const lastCandle = snapshot?.candles.at(-1);
  const asOf = candleTime((lastCandle as { date?: unknown } | undefined)?.date);
  if (!snapshot || !snapshot.candles.length || !asOf) {
    await recordOperationalHealth(`candle:${instrumentId}:${timeframe}`, false, {
      instrumentId,
      timeframe,
      staleReason: snapshot?.staleReason ?? "feed_unavailable",
      sourceFetchedAt: snapshot?.sourceFetchedAt ?? null,
      sourceMaxAgeMs: snapshot?.sourceMaxAgeMs ?? null,
    });
    throw new TradePilotServiceError("upstream_unavailable", 503);
  }
  await recordOperationalHealth(`candle:${instrumentId}:${timeframe}`, !snapshot.isStale, {
    instrumentId,
    timeframe,
    candleAsOf: asOf.toISOString(),
    sourceFetchedAt: snapshot.sourceFetchedAt,
    sourceMaxAgeMs: snapshot.sourceMaxAgeMs,
    isStale: snapshot.isStale,
    staleReason: snapshot.staleReason,
  });
  const snapshotInfo = { candleCount: snapshot.candles.length, candleAsOf: asOf };
  if (!aiCacheEnabled()) {
    return { generated: await generateFresh(instrumentId, timeframe, mode, snapshotInfo), cacheHit: false };
  }
  const key = `${instrumentId}|${timeframe}|${asOf.toISOString()}`;
  const now = Date.now();
  for (const [cacheKey, entry] of aiResultCache) if (entry.expiresAt <= now) aiResultCache.delete(cacheKey);
  const existing = aiResultCache.get(key);
  if (existing) return { generated: await existing.value, cacheHit: true };
  const value = generateFresh(instrumentId, timeframe, mode, snapshotInfo);
  aiResultCache.set(key, { expiresAt: now + Math.min(tf.candleMs, HOUR), value });
  value.catch(() => {
    if (aiResultCache.get(key)?.value === value) aiResultCache.delete(key);
  });
  return { generated: await value, cacheHit: false };
}

// ---------------------------------------------------------------------------
// Public views
// ---------------------------------------------------------------------------

const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);
const textList = (value: unknown) =>
  Array.isArray(value) ? value.map(text).filter((item): item is string => item !== null) : [];

/** "a; b" atau baris "• a\n• b" -> ["a", "b"] */
function splitConditions(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(/\n|;|(?:^|\s)•\s/)
    .map((item) => item.replace(/^[•\-\s]+/, "").trim())
    .filter(Boolean);
}

/**
 * Penjelasan keyakinan dari output AI tersimpan (untuk modal "Kenapa keyakinan
 * tidak lebih tinggi?"). Narasi dari model berbahasa Indonesia.
 * Null untuk analisis lama tanpa ai_output.
 */
export function confidenceExplanation(row: Pick<TradePilotAnalysis, "aiInput" | "aiOutput">) {
  const output = row.aiOutput as Record<string, unknown> | null;
  if (!output) return null;
  const min = Number(output.confidenceMin);
  const max = Number(output.confidenceMax);
  const citations = (output.fundamentalCitations ?? {}) as Record<string, unknown>;
  const datedEvents = Array.isArray((row.aiInput as Record<string, unknown> | null)?.calendarEventDates)
    ? ((row.aiInput as Record<string, unknown>).calendarEventDates as Array<{ event?: string; date?: string }>)
    : [];
  const riskLevel = output.riskLevel;
  return {
    min: Number.isFinite(min) ? min : null,
    max: Number.isFinite(max) ? max : null,
    riskLevel: riskLevel === "low" || riskLevel === "medium" || riskLevel === "high" ? riskLevel : null,
    reason: text(output.uncertaintyNotes) ?? text(output.whyReason),
    technical: text(output.keyDriversTechnical),
    fundamental: text(output.keyDriversFundamental),
    risk: text(output.risk),
    invalidation: splitConditions(text(output.invalidationConditions) ?? text(output.failureConditions)),
    sources: {
      news: textList(citations.newsTitles),
      calendar: textList(citations.calendarEvents).map((name) => ({
        name,
        date: datedEvents.find((item) => item.event === name)?.date ?? null,
      })),
    },
  };
}

export function publicAnalysis(row: TradePilotAnalysis, language: TradePilotLanguage) {
  const context = row.marketContext?.[language] ?? row.marketContext?.["id"];
  return {
    id: row.id,
    analyzedAt: row.analyzedAt.toISOString(),
    mode: row.mode as TradePilotMode,
    instrumentId: row.instrumentId as TradePilotInstrumentId,
    instrumentLabel: row.instrumentLabel,
    timeframe: row.timeframe as TradePilotTimeframe,
    timeframeLabel: row.timeframeLabel,
    direction: row.direction as "bullish" | "bearish" | "neutral",
    marketSentiment: row.marketSentiment as "bullish" | "bearish",
    buyLevels: row.buyLevels,
    sellLevels: row.sellLevels,
    validUntil: row.validUntil.toISOString(),
    dataSnapshot: {
      price: decimal2(row.priceAtAnalysis),
      candleCount: row.candleCount ?? 0,
      asOf: (row.candleAsOf ?? row.analyzedAt).toISOString(),
    },
    indicators: row.indicators.map(publicIndicator),
    ...(context ? { marketContext: context } : {}),
    status: row.status as TradePilotStatus,
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    confidence: confidenceExplanation(row),
    disclaimer: TRADE_PILOT_DISCLAIMER[language],
    source: "api" as const,
  };
}

function historyItem(row: TradePilotAnalysis) {
  return {
    id: row.id,
    createdAt: row.analyzedAt.toISOString(),
    instrumentId: row.instrumentId as TradePilotInstrumentId,
    instrumentLabel: row.instrumentLabel,
    mode: row.mode as TradePilotMode,
    timeframe: row.timeframe as TradePilotTimeframe,
    timeframeLabel: row.timeframeLabel,
    status: row.status as TradePilotStatus,
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    // Ringkasan untuk kartu riwayat (tambahan, opsional bagi klien lama).
    direction: row.direction as "bullish" | "bearish" | "neutral",
    priceAtAnalysis: decimal2(row.priceAtAnalysis),
    activeSide: row.activeSide === "buy" || row.activeSide === "sell" ? row.activeSide : null,
    buyLevels: row.buyLevels,
    sellLevels: row.sellLevels,
    validUntil: row.validUntil.toISOString(),
    source: "api" as const,
  };
}

// ---------------------------------------------------------------------------
// POST /analyses
// ---------------------------------------------------------------------------

export async function createTradePilotAnalysis(input: {
  userId: string;
  mode: TradePilotMode;
  instrumentId: TradePilotInstrumentId;
  timeframe: TradePilotTimeframe;
  idempotencyKey: string;
  requestId: string;
  language: TradePilotLanguage;
}) {
  const requestHash = createHash("sha256").update(JSON.stringify({ mode: input.mode, instrumentId: input.instrumentId, timeframe: input.timeframe })).digest("hex");
  const cutoff = new Date(Date.now() - DAY);

  const replay = async (existing: { requestHash: string; analysisId: string; response: Record<string, unknown> }) => {
    if (existing.requestHash !== requestHash) throw new TradePilotServiceError("idempotency_conflict", 409);
    const [row] = await db.select().from(tradePilotAnalyses).where(eq(tradePilotAnalyses.id, existing.analysisId)).limit(1);
    if (!row) throw new TradePilotServiceError("not_found", 404);
    return { ...existing.response, analysis: publicAnalysis(row, input.language) };
  };

  // Keys can be reused after 24 hours. Remove only this caller's expired
  // record before the lookup so cleanup-job timing never extends the TTL.
  await db.delete(tradePilotIdempotency).where(and(
    eq(tradePilotIdempotency.userId, input.userId),
    eq(tradePilotIdempotency.key, input.idempotencyKey),
    lt(tradePilotIdempotency.createdAt, cutoff),
  ));
  const [existing] = await db.select().from(tradePilotIdempotency).where(and(
    eq(tradePilotIdempotency.userId, input.userId),
    eq(tradePilotIdempotency.key, input.idempotencyKey),
  )).limit(1);
  if (existing) return replay(existing);

  const creditBefore = await getTradePilotCredit(input.userId, input.mode);
  if (creditBefore.remaining <= 0) throw new TradePilotServiceError("insufficient_credit", 402);

  const { generated, cacheHit } = await getOrGenerate(input.instrumentId, input.timeframe, input.mode);
  const instrument = INSTRUMENTS[input.instrumentId];
  const tf = TIMEFRAMES[input.timeframe];
  const levels = mapLevels(generated.output);
  const plan = generated.output.tradePlan;
  const direction = plan?.preferredSide === "buy" ? "bullish" : plan?.preferredSide === "sell" ? "bearish" : "neutral";
  const tally = {
    buy: generated.indicatorItems.filter((item) => item.status === "buy").length,
    sell: generated.indicatorItems.filter((item) => item.status === "sell").length,
    neutral: generated.indicatorItems.filter((item) => item.status === "neutral").length,
  };
  const marketSentiment = tally.buy >= tally.sell ? "bullish" : "bearish";
  const priceAtAnalysis = numberString(generated.price);
  if (!priceAtAnalysis) throw new TradePilotServiceError("upstream_unavailable", 503);
  const output = generated.output as AIOutput & { marketContext?: string; uncertaintyNotes?: string };
  const marketContext = buildMarketContext({
    instrumentLabel: instrument.label,
    timeframeLabel: tf.label,
    direction,
    marketCondition: generated.output.marketCondition,
    riskLevel: generated.output.riskLevel,
    indicatorTally: tally,
    narrativeId: output.marketContext,
    uncertaintyId: output.uncertaintyNotes,
  });
  const usage = cacheHit
    ? { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
    : generated.usage;
  const costUsd = cacheHit ? 0 : estimateCostUsd(generated.model, usage.promptTokens, usage.completionTokens);
  const now = new Date();
  const id = newId("a");
  const validUntil = new Date(generated.generatedAt.getTime() + tf.durationMs);

  const response = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${input.userId}:${input.mode}`}))`);
    const [raceExisting] = await tx.select().from(tradePilotIdempotency).where(and(
      eq(tradePilotIdempotency.userId, input.userId), eq(tradePilotIdempotency.key, input.idempotencyKey),
    )).limit(1);
    if (raceExisting) return { replayOf: raceExisting, row: null, stored: null };
    const [credit] = await tx.select().from(tradePilotCreditBalances).where(and(
      eq(tradePilotCreditBalances.userId, input.userId), eq(tradePilotCreditBalances.mode, input.mode),
    )).limit(1);
    if (!credit || credit.consumed >= credit.allowance) throw new TradePilotServiceError("insufficient_credit", 402);
    const [row] = await tx.insert(tradePilotAnalyses).values({
      id, userId: input.userId, mode: input.mode,
      instrumentId: input.instrumentId, instrumentLabel: instrument.label,
      timeframe: input.timeframe, timeframeLabel: tf.label,
      direction, marketSentiment, priceAtAnalysis,
      buyLevels: levels.buy, sellLevels: levels.sell, indicators: generated.indicatorItems,
      lastEvaluatedPrice: priceAtAnalysis, analyzedAt: now, validUntil,
      candleCount: generated.candleCount, candleAsOf: generated.candleAsOf,
      marketContext,
      model: generated.model, promptVersion: PRO_PROMPT_VERSION,
      aiInput: generated.aiInput,
      aiOutput: generated.output as unknown as Record<string, unknown>,
      aiCacheHit: cacheHit,
      promptTokens: usage.promptTokens, completionTokens: usage.completionTokens, totalTokens: usage.totalTokens,
      estimatedCostUsd: costUsd.toFixed(6),
      requestId: input.requestId,
    }).returning();
    const [updatedCredit] = await tx.update(tradePilotCreditBalances).set({
      consumed: sql`${tradePilotCreditBalances.consumed} + 1`, updatedAt: now,
    }).where(and(
      eq(tradePilotCreditBalances.userId, input.userId),
      eq(tradePilotCreditBalances.mode, input.mode),
      sql`${tradePilotCreditBalances.consumed} < ${tradePilotCreditBalances.allowance}`,
    )).returning();
    if (!updatedCredit) throw new TradePilotServiceError("insufficient_credit", 402);
    const stored = {
      credit: creditView(input.mode, updatedCredit),
      history: historyItem(row!),
    };
    await tx.insert(tradePilotIdempotency).values({
      userId: input.userId, key: input.idempotencyKey, requestHash, analysisId: id,
      response: stored as unknown as Record<string, unknown>, createdAt: now,
    });
    return { replayOf: null, row: row!, stored };
  });

  if (response.replayOf) return replay(response.replayOf);
  logger.info({
    analysisId: id, mode: input.mode, instrumentId: input.instrumentId, timeframe: input.timeframe,
    model: generated.model, totalTokens: usage.totalTokens, estimatedCostUsd: costUsd, aiCacheHit: cacheHit,
    requestId: input.requestId,
  }, "trade_pilot.analysis.created");
  return { analysis: publicAnalysis(response.row!, input.language), ...response.stored! };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

async function ownedAnalysis(userId: string, id: string, allowed: AllowedModes): Promise<TradePilotAnalysis> {
  const [row] = await db.select().from(tradePilotAnalyses).where(and(
    eq(tradePilotAnalyses.id, id), eq(tradePilotAnalyses.userId, userId),
  )).limit(1);
  // 404 (not 403) for foreign ids so other users' ids cannot be probed.
  if (!row) throw new TradePilotServiceError("not_found", 404);
  assertMode(allowed, row.mode);
  return row;
}

export async function getTradePilotAnalysis(userId: string, id: string, language: TradePilotLanguage, allowed: AllowedModes) {
  return publicAnalysis(await ownedAnalysis(userId, id, allowed), language);
}

export async function getTradePilotAnalysisIndicators(userId: string, id: string, allowed: AllowedModes) {
  const row = await ownedAnalysis(userId, id, allowed);
  return {
    analysisId: row.id,
    calculatedAt: (row.candleAsOf ?? row.analyzedAt).toISOString(),
    items: row.indicators.map(publicIndicator),
  };
}

async function latestRow(userId: string, mode: TradePilotMode): Promise<TradePilotAnalysis | null> {
  const [row] = await db.select().from(tradePilotAnalyses).where(and(
    eq(tradePilotAnalyses.userId, userId), eq(tradePilotAnalyses.mode, mode),
  )).orderBy(desc(tradePilotAnalyses.analyzedAt), desc(tradePilotAnalyses.id)).limit(1);
  return row ?? null;
}

export async function getLatestTradePilotAnalysis(userId: string, mode: TradePilotMode, language: TradePilotLanguage) {
  await provisionTradePilotUser(userId, mode);
  const row = await latestRow(userId, mode);
  return row ? publicAnalysis(row, language) : null;
}

function encodeCursor(row: TradePilotAnalysis): string {
  return Buffer.from(JSON.stringify([row.analyzedAt.toISOString(), row.id]), "utf8").toString("base64url");
}

export type HistoryFilters = {
  instrumentId?: TradePilotInstrumentId;
  timeframe?: TradePilotTimeframe;
  status?: TradePilotStatus;
};

export async function listTradePilotHistory(
  userId: string,
  mode: TradePilotMode,
  limit: number,
  cursor?: string,
  filters: HistoryFilters = {},
) {
  await provisionTradePilotUser(userId, mode);
  let cursorDate: Date | null = null;
  let cursorId: string | null = null;
  if (cursor) {
    try {
      const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
      cursorDate = new Date(parsed[0]);
      cursorId = typeof parsed[1] === "string" ? parsed[1] : null;
    } catch { /* handled below */ }
    if (!cursorDate || !Number.isFinite(cursorDate.getTime()) || !cursorId) {
      throw new TradePilotServiceError("invalid_request", 400);
    }
  }
  const conditions: SQL[] = [eq(tradePilotAnalyses.userId, userId), eq(tradePilotAnalyses.mode, mode)];
  if (filters.instrumentId) conditions.push(eq(tradePilotAnalyses.instrumentId, filters.instrumentId));
  if (filters.timeframe) conditions.push(eq(tradePilotAnalyses.timeframe, filters.timeframe));
  if (filters.status) conditions.push(eq(tradePilotAnalyses.status, filters.status));
  if (cursorDate && cursorId) conditions.push(or(
    lt(tradePilotAnalyses.analyzedAt, cursorDate),
    and(eq(tradePilotAnalyses.analyzedAt, cursorDate), lt(tradePilotAnalyses.id, cursorId)),
  )!);
  const rows = await db.select().from(tradePilotAnalyses)
    .where(and(...conditions)).orderBy(desc(tradePilotAnalyses.analyzedAt), desc(tradePilotAnalyses.id)).limit(limit + 1);
  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit);
  return { items: items.map(historyItem), nextCursor: hasMore ? encodeCursor(items[items.length - 1]!) : null };
}

const MINIMUM_PERFORMANCE_SAMPLES = 10;

export async function getTradePilotPerformance(mode: TradePilotMode, instrumentId?: TradePilotInstrumentId) {
  const rows = await db.select().from(tradePilotPerformanceSnapshots).where(and(
    eq(tradePilotPerformanceSnapshots.mode, mode),
    eq(tradePilotPerformanceSnapshots.instrumentId, instrumentId ?? "*"),
  ));
  const byTimeframe = new Map(rows.map((row) => [row.timeframe, row]));
  return Object.values(TIMEFRAMES).map(({ label }) => {
    const row = byTimeframe.get(label);
    return {
      timeframe: label,
      sample: row?.sample ?? 0,
      stillValid: row?.stillValid ?? 0,
      expired: row?.expired ?? 0,
      stopLoss: row?.stopLoss ?? 0,
      takeProfitOne: row?.takeProfitOne ?? 0,
      takeProfitTwo: row?.takeProfitTwo ?? 0,
      winRate: row?.winRate ?? null,
      completion: row?.completion ?? null,
      minimumSamples: row ? row.minimumSamples : MINIMUM_PERFORMANCE_SAMPLES,
    };
  });
}

/** Status kill switch untuk klien (tanpa metadata admin). */
function publicAvailability(language: TradePilotLanguage) {
  const settings = currentAvailabilitySettings();
  return {
    enabled: settings.enabled,
    modes: settings.modes,
    instruments: settings.instruments,
    timeframes: settings.timeframes,
    message: settings.message[language] ?? null,
  };
}

export async function getTradePilotBootstrap(userId: string, modes: TradePilotMode[], language: TradePilotLanguage) {
  await provisionTradePilotUser(userId, modes[0]!);
  const isNewUser = await claimFirstBootstrap(userId);
  const perMode = await Promise.all(modes.map(async (mode) => {
    const [credit, history, latest, performance] = await Promise.all([
      getTradePilotCredit(userId, mode),
      listTradePilotHistory(userId, mode, 20),
      latestRow(userId, mode),
      getTradePilotPerformance(mode),
    ]);
    return { mode, credit, history, latest, performance };
  }));
  return {
    isNewUser,
    credits: Object.fromEntries(perMode.map((item) => [item.mode, item.credit])),
    histories: Object.fromEntries(perMode.map((item) => [item.mode, item.history.items])),
    latestAnalyses: Object.fromEntries(perMode.map((item) => [item.mode, item.latest ? publicAnalysis(item.latest, language) : null])),
    timeframePerformance: perMode.flatMap((item) => item.performance.map((row) => ({ mode: item.mode, ...row }))),
    analysisAvailability: publicAvailability(language),
  };
}

// ---------------------------------------------------------------------------
// Price alerts (PUT/GET /analyses/{id}/price-alert)
// ---------------------------------------------------------------------------

function alertView(analysis: TradePilotAnalysis, rows: TradePilotPriceAlert[]) {
  const enabled = rows.some((row) => row.active);
  const requested = new Set<string>(rows.flatMap((row) => row.levels));
  const levels = TP_LEVELS.filter((level) => requested.has(level)).map((level) => {
    const hit = rows.find((row) => row.triggeredLevels?.[level]);
    if (hit) {
      return { level, status: "triggered" as const, side: hit.side as TradePilotSide, triggeredAt: hit.triggeredLevels[level]! };
    }
    const pending = rows.some((row) => row.active && row.levels.includes(level));
    return { level, status: pending ? "pending" as const : "cancelled" as const, side: null, triggeredAt: null };
  });
  const updatedAt = rows.reduce<Date | null>((latest, row) => (!latest || row.updatedAt > latest ? row.updatedAt : latest), null);
  return {
    analysisId: analysis.id,
    enabled,
    channels: [...new Set(rows.flatMap((row) => row.channels))],
    levels,
    updatedAt: updatedAt?.toISOString() ?? null,
  };
}

export async function getTradePilotPriceAlert(userId: string, analysisId: string, allowed: AllowedModes) {
  const analysis = await ownedAnalysis(userId, analysisId, allowed);
  const rows = await db.select().from(tradePilotPriceAlerts).where(eq(tradePilotPriceAlerts.analysisId, analysis.id));
  return alertView(analysis, rows);
}

export async function putTradePilotPriceAlert(
  userId: string,
  analysisId: string,
  input: { enabled: boolean; levels: LevelName[]; channels: string[] },
  allowed: AllowedModes,
) {
  const analysis = await ownedAnalysis(userId, analysisId, allowed);
  const now = new Date();
  if (!input.enabled) {
    await db.update(tradePilotPriceAlerts).set({ active: false, updatedAt: now })
      .where(eq(tradePilotPriceAlerts.analysisId, analysis.id));
  } else {
    if (analysis.status !== "still_valid") throw new TradePilotServiceError("invalid_request", 400);
    // Before entry the alert watches both scenarios; once a side is active
    // only that side can still trigger.
    const sides: TradePilotSide[] = analysis.activeSide ? [analysis.activeSide as TradePilotSide] : ["buy", "sell"];
    for (const side of sides) {
      await db.insert(tradePilotPriceAlerts).values({
        id: newId("al"), userId, analysisId: analysis.id, mode: analysis.mode, side,
        levels: input.levels, channels: input.channels, active: true, updatedAt: now,
      }).onConflictDoUpdate({
        target: [tradePilotPriceAlerts.analysisId, tradePilotPriceAlerts.side],
        set: { levels: input.levels, channels: input.channels, active: true, updatedAt: now },
      });
    }
  }
  const rows = await db.select().from(tradePilotPriceAlerts).where(eq(tradePilotPriceAlerts.analysisId, analysis.id));
  return alertView(analysis, rows);
}

// ---------------------------------------------------------------------------
// Trading plans
// ---------------------------------------------------------------------------

function tradingPlanView(row: TradePilotTradingPlan) {
  return {
    id: row.id,
    analysisId: row.analysisId,
    mode: row.mode as TradePilotMode,
    variant: row.variant as TradePilotSide,
    accountType: row.accountType,
    tradingCapital: decimal2(row.tradingCapital),
    lossLimit: decimal2(row.lossLimit),
    riskStyle: row.riskStyle,
    result: row.result ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function createTradePilotTradingPlan(
  userId: string,
  input: {
    analysisId: string;
    variant: TradePilotSide;
    accountType: typeof TP_ACCOUNT_TYPES[number];
    tradingCapital: string;
    lossLimit: string;
    riskStyle: string;
    result?: Record<string, unknown>;
  },
  allowed: AllowedModes,
) {
  const analysis = await ownedAnalysis(userId, input.analysisId, allowed);
  const [row] = await db.insert(tradePilotTradingPlans).values({
    id: newId("tp"), userId, analysisId: analysis.id, mode: analysis.mode,
    variant: input.variant, accountType: input.accountType,
    tradingCapital: input.tradingCapital, lossLimit: input.lossLimit,
    riskStyle: input.riskStyle, result: input.result ?? null,
  }).returning();
  return tradingPlanView(row!);
}

export async function listTradePilotTradingPlans(userId: string, analysisId: string, allowed: AllowedModes) {
  const analysis = await ownedAnalysis(userId, analysisId, allowed);
  const rows = await db.select().from(tradePilotTradingPlans).where(and(
    eq(tradePilotTradingPlans.userId, userId), eq(tradePilotTradingPlans.analysisId, analysis.id),
  )).orderBy(desc(tradePilotTradingPlans.createdAt));
  return { items: rows.map(tradingPlanView) };
}

// ---------------------------------------------------------------------------
// Adaptive Position Plan (POST /analyses/{id}/position-plan)
// ---------------------------------------------------------------------------

export const TP_RISK_STYLES = ["conservative", "balanced", "aggressive"] as const;

/** Timeframe v1 -> label timeframe mesin Adaptive (bulanan tidak didukung). */
const ADAPTIVE_TIMEFRAMES: Record<TradePilotTimeframe, string | null> = {
  "1": "1m", "5": "5m", "15": "15m", "30": "30m", "60": "1h", "240": "4h", D: "1d", W: "1w", M: null,
};

/**
 * Zona entry asli dari output AI (mis. "4160–4165"). Tepi zona menjadi kandidat
 * layer tambahan di mesin Adaptive. Hanya dipakai bila titik tengahnya sama
 * dengan entry yang tersimpan (konsisten dengan yang dilihat nasabah);
 * selain itu kembali ke entry tunggal.
 */
export function adaptiveEntryZone(aiOutput: unknown, side: "buy" | "sell", storedEntry: string): string {
  const plan = (aiOutput as { tradePlan?: Record<string, { entryZone?: unknown } | undefined> } | null)?.tradePlan;
  const zone = plan?.[side]?.entryZone;
  if (typeof zone !== "string") return storedEntry;
  const numbers = (zone
    .replace(/,/g, "")
    .replace(/\b[HMDWhmdw]\d{1,3}\b/g, " ")
    .replace(/\b\d{1,3}[mhdwMHDW]\b/g, " ")
    .match(/\d+(?:\.\d+)?/g) ?? [])
    .map(Number)
    .filter((value) => Number.isFinite(value) && value > 0);
  if (numbers.length < 2) return storedEntry;
  const low = Math.min(numbers[0]!, numbers[1]!);
  const high = Math.max(numbers[0]!, numbers[1]!);
  const entry = Number(storedEntry);
  if (!Number.isFinite(entry) || high === low) return storedEntry;
  if (Math.abs((low + high) / 2 - entry) > 0.01) return storedEntry;
  return `${low.toFixed(2)}–${high.toFixed(2)}`;
}

function adaptiveSide(levels: TradePilotAnalysis["buyLevels"], entryZone = levels.entry) {
  return {
    entryZone,
    stopLoss: levels.stopLoss,
    takeProfit1: levels.takeProfitOne,
    takeProfit2: levels.takeProfitTwo,
    riskRewardRatio: "",
    rationale: "",
  };
}

/** Bersihkan noise floating point (287.0000000000073 -> 287) sebelum dikirim. */
function roundDeep<T>(value: T): T {
  if (typeof value === "number") return (Number.isFinite(value) ? Math.round(value * 10_000) / 10_000 : value) as T;
  if (Array.isArray(value)) return value.map(roundDeep) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, roundDeep(item)])) as T;
  }
  return value;
}

function finiteOrNull(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Rencana posisi adaptif untuk satu analisis milik user. Level & arah dari AI
 * (tersimpan di analisis); lot, margin, risiko, dan profit dihitung
 * deterministik dari TP Standard Trading Rules. Tidak memotong kredit.
 */
export async function getTradePilotPositionPlan(
  userId: string,
  analysisId: string,
  input: {
    accountType: typeof TP_ACCOUNT_TYPES[number];
    riskStyle: AdaptiveRiskStyle;
    tradingCapital: number;
    lossLimit: number;
  },
  language: TradePilotLanguage,
  allowed: AllowedModes,
) {
  const row = await ownedAnalysis(userId, analysisId, allowed);
  const instrumentId = row.instrumentId as TradePilotInstrumentId;
  const instrument = INSTRUMENTS[instrumentId];
  if (!instrument) throw new TradePilotServiceError("not_found", 404);
  const timeframe = row.timeframe as TradePilotTimeframe;
  const standardRule = STANDARD_TRADING_RULES.instruments.find((item) => item.code === instrument.contractCode) ?? null;
  const output = (row.aiOutput ?? {}) as Record<string, unknown>;
  const tradePlan: TradePlan = {
    preferredSide: row.direction === "bullish" ? "buy" : row.direction === "bearish" ? "sell" : "wait",
    buy: adaptiveSide(row.buyLevels, adaptiveEntryZone(row.aiOutput, "buy", row.buyLevels.entry)),
    sell: adaptiveSide(row.sellLevels, adaptiveEntryZone(row.aiOutput, "sell", row.sellLevels.entry)),
  };

  // Konteks pasar terkini: candle (untuk layer & volatilitas) dan berita/kalender
  // (untuk event high-impact). Gagal ambil tidak memblokir rencana.
  const isFastIntraday = timeframe === "1" || timeframe === "5";
  const [candleSnapshot, news, calendar] = await Promise.all([
    withTimeout(loadTradePilotCandles(instrumentId, timeframe).catch(() => null), 3_000, null),
    isFastIntraday ? Promise.resolve([] as NewsItem[]) : withTimeout(getRelevantNews(instrument.engine), 3_000, [] as NewsItem[]),
    isFastIntraday ? Promise.resolve([] as CalendarEvent[]) : withTimeout(getRelevantCalendar(instrument.engine), 3_000, [] as CalendarEvent[]),
  ]);
  const candles: AdaptiveChartCandle[] = (candleSnapshot?.candles ?? []).map((candle) => ({
    date: candle.date, open: candle.open, high: candle.high, low: candle.low, close: candle.close,
  }));

  const tally = { buy: 0, sell: 0, neutral: 0 };
  for (const indicator of row.indicators) {
    if (indicator.status === "buy" || indicator.status === "sell" || indicator.status === "neutral") tally[indicator.status] += 1;
  }
  const context = {
    timeframe: ADAPTIVE_TIMEFRAMES[timeframe],
    // Analisis yang sudah selesai (TP/SL/kedaluwarsa) tidak boleh dipakai untuk posisi baru.
    validUntil: row.status === "still_valid" ? row.validUntil.toISOString() : null,
    marketCondition: typeof output.marketCondition === "string" ? output.marketCondition : null,
    riskLevel: typeof output.riskLevel === "string" ? output.riskLevel : null,
    tradingBias: row.direction,
    confidenceMin: finiteOrNull(output.confidenceMin),
    confidenceMax: finiteOrNull(output.confidenceMax),
    techBuyCount: row.indicators.length ? tally.buy : null,
    techSellCount: row.indicators.length ? tally.sell : null,
    techNeutralCount: row.indicators.length ? tally.neutral : null,
    fundamentalContext: { newsItems: news, calendarEvents: calendar },
  };

  const recommend = (accountTier: typeof TP_ACCOUNT_TYPES[number]) => {
    const rule = getAdaptiveMarketRule(instrument.engine, standardRule, accountTier);
    return buildAdaptivePlanRecommendation({
      instrument: instrument.engine,
      tradePlan,
      availableMargin: input.tradingCapital,
      maximumLoss: input.lossLimit,
      existingExposure: 0,
      standardRule,
      context,
      checkpointPrices: rule ? getAdaptiveChartCandidatePrices(candles, tradePlan, rule.minMovement) : undefined,
      candles,
      accountTier,
      riskStyle: input.riskStyle,
    });
  };

  const selected = recommend(input.accountType);
  const tiers = Object.fromEntries(TP_ACCOUNT_TYPES.map((tier) => {
    const plan = tier === input.accountType ? selected : recommend(tier);
    const side = plan.decision.preferredSide === "buy" || plan.decision.preferredSide === "sell"
      ? plan.result[plan.decision.preferredSide]
      : null;
    return [tier, {
      valid: plan.result.valid && side != null,
      posture: plan.decision.posture,
      totalLots: side?.totalLots ?? null,
      marginRequired: side?.marginRequired ?? null,
      riskAtStop: side?.estimatedCycleLoss ?? null,
      minimumLot: plan.result.rule?.minimumLot ?? null,
    }];
  }));

  return roundDeep({
    analysisId: row.id,
    instrumentLabel: row.instrumentLabel,
    timeframeLabel: row.timeframeLabel,
    accountType: input.accountType,
    riskStyle: input.riskStyle,
    tradingCapital: input.tradingCapital,
    lossLimit: input.lossLimit,
    rulesVersion: STANDARD_TRADING_RULES.version,
    generatedAt: new Date().toISOString(),
    valid: selected.result.valid,
    errors: selected.result.errors,
    assumptions: selected.result.assumptions,
    rule: selected.result.rule,
    decision: selected.decision,
    recommendation: selected.recommendation,
    buy: selected.result.buy,
    sell: selected.result.sell,
    // conditionalPlan: rencana sisi yang tidak searah analisis (skenario alternatif).
    sideEvaluations: selected.sideEvaluations,
    volatility: selected.volatilityDiagnostic,
    tiers,
    disclaimer: TRADE_PILOT_DISCLAIMER[language],
  });
}

// ---------------------------------------------------------------------------
// Instruments & fundamental news
// ---------------------------------------------------------------------------

export function listTradePilotInstruments() {
  return {
    items: TP_INSTRUMENTS.map((id) => {
      const instrument = INSTRUMENTS[id];
      const tiers = BROKER_CONTRACT_TIERS[instrument.contractCode];
      const rule = STANDARD_TRADING_RULES.instruments.find((item) => item.code === instrument.contractCode);
      const miniMargin = rule?.initialMarginUsdPerLot ?? null;
      const spec = (tier: typeof TP_ACCOUNT_TYPES[number]) => ({
        lot: ACCOUNT_LOTS[tier],
        contractSize: tiers[tier].size,
        contractUnit: tiers.unit,
        // Initial margin per 1 lot in USD. Only the Mini figure comes from the
        // broker document; Micro/Regular are scaled by contract size.
        margin: miniMargin === null ? null : decimal2(miniMargin * (tiers[tier].size / tiers.mini.size)),
        marginCurrency: "USD",
        marginSource: tier === "mini" ? "broker_document" : "derived_from_contract_size",
      });
      return {
        id,
        label: instrument.label,
        quoteSymbols: instrument.quoteSymbols,
        tradingViewSymbol: instrument.tradingViewSymbol,
        timeframes: TP_TIMEFRAMES.map((value) => ({ value, label: TIMEFRAMES[value].label })),
        contractSpecs: { micro: spec("micro"), mini: spec("mini"), regular: spec("regular") },
      };
    }),
    rulesVersion: STANDARD_TRADING_RULES.version,
  };
}

export async function getTradePilotFundamentalNews(instrumentId: TradePilotInstrumentId, limit: number) {
  const instrument = INSTRUMENTS[instrumentId];
  const news = await withTimeout(getRelevantNews(instrument.engine, limit), 5_000, [] as NewsItem[]);
  return {
    instrumentId,
    items: news.map((item) => ({
      id: item.id,
      title: item.title,
      source: item.source,
      url: item.url,
      publishedAt: item.publishedAt,
      language: item.source === "Newsmaker.id" ? "id" as const : "en" as const,
    })),
  };
}

// ---------------------------------------------------------------------------
// Background jobs
// ---------------------------------------------------------------------------

function crossed(previous: number, current: number, target: number): boolean {
  return target >= Math.min(previous, current) && target <= Math.max(previous, current);
}

async function triggerAlerts(row: TradePilotAnalysis, side: TradePilotSide, level: LevelName, price: number): Promise<void> {
  const alerts = await db.select().from(tradePilotPriceAlerts).where(and(
    eq(tradePilotPriceAlerts.analysisId, row.id),
    eq(tradePilotPriceAlerts.side, side),
    eq(tradePilotPriceAlerts.active, true),
  ));
  const matching = alerts.filter((alert) => alert.levels.includes(level));
  if (!matching.length) return;
  const triggeredAt = new Date();
  await db.update(tradePilotPriceAlerts).set({
    lastTriggeredLevel: level,
    triggeredLevels: sql`${tradePilotPriceAlerts.triggeredLevels} || ${JSON.stringify({ [level]: triggeredAt.toISOString() })}::jsonb`,
    updatedAt: triggeredAt,
  }).where(inArray(tradePilotPriceAlerts.id, matching.map((alert) => alert.id)));
  const webhook = process.env["TRADE_PILOT_ALERT_WEBHOOK_URL"];
  if (!webhook) return;
  for (const alert of matching) {
    try {
      const response = await fetch(webhook, {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": process.env["TRADE_PILOT_ALERT_WEBHOOK_API_KEY"] ?? "" },
        body: JSON.stringify({ alertId: alert.id, userId: row.userId, analysisId: row.id, mode: row.mode, instrumentId: row.instrumentId, side, level, price: price.toFixed(2), channels: alert.channels, triggeredAt: triggeredAt.toISOString() }),
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) throw new Error(`Webhook responded HTTP ${response.status}`);
      await recordOperationalEvent("alert_webhook", true, {
        status: response.status,
        alertId: alert.id,
        analysisId: row.id,
      });
    } catch (error) {
      await recordOperationalEvent("alert_webhook", false, {
        alertId: alert.id,
        analysisId: row.id,
        error: error instanceof Error ? error.message.slice(0, 300) : "unknown_error",
      });
      logger.warn({ err: error, alertId: alert.id, analysisId: row.id, level }, "Trade Pilot alert webhook failed");
    }
  }
}

export async function evaluateTradePilotSignals(): Promise<void> {
  const rows = await db.select().from(tradePilotAnalyses).where(eq(tradePilotAnalyses.status, "still_valid"));
  const prices = new Map<string, number | null>();
  const now = new Date();
  for (const row of rows) {
    const instrument = INSTRUMENTS[row.instrumentId as TradePilotInstrumentId];
    if (!instrument) continue;
    if (!prices.has(row.instrumentId)) prices.set(row.instrumentId, await getLivePriceFor(instrument.engine).catch(() => null));
    const current = prices.get(row.instrumentId);
    if (current === null || current === undefined) {
      if (now >= row.validUntil) {
        const status: TradePilotStatus = row.takeProfitOneHitAt ? "take_profit_1" : "expired";
        await db.update(tradePilotAnalyses).set({ status, resolvedAt: now }).where(and(
          eq(tradePilotAnalyses.id, row.id), eq(tradePilotAnalyses.status, "still_valid"),
        ));
        await db.update(tradePilotPriceAlerts).set({ active: false, updatedAt: now }).where(eq(tradePilotPriceAlerts.analysisId, row.id));
      }
      continue;
    }
    const previous = Number(row.lastEvaluatedPrice ?? row.priceAtAnalysis);
    let activeSide = row.activeSide as TradePilotSide | null;
    if (!activeSide) {
      const buyEntry = Number(row.buyLevels.entry);
      const sellEntry = Number(row.sellLevels.entry);
      const buyHit = crossed(previous, current, buyEntry);
      const sellHit = crossed(previous, current, sellEntry);
      if (buyHit && sellHit) activeSide = Math.abs(previous - buyEntry) <= Math.abs(previous - sellEntry) ? "buy" : "sell";
      else if (buyHit) activeSide = "buy";
      else if (sellHit) activeSide = "sell";
      if (activeSide) {
        await triggerAlerts(row, activeSide, "entry", current);
        // The other scenario can no longer trigger.
        await db.update(tradePilotPriceAlerts).set({ active: false, updatedAt: now }).where(and(
          eq(tradePilotPriceAlerts.analysisId, row.id),
          eq(tradePilotPriceAlerts.side, activeSide === "buy" ? "sell" : "buy"),
        ));
      }
    }
    let status: TradePilotStatus = "still_valid";
    let tp1At = row.takeProfitOneHitAt;
    if (activeSide) {
      const levels = activeSide === "buy" ? row.buyLevels : row.sellLevels;
      const candidates = [
        { name: "stop_loss" as const, price: Number(levels.stopLoss) },
        { name: "take_profit_two" as const, price: Number(levels.takeProfitTwo) },
      ].filter((candidate) => crossed(previous, current, candidate.price))
        .sort((a, b) => Math.abs(previous - a.price) - Math.abs(previous - b.price));
      if (candidates[0]) {
        status = candidates[0].name === "stop_loss" ? "stop_loss" : "take_profit_2";
        await triggerAlerts(row, activeSide, candidates[0].name === "stop_loss" ? "stopLoss" : "takeProfitTwo", current);
      } else if (!tp1At && crossed(previous, current, Number(levels.takeProfitOne))) {
        tp1At = now;
        await triggerAlerts(row, activeSide, "takeProfitOne", current);
      }
    }
    if (status === "still_valid" && now >= row.validUntil) status = tp1At ? "take_profit_1" : "expired";
    const resolvedAt = status === "still_valid" ? null : now;
    await db.update(tradePilotAnalyses).set({ activeSide, status, takeProfitOneHitAt: tp1At, lastEvaluatedPrice: current.toFixed(2), resolvedAt }).where(and(
      eq(tradePilotAnalyses.id, row.id), eq(tradePilotAnalyses.status, "still_valid"),
    ));
    if (status !== "still_valid") {
      await db.update(tradePilotPriceAlerts).set({ active: false, updatedAt: now }).where(eq(tradePilotPriceAlerts.analysisId, row.id));
    }
  }
}

export async function aggregateTradePilotPerformance(): Promise<void> {
  const rows = await db.select({
    mode: tradePilotAnalyses.mode, instrumentId: tradePilotAnalyses.instrumentId,
    timeframeLabel: tradePilotAnalyses.timeframeLabel, status: tradePilotAnalyses.status,
  }).from(tradePilotAnalyses);
  const groups = new Map<string, typeof rows>();
  for (const row of rows) {
    for (const instrumentId of ["*", row.instrumentId]) {
      const key = `${row.mode}|${instrumentId}|${row.timeframeLabel}`;
      groups.set(key, [...(groups.get(key) ?? []), row]);
    }
  }
  await db.transaction(async (tx) => {
    await tx.delete(tradePilotPerformanceSnapshots);
    for (const [key, members] of groups) {
      const [mode, instrumentId, timeframe] = key.split("|");
      const count = (status: string) => members.filter((row) => row.status === status).length;
      const stillValid = count("still_valid");
      const expired = count("expired");
      const stopLoss = count("stop_loss");
      const takeProfitOne = count("take_profit_1");
      const takeProfitTwo = count("take_profit_2");
      const completed = expired + stopLoss + takeProfitOne + takeProfitTwo + count("invalid");
      const sample = members.length;
      const enough = completed >= MINIMUM_PERFORMANCE_SAMPLES;
      // Requirement: winRate = (TP1 + TP2) / (TP1 + TP2 + SL) x 100.
      const decided = takeProfitOne + takeProfitTwo + stopLoss;
      await tx.insert(tradePilotPerformanceSnapshots).values({
        mode: mode!, instrumentId: instrumentId!, timeframe: timeframe!, sample, stillValid,
        expired, stopLoss, takeProfitOne, takeProfitTwo,
        winRate: enough && decided > 0 ? Math.round(((takeProfitOne + takeProfitTwo) / decided) * 100) : null,
        completion: enough ? Math.round((completed / Math.max(1, sample)) * 100) : null,
        minimumSamples: enough ? null : MINIMUM_PERFORMANCE_SAMPLES - completed,
      });
    }
  });
}

export async function maintainTradePilotCreditsAndIdempotency(): Promise<void> {
  const now = new Date();
  const expired = await db.select().from(tradePilotCreditBalances).where(lte(tradePilotCreditBalances.resetsAt, now));
  for (const row of expired) await ensureCredit(row.userId, row.mode as TradePilotMode);
  await db.delete(tradePilotIdempotency).where(lt(tradePilotIdempotency.createdAt, new Date(now.getTime() - DAY)));
  await cleanupOperationalEvents(new Date(now.getTime() - 7 * DAY));
}
