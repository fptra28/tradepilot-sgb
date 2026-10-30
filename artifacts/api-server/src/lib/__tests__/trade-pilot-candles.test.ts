import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../historical", async (importActual) => {
  const actual = await importActual<typeof import("../historical")>();
  return {
    ...actual,
    getCandleSnapshot: vi.fn(),
  };
});

import { getCandleSnapshot } from "../historical";
import { loadTradePilotCandles } from "../trade-pilot";

const candle = (index: number) => ({
  date: new Date(Date.UTC(2026, 9, 27, 0, index)).toISOString(),
  open: 4100 + index,
  high: 4102 + index,
  low: 4098 + index,
  close: 4101 + index,
});

beforeEach(() => {
  vi.mocked(getCandleSnapshot).mockReset();
});

describe("loadTradePilotCandles", () => {
  it("maps public IDs to the market engine and caps the response at 300 bars", async () => {
    vi.mocked(getCandleSnapshot).mockResolvedValue({
      candles: Array.from({ length: 305 }, (_, index) => candle(index)),
      sourceFetchedAt: "2026-10-27T03:00:00.000Z",
      sourceMaxAgeMs: 300_000,
      isStale: false,
      staleReason: null,
    });

    const result = await loadTradePilotCandles("gold", "60");

    expect(getCandleSnapshot).toHaveBeenCalledWith("XAU/USD", "1h");
    expect(result).toMatchObject({
      instrumentId: "gold",
      instrumentLabel: "XAU/USD",
      timeframe: "60",
      timeframeLabel: "1h",
      candleTimeframe: "1h",
      isStale: false,
    });
    expect(result.candles).toHaveLength(300);
    expect(result.candles[0]?.open).toBe(4105);
  });

  it("makes the weekly candle source explicit for the monthly analysis option", async () => {
    vi.mocked(getCandleSnapshot).mockResolvedValue({
      candles: [candle(0)],
      sourceFetchedAt: "2026-10-27T03:00:00.000Z",
      sourceMaxAgeMs: 3_600_000,
      isStale: true,
      staleReason: "source_age",
    });

    const result = await loadTradePilotCandles("nikkei", "M");

    expect(getCandleSnapshot).toHaveBeenCalledWith("NIKKEI", "1W");
    expect(result.timeframeLabel).toBe("1M");
    expect(result.candleTimeframe).toBe("1W");
    expect(result.staleReason).toBe("source_age");
  });
});
