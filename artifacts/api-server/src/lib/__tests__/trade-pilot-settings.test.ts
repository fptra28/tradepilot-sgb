import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({ db: {}, pool: {} }));

import {
  _setTradePilotSettingsCache,
  analysisPauseReason,
  availabilitySettingsSchema,
  currentQuotaSettings,
  defaultAvailabilitySettings,
  quotaSettingsSchema,
} from "../trade-pilot-settings";

const gold1h = { mode: "real", instrumentId: "gold", timeframe: "60" };

describe("analysisPauseReason", () => {
  it("allows analysis with default settings", () => {
    expect(analysisPauseReason(gold1h, defaultAvailabilitySettings())).toBeNull();
  });

  it("pauses everything when the global switch is off", () => {
    expect(analysisPauseReason(gold1h, { ...defaultAvailabilitySettings(), enabled: false })).toBe("global");
  });

  it("pauses only the matching mode, instrument or timeframe", () => {
    const settings = availabilitySettingsSchema.parse({
      enabled: true,
      modes: { demo: false },
      instruments: { brent: false },
      timeframes: { "1": false },
    });
    expect(analysisPauseReason(gold1h, settings)).toBeNull();
    expect(analysisPauseReason({ ...gold1h, mode: "demo" }, settings)).toBe("mode");
    expect(analysisPauseReason({ ...gold1h, instrumentId: "brent" }, settings)).toBe("instrument");
    expect(analysisPauseReason({ ...gold1h, timeframe: "1" }, settings)).toBe("timeframe");
  });
});

describe("settings validation", () => {
  it("rejects unknown toggle keys and invalid quota values", () => {
    expect(availabilitySettingsSchema.safeParse({ enabled: true, instruments: { btc: false } }).success).toBe(false);
    expect(quotaSettingsSchema.safeParse({
      demo: { allowance: -1, period: "daily" },
      real: { allowance: 50, period: "monthly" },
    }).success).toBe(false);
    expect(quotaSettingsSchema.safeParse({
      demo: { allowance: 5, period: "hourly" },
      real: { allowance: 50, period: "monthly" },
    }).success).toBe(false);
  });
});

describe("currentQuotaSettings", () => {
  afterEach(() => {
    _setTradePilotSettingsCache({ quota: null });
    delete process.env.TRADE_PILOT_DEMO_ALLOWANCE;
  });

  it("falls back to env defaults when nothing is stored", () => {
    process.env.TRADE_PILOT_DEMO_ALLOWANCE = "7";
    _setTradePilotSettingsCache({ quota: null });
    expect(currentQuotaSettings().demo).toEqual({ allowance: 7, period: "daily" });
  });

  it("prefers the stored super-admin setting", () => {
    _setTradePilotSettingsCache({
      quota: { demo: { allowance: 10, period: "weekly" }, real: { allowance: 80, period: "monthly" } },
    });
    expect(currentQuotaSettings().demo).toEqual({ allowance: 10, period: "weekly" });
  });
});
