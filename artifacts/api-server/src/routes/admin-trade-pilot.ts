import { Router, type Response } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { sql, type SQL } from "drizzle-orm";
import { db } from "../lib/db";
import { requireAdmin, requireSuperAdmin, type AuthRequest } from "../middleware/auth";
import {
  TP_INSTRUMENTS,
  TP_MODES,
  TP_STATUSES,
  TP_TIMEFRAMES,
  adjustTradePilotCredit,
  tradePilotCreditPolicy,
} from "../lib/trade-pilot";
import { logger } from "../lib/logger";
import { sessions, tradePilotAdminAudit, users } from "@workspace/db/schema";
import { and, count, eq, inArray } from "drizzle-orm";
import {
  availabilitySettingsSchema,
  currentAvailabilitySettings,
  currentQuotaSettings,
  defaultQuotaSettings,
  quotaSettingsSchema,
  refreshTradePilotSettingsIfStale,
  saveTradePilotSetting,
} from "../lib/trade-pilot-settings";
import { isTradePilotEmailLookupConfigured, tradePilotUserIdFromEmail } from "../lib/trade-pilot-user-id";

/*
 * Dashboard admin TradePilot v1 (data nasabah get-sgb, tabel tp_*).
 * Hanya untuk role admin & super_admin (sesi web). Data user hanya berupa
 * userId HMAC opaque — tidak ada PII nasabah di service ini.
 */

const router = Router();

type Row = Record<string, unknown>;

async function rows<T extends Row = Row>(query: SQL): Promise<T[]> {
  const result = await db.execute(query);
  return result.rows as T[];
}

const num = (value: unknown) => (value === null || value === undefined ? 0 : Number(value));
const iso = (value: unknown) =>
  value instanceof Date ? value.toISOString() : value === null || value === undefined ? null : String(value);

const TIMEZONE = "Asia/Jakarta";
const USER_ID_PATTERN = /^[a-f0-9]{1,64}$/;
const ANALYSIS_ID_PATTERN = /^[a-zA-Z0-9_-]{3,100}$/;
type HealthStatus = "healthy" | "warning" | "critical" | "unknown";

function sendInvalid(res: Response) {
  res.status(400).json({ error: "invalid_request" });
}

function handler(fn: (req: AuthRequest, res: Response) => Promise<void>) {
  return async (req: AuthRequest, res: Response) => {
    try {
      await fn(req, res);
    } catch (error) {
      logger.error({ err: error, path: req.path }, "Admin Trade Pilot request failed");
      if (!res.headersSent) res.status(500).json({ error: "internal_error" });
    }
  };
}

// ---------------------------------------------------------------------------
// 1. Ringkasan: KPI, biaya AI, tren harian
// ---------------------------------------------------------------------------

router.get("/admin/trade-pilot/overview", requireAdmin, handler(async (req, res) => {
  const parsed = z.object({ days: z.coerce.number().int().refine((v) => [7, 30, 90].includes(v)).default(30) })
    .safeParse(req.query);
  if (!parsed.success) return sendInvalid(res);
  const days = parsed.data.days;
  const since = sql`now() - make_interval(days => ${days})`;

  const [users] = await rows(sql`
    select
      (select count(*) from tp_user) as total,
      (select count(*) from tp_user where created_at >= now() - interval '1 day') as new_24h,
      (select count(*) from tp_user where created_at >= ${since}) as new_in_range,
      (select count(distinct user_id) from tp_analysis where analyzed_at >= ${since}) as active_in_range
  `);

  const [totals] = await rows(sql`
    select
      count(*) as analyses,
      count(*) filter (where analyzed_at >= now() - interval '1 day') as analyses_24h,
      coalesce(sum(total_tokens), 0) as tokens,
      coalesce(sum(estimated_cost_usd), 0) as cost_usd,
      coalesce(sum(estimated_cost_usd) filter (where analyzed_at >= now() - interval '1 day'), 0) as cost_usd_24h,
      count(*) filter (where ai_cache_hit) as cache_hits
    from tp_analysis
    where analyzed_at >= ${since}
  `);

  const breakdown = async (column: SQL) => rows<{ key: string; count: string }>(sql`
    select ${column} as key, count(*) as count
    from tp_analysis where analyzed_at >= ${since}
    group by 1 order by 2 desc
  `);
  const [byMode, byInstrument, byTimeframe, byStatus, byDirection, byModel] = await Promise.all([
    breakdown(sql`mode`),
    breakdown(sql`instrument_label`),
    breakdown(sql`timeframe_label`),
    breakdown(sql`status`),
    breakdown(sql`direction`),
    breakdown(sql`coalesce(model, '-')`),
  ]);

  // Kualitas sinyal: hasil analisis yang sudah selesai (TP vs SL) per dimensi.
  const quality = async (column: SQL) => rows<{
    key: string; total: string; tp: string; sl: string; expired: string; open: string;
  }>(sql`
    select ${column} as key,
      count(*) as total,
      count(*) filter (where status in ('take_profit_1', 'take_profit_2')) as tp,
      count(*) filter (where status = 'stop_loss') as sl,
      count(*) filter (where status = 'expired') as expired,
      count(*) filter (where status = 'still_valid') as open
    from tp_analysis where analyzed_at >= ${since}
    group by 1 order by 2 desc
  `);
  const [qualityByInstrument, qualityByTimeframe, qualityByDirection] = await Promise.all([
    quality(sql`instrument_label`),
    quality(sql`timeframe_label`),
    quality(sql`direction`),
  ]);
  const qualityRow = (r: { key: string; total: string; tp: string; sl: string; expired: string; open: string }) => ({
    key: r.key,
    total: num(r.total),
    tp: num(r.tp),
    sl: num(r.sl),
    expired: num(r.expired),
    open: num(r.open),
  });

  const daily = await rows(sql`
    with days as (
      select generate_series(
        (now() at time zone ${TIMEZONE})::date - (${days} - 1),
        (now() at time zone ${TIMEZONE})::date,
        interval '1 day'
      )::date as day
    )
    select
      to_char(d.day, 'YYYY-MM-DD') as date,
      count(a.id) as analyses,
      count(distinct a.user_id) as users,
      coalesce(sum(a.estimated_cost_usd), 0) as cost_usd,
      coalesce(sum(a.total_tokens), 0) as tokens,
      count(a.id) filter (where a.ai_cache_hit) as cache_hits
    from days d
    left join tp_analysis a on (a.analyzed_at at time zone ${TIMEZONE})::date = d.day
    group by d.day
    order by d.day
  `);

  const [alerts] = await rows(sql`
    select
      count(*) filter (where active) as active,
      count(*) filter (where triggered_levels <> '{}'::jsonb and updated_at >= ${since}) as triggered_in_range
    from tp_price_alert
  `);

  const credits = await rows(sql`
    select mode,
      count(*) filter (where resets_at > now()) as users_in_period,
      coalesce(sum(consumed) filter (where resets_at > now()), 0) as consumed,
      coalesce(sum(allowance) filter (where resets_at > now()), 0) as allowance_total,
      count(*) filter (where resets_at > now() and consumed >= allowance) as exhausted
    from tp_credit_balance
    group by mode
  `);

  const topUsers = await rows(sql`
    select user_id, count(*) as analyses, coalesce(sum(estimated_cost_usd), 0) as cost_usd, max(analyzed_at) as last_analysis_at
    from tp_analysis where analyzed_at >= ${since}
    group by user_id order by 2 desc limit 5
  `);

  const analyses = num(totals?.analyses);
  res.json({
    days,
    users: {
      total: num(users?.total),
      new24h: num(users?.new_24h),
      newInRange: num(users?.new_in_range),
      activeInRange: num(users?.active_in_range),
    },
    analyses: {
      total: analyses,
      last24h: num(totals?.analyses_24h),
      byMode: byMode.map((r) => ({ key: r.key, count: num(r.count) })),
      byInstrument: byInstrument.map((r) => ({ key: r.key, count: num(r.count) })),
      byTimeframe: byTimeframe.map((r) => ({ key: r.key, count: num(r.count) })),
      byStatus: byStatus.map((r) => ({ key: r.key, count: num(r.count) })),
      byDirection: byDirection.map((r) => ({ key: r.key, count: num(r.count) })),
    },
    quality: {
      byInstrument: qualityByInstrument.map(qualityRow),
      byTimeframe: qualityByTimeframe.map(qualityRow),
      byDirection: qualityByDirection.map(qualityRow),
    },
    ai: {
      tokens: num(totals?.tokens),
      costUsd: num(totals?.cost_usd),
      costUsd24h: num(totals?.cost_usd_24h),
      cacheHits: num(totals?.cache_hits),
      cacheHitRate: analyses > 0 ? num(totals?.cache_hits) / analyses : 0,
      avgCostPerAnalysisUsd: analyses > 0 ? num(totals?.cost_usd) / analyses : 0,
      byModel: byModel.map((r) => ({ key: r.key, count: num(r.count) })),
    },
    daily: daily.map((r) => ({
      date: String(r.date),
      analyses: num(r.analyses),
      users: num(r.users),
      costUsd: num(r.cost_usd),
      tokens: num(r.tokens),
      cacheHits: num(r.cache_hits),
    })),
    alerts: { active: num(alerts?.active), triggeredInRange: num(alerts?.triggered_in_range) },
    credits: TP_MODES.map((mode) => {
      const row = credits.find((r) => r.mode === mode);
      return {
        mode,
        ...tradePilotCreditPolicy(mode),
        usersInPeriod: num(row?.users_in_period),
        consumed: num(row?.consumed),
        allowanceTotal: num(row?.allowance_total),
        exhausted: num(row?.exhausted),
      };
    }),
    topUsers: topUsers.map((r) => ({
      userId: String(r.user_id),
      analyses: num(r.analyses),
      costUsd: num(r.cost_usd),
      lastAnalysisAt: iso(r.last_analysis_at),
    })),
  });
}));

// ---------------------------------------------------------------------------
// 1b. Kesehatan sistem: feed, OpenAI, scheduler, webhook get-sgb
// ---------------------------------------------------------------------------

function healthStatusFromRate(total: number, failed: number): HealthStatus {
  if (total === 0) return "unknown";
  const rate = failed / total;
  if (rate > 0.2) return "critical";
  if (rate > 0.05) return "warning";
  return "healthy";
}

function jobHealthStatus(lastSuccessAt: Date | null, lastFailureAt: Date | null, expectedIntervalMs: number): HealthStatus {
  if (lastFailureAt && (!lastSuccessAt || lastFailureAt > lastSuccessAt)) return "critical";
  if (!lastSuccessAt) return "unknown";
  const age = Date.now() - lastSuccessAt.getTime();
  if (age > expectedIntervalMs * 4) return "critical";
  if (age > expectedIntervalMs * 2) return "warning";
  return "healthy";
}

router.get("/admin/trade-pilot/health", requireAdmin, handler(async (_req, res) => {
  const [healthRows, eventRows] = await Promise.all([
    rows(sql`
      select key, last_success_at, last_failure_at, checked_at, details
      from tp_operational_health order by key
    `),
    rows<{ category: string; total: string; failed: string }>(sql`
      select category, count(*) as total, count(*) filter (where not success) as failed
      from tp_operational_event
      where created_at >= now() - interval '24 hours'
      group by category
    `),
  ]);

  const eventMetric = (category: string) => {
    const row = eventRows.find((item) => item.category === category);
    const total = num(row?.total);
    const failed = num(row?.failed);
    return { total, failed, failureRate: total > 0 ? failed / total : 0, status: healthStatusFromRate(total, failed) };
  };
  const byKey = new Map(healthRows.map((row) => [String(row.key), row]));
  const rowDate = (value: unknown) => value instanceof Date ? value : value ? new Date(String(value)) : null;
  const snapshot = (key: string) => {
    const row = byKey.get(key);
    return {
      lastSuccessAt: iso(row?.last_success_at),
      lastFailureAt: iso(row?.last_failure_at),
      checkedAt: iso(row?.checked_at),
      details: (row?.details ?? {}) as Record<string, unknown>,
    };
  };

  const candleItems = healthRows.filter((row) => String(row.key).startsWith("candle:")).map((row) => {
    const details = (row.details ?? {}) as Record<string, unknown>;
    const checkedAt = rowDate(row.checked_at);
    const stale = details.isStale === true || details.staleReason != null;
    const observationAgeMs = checkedAt ? Math.max(0, Date.now() - checkedAt.getTime()) : null;
    const status: HealthStatus = stale
      ? "critical"
      : observationAgeMs === null
        ? "unknown"
        : observationAgeMs > 60 * 60_000
          ? "critical"
          : observationAgeMs > 15 * 60_000
            ? "warning"
            : "healthy";
    const [, instrumentId = "", timeframe = ""] = String(row.key).split(":");
    return {
      instrumentId,
      timeframe,
      status,
      checkedAt: iso(row.checked_at),
      lastSuccessAt: iso(row.last_success_at),
      lastFailureAt: iso(row.last_failure_at),
      candleAsOf: details.candleAsOf == null ? null : String(details.candleAsOf),
      sourceFetchedAt: details.sourceFetchedAt == null ? null : String(details.sourceFetchedAt),
      sourceMaxAgeMs: details.sourceMaxAgeMs == null ? null : num(details.sourceMaxAgeMs),
      staleReason: details.staleReason == null ? null : String(details.staleReason),
      observationAgeMs,
    };
  });
  const candleStatus: HealthStatus = candleItems.some((item) => item.status === "critical")
    ? "critical"
    : candleItems.some((item) => item.status === "warning")
      ? "warning"
      : candleItems.length > 0
        ? "healthy"
        : "unknown";

  const job = (key: "signal_evaluation" | "performance_aggregation", intervalMs: number) => {
    const state = snapshot(`job:${key}`);
    return {
      key,
      ...state,
      status: jobHealthStatus(
        state.lastSuccessAt ? new Date(state.lastSuccessAt) : null,
        state.lastFailureAt ? new Date(state.lastFailureAt) : null,
        intervalMs,
      ),
    };
  };
  const jobs = [
    job("signal_evaluation", 60_000),
    job("performance_aggregation", 15 * 60_000),
  ];
  const openai = { ...eventMetric("openai"), ...snapshot("openai"), windowHours: 24 };
  const webhookConfigured = Boolean(process.env["TRADE_PILOT_ALERT_WEBHOOK_URL"]);
  const webhookMetric = eventMetric("alert_webhook");
  const webhook = {
    ...webhookMetric,
    ...snapshot("alert_webhook"),
    configured: webhookConfigured,
    status: webhookConfigured ? webhookMetric.status : "unknown" as HealthStatus,
    windowHours: 24,
  };
  const componentStatuses = [candleStatus, openai.status, webhook.status, ...jobs.map((item) => item.status)];
  const overall: HealthStatus = componentStatuses.includes("critical")
    ? "critical"
    : componentStatuses.includes("warning")
      ? "warning"
      : componentStatuses.every((status) => status === "unknown")
        ? "unknown"
        : "healthy";

  res.json({
    capturedAt: new Date().toISOString(),
    overall,
    candles: { status: candleStatus, observed: candleItems.length, items: candleItems },
    openai,
    jobs,
    webhook,
  });
}));

// ---------------------------------------------------------------------------
// 2. Audit analisis
// ---------------------------------------------------------------------------

const analysisListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  mode: z.enum(TP_MODES).optional(),
  instrumentId: z.enum(TP_INSTRUMENTS).optional(),
  timeframe: z.enum(TP_TIMEFRAMES).optional(),
  status: z.enum(TP_STATUSES).optional(),
  direction: z.enum(["bullish", "bearish", "neutral"]).optional(),
  cacheHit: z.enum(["true", "false"]).optional(),
  userId: z.string().regex(USER_ID_PATTERN).optional(),
  q: z.string().trim().max(100).optional(),
  from: z.string().date().optional(),
  to: z.string().date().optional(),
});

router.get("/admin/trade-pilot/analyses", requireAdmin, handler(async (req, res) => {
  const parsed = analysisListQuery.safeParse(
    Object.fromEntries(Object.entries(req.query).filter(([, v]) => v !== "")),
  );
  if (!parsed.success) return sendInvalid(res);
  const f = parsed.data;

  const conditions: SQL[] = [sql`true`];
  if (f.mode) conditions.push(sql`mode = ${f.mode}`);
  if (f.instrumentId) conditions.push(sql`instrument_id = ${f.instrumentId}`);
  if (f.timeframe) conditions.push(sql`timeframe = ${f.timeframe}`);
  if (f.status) conditions.push(sql`status = ${f.status}`);
  if (f.direction) conditions.push(sql`direction = ${f.direction}`);
  if (f.cacheHit) conditions.push(sql`ai_cache_hit = ${f.cacheHit === "true"}`);
  if (f.userId) conditions.push(sql`user_id like ${`${f.userId}%`}`);
  if (f.q) conditions.push(sql`(id = ${f.q} or request_id = ${f.q})`);
  if (f.from) conditions.push(sql`(analyzed_at at time zone ${TIMEZONE})::date >= ${f.from}::date`);
  if (f.to) conditions.push(sql`(analyzed_at at time zone ${TIMEZONE})::date <= ${f.to}::date`);
  const where = sql.join(conditions, sql` and `);

  // Ringkasan untuk filter yang sama: total, hasil (TP/SL/kedaluwarsa/berjalan), biaya.
  const [countRow] = await rows(sql`
    select count(*) as total,
      count(*) filter (where status in ('take_profit_1', 'take_profit_2')) as tp,
      count(*) filter (where status = 'stop_loss') as sl,
      count(*) filter (where status = 'expired') as expired,
      count(*) filter (where status = 'still_valid') as open,
      coalesce(sum(estimated_cost_usd), 0) as cost_usd
    from tp_analysis where ${where}
  `);
  const items = await rows(sql`
    select id, user_id, mode, instrument_id, instrument_label, timeframe, timeframe_label,
      direction, market_sentiment, status, price_at_analysis, analyzed_at, valid_until, resolved_at,
      model, ai_cache_hit, total_tokens, estimated_cost_usd, request_id
    from tp_analysis where ${where}
    order by analyzed_at desc
    limit ${f.limit} offset ${(f.page - 1) * f.limit}
  `);

  res.json({
    page: f.page,
    limit: f.limit,
    total: num(countRow?.total),
    summary: {
      total: num(countRow?.total),
      tp: num(countRow?.tp),
      sl: num(countRow?.sl),
      expired: num(countRow?.expired),
      open: num(countRow?.open),
      costUsd: num(countRow?.cost_usd),
    },
    items: items.map((r) => ({
      id: String(r.id),
      userId: String(r.user_id),
      mode: String(r.mode),
      instrumentId: String(r.instrument_id),
      instrumentLabel: String(r.instrument_label),
      timeframe: String(r.timeframe),
      timeframeLabel: String(r.timeframe_label),
      direction: String(r.direction),
      marketSentiment: String(r.market_sentiment),
      status: String(r.status),
      priceAtAnalysis: String(r.price_at_analysis),
      analyzedAt: iso(r.analyzed_at),
      validUntil: iso(r.valid_until),
      resolvedAt: iso(r.resolved_at),
      model: r.model === null ? null : String(r.model),
      aiCacheHit: Boolean(r.ai_cache_hit),
      totalTokens: num(r.total_tokens),
      estimatedCostUsd: num(r.estimated_cost_usd),
      requestId: r.request_id === null ? null : String(r.request_id),
    })),
  });
}));

router.get("/admin/trade-pilot/analyses/:id", requireAdmin, handler(async (req, res) => {
  const id = String(req.params.id ?? "");
  if (!ANALYSIS_ID_PATTERN.test(id)) return sendInvalid(res);

  const [row] = await rows(sql`select * from tp_analysis where id = ${id}`);
  if (!row) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const [alerts, plans] = await Promise.all([
    rows(sql`select id, side, levels, channels, active, last_triggered_level, triggered_levels, created_at, updated_at
      from tp_price_alert where analysis_id = ${id} order by created_at`),
    rows(sql`select id, variant, account_type, trading_capital, loss_limit, risk_style, result, created_at
      from tp_trading_plan where analysis_id = ${id} order by created_at desc`),
  ]);

  res.json({
    id: String(row.id),
    userId: String(row.user_id),
    mode: String(row.mode),
    instrumentId: String(row.instrument_id),
    instrumentLabel: String(row.instrument_label),
    timeframe: String(row.timeframe),
    timeframeLabel: String(row.timeframe_label),
    direction: String(row.direction),
    marketSentiment: String(row.market_sentiment),
    status: String(row.status),
    activeSide: row.active_side ?? null,
    priceAtAnalysis: String(row.price_at_analysis),
    lastEvaluatedPrice: row.last_evaluated_price === null ? null : String(row.last_evaluated_price),
    buyLevels: row.buy_levels,
    sellLevels: row.sell_levels,
    indicators: row.indicators,
    marketContext: row.market_context ?? null,
    analyzedAt: iso(row.analyzed_at),
    validUntil: iso(row.valid_until),
    resolvedAt: iso(row.resolved_at),
    takeProfitOneHitAt: iso(row.take_profit_one_hit_at),
    candleCount: row.candle_count === null ? null : num(row.candle_count),
    candleAsOf: iso(row.candle_as_of),
    audit: {
      model: row.model ?? null,
      promptVersion: row.prompt_version ?? null,
      requestId: row.request_id ?? null,
      aiCacheHit: Boolean(row.ai_cache_hit),
      promptTokens: num(row.prompt_tokens),
      completionTokens: num(row.completion_tokens),
      totalTokens: num(row.total_tokens),
      estimatedCostUsd: num(row.estimated_cost_usd),
      aiInput: row.ai_input ?? null,
      aiOutput: row.ai_output ?? null,
    },
    alerts: alerts.map((a) => ({
      id: String(a.id),
      side: String(a.side),
      levels: a.levels,
      channels: a.channels,
      active: Boolean(a.active),
      lastTriggeredLevel: a.last_triggered_level ?? null,
      triggeredLevels: a.triggered_levels,
      createdAt: iso(a.created_at),
      updatedAt: iso(a.updated_at),
    })),
    tradingPlans: plans.map((p) => ({
      id: String(p.id),
      variant: String(p.variant),
      accountType: String(p.account_type),
      tradingCapital: String(p.trading_capital),
      lossLimit: String(p.loss_limit),
      riskStyle: String(p.risk_style),
      result: p.result ?? null,
      createdAt: iso(p.created_at),
    })),
  });
}));

// ---------------------------------------------------------------------------
// 3. Daftar user (userId HMAC opaque)
// ---------------------------------------------------------------------------

const userListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  q: z.string().trim().toLowerCase().regex(USER_ID_PATTERN).optional(),
  sort: z.enum(["recent", "active", "analyses", "cost"]).default("recent"),
});

const USER_SORT: Record<z.infer<typeof userListQuery>["sort"], SQL> = {
  recent: sql`u.created_at desc`,
  active: sql`s.last_analysis_at desc nulls last`,
  analyses: sql`coalesce(s.analyses, 0) desc`,
  cost: sql`coalesce(s.cost_usd, 0) desc`,
};

function creditView(row: Row | undefined, mode: (typeof TP_MODES)[number]) {
  if (!row) return null;
  const inPeriod = new Date(String(iso(row.resets_at))).getTime() > Date.now();
  const allowance = num(row.allowance);
  const consumed = inPeriod ? num(row.consumed) : 0;
  return {
    mode,
    allowance,
    consumed,
    remaining: Math.max(allowance - consumed, 0),
    resetsAt: iso(row.resets_at),
    inPeriod,
  };
}

router.get("/admin/trade-pilot/users", requireAdmin, handler(async (req, res) => {
  const parsed = userListQuery.safeParse(
    Object.fromEntries(Object.entries(req.query).filter(([, v]) => v !== "")),
  );
  if (!parsed.success) return sendInvalid(res);
  const f = parsed.data;
  const where = f.q ? sql`u.user_id like ${`${f.q}%`}` : sql`true`;

  const [countRow] = await rows(sql`select count(*) as total from tp_user u where ${where}`);
  const items = await rows(sql`
    with s as (
      select user_id, count(*) as analyses, coalesce(sum(estimated_cost_usd), 0) as cost_usd, max(analyzed_at) as last_analysis_at
      from tp_analysis group by user_id
    )
    select u.user_id, u.first_seen_mode, u.created_at, u.bootstrapped_at,
      coalesce(s.analyses, 0) as analyses, coalesce(s.cost_usd, 0) as cost_usd, s.last_analysis_at,
      (select count(*) from tp_price_alert p where p.user_id = u.user_id and p.active) as active_alerts
    from tp_user u left join s on s.user_id = u.user_id
    where ${where}
    order by ${USER_SORT[f.sort]}
    limit ${f.limit} offset ${(f.page - 1) * f.limit}
  `);

  const ids = items.map((r) => String(r.user_id));
  const balances = ids.length
    ? await rows(sql`select * from tp_credit_balance where user_id in (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`)
    : [];

  res.json({
    page: f.page,
    limit: f.limit,
    total: num(countRow?.total),
    items: items.map((r) => {
      const userId = String(r.user_id);
      return {
        userId,
        firstSeenMode: String(r.first_seen_mode),
        createdAt: iso(r.created_at),
        bootstrappedAt: iso(r.bootstrapped_at),
        analyses: num(r.analyses),
        costUsd: num(r.cost_usd),
        lastAnalysisAt: iso(r.last_analysis_at),
        activeAlerts: num(r.active_alerts),
        credits: Object.fromEntries(TP_MODES.map((mode) => [
          mode,
          creditView(balances.find((b) => b.user_id === userId && b.mode === mode), mode),
        ])),
      };
    }),
  });
}));

// Cari nasabah via email (blind index). Email dikirim lewat body POST supaya
// tidak masuk URL/log akses, tidak disimpan, dan tidak dicatat di log.
// Setiap pencarian masuk tp_admin_audit (admin, waktu, userId hasil).
const lookupBuckets = new Map<number, { count: number; resetsAt: number }>();
const LOOKUP_LIMIT_PER_MINUTE = 30;

function consumeLookup(adminId: number) {
  const now = Date.now();
  const bucket = lookupBuckets.get(adminId);
  if (!bucket || bucket.resetsAt <= now) {
    lookupBuckets.set(adminId, { count: 1, resetsAt: now + 60_000 });
    return true;
  }
  if (bucket.count >= LOOKUP_LIMIT_PER_MINUTE) return false;
  bucket.count += 1;
  return true;
}

router.post("/admin/trade-pilot/users/lookup", requireAdmin, handler(async (req, res) => {
  const parsed = z.object({ email: z.string().trim().min(3).max(254).email() }).safeParse(req.body);
  if (!parsed.success) return sendInvalid(res);
  if (!isTradePilotEmailLookupConfigured()) {
    res.status(503).json({ error: "lookup_not_configured" });
    return;
  }
  const adminId = Number(req.userId);
  if (!consumeLookup(adminId)) {
    res.setHeader("Retry-After", "60");
    res.status(429).json({ error: "rate_limited" });
    return;
  }

  const userId = tradePilotUserIdFromEmail(parsed.data.email)!;
  const [user] = await rows(sql`select user_id from tp_user where user_id = ${userId}`);
  await db.insert(tradePilotAdminAudit).values({
    adminUserId: adminId,
    action: "email_lookup",
    targetUserId: user ? userId : null,
    found: Boolean(user),
    requestId: typeof req.id === "string" || typeof req.id === "number" ? String(req.id) : null,
  });

  res.setHeader("Cache-Control", "no-store");
  res.json(user ? { found: true, userId } : { found: false, userId: null });
}));

router.get("/admin/trade-pilot/users/:userId", requireAdmin, handler(async (req, res) => {
  const userId = String(req.params.userId ?? "").toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(userId)) return sendInvalid(res);

  const [user] = await rows(sql`select * from tp_user where user_id = ${userId}`);
  if (!user) {
    res.status(404).json({ error: "not_found" });
    return;
  }

  const [balances, stats, byStatus, recent, alerts, [plans]] = await Promise.all([
    rows(sql`select * from tp_credit_balance where user_id = ${userId}`),
    rows(sql`select mode, count(*) as analyses, coalesce(sum(estimated_cost_usd), 0) as cost_usd,
        coalesce(sum(total_tokens), 0) as tokens, max(analyzed_at) as last_analysis_at
      from tp_analysis where user_id = ${userId} group by mode`),
    rows(sql`select status as key, count(*) as count from tp_analysis where user_id = ${userId} group by 1 order by 2 desc`),
    rows(sql`select id, mode, instrument_label, timeframe_label, direction, status, analyzed_at, estimated_cost_usd, ai_cache_hit
      from tp_analysis where user_id = ${userId} order by analyzed_at desc limit 20`),
    rows(sql`select p.id, p.analysis_id, p.mode, p.side, p.active, p.last_triggered_level, p.triggered_levels, p.updated_at,
        a.instrument_label, a.timeframe_label
      from tp_price_alert p join tp_analysis a on a.id = p.analysis_id
      where p.user_id = ${userId} order by p.updated_at desc limit 20`),
    rows(sql`select count(*) as count from tp_trading_plan where user_id = ${userId}`),
  ]);

  res.json({
    userId,
    firstSeenMode: String(user.first_seen_mode),
    createdAt: iso(user.created_at),
    bootstrappedAt: iso(user.bootstrapped_at),
    credits: TP_MODES.map((mode) => creditView(balances.find((b) => b.mode === mode), mode)).filter(Boolean),
    statsByMode: stats.map((r) => ({
      mode: String(r.mode),
      analyses: num(r.analyses),
      costUsd: num(r.cost_usd),
      tokens: num(r.tokens),
      lastAnalysisAt: iso(r.last_analysis_at),
    })),
    byStatus: byStatus.map((r) => ({ key: String(r.key), count: num(r.count) })),
    tradingPlans: num(plans?.count),
    recentAnalyses: recent.map((r) => ({
      id: String(r.id),
      mode: String(r.mode),
      instrumentLabel: String(r.instrument_label),
      timeframeLabel: String(r.timeframe_label),
      direction: String(r.direction),
      status: String(r.status),
      analyzedAt: iso(r.analyzed_at),
      estimatedCostUsd: num(r.estimated_cost_usd),
      aiCacheHit: Boolean(r.ai_cache_hit),
    })),
    alerts: alerts.map((a) => ({
      id: String(a.id),
      analysisId: String(a.analysis_id),
      mode: String(a.mode),
      side: String(a.side),
      active: Boolean(a.active),
      lastTriggeredLevel: a.last_triggered_level ?? null,
      triggeredLevels: a.triggered_levels,
      updatedAt: iso(a.updated_at),
      instrumentLabel: String(a.instrument_label),
      timeframeLabel: String(a.timeframe_label),
    })),
  });
}));

// Penyesuaian kredit (khusus super_admin) untuk periode berjalan.
const creditAdjustmentBody = z.discriminatedUnion("action", [
  z.object({ action: z.literal("reset") }),
  z.object({ action: z.literal("set"), remaining: z.number().int().min(0).max(1000) }),
]);

router.post("/admin/trade-pilot/users/:userId/credits/:mode", requireSuperAdmin, handler(async (req, res) => {
  const userId = String(req.params.userId ?? "").toLowerCase();
  const mode = z.enum(TP_MODES).safeParse(req.params.mode);
  const body = creditAdjustmentBody.safeParse(req.body);
  if (!/^[a-f0-9]{64}$/.test(userId) || !mode.success || !body.success) return sendInvalid(res);

  const [user] = await rows(sql`select user_id from tp_user where user_id = ${userId}`);
  if (!user) {
    res.status(404).json({ error: "not_found" });
    return;
  }

  // Perubahan kredit + audit dalam satu transaksi: gagal audit = kredit batal berubah.
  const result = await adjustTradePilotCredit(
    userId,
    mode.data,
    body.data.action === "reset" ? { type: "reset" } : { type: "set", remaining: body.data.remaining },
    async (tx, change) => {
      await tx.insert(tradePilotAdminAudit).values({
        adminUserId: Number(req.userId),
        action: body.data.action === "reset" ? "credit_reset" : "credit_set",
        targetUserId: userId,
        found: true,
        requestId: typeof req.id === "string" || typeof req.id === "number" ? String(req.id) : null,
        details: {
          mode: mode.data,
          before: { allowance: change.before.allowance, consumed: change.before.consumed },
          after: { allowance: change.after.allowance, consumed: change.after.consumed },
          ...(body.data.action === "set" ? { remaining: body.data.remaining } : {}),
        },
      });
    },
  );

  res.json({
    credit: {
      mode: mode.data,
      allowance: result.after.allowance,
      consumed: result.after.consumed,
      remaining: result.after.remaining,
      resetsAt: result.after.resetsAt,
      inPeriod: true,
    },
  });
}));

// ---------------------------------------------------------------------------
// 4. Kredit & alert
// ---------------------------------------------------------------------------

router.get("/admin/trade-pilot/credits-alerts", requireAdmin, handler(async (req, res) => {
  const parsed = z.object({
    alertStatus: z.enum(["active", "triggered", "all"]).default("active"),
  }).safeParse(req.query);
  if (!parsed.success) return sendInvalid(res);

  const summary = await rows(sql`
    select mode,
      count(*) filter (where resets_at > now()) as users_in_period,
      coalesce(sum(consumed) filter (where resets_at > now()), 0) as consumed,
      coalesce(sum(allowance) filter (where resets_at > now()), 0) as allowance,
      count(*) filter (where resets_at > now() and consumed >= allowance) as exhausted,
      count(*) filter (where resets_at > now() and consumed > 0 and consumed < allowance) as partially_used
    from tp_credit_balance group by mode
  `);

  const exhausted = await rows(sql`
    select user_id, mode, allowance, consumed, resets_at, updated_at
    from tp_credit_balance
    where resets_at > now() and consumed >= allowance
    order by updated_at desc limit 50
  `);

  const alertWhere = parsed.data.alertStatus === "active"
    ? sql`p.active`
    : parsed.data.alertStatus === "triggered"
      ? sql`p.triggered_levels <> '{}'::jsonb`
      : sql`true`;
  const alerts = await rows(sql`
    select p.id, p.user_id, p.analysis_id, p.mode, p.side, p.levels, p.channels, p.active,
      p.last_triggered_level, p.triggered_levels, p.created_at, p.updated_at,
      a.instrument_label, a.timeframe_label, a.status as analysis_status
    from tp_price_alert p join tp_analysis a on a.id = p.analysis_id
    where ${alertWhere}
    order by p.updated_at desc limit 100
  `);

  res.json({
    policies: TP_MODES.map((mode) => {
      const row = summary.find((r) => r.mode === mode);
      return {
        mode,
        ...tradePilotCreditPolicy(mode),
        usersInPeriod: num(row?.users_in_period),
        consumed: num(row?.consumed),
        allowanceTotal: num(row?.allowance),
        exhausted: num(row?.exhausted),
        partiallyUsed: num(row?.partially_used),
      };
    }),
    exhausted: exhausted.map((r) => ({
      userId: String(r.user_id),
      mode: String(r.mode),
      allowance: num(r.allowance),
      consumed: num(r.consumed),
      resetsAt: iso(r.resets_at),
      updatedAt: iso(r.updated_at),
    })),
    alerts: alerts.map((a) => ({
      id: String(a.id),
      userId: String(a.user_id),
      analysisId: String(a.analysis_id),
      mode: String(a.mode),
      side: String(a.side),
      levels: a.levels,
      channels: a.channels,
      active: Boolean(a.active),
      lastTriggeredLevel: a.last_triggered_level ?? null,
      triggeredLevels: a.triggered_levels,
      createdAt: iso(a.created_at),
      updatedAt: iso(a.updated_at),
      instrumentLabel: String(a.instrument_label),
      timeframeLabel: String(a.timeframe_label),
      analysisStatus: String(a.analysis_status),
    })),
  });
}));


// ---------------------------------------------------------------------------
// 5. Log audit admin
// ---------------------------------------------------------------------------

async function audit(
  req: AuthRequest,
  action: string,
  details: Record<string, unknown>,
  targetUserId: string | null = null,
) {
  await db.insert(tradePilotAdminAudit).values({
    adminUserId: Number(req.userId),
    action,
    targetUserId,
    found: true,
    requestId: typeof req.id === "string" || typeof req.id === "number" ? String(req.id) : null,
    details,
  });
}

const AUDIT_ACTIONS = [
  "email_lookup",
  "credit_reset",
  "credit_set",
  "settings_quota",
  "settings_availability",
  "staff_create",
  "staff_role",
  "staff_password",
] as const;

router.get("/admin/trade-pilot/audit", requireAdmin, handler(async (req, res) => {
  const parsed = z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    action: z.enum(AUDIT_ACTIONS).optional(),
    adminUserId: z.coerce.number().int().positive().optional(),
    targetUserId: z.string().trim().toLowerCase().regex(USER_ID_PATTERN).optional(),
  }).safeParse(Object.fromEntries(Object.entries(req.query).filter(([, v]) => v !== "")));
  if (!parsed.success) return sendInvalid(res);
  const f = parsed.data;

  const conditions: SQL[] = [sql`true`];
  if (f.action) conditions.push(sql`a.action = ${f.action}`);
  if (f.adminUserId) conditions.push(sql`a.admin_user_id = ${f.adminUserId}`);
  if (f.targetUserId) conditions.push(sql`a.target_user_id like ${`${f.targetUserId}%`}`);
  const where = sql.join(conditions, sql` and `);

  const [countRow] = await rows(sql`select count(*) as total from tp_admin_audit a where ${where}`);
  const items = await rows(sql`
    select a.id, a.admin_user_id, a.action, a.target_user_id, a.found, a.request_id, a.details, a.created_at,
      u.email as admin_email, u.display_name as admin_name, u.role as admin_role
    from tp_admin_audit a left join users u on u.id = a.admin_user_id
    where ${where}
    order by a.created_at desc, a.id desc
    limit ${f.limit} offset ${(f.page - 1) * f.limit}
  `);
  const admins = await rows(sql`
    select distinct u.id, u.email, u.display_name from tp_admin_audit a join users u on u.id = a.admin_user_id
    order by u.email limit 200
  `);

  res.json({
    page: f.page,
    limit: f.limit,
    total: num(countRow?.total),
    admins: admins.map((r) => ({ id: num(r.id), email: String(r.email), displayName: String(r.display_name) })),
    items: items.map((r) => ({
      id: num(r.id),
      action: String(r.action),
      adminUserId: num(r.admin_user_id),
      adminEmail: r.admin_email === null ? null : String(r.admin_email),
      adminName: r.admin_name === null ? null : String(r.admin_name),
      adminRole: r.admin_role === null ? null : String(r.admin_role),
      targetUserId: r.target_user_id === null ? null : String(r.target_user_id),
      found: Boolean(r.found),
      requestId: r.request_id === null ? null : String(r.request_id),
      details: r.details ?? null,
      createdAt: iso(r.created_at),
    })),
  });
}));

// ---------------------------------------------------------------------------
// 6. Pengaturan: kuota standar & kill switch analisis
// ---------------------------------------------------------------------------

async function settingMeta(key: "quota" | "availability") {
  const [row] = await rows(sql`
    select s.updated_at, u.email from tp_settings s left join users u on u.id = s.updated_by where s.key = ${key}
  `);
  return row ? { updatedAt: iso(row.updated_at), updatedBy: row.email === null ? null : String(row.email) } : null;
}

router.get("/admin/trade-pilot/settings", requireAdmin, handler(async (_req, res) => {
  await refreshTradePilotSettingsIfStale(true);
  const [quotaMeta, availabilityMeta] = await Promise.all([settingMeta("quota"), settingMeta("availability")]);
  res.json({
    quota: {
      current: currentQuotaSettings(),
      defaults: defaultQuotaSettings(),
      custom: quotaMeta !== null,
      meta: quotaMeta,
    },
    availability: {
      current: currentAvailabilitySettings(),
      meta: availabilityMeta,
    },
  });
}));

router.put("/admin/trade-pilot/settings/quota", requireSuperAdmin, handler(async (req, res) => {
  const parsed = quotaSettingsSchema.extend({ applyToCurrentPeriod: z.boolean().default(false) }).safeParse(req.body);
  if (!parsed.success) return sendInvalid(res);
  const { applyToCurrentPeriod, ...next } = parsed.data;

  await refreshTradePilotSettingsIfStale(true);
  const before = currentQuotaSettings();
  await saveTradePilotSetting("quota", next, Number(req.userId));

  // Opsional: terapkan ke periode berjalan hanya untuk saldo yang masih
  // memakai kuota standar lama (penyesuaian manual per pengguna tidak ditimpa).
  const applied: Record<string, number> = {};
  if (applyToCurrentPeriod) {
    for (const mode of TP_MODES) {
      if (before[mode].allowance === next[mode].allowance) continue;
      const updated = await rows(sql`
        update tp_credit_balance set allowance = ${next[mode].allowance}, updated_at = now()
        where mode = ${mode} and resets_at > now() and allowance = ${before[mode].allowance}
        returning user_id
      `);
      applied[mode] = updated.length;
    }
  }

  await audit(req, "settings_quota", { before, after: next, applyToCurrentPeriod, applied });
  res.json({ quota: currentQuotaSettings(), applied });
}));

router.put("/admin/trade-pilot/settings/availability", requireSuperAdmin, handler(async (req, res) => {
  const parsed = availabilitySettingsSchema.safeParse(req.body);
  if (!parsed.success) return sendInvalid(res);
  await refreshTradePilotSettingsIfStale(true);
  const before = currentAvailabilitySettings();
  await saveTradePilotSetting("availability", parsed.data, Number(req.userId));
  await audit(req, "settings_availability", { before, after: parsed.data });
  res.json({ availability: currentAvailabilitySettings() });
}));

// ---------------------------------------------------------------------------
// 7. Akun admin (khusus super_admin)
// ---------------------------------------------------------------------------

// Sama dengan SUPER_ADMIN_GUARD_LOCK di routes/admin.ts supaya serial dengan endpoint lama.
const SUPER_ADMIN_GUARD_LOCK = 0x5a5ad317;
const STAFF_ROLES = ["admin", "super_admin"] as const;
const PASSWORD_MIN = 8;

router.get("/admin/trade-pilot/staff", requireSuperAdmin, handler(async (_req, res) => {
  const staff = await rows(sql`
    select u.id, u.email, u.display_name, u.role, u.created_at, u.password_hash is not null as has_password,
      (select max(s.created_at) from sessions s where s.user_id = u.id) as last_session_at
    from users u where u.role in ('admin', 'super_admin')
    order by case when u.role = 'super_admin' then 0 else 1 end, u.email
  `);
  res.json({
    items: staff.map((r) => ({
      id: num(r.id),
      email: String(r.email),
      displayName: String(r.display_name),
      role: String(r.role),
      createdAt: iso(r.created_at),
      hasPassword: Boolean(r.has_password),
      lastSessionAt: iso(r.last_session_at),
    })),
  });
}));

router.post("/admin/trade-pilot/staff", requireSuperAdmin, handler(async (req, res) => {
  const parsed = z.object({
    email: z.string().trim().toLowerCase().email().max(254),
    displayName: z.string().trim().min(1).max(80).optional(),
    role: z.enum(STAFF_ROLES),
    password: z.string().min(PASSWORD_MIN).max(200).optional(),
  }).safeParse(req.body);
  if (!parsed.success) return sendInvalid(res);
  const body = parsed.data;

  const [existing] = await db.select({ id: users.id, role: users.role }).from(users).where(eq(users.email, body.email)).limit(1);
  if (existing) {
    if (existing.role === "admin" || existing.role === "super_admin") {
      res.status(409).json({ error: "already_staff" });
      return;
    }
    await db.update(users).set({ role: body.role, updatedAt: new Date() }).where(eq(users.id, existing.id));
    await audit(req, "staff_create", { staffId: existing.id, email: body.email, fromRole: existing.role, toRole: body.role, created: false });
    res.status(200).json({ id: existing.id, created: false });
    return;
  }

  if (!body.password) {
    res.status(400).json({ error: "password_required" });
    return;
  }
  const [created] = await db.insert(users).values({
    email: body.email,
    passwordHash: await bcrypt.hash(body.password, 12),
    displayName: body.displayName ?? body.email.split("@")[0]!,
    role: body.role,
  }).returning({ id: users.id });
  await audit(req, "staff_create", { staffId: created!.id, email: body.email, toRole: body.role, created: true });
  res.status(201).json({ id: created!.id, created: true });
}));

router.patch("/admin/trade-pilot/staff/:id/role", requireSuperAdmin, handler(async (req, res) => {
  const id = Number(req.params.id);
  const parsed = z.object({ role: z.enum(["user", "admin", "super_admin"]) }).safeParse(req.body);
  if (!Number.isInteger(id) || id <= 0 || !parsed.success) return sendInvalid(res);
  if (id === Number(req.userId)) {
    res.status(400).json({ error: "cannot_change_self" });
    return;
  }
  const role = parsed.data.role;

  const outcome = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${SUPER_ADMIN_GUARD_LOCK}::int, 0::int)`);
    const [target] = await tx.select({ id: users.id, role: users.role, email: users.email }).from(users).where(eq(users.id, id)).limit(1);
    if (!target) return { kind: "not_found" as const };
    if (target.role === "super_admin" && role !== "super_admin") {
      const [{ c }] = await tx.select({ c: count() }).from(users).where(eq(users.role, "super_admin"));
      if (Number(c) <= 1) return { kind: "last_super_admin" as const };
    }
    await tx.update(users).set({ role, updatedAt: new Date() }).where(eq(users.id, id));
    // Akses dicabut: akhiri semua sesi supaya tidak ada sesi staf yang tertinggal.
    if (role === "user") await tx.delete(sessions).where(eq(sessions.userId, id));
    return { kind: "ok" as const, from: target.role, email: target.email };
  });

  if (outcome.kind === "not_found") {
    res.status(404).json({ error: "not_found" });
    return;
  }
  if (outcome.kind === "last_super_admin") {
    res.status(400).json({ error: "last_super_admin" });
    return;
  }
  await audit(req, "staff_role", { staffId: id, email: outcome.email, fromRole: outcome.from, toRole: role });
  res.json({ id, role });
}));

router.post("/admin/trade-pilot/staff/:id/password", requireSuperAdmin, handler(async (req, res) => {
  const id = Number(req.params.id);
  const parsed = z.object({ newPassword: z.string().min(PASSWORD_MIN).max(200) }).safeParse(req.body);
  if (!Number.isInteger(id) || id <= 0 || !parsed.success) return sendInvalid(res);

  const [target] = await db.select({ id: users.id, email: users.email, role: users.role })
    .from(users)
    .where(and(eq(users.id, id), inArray(users.role, ["admin", "super_admin"])))
    .limit(1);
  if (!target) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  await db.update(users)
    .set({ passwordHash: await bcrypt.hash(parsed.data.newPassword, 12), updatedAt: new Date() })
    .where(eq(users.id, id));
  // Paksa login ulang di semua perangkat staf tersebut (kecuali sesi super_admin yang sedang reset dirinya sendiri).
  if (id !== Number(req.userId)) await db.delete(sessions).where(eq(sessions.userId, id));
  await audit(req, "staff_password", { staffId: id, email: target.email });
  res.json({ id, reset: true });
}));

export default router;
