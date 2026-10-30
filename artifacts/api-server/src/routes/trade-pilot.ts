import { randomBytes, timingSafeEqual } from "node:crypto";
import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import {
  TP_ACCOUNT_TYPES,
  TP_RISK_STYLES,
  getTradePilotPositionPlan,
  TP_ALERT_CHANNELS,
  TP_INSTRUMENTS,
  TP_LEVELS,
  TP_MODES,
  TP_STATUSES,
  TP_TIMEFRAMES,
  TradePilotServiceError,
  createTradePilotAnalysis,
  createTradePilotTradingPlan,
  getLatestTradePilotAnalysis,
  getTradePilotAnalysis,
  getTradePilotAnalysisIndicators,
  getTradePilotBootstrap,
  getTradePilotCredit,
  getTradePilotFundamentalNews,
  getTradePilotPerformance,
  getTradePilotPriceAlert,
  listTradePilotHistory,
  listTradePilotInstruments,
  listTradePilotTradingPlans,
  loadTradePilotCandles,
  loadTradePilotIndicators,
  publicIndicator,
  putTradePilotPriceAlert,
  type TradePilotMode,
} from "../lib/trade-pilot";
import { acquireAnalysisSlot } from "../lib/trade-pilot-rate-limit";
import {
  tradePilotLanguage,
  tradePilotMessage,
  type TradePilotErrorCode,
  type TradePilotLanguage,
} from "../locales/trade-pilot";
import { logger } from "../lib/logger";
import {
  analysisPauseReason,
  currentAvailabilitySettings,
  refreshTradePilotSettingsIfStale,
} from "../lib/trade-pilot-settings";

interface TradePilotRequest extends Request {
  tradePilotUserId?: string;
  tradePilotRequestId?: string;
  tradePilotLanguage?: TradePilotLanguage;
  tradePilotAllowedModes?: ReadonlySet<string> | null;
}

const router = Router();
const modeSchema = z.enum(TP_MODES);
const instrumentSchema = z.enum(TP_INSTRUMENTS);
const timeframeSchema = z.enum(TP_TIMEFRAMES);
const idSchema = z.string().regex(/^[A-Za-z0-9_-]{3,64}$/);
const userIdPattern = /^[a-f0-9]{64}$/i;
const idempotencyPattern = /^[a-zA-Z0-9-]{8,80}$/;
const incomingRequestIdPattern = /^[A-Za-z0-9._:-]{8,128}$/;
const decimalSchema = z.union([z.string(), z.number()])
  .transform((value) => (typeof value === "number" ? value.toFixed(2) : value.trim()))
  .refine((value) => /^\d{1,20}(\.\d{1,2})?$/.test(value), "decimal");

function sendError(res: Response, code: TradePilotErrorCode, status: number, message?: string | null): void {
  const req = res.req as TradePilotRequest;
  const language = req.tradePilotLanguage ?? tradePilotLanguage(req.headers["accept-language"]);
  res.status(status).json({
    error: { code, message: message || tradePilotMessage(code, language), requestId: req.tradePilotRequestId ?? null },
  });
}

function safeEqual(actual: string, expected: string): boolean {
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** X-Request-Id on every response (echoes a well-formed incoming id). */
function assignRequestId(req: TradePilotRequest, res: Response, next: NextFunction): void {
  const incoming = req.header("X-Request-Id");
  const requestId = incoming && incomingRequestIdPattern.test(incoming)
    ? incoming
    : `req_${randomBytes(12).toString("hex")}`;
  req.tradePilotRequestId = requestId;
  req.tradePilotLanguage = tradePilotLanguage(req.headers["accept-language"]);
  res.setHeader("X-Request-Id", requestId);
  next();
}

/**
 * Service auth: `Authorization: Bearer {TRADE_PILOT_API_KEY}`.
 * User identity: `X-TradePilot-User` = opaque HMAC-SHA256 hex (never email).
 */
function requireTradePilotService(req: TradePilotRequest, res: Response, next: NextFunction): void {
  const expectedKey = process.env["TRADE_PILOT_API_KEY"];
  const authorization = req.header("Authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
  const suppliedKey = match?.[1]?.trim() ?? "";
  if (!expectedKey || !suppliedKey || !safeEqual(suppliedKey, expectedKey)) {
    sendError(res, "unauthorized", 401);
    return;
  }
  const userId = req.header("X-TradePilot-User") ?? "";
  if (!userIdPattern.test(userId)) {
    sendError(res, "invalid_request", 400);
    return;
  }
  req.tradePilotUserId = userId.toLowerCase();
  const allowed = req.header("X-Allowed-Modes");
  req.tradePilotAllowedModes = allowed
    ? new Set(allowed.split(",").map((value) => value.trim()).filter(Boolean))
    : null;
  next();
}

function assertModeAccess(req: TradePilotRequest, res: Response, mode: TradePilotMode): boolean {
  const allowed = req.tradePilotAllowedModes;
  if (!allowed || allowed.has(mode)) return true;
  sendError(res, "access_denied", 403);
  return false;
}

function handler(fn: (req: TradePilotRequest, res: Response) => Promise<void>) {
  return async (req: TradePilotRequest, res: Response): Promise<void> => {
    try {
      await fn(req, res);
    } catch (error) {
      if (error instanceof TradePilotServiceError) {
        sendError(res, error.code, error.status);
        return;
      }
      logger.error({ err: error, path: req.path, requestId: req.tradePilotRequestId }, "Trade Pilot v1 request failed");
      sendError(res, "internal_error", 500);
    }
  };
}

const lang = (req: TradePilotRequest): TradePilotLanguage => req.tradePilotLanguage ?? "id";

router.use(assignRequestId);
router.use(requireTradePilotService);

// 1. GET /bootstrap?modes=demo,real
router.get("/bootstrap", handler(async (req, res) => {
  const raw = typeof req.query.modes === "string" ? req.query.modes : "";
  const requested = raw
    ? raw.split(",").map((value) => value.trim()).filter(Boolean)
    : TP_MODES.filter((mode) => !req.tradePilotAllowedModes || req.tradePilotAllowedModes.has(mode));
  const parsed = z.array(modeSchema).min(1).safeParse([...new Set(requested)]);
  if (!parsed.success) return sendError(res, "invalid_request", 400);
  for (const mode of parsed.data) if (!assertModeAccess(req, res, mode)) return;
  res.json(await getTradePilotBootstrap(req.tradePilotUserId!, parsed.data, lang(req)));
}));

// 2. GET /credits?mode=
router.get("/credits", handler(async (req, res) => {
  const parsed = modeSchema.safeParse(req.query.mode);
  if (!parsed.success) return sendError(res, "invalid_request", 400);
  if (!assertModeAccess(req, res, parsed.data)) return;
  res.json(await getTradePilotCredit(req.tradePilotUserId!, parsed.data));
}));

// 3. POST /analyses
router.post("/analyses", handler(async (req, res) => {
  const body = z.object({
    instrumentId: instrumentSchema,
    mode: modeSchema,
    timeframe: timeframeSchema,
  }).safeParse(req.body);
  const idempotencyKey = req.header("Idempotency-Key") ?? "";
  if (!body.success || !idempotencyPattern.test(idempotencyKey)) {
    return sendError(res, "invalid_request", 400);
  }
  if (!assertModeAccess(req, res, body.data.mode)) return;
  // Kill switch dari konsol admin: tolak SEBELUM rate limit & pemotongan kredit.
  await refreshTradePilotSettingsIfStale();
  if (analysisPauseReason(body.data)) {
    const availability = currentAvailabilitySettings();
    return sendError(res, "analysis_paused", 503, availability.message[lang(req)]);
  }
  const slot = acquireAnalysisSlot(req.tradePilotUserId!);
  if (!slot.allowed) {
    res.setHeader("Retry-After", String(slot.retryAfterSeconds));
    return sendError(res, "rate_limited", 429);
  }
  try {
    const result = await createTradePilotAnalysis({
      userId: req.tradePilotUserId!,
      idempotencyKey,
      requestId: req.tradePilotRequestId!,
      language: lang(req),
      ...body.data,
    });
    res.status(201).json(result);
  } finally {
    slot.release();
  }
}));

// 4. GET /analyses/latest?mode=  (204 when none yet)
router.get("/analyses/latest", handler(async (req, res) => {
  const parsed = modeSchema.safeParse(req.query.mode);
  if (!parsed.success) return sendError(res, "invalid_request", 400);
  if (!assertModeAccess(req, res, parsed.data)) return;
  const analysis = await getLatestTradePilotAnalysis(req.tradePilotUserId!, parsed.data, lang(req));
  if (!analysis) {
    res.status(204).end();
    return;
  }
  res.json(analysis);
}));

// 5. GET /analyses/{id}
router.get("/analyses/:id", handler(async (req, res) => {
  const id = idSchema.safeParse(req.params.id);
  if (!id.success) return sendError(res, "invalid_request", 400);
  res.json(await getTradePilotAnalysis(req.tradePilotUserId!, id.data, lang(req), req.tradePilotAllowedModes ?? null));
}));

// 8. GET /analyses/{id}/indicators
router.get("/analyses/:id/indicators", handler(async (req, res) => {
  const id = idSchema.safeParse(req.params.id);
  if (!id.success) return sendError(res, "invalid_request", 400);
  res.json(await getTradePilotAnalysisIndicators(req.tradePilotUserId!, id.data, req.tradePilotAllowedModes ?? null));
}));

// 10. GET + PUT /analyses/{id}/price-alert
router.get("/analyses/:id/price-alert", handler(async (req, res) => {
  const id = idSchema.safeParse(req.params.id);
  if (!id.success) return sendError(res, "invalid_request", 400);
  res.json(await getTradePilotPriceAlert(req.tradePilotUserId!, id.data, req.tradePilotAllowedModes ?? null));
}));

router.put("/analyses/:id/price-alert", handler(async (req, res) => {
  const id = idSchema.safeParse(req.params.id);
  const body = z.object({
    enabled: z.boolean(),
    levels: z.array(z.enum(TP_LEVELS)).min(1).default([...TP_LEVELS]),
    channels: z.array(z.enum(TP_ALERT_CHANNELS)).min(1).default(["push"]),
  }).safeParse(req.body);
  if (!id.success || !body.success) return sendError(res, "invalid_request", 400);
  res.json(await putTradePilotPriceAlert(
    req.tradePilotUserId!,
    id.data,
    { enabled: body.data.enabled, levels: [...new Set(body.data.levels)], channels: [...new Set(body.data.channels)] },
    req.tradePilotAllowedModes ?? null,
  ));
}));

// 6. GET /histories?mode=&cursor=&limit=&instrumentId=&timeframe=&status=
router.get("/histories", handler(async (req, res) => {
  const parsed = z.object({
    mode: modeSchema,
    limit: z.coerce.number().int().min(1).max(100).default(20),
    cursor: z.string().min(1).optional(),
    instrumentId: instrumentSchema.optional(),
    timeframe: timeframeSchema.optional(),
    status: z.enum(TP_STATUSES).optional(),
  }).safeParse(req.query);
  if (!parsed.success) return sendError(res, "invalid_request", 400);
  if (!assertModeAccess(req, res, parsed.data.mode)) return;
  const { mode, limit, cursor, ...filters } = parsed.data;
  res.json(await listTradePilotHistory(req.tradePilotUserId!, mode, limit, cursor, filters));
}));

// 7. GET /performance/timeframes?mode=
router.get("/performance/timeframes", handler(async (req, res) => {
  const parsed = z.object({ mode: modeSchema, instrumentId: instrumentSchema.optional() }).safeParse(req.query);
  if (!parsed.success) return sendError(res, "invalid_request", 400);
  if (!assertModeAccess(req, res, parsed.data.mode)) return;
  res.json(await getTradePilotPerformance(parsed.data.mode, parsed.data.instrumentId));
}));

// 9. GET /fundamental-news?instrumentId=
router.get("/fundamental-news", handler(async (req, res) => {
  const parsed = z.object({
    instrumentId: instrumentSchema,
    limit: z.coerce.number().int().min(1).max(10).default(5),
  }).safeParse(req.query);
  if (!parsed.success) return sendError(res, "invalid_request", 400);
  res.setHeader("Cache-Control", "private, max-age=300");
  res.json(await getTradePilotFundamentalNews(parsed.data.instrumentId, parsed.data.limit));
}));

// 11. POST /trading-plans, GET /trading-plans?analysisId=
router.post("/trading-plans", handler(async (req, res) => {
  const parsed = z.object({
    analysisId: idSchema,
    variant: z.enum(["buy", "sell"]),
    accountType: z.enum(TP_ACCOUNT_TYPES),
    tradingCapital: decimalSchema,
    lossLimit: decimalSchema,
    riskStyle: z.string().trim().min(1).max(32),
    result: z.record(z.string(), z.unknown()).optional(),
  }).safeParse(req.body);
  if (!parsed.success || Number(parsed.data.tradingCapital) <= 0) return sendError(res, "invalid_request", 400);
  if (parsed.data.result && JSON.stringify(parsed.data.result).length > 8_192) return sendError(res, "invalid_request", 400);
  res.status(201).json(await createTradePilotTradingPlan(req.tradePilotUserId!, parsed.data, req.tradePilotAllowedModes ?? null));
}));

router.get("/trading-plans", handler(async (req, res) => {
  const analysisId = idSchema.safeParse(req.query.analysisId);
  if (!analysisId.success) return sendError(res, "invalid_request", 400);
  res.json(await listTradePilotTradingPlans(req.tradePilotUserId!, analysisId.data, req.tradePilotAllowedModes ?? null));
}));

// 11b. POST /analyses/{id}/position-plan — Adaptive Position Plan (tanpa kredit)
router.post("/analyses/:id/position-plan", handler(async (req, res) => {
  const id = idSchema.safeParse(req.params.id);
  const body = z.object({
    accountType: z.enum(TP_ACCOUNT_TYPES),
    riskStyle: z.enum(TP_RISK_STYLES),
    tradingCapital: z.coerce.number().positive().max(100_000_000),
    lossLimit: z.coerce.number().positive().max(100_000_000),
  }).safeParse(req.body);
  if (!id.success || !body.success) return sendError(res, "invalid_request", 400);
  res.setHeader("Cache-Control", "no-store");
  res.json(await getTradePilotPositionPlan(
    req.tradePilotUserId!,
    id.data,
    body.data,
    lang(req),
    req.tradePilotAllowedModes ?? null,
  ));
}));

// 12. GET /instruments
router.get("/instruments", handler(async (_req, res) => {
  res.setHeader("Cache-Control", "private, max-age=3600");
  res.json(listTradePilotInstruments());
}));

// Supporting endpoints (not in the requirement list): live indicators and
// candles for the chart.
router.get("/indicators", handler(async (req, res) => {
  const parsed = z.object({ instrumentId: instrumentSchema, timeframe: timeframeSchema }).safeParse(req.query);
  if (!parsed.success) return sendError(res, "invalid_request", 400);
  const data = await loadTradePilotIndicators(parsed.data.instrumentId, parsed.data.timeframe);
  res.json({ instrumentId: parsed.data.instrumentId, timeframe: parsed.data.timeframe, calculatedAt: data.calculatedAt, items: data.items.map(publicIndicator) });
}));

router.get("/candles", handler(async (req, res) => {
  const parsed = z.object({ instrumentId: instrumentSchema, timeframe: timeframeSchema }).safeParse(req.query);
  if (!parsed.success) return sendError(res, "invalid_request", 400);
  const data = await loadTradePilotCandles(parsed.data.instrumentId, parsed.data.timeframe);
  res.setHeader("Cache-Control", "private, no-store");
  res.json(data);
}));

router.use((_req, res) => sendError(res, "not_found", 404));

export default router;
