import { z } from "zod";
import { db } from "./db";
import { tradePilotSettings } from "@workspace/db/schema";
import { logger } from "./logger";

/*
 * Pengaturan TradePilot yang bisa diubah super_admin tanpa restart:
 * - quota:        kuota kredit standar per mode (allowance + periode reset).
 * - availability: kill switch analisis (global / per mode / instrumen / timeframe).
 * Disimpan di tp_settings; dibaca lewat cache in-process yang disegarkan
 * paling lama tiap 30 detik (cukup untuk beberapa replika).
 */

export const SETTING_MODES = ["demo", "real"] as const;
export const SETTING_INSTRUMENTS = ["gold", "brent", "hang-seng", "nikkei"] as const;
export const SETTING_TIMEFRAMES = ["1", "5", "15", "30", "60", "240", "D", "W", "M"] as const;
export const SETTING_PERIODS = ["daily", "weekly", "monthly"] as const;

export type CreditPeriod = (typeof SETTING_PERIODS)[number];
type Mode = (typeof SETTING_MODES)[number];

const quotaModeSchema = z.object({
  allowance: z.number().int().min(0).max(10_000),
  period: z.enum(SETTING_PERIODS),
});

export const quotaSettingsSchema = z.object({
  demo: quotaModeSchema,
  real: quotaModeSchema,
});

/** Objek { key?: boolean } untuk daftar kunci tetap (zod v3 tidak punya partialRecord). */
function toggles<const K extends readonly string[]>(keys: K) {
  const shape = Object.fromEntries(keys.map((key) => [key, z.boolean().optional()])) as {
    [P in K[number]]: z.ZodOptional<z.ZodBoolean>;
  };
  return z.object(shape).strict().optional().transform((value) => value ?? ({} as NonNullable<typeof value>));
}

export const availabilitySettingsSchema = z.object({
  enabled: z.boolean(),
  modes: toggles(SETTING_MODES),
  instruments: toggles(SETTING_INSTRUMENTS),
  timeframes: toggles(SETTING_TIMEFRAMES),
  /** Pesan opsional untuk nasabah saat analisis dijeda. */
  message: z.object({
    id: z.string().trim().max(300).nullable().default(null),
    en: z.string().trim().max(300).nullable().default(null),
  }).default({ id: null, en: null }),
});

export type QuotaSettings = z.infer<typeof quotaSettingsSchema>;
export type AvailabilitySettings = z.infer<typeof availabilitySettingsSchema>;

function positiveEnv(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function envPeriod(mode: Mode): CreditPeriod {
  const value = process.env[mode === "demo" ? "TRADE_PILOT_DEMO_CREDIT_PERIOD" : "TRADE_PILOT_REAL_CREDIT_PERIOD"];
  return value === "daily" || value === "weekly" || value === "monthly" ? value : mode === "demo" ? "daily" : "monthly";
}

export function defaultQuotaSettings(): QuotaSettings {
  return {
    demo: { allowance: positiveEnv("TRADE_PILOT_DEMO_ALLOWANCE", 5), period: envPeriod("demo") },
    real: { allowance: positiveEnv("TRADE_PILOT_REAL_ALLOWANCE", 50), period: envPeriod("real") },
  };
}

export function defaultAvailabilitySettings(): AvailabilitySettings {
  return { enabled: true, modes: {}, instruments: {}, timeframes: {}, message: { id: null, en: null } };
}

type Cache = {
  quota: QuotaSettings | null;
  availability: AvailabilitySettings | null;
  loadedAt: number;
};

const CACHE_TTL_MS = 30_000;
let cache: Cache = { quota: null, availability: null, loadedAt: 0 };
let inflight: Promise<void> | null = null;

async function load(): Promise<void> {
  const rows = await db.select().from(tradePilotSettings);
  const quotaRow = rows.find((row) => row.key === "quota");
  const availabilityRow = rows.find((row) => row.key === "availability");
  const quota = quotaRow ? quotaSettingsSchema.safeParse(quotaRow.value) : null;
  const availability = availabilityRow ? availabilitySettingsSchema.safeParse(availabilityRow.value) : null;
  cache = {
    quota: quota?.success ? quota.data : null,
    availability: availability?.success ? availability.data : null,
    loadedAt: Date.now(),
  };
}

/** Segarkan cache bila sudah lewat TTL. Gagal baca DB tidak memblokir (pakai nilai terakhir/env). */
export async function refreshTradePilotSettingsIfStale(force = false): Promise<void> {
  if (!force && Date.now() - cache.loadedAt < CACHE_TTL_MS) return;
  inflight ??= load()
    .catch((error) => {
      logger.warn({ err: error }, "Trade Pilot settings could not be loaded; using cached/env values");
      cache = { ...cache, loadedAt: Date.now() };
    })
    .finally(() => {
      inflight = null;
    });
  await inflight;
}

export function currentQuotaSettings(): QuotaSettings {
  return cache.quota ?? defaultQuotaSettings();
}

export function currentAvailabilitySettings(): AvailabilitySettings {
  return cache.availability ?? defaultAvailabilitySettings();
}

/** Alasan analisis dijeda untuk kombinasi ini, atau null bila boleh jalan. */
export function analysisPauseReason(
  input: { mode: string; instrumentId: string; timeframe: string },
  settings: AvailabilitySettings = currentAvailabilitySettings(),
): "global" | "mode" | "instrument" | "timeframe" | null {
  if (!settings.enabled) return "global";
  if (settings.modes[input.mode as Mode] === false) return "mode";
  if (settings.instruments[input.instrumentId as (typeof SETTING_INSTRUMENTS)[number]] === false) return "instrument";
  if (settings.timeframes[input.timeframe as (typeof SETTING_TIMEFRAMES)[number]] === false) return "timeframe";
  return null;
}

export async function saveTradePilotSetting(
  key: "quota" | "availability",
  value: QuotaSettings | AvailabilitySettings,
  adminUserId: number,
): Promise<void> {
  await db.insert(tradePilotSettings)
    .values({ key, value: value as unknown as Record<string, unknown>, updatedBy: adminUserId, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: tradePilotSettings.key,
      set: { value: value as unknown as Record<string, unknown>, updatedBy: adminUserId, updatedAt: new Date() },
    });
  await refreshTradePilotSettingsIfStale(true);
}

/** Hanya untuk test. */
export function _setTradePilotSettingsCache(next: Partial<Omit<Cache, "loadedAt">>): void {
  cache = { ...cache, ...next, loadedAt: Date.now() };
}
