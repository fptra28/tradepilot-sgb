export type TradePilotLanguage = "id" | "en";

const messages = {
  id: {
    invalid_request: "Parameter permintaan tidak valid.",
    unauthorized: "Kredensial layanan tidak valid.",
    access_denied: "Akses ke mode akun ini ditolak.",
    not_found: "Data Trade Pilot tidak ditemukan.",
    idempotency_conflict: "Idempotency key sudah dipakai untuk permintaan yang berbeda.",
    insufficient_credit: "Kredit tidak cukup.",
    rate_limited: "Terlalu banyak permintaan analisis. Coba lagi sebentar lagi.",
    upstream_unavailable: "Analisis Trade Pilot sedang tidak tersedia sementara.",
    analysis_paused: "Analisis Trade Pilot sedang dinonaktifkan sementara oleh admin.",
    internal_error: "Analisis Trade Pilot sedang tidak tersedia sementara.",
  },
  en: {
    invalid_request: "The request parameters are invalid.",
    unauthorized: "The service credentials are invalid.",
    access_denied: "Access to this account mode was denied.",
    not_found: "The Trade Pilot resource was not found.",
    idempotency_conflict: "The idempotency key was already used for a different request.",
    insufficient_credit: "Insufficient credit.",
    rate_limited: "Too many analysis requests. Please try again shortly.",
    upstream_unavailable: "Trade Pilot analysis is temporarily unavailable.",
    analysis_paused: "Trade Pilot analysis has been temporarily paused by an administrator.",
    internal_error: "Trade Pilot analysis is temporarily unavailable.",
  },
} as const;

export type TradePilotErrorCode = keyof typeof messages.id;

export function tradePilotLanguage(acceptLanguage: string | undefined): TradePilotLanguage {
  return acceptLanguage?.trim().toLowerCase().startsWith("en") ? "en" : "id";
}

export function tradePilotMessage(code: TradePilotErrorCode, language: TradePilotLanguage): string {
  return messages[language][code];
}

/**
 * Compliance disclaimer attached to every analysis response.
 * NOTE: wording must be reviewed by the compliance team against BAPPEBTI
 * rules before production use.
 */
export const TRADE_PILOT_DISCLAIMER: Record<TradePilotLanguage, string> = {
  id: "Hasil analisis TradePilot bersifat informasi dan edukasi, bukan ajakan, rekomendasi, atau saran untuk melakukan transaksi. Perdagangan berjangka mengandung risiko tinggi dan dapat mengakibatkan kerugian melebihi dana awal. Setiap keputusan transaksi sepenuhnya menjadi tanggung jawab nasabah.",
  en: "TradePilot analysis is provided for information and education only and is not a solicitation, recommendation, or advice to trade. Futures trading carries a high level of risk and losses may exceed your initial funds. Every trading decision is solely the customer's responsibility.",
};

const conditionLabels: Record<TradePilotLanguage, Record<string, string>> = {
  id: { trending_up: "tren naik", trending_down: "tren turun", ranging: "sideways", volatile: "volatil" },
  en: { trending_up: "trending up", trending_down: "trending down", ranging: "ranging", volatile: "volatile" },
};
const riskLabels: Record<TradePilotLanguage, Record<string, string>> = {
  id: { low: "rendah", medium: "sedang", high: "tinggi" },
  en: { low: "low", medium: "medium", high: "high" },
};
const directionLabels: Record<TradePilotLanguage, Record<string, string>> = {
  id: { bullish: "cenderung naik (bullish)", bearish: "cenderung turun (bearish)", neutral: "netral" },
  en: { bullish: "bullish", bearish: "bearish", neutral: "neutral" },
};

export type MarketContextInput = {
  instrumentLabel: string;
  timeframeLabel: string;
  direction: string;
  marketCondition?: string;
  riskLevel?: string;
  indicatorTally: { buy: number; sell: number; neutral: number };
  /** AI narrative (Indonesian) used as the ID description when present. */
  narrativeId?: string;
  uncertaintyId?: string;
};

export type MarketContext = { title: string; description: string; note: string };

/** Builds the bilingual `marketContext`. The AI narrates in Indonesian; the
 *  English text is composed from the same structured fields. */
export function buildMarketContext(input: MarketContextInput): Record<TradePilotLanguage, MarketContext> {
  const { buy, sell, neutral } = input.indicatorTally;
  const cond = (lang: TradePilotLanguage) =>
    input.marketCondition ? conditionLabels[lang][input.marketCondition] ?? input.marketCondition : null;
  const risk = (lang: TradePilotLanguage) =>
    input.riskLevel ? riskLabels[lang][input.riskLevel] ?? input.riskLevel : null;

  const idSummary = [
    `Bias ${input.instrumentLabel} pada timeframe ${input.timeframeLabel} ${directionLabels.id[input.direction] ?? input.direction}.`,
    cond("id") ? `Kondisi pasar: ${cond("id")}.` : "",
    risk("id") ? `Tingkat risiko: ${risk("id")}.` : "",
    `Indikator teknikal: ${buy} beli, ${sell} jual, ${neutral} netral.`,
  ].filter(Boolean).join(" ");
  const enSummary = [
    `${input.instrumentLabel} bias on the ${input.timeframeLabel} timeframe is ${directionLabels.en[input.direction] ?? input.direction}.`,
    cond("en") ? `Market condition: ${cond("en")}.` : "",
    risk("en") ? `Risk level: ${risk("en")}.` : "",
    `Technical indicators: ${buy} buy, ${sell} sell, ${neutral} neutral.`,
  ].filter(Boolean).join(" ");

  return {
    id: {
      title: `Konteks Pasar ${input.instrumentLabel} (${input.timeframeLabel})`,
      description: input.narrativeId?.trim() || idSummary,
      note: input.uncertaintyId?.trim()
        ? `${idSummary} ${input.uncertaintyId.trim()}`
        : idSummary,
    },
    en: {
      title: `${input.instrumentLabel} Market Context (${input.timeframeLabel})`,
      description: enSummary,
      note: "Levels are conditional scenarios, not orders. Re-run the analysis when price moves away from the entry zone or the validity window ends.",
    },
  };
}
