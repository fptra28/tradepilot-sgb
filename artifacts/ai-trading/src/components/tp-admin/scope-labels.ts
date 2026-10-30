import { useTranslation } from "@/lib/i18n";
import type { AvailabilitySettings, Mode } from "@/lib/tp-admin-api";

export const SCOPE_MODES: Mode[] = ["demo", "real"];
export const SCOPE_INSTRUMENTS = ["gold", "brent", "hang-seng", "nikkei"] as const;
export const SCOPE_TIMEFRAMES = ["1", "5", "15", "30", "60", "240", "D", "W", "M"] as const;
export type ScopeInstrument = (typeof SCOPE_INSTRUMENTS)[number];
export type ScopeTimeframe = (typeof SCOPE_TIMEFRAMES)[number];

/** Label instrumen/timeframe/mode untuk kill switch, dipakai Ringkasan & Pengaturan. */
export function useScopeLabels() {
  const { t } = useTranslation();
  const instrument: Record<ScopeInstrument, string> = {
    gold: t.tpAdmin.availability_instrument_gold,
    brent: t.tpAdmin.availability_instrument_brent,
    "hang-seng": t.tpAdmin.availability_instrument_hang_seng,
    nikkei: t.tpAdmin.availability_instrument_nikkei,
  };
  const timeframe: Record<ScopeTimeframe, string> = {
    "1": t.tpAdmin.availability_timeframe_1,
    "5": t.tpAdmin.availability_timeframe_5,
    "15": t.tpAdmin.availability_timeframe_15,
    "30": t.tpAdmin.availability_timeframe_30,
    "60": t.tpAdmin.availability_timeframe_60,
    "240": t.tpAdmin.availability_timeframe_240,
    D: t.tpAdmin.availability_timeframe_d,
    W: t.tpAdmin.availability_timeframe_w,
    M: t.tpAdmin.availability_timeframe_m,
  };
  const mode = (value: Mode) => (value === "demo" ? t.tpAdmin.mode_demo : t.tpAdmin.mode_real);

  /** Daftar cakupan yang dijeda, berurutan mode → instrumen → timeframe. */
  const pausedScopes = (availability: AvailabilitySettings) => [
    ...SCOPE_MODES.filter((key) => availability.modes[key] === false).map(mode),
    ...SCOPE_INSTRUMENTS.filter((key) => availability.instruments[key] === false).map((key) => instrument[key]),
    ...SCOPE_TIMEFRAMES.filter((key) => availability.timeframes[key] === false).map((key) => timeframe[key]),
  ];

  return { instrument, timeframe, mode, pausedScopes };
}
