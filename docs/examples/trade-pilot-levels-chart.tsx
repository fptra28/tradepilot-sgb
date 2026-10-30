"use client";

/**
 * Chart TradingView (lightweight-charts v5) untuk Trade Pilot v1:
 * candle OHLC + garis Entry / SL / TP1 / TP2 + garis harga live.
 *
 * Dependensi:  npm i lightweight-charts@^5
 * Data candle: GET /api/client-area/trade-pilot/candles (proxy BFF, lihat
 *              docs/TRADE_PILOT_V1_API_REFERENCE.md bagian 9.2).
 * Level:       objek `analysis` dari POST /analyses atau GET /analyses/{id}.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  createChart,
  CandlestickSeries,
  LineStyle,
  TickMarkType,
  type AutoscaleInfo,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";

interface Candle {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

interface LevelSet {
  entry: string;
  stopLoss: string;
  takeProfitOne: string;
  takeProfitTwo: string;
}

export interface TradePilotAnalysisLevels {
  direction: "bullish" | "bearish" | "neutral";
  buyLevels: LevelSet;
  sellLevels: LevelSet;
}

type Side = "buy" | "sell";
type Mode = Side | "both";

interface Props {
  instrumentId: string;
  timeframe: string;
  analysis: TradePilotAnalysisLevels | null;
  /** Default: proxy BFF. API key Trade Pilot tidak boleh sampai ke browser. */
  candlesUrl?: string;
  height?: number;
}

const COLORS = { buyEntry: "#06b6d4", sellEntry: "#f59e0b", sl: "#ef4444", tp: "#10b981" };
const pad2 = (n: number) => String(n).padStart(2, "0");

// lightweight-charts memformat sumbu waktu dengan getter UTC. Paksa waktu lokal
// agar sejajar dengan teks "Diperbarui ... WIB" di sekitar chart.
function formatTick(time: Time, type: TickMarkType): string {
  const d = new Date((time as UTCTimestamp) * 1000);
  if (type === TickMarkType.Year) return String(d.getFullYear());
  if (type === TickMarkType.Month) return `${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
  if (type === TickMarkType.DayOfMonth) return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}`;
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function formatCrosshair(time: Time): string {
  const d = new Date((time as UTCTimestamp) * 1000);
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

interface Line { price: number; title: string; color: string; style: LineStyle }

function buildLines(analysis: TradePilotAnalysisLevels, mode: Mode): Line[] {
  const sides: Side[] = mode === "both" ? ["buy", "sell"] : [mode];
  return sides.flatMap((side) => {
    const set = side === "buy" ? analysis.buyLevels : analysis.sellLevels;
    const prefix = side === "buy" ? "BUY" : "SELL";
    const short = side === "buy" ? "B" : "S";
    const style = side === "buy" ? LineStyle.Solid : LineStyle.Dashed;
    const both = mode === "both";
    const rows: Array<[string, string, string]> = [
      [set.entry, `${prefix} Entry`, side === "buy" ? COLORS.buyEntry : COLORS.sellEntry],
      [set.stopLoss, both ? `${short}-SL` : "SL", COLORS.sl],
      [set.takeProfitOne, both ? `${short}-TP1` : "TP1", COLORS.tp],
      [set.takeProfitTwo, both ? `${short}-TP2` : "TP2", COLORS.tp],
    ];
    return rows.flatMap(([raw, title, color]) => {
      const price = Number(raw); // v1 mengirim harga sebagai string desimal
      return Number.isFinite(price) && price > 0 ? [{ price, title, color, style }] : [];
    });
  });
}

export function TradePilotLevelsChart({
  instrumentId,
  timeframe,
  analysis,
  candlesUrl = "/api/client-area/trade-pilot/candles",
  height = 360,
}: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const linesRef = useRef<IPriceLine[]>([]);
  const [candles, setCandles] = useState<Candle[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>(analysis?.direction === "bearish" ? "sell" : "buy");

  useEffect(() => {
    setMode(analysis?.direction === "bearish" ? "sell" : "buy");
  }, [analysis?.direction]);

  const lines = useMemo(() => (analysis ? buildLines(analysis, mode) : []), [analysis, mode]);

  // 1. Ambil candle.
  useEffect(() => {
    let cancelled = false;
    setCandles(null);
    setError(null);
    const url = `${candlesUrl}?instrumentId=${encodeURIComponent(instrumentId)}&timeframe=${encodeURIComponent(timeframe)}`;
    fetch(url, { credentials: "include" })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
        return body as { candles?: Candle[] };
      })
      .then(({ candles: list }) => {
        if (cancelled) return;
        // Buang candle yang OHLC-nya tidak lengkap; satu nilai null membuat
        // lightweight-charts melempar error dan seluruh chart gagal tampil.
        const clean = (list ?? []).filter((c) =>
          [c.open, c.high, c.low, c.close].every((v) => typeof v === "number" && Number.isFinite(v)),
        );
        if (clean.length === 0) throw new Error("empty");
        setCandles(clean);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [candlesUrl, instrumentId, timeframe]);

  // 2. Bangun chart (gaya gelap seperti TradingView).
  useEffect(() => {
    const host = hostRef.current;
    if (!host || !candles) return;

    // Pastikan semua level ikut masuk skala harga, bukan hanya candle.
    const prices = lines.map((l) => l.price);
    const chart = createChart(host, {
      autoSize: true,
      layout: { background: { color: "transparent" }, textColor: "#cbd5e1", fontSize: 11 },
      grid: {
        vertLines: { color: "rgba(148,163,184,0.08)" },
        horzLines: { color: "rgba(148,163,184,0.08)" },
      },
      rightPriceScale: { borderColor: "#334155" },
      timeScale: {
        borderColor: "#334155",
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 10,
        tickMarkFormatter: formatTick,
      },
      localization: { timeFormatter: formatCrosshair },
      crosshair: { mode: 0 },
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor: COLORS.tp,
      downColor: COLORS.sl,
      borderUpColor: COLORS.tp,
      borderDownColor: COLORS.sl,
      wickUpColor: COLORS.tp,
      wickDownColor: COLORS.sl,
      priceLineColor: "#eab308",
      priceLineStyle: LineStyle.Dotted,
      autoscaleInfoProvider: (original: () => AutoscaleInfo | null): AutoscaleInfo | null => {
        const base = original();
        if (!base || prices.length === 0) return base;
        return {
          ...base,
          priceRange: {
            minValue: Math.min(base.priceRange.minValue, ...prices),
            maxValue: Math.max(base.priceRange.maxValue, ...prices),
          },
        };
      },
    });

    // Waktu harus unik dan naik; jika dua candle sama detiknya, ambil yang terakhir.
    const byTime = new Map<number, Candle>();
    for (const c of candles) byTime.set(Math.floor(new Date(c.date).getTime() / 1000), c);
    series.setData(
      [...byTime.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([t, c]) => ({
          time: t as UTCTimestamp,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
        })),
    );
    chart.timeScale().fitContent();

    chartRef.current = chart;
    seriesRef.current = series;
    return () => {
      linesRef.current = [];
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [candles, lines]);

  // 3. Gambar garis Entry / SL / TP.
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    for (const l of linesRef.current) {
      try { series.removePriceLine(l); } catch { /* sudah hilang */ }
    }
    linesRef.current = lines.map((l) =>
      series.createPriceLine({
        price: l.price,
        color: l.color,
        lineWidth: 2,
        lineStyle: l.style,
        axisLabelVisible: true,
        axisLabelTextColor: "#000000",
        title: l.title,
      }),
    );
  }, [lines, candles]);

  return (
    <div className="relative w-full" style={{ height }}>
      <div ref={hostRef} className="absolute inset-0" style={{ visibility: candles ? "visible" : "hidden" }} />

      {candles && analysis?.direction === "neutral" && (
        <div className="absolute left-2 top-2 z-10 flex gap-1 rounded-lg bg-black/70 p-0.5">
          {(["buy", "sell", "both"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              aria-pressed={mode === m}
              className={`rounded-md px-2 py-1 text-[10px] font-bold ${
                mode === m ? "bg-white text-black" : "text-slate-300"
              }`}
            >
              {m === "both" ? "Keduanya" : m.toUpperCase()}
            </button>
          ))}
        </div>
      )}

      {!candles && !error && (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-slate-400">Memuat chart…</div>
      )}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center px-3 text-center text-xs text-slate-400">
          Data chart tidak tersedia.
        </div>
      )}
    </div>
  );
}
