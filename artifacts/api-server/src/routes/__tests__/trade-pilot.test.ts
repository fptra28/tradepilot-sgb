import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

// ---------------------------------------------------------------------------
// Market data / AI are mocked; everything else (routing, DB, credits,
// idempotency, alerts) runs for real. Database-backed tests run only when
// TRADE_PILOT_TEST_DATABASE=1 and DATABASE_URL points at a database with
// lib/db/migrations/0001 + 0002 applied.
// ---------------------------------------------------------------------------

const aiCalls = { count: 0 };

vi.mock("../../lib/openai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/openai")>();
  return {
    ...actual,
    generateAnalysis: vi.fn(async () => {
      aiCalls.count += 1;
      const side = { riskRewardRatio: "1:2", rationale: "test" };
      return {
        model: "gpt-4o",
        usage: { promptTokens: 1000, completionTokens: 500, totalTokens: 1500, callCount: 1 },
        output: {
          marketCondition: "trending_up",
          riskLevel: "medium",
          confidenceMin: 40,
          confidenceMax: 60,
          tradingBias: "bullish",
          opportunity: "x", risk: "x", baseCase: "x", bullishScenario: "x", bearishScenario: "x",
          keyDriversTechnical: "x", keyDriversFundamental: "x",
          marketContext: "Emas bergerak naik pada 1h didukung pelemahan dolar.",
          invalidationConditions: "x",
          uncertaintyNotes: "Waspadai rilis data inflasi.",
          tradePlan: {
            preferredSide: "buy",
            buy: { ...side, entryZone: "4172", stopLoss: "4152", takeProfit1: "4192", takeProfit2: "4212" },
            sell: { ...side, entryZone: "4148", stopLoss: "4168", takeProfit1: "4128", takeProfit2: "4108" },
          },
        },
      };
    }),
  };
});

vi.mock("../../lib/historical", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/historical")>();
  const indicators = {
    lastClose: 4162.35,
    rsi14: { value: 44.87, signal: "buy" },
    macd: { macd: 1.2345, action: "buy" },
    stochastic: { k: 30.5, signal: "sell" },
    bollinger: { lower: 4100, upper: 4200, signal: "neutral" },
    movingAverages: [
      { type: "EMA", period: 9, value: 4160, signal: "buy" },
      { type: "SMA", period: 50, value: 4150, signal: "buy" },
    ],
  };
  return {
    ...actual,
    getIndicators: vi.fn(async () => indicators),
    formatIndicatorsForPrompt: vi.fn(() => "INDIKATOR TEST"),
    getCandleSnapshot: vi.fn(async () => ({
      candles: Array.from({ length: 50 }, (_, i) => ({
        date: new Date(Date.UTC(2026, 9, 15, 2, 0) + i * 3_600_000).toISOString(),
        open: 4160, high: 4170, low: 4150, close: 4162.35,
      })),
      sourceFetchedAt: new Date().toISOString(),
      sourceMaxAgeMs: 60_000,
      isStale: false,
      staleReason: null,
    })),
  };
});

vi.mock("../../lib/live-prices", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/live-prices")>();
  return { ...actual, getLivePriceFor: vi.fn(async () => 4162.35) };
});

vi.mock("../../lib/news", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/news")>();
  return {
    ...actual,
    getRelevantNews: vi.fn(async () => [
      { id: "n1", title: "Emas menguat", summary: "", source: "Newsmaker.id", url: "https://newsmaker.id/x", publishedAt: "2026-10-15T01:00:00Z" },
      { id: "n2", title: "Gold rises", summary: "", source: "Yahoo Finance", url: "https://finance.yahoo.com/x", publishedAt: "2026-10-15T00:00:00Z" },
    ]),
  };
});

vi.mock("../../lib/calendar", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/calendar")>();
  return { ...actual, getRelevantCalendar: vi.fn(async () => []) };
});

const API_KEY = "test-trade-pilot-api-key";
const originalApiKey = process.env["TRADE_PILOT_API_KEY"];
process.env["TRADE_PILOT_API_KEY"] = API_KEY;
process.env["OPENAI_API_KEY"] ??= "test-openai-key";

const { default: app } = await import("../../app");
const { _resetTradePilotRateLimit } = await import("../../lib/trade-pilot-rate-limit");
const { _clearTradePilotAiCache } = await import("../../lib/trade-pilot");

const withDb = process.env["TRADE_PILOT_TEST_DATABASE"] === "1";
const dbDescribe = withDb ? describe : describe.skip;

let userSeq = 0;
function newUser(): string {
  userSeq += 1;
  return `${Date.now().toString(16)}${userSeq.toString(16)}`.padEnd(64, "0").slice(0, 64);
}

function api(method: "get" | "post" | "put", path: string, userId: string) {
  return request(app)[method](`/v1/trade-pilot${path}`)
    .set("Authorization", `Bearer ${API_KEY}`)
    .set("X-TradePilot-User", userId);
}

beforeAll(() => {
  process.env["TRADE_PILOT_API_KEY"] = API_KEY;
});

beforeEach(() => {
  _resetTradePilotRateLimit();
  _clearTradePilotAiCache();
  aiCalls.count = 0;
});

afterAll(() => {
  if (originalApiKey === undefined) delete process.env["TRADE_PILOT_API_KEY"];
  else process.env["TRADE_PILOT_API_KEY"] = originalApiKey;
});

describe("Trade Pilot v1 conventions", () => {
  it("rejects a missing bearer token with the error envelope and request id", async () => {
    const response = await request(app)
      .get("/v1/trade-pilot/credits?mode=demo")
      .set("X-TradePilot-User", "a".repeat(64));
    expect(response.status).toBe(401);
    expect(response.headers["x-request-id"]).toMatch(/^req_[a-f0-9]{24}$/);
    expect(response.body).toEqual({
      error: { code: "unauthorized", message: "Kredensial layanan tidak valid.", requestId: response.headers["x-request-id"] },
    });
  });

  it("no longer accepts the legacy X-Api-Key header", async () => {
    const response = await request(app)
      .get("/v1/trade-pilot/credits?mode=demo")
      .set("X-Api-Key", API_KEY)
      .set("X-TradePilot-User", "a".repeat(64));
    expect(response.status).toBe(401);
  });

  it("echoes a well-formed incoming X-Request-Id", async () => {
    const response = await request(app)
      .get("/v1/trade-pilot/credits?mode=demo")
      .set("X-Request-Id", "req_from-bff-12345");
    expect(response.headers["x-request-id"]).toBe("req_from-bff-12345");
    expect(response.body.error.requestId).toBe("req_from-bff-12345");
  });

  it("rejects an email as X-TradePilot-User", async () => {
    const response = await api("get", "/credits?mode=demo", "customer@example.test");
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("invalid_request");
  });

  it("localizes errors from Accept-Language", async () => {
    const response = await request(app)
      .get("/v1/trade-pilot/credits?mode=demo")
      .set("Accept-Language", "en-US");
    expect(response.body.error.message).toBe("The service credentials are invalid.");
  });

  it("validates instrument and timeframe", async () => {
    const response = await api("get", "/candles?instrumentId=unknown&timeframe=60", "a".repeat(64));
    expect(response.status).toBe(400);
  });

  it("denies a mode the client-area did not allow", async () => {
    const response = await api("get", "/credits?mode=real", "a".repeat(64)).set("X-Allowed-Modes", "demo");
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("access_denied");
  });

  it("serves the instrument catalogue with contract specs", async () => {
    const response = await api("get", "/instruments", "a".repeat(64));
    expect(response.status).toBe(200);
    expect(response.body.items.map((item: { id: string }) => item.id)).toEqual(["gold", "brent", "hang-seng", "nikkei"]);
    const gold = response.body.items[0];
    expect(gold.tradingViewSymbol).toBe("OANDA:XAUUSD");
    expect(gold.timeframes).toContainEqual({ value: "60", label: "1h" });
    expect(gold.contractSpecs.mini).toMatchObject({ lot: "0.10", margin: "100.00", marginSource: "broker_document" });
  });

  it("serves fundamental news with a language tag", async () => {
    const response = await api("get", "/fundamental-news?instrumentId=gold", "a".repeat(64));
    expect(response.status).toBe(200);
    expect(response.body.items[0]).toEqual({
      id: "n1", title: "Emas menguat", source: "Newsmaker.id", url: "https://newsmaker.id/x",
      publishedAt: "2026-10-15T01:00:00Z", language: "id",
    });
    expect(response.body.items[1].language).toBe("en");
  });
});

dbDescribe("Trade Pilot v1 with database", () => {
  it("bootstraps a new user once, with full balance and empty history", async () => {
    const user = newUser();
    const first = await api("get", "/bootstrap?modes=demo,real", user);
    expect(first.status).toBe(200);
    expect(first.body.isNewUser).toBe(true);
    expect(first.body.credits.demo).toMatchObject({ mode: "demo", allowance: 5, consumed: 0, remaining: 5, source: "api" });
    expect(first.body.credits.real).toMatchObject({ mode: "real", allowance: 50, remaining: 50 });
    expect(first.body.histories).toEqual({ demo: [], real: [] });
    expect(first.body.latestAnalyses).toEqual({ demo: null, real: null });
    expect(first.body.timeframePerformance).toHaveLength(16);
    expect(first.body.timeframePerformance[0]).toMatchObject({ mode: "demo", timeframe: "1m", winRate: null });

    const second = await api("get", "/bootstrap?modes=demo", user);
    expect(second.body.isNewUser).toBe(false);
    expect(Object.keys(second.body.credits)).toEqual(["demo"]);
  });

  it("returns 204 from /analyses/latest before any analysis", async () => {
    const response = await api("get", "/analyses/latest?mode=demo", newUser());
    expect(response.status).toBe(204);
  });

  it("runs an analysis, charges one credit, and replays idempotently", async () => {
    const user = newUser();
    const body = { instrumentId: "gold", mode: "real", timeframe: "60" };
    const created = await api("post", "/analyses", user).set("Idempotency-Key", "key-0001-abcd").send(body);
    expect(created.status).toBe(201);
    const { analysis, credit, history } = created.body;
    expect(analysis).toMatchObject({
      mode: "real", instrumentId: "gold", instrumentLabel: "XAU/USD", timeframe: "60", timeframeLabel: "1h",
      direction: "bullish", marketSentiment: "bullish",
      buyLevels: { entry: "4172.00", stopLoss: "4152.00", takeProfitOne: "4192.00", takeProfitTwo: "4212.00" },
      sellLevels: { entry: "4148.00", stopLoss: "4168.00", takeProfitOne: "4128.00", takeProfitTwo: "4108.00" },
      dataSnapshot: { price: "4162.35", candleCount: 50 },
      source: "api",
    });
    expect(analysis.indicators[0]).toEqual({ group: "oscillator", label: "RSI (14)", value: "44.87", status: "buy", marker: 45 });
    expect(analysis.indicators.at(-1).group).toBe("movingAverage");
    expect(analysis.marketContext.title).toBe("Konteks Pasar XAU/USD (1h)");
    expect(analysis.marketContext.description).toContain("Emas bergerak naik");
    expect(analysis.disclaimer).toMatch(/bukan ajakan/);
    expect(credit).toMatchObject({ mode: "real", allowance: 50, consumed: 1, remaining: 49 });
    expect(history).toMatchObject({ id: analysis.id, status: "still_valid", instrumentLabel: "XAU/USD", timeframeLabel: "1h" });

    const replay = await api("post", "/analyses", user).set("Idempotency-Key", "key-0001-abcd").set("Accept-Language", "en").send(body);
    expect(replay.status).toBe(201);
    expect(replay.body.analysis.id).toBe(analysis.id);
    expect(replay.body.credit.consumed).toBe(1);
    expect(replay.body.analysis.disclaimer).toMatch(/not a solicitation/);
    expect(replay.body.analysis.marketContext.title).toBe("XAU/USD Market Context (1h)");

    const conflict = await api("post", "/analyses", user).set("Idempotency-Key", "key-0001-abcd").send({ ...body, timeframe: "240" });
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe("idempotency_conflict");

    const credits = await api("get", "/credits?mode=real", user);
    expect(credits.body).toMatchObject({ consumed: 1, remaining: 49 });
    // Reset pukul 00:00 WIB (= 17:00 UTC hari sebelumnya), berjangkar pada pertama kali pakai.
    expect(credits.body.resetsAt).toMatch(/T17:00:00.000Z$/);

    const latest = await api("get", "/analyses/latest?mode=real", user);
    expect(latest.status).toBe(200);
    expect(latest.body.id).toBe(analysis.id);

    const detail = await api("get", `/analyses/${analysis.id}`, user);
    expect(detail.status).toBe(200);
    const indicators = await api("get", `/analyses/${analysis.id}/indicators`, user);
    expect(indicators.body.items).toHaveLength(6);

    const foreign = await api("get", `/analyses/${analysis.id}`, newUser());
    expect(foreign.status).toBe(404);
  });

  it("shares AI output across users for the same candle but charges each user", async () => {
    const body = { instrumentId: "brent", mode: "demo", timeframe: "240" };
    const a = await api("post", "/analyses", newUser()).set("Idempotency-Key", "share-0001").send(body);
    const b = await api("post", "/analyses", newUser()).set("Idempotency-Key", "share-0002").send(body);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(aiCalls.count).toBe(1);
    expect(b.body.credit.consumed).toBe(1);
    expect(a.body.analysis.id).not.toBe(b.body.analysis.id);
  });

  it("returns 402 when credit runs out", async () => {
    const user = newUser();
    for (let i = 0; i < 5; i += 1) {
      _resetTradePilotRateLimit();
      const ok = await api("post", "/analyses", user).set("Idempotency-Key", `quota-${i}-xxxx`).send({ instrumentId: "nikkei", mode: "demo", timeframe: "D" });
      expect(ok.status).toBe(201);
    }
    _resetTradePilotRateLimit();
    const denied = await api("post", "/analyses", user).set("Idempotency-Key", "quota-5-xxxx").send({ instrumentId: "nikkei", mode: "demo", timeframe: "D" });
    expect(denied.status).toBe(402);
    expect(denied.body.error.code).toBe("insufficient_credit");
  });

  it("rate limits analyses to 10 per minute per user", async () => {
    process.env["TRADE_PILOT_REAL_ALLOWANCE"] = "100";
    try {
      const user = newUser();
      const statuses: number[] = [];
      for (let i = 0; i < 11; i += 1) {
        const response = await api("post", "/analyses", user).set("Idempotency-Key", `rate-${i}-xxxx`).send({ instrumentId: "gold", mode: "real", timeframe: "15" });
        statuses.push(response.status);
        if (response.status === 429) {
          expect(response.body.error.code).toBe("rate_limited");
          expect(response.headers["retry-after"]).toBeDefined();
        }
      }
      expect(statuses.slice(0, 10).every((status) => status === 201)).toBe(true);
      expect(statuses[10]).toBe(429);
    } finally {
      delete process.env["TRADE_PILOT_REAL_ALLOWANCE"];
    }
  });

  it("lists histories with filters and cursor pagination", async () => {
    const user = newUser();
    for (const [i, tf] of ["60", "240", "60"].entries()) {
      _resetTradePilotRateLimit();
      await api("post", "/analyses", user).set("Idempotency-Key", `hist-${i}-xxxx`).send({ instrumentId: "gold", mode: "real", timeframe: tf });
    }
    const page1 = await api("get", "/histories?mode=real&limit=2", user);
    expect(page1.body.items).toHaveLength(2);
    expect(page1.body.nextCursor).toEqual(expect.any(String));
    const page2 = await api("get", `/histories?mode=real&limit=2&cursor=${page1.body.nextCursor}`, user);
    expect(page2.body.items).toHaveLength(1);
    expect(page2.body.nextCursor).toBeNull();
    const filtered = await api("get", "/histories?mode=real&timeframe=60&status=still_valid", user);
    expect(filtered.body.items).toHaveLength(2);
    const tooMany = await api("get", "/histories?mode=real&limit=101", user);
    expect(tooMany.status).toBe(400);
    const performance = await api("get", "/performance/timeframes?mode=real", user);
    expect(performance.status).toBe(200);
    expect(performance.body.map((row: { timeframe: string }) => row.timeframe)).toEqual(["1m", "5m", "15m", "1h", "4h", "1D", "1W", "1M"]);
  });

  it("enables, reads, and disables a price alert per level", async () => {
    const user = newUser();
    const created = await api("post", "/analyses", user).set("Idempotency-Key", "alert-0001").send({ instrumentId: "gold", mode: "demo", timeframe: "60" });
    const id = created.body.analysis.id;
    const enabled = await api("put", `/analyses/${id}/price-alert`, user).send({ enabled: true, levels: ["entry", "stopLoss"], channels: ["push"] });
    expect(enabled.status).toBe(200);
    expect(enabled.body).toMatchObject({
      analysisId: id, enabled: true, channels: ["push"],
      levels: [
        { level: "entry", status: "pending", side: null, triggeredAt: null },
        { level: "stopLoss", status: "pending", side: null, triggeredAt: null },
      ],
    });
    const disabled = await api("put", `/analyses/${id}/price-alert`, user).send({ enabled: false });
    expect(disabled.body.enabled).toBe(false);
    expect(disabled.body.levels.every((level: { status: string }) => level.status === "cancelled")).toBe(true);
    const read = await api("get", `/analyses/${id}/price-alert`, user);
    expect(read.body.enabled).toBe(false);
  });

  it("marks an alert level as triggered when the evaluator sees price cross it", async () => {
    const user = newUser();
    const created = await api("post", "/analyses", user).set("Idempotency-Key", "trigger-0001").send({ instrumentId: "hang-seng", mode: "demo", timeframe: "60" });
    const id = created.body.analysis.id;
    await api("put", `/analyses/${id}/price-alert`, user).send({ enabled: true, levels: ["entry", "takeProfitOne"], channels: ["push"] });
    const { getLivePriceFor } = await import("../../lib/live-prices");
    const { evaluateTradePilotSignals } = await import("../../lib/trade-pilot");
    vi.mocked(getLivePriceFor).mockResolvedValue(4172.5);
    try {
      await evaluateTradePilotSignals();
    } finally {
      vi.mocked(getLivePriceFor).mockResolvedValue(4162.35);
    }
    const read = await api("get", `/analyses/${id}/price-alert`, user);
    expect(read.body.enabled).toBe(true);
    expect(read.body.levels[0]).toMatchObject({ level: "entry", status: "triggered", side: "buy" });
    expect(read.body.levels[0].triggeredAt).toEqual(expect.any(String));
    expect(read.body.levels[1]).toMatchObject({ level: "takeProfitOne", status: "pending" });
  });

  it("saves and lists trading plans", async () => {
    const user = newUser();
    const created = await api("post", "/analyses", user).set("Idempotency-Key", "plan-0001").send({ instrumentId: "gold", mode: "demo", timeframe: "60" });
    const id = created.body.analysis.id;
    const plan = await api("post", "/trading-plans", user).send({
      analysisId: id, variant: "buy", accountType: "mini", tradingCapital: "1000", lossLimit: 250.5, riskStyle: "50",
      result: { lot: "0.10", margin: "100.00" },
    });
    expect(plan.status).toBe(201);
    expect(plan.body).toMatchObject({ analysisId: id, mode: "demo", variant: "buy", accountType: "mini", tradingCapital: "1000.00", lossLimit: "250.50" });
    const list = await api("get", `/trading-plans?analysisId=${id}`, user);
    expect(list.body.items).toHaveLength(1);
    const foreign = await api("post", "/trading-plans", newUser()).send({
      analysisId: id, variant: "buy", accountType: "mini", tradingCapital: "1000", lossLimit: "100", riskStyle: "25",
    });
    expect(foreign.status).toBe(404);
  });
});
