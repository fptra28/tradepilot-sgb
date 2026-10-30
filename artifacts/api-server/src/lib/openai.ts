import { createHash } from "node:crypto";
import OpenAI from "openai";
import { z } from "zod";
import type { CalendarEvent } from "./calendar";
import type { NewsItem } from "./news";
import { isCryptoInstrument } from "./crypto-instruments";
import { logger } from "./logger";

// Cost-attribution tier (see chat 2026-09-30) — which of 3 separate OpenAI
// API keys a call is billed against, so usage/cost can be cross-checked
// per-tier on OpenAI's own Usage dashboard against our in-app estimate
// (the "Per Segmentasi User" admin panel), not just trusted blind:
//   "free" — covered by a user's free lifetime quota, no matching revenue.
//   "paid" — this specific analysis consumed a purchased credit.
//   "dev"  — admin/super_admin, unlimited + free, pure internal overhead.
// Each tier's key env var falls back to OPENAI_API_KEY when unset, so
// this is a no-op (everything shares one key, exactly as before) until
// the tier-specific keys are actually created in the OpenAI dashboard and
// configured as secrets.
export type AICostTier = "free" | "paid" | "dev";

export type OpenAIOutcome = {
  success: boolean;
  model: string;
  tier: AICostTier;
  error?: string;
};
let openAIOutcomeObserver: ((outcome: OpenAIOutcome) => void | Promise<void>) | null = null;

/** Decouples core AI calls from the optional persisted observability layer. */
export function setOpenAIOutcomeObserver(
  observer: ((outcome: OpenAIOutcome) => void | Promise<void>) | null,
): void {
  openAIOutcomeObserver = observer;
}

function observeOpenAIOutcome(outcome: OpenAIOutcome): void {
  if (!openAIOutcomeObserver) return;
  try {
    void Promise.resolve(openAIOutcomeObserver(outcome)).catch((error) => {
      logger.warn({ err: error }, "OpenAI outcome observer failed");
    });
  } catch (error) {
    logger.warn({ err: error }, "OpenAI outcome observer failed");
  }
}

function buildTierClient(envVar: string): OpenAI {
  return new OpenAI({ apiKey: process.env[envVar] ?? process.env["OPENAI_API_KEY"] });
}

const TIER_CLIENTS: Record<AICostTier, OpenAI> = {
  free: buildTierClient("OPENAI_API_KEY_FREE"),
  paid: buildTierClient("OPENAI_API_KEY_PAID"),
  dev: buildTierClient("OPENAI_API_KEY_DEV"),
};

// Kept as the default/free-tier client — used by anything that doesn't
// care about tier attribution (tests, one-off scripts).
export const openai = TIER_CLIENTS.free;

const TIMEFRAME_VALIDITY: Record<string, number> = {
  "1m": 15 * 60 * 1000,
  "5m": 60 * 60 * 1000,
  "15m": 2.5 * 60 * 60 * 1000,
  "30m": 3.5 * 60 * 60 * 1000,
  "1h": 5 * 60 * 60 * 1000,
  "4h": 18 * 60 * 60 * 1000,
  "1D": 36 * 60 * 60 * 1000,
  "1W": 96 * 60 * 60 * 1000,
};

export function getValidUntil(timeframe: string): Date {
  const durationMs = TIMEFRAME_VALIDITY[timeframe] ?? 60 * 60 * 1000;
  return new Date(Date.now() + durationMs);
}

const MarketCondition = z.enum(["trending_up", "trending_down", "ranging", "volatile"]);
const RiskLevel = z.enum(["low", "medium", "high"]);
const TradingBias = z.enum(["bearish_strong", "bearish", "neutral", "bullish", "bullish_strong"]);

const TradeSideSchema = z.object({
  entryZone: z.string().min(1),
  stopLoss: z.string().min(1),
  takeProfit1: z.string().min(1),
  takeProfit2: z.string().min(1),
  riskRewardRatio: z.string().min(1),
  rationale: z.string().min(1),
});

const TradePlanSchema = z.object({
  preferredSide: z.enum(["buy", "sell", "wait"]),
  buy: TradeSideSchema,
  sell: TradeSideSchema,
});

export type TradePlan = z.infer<typeof TradePlanSchema>;
export type TradeSide = z.infer<typeof TradeSideSchema>;

/**
 * The model is asked to record which news headlines and calendar
 * events it actually leaned on so we can verify the fundamental
 * commentary is grounded in the snapshot we sent (vs. fabricated).
 * Optional because legacy responses + analyses with no fundamental
 * data won't have one.
 */
const FundamentalCitationsSchema = z.object({
  newsTitles: z.array(z.string()).default([]),
  calendarEvents: z.array(z.string()).default([]),
});

export type FundamentalCitations = z.infer<typeof FundamentalCitationsSchema>;

const BeginnerAIOutputSchema = z.object({
  marketCondition: MarketCondition,
  riskLevel: RiskLevel,
  confidenceMin: z.number().int().min(1).max(65),
  confidenceMax: z.number().int().min(11).max(75),
  tradingBias: TradingBias,
  opportunity: z.string().min(1),
  risk: z.string().min(1),
  mainScenario: z.string().min(1),
  alternativeScenario: z.string().min(1),
  whyReason: z.string().min(1),
  failureConditions: z.string().min(1),
  tradePlan: TradePlanSchema,
  fundamentalCitations: FundamentalCitationsSchema.optional(),
});

const ProAIOutputSchema = z.object({
  marketCondition: MarketCondition,
  riskLevel: RiskLevel,
  confidenceMin: z.number().int().min(1).max(70),
  confidenceMax: z.number().int().min(11).max(80),
  tradingBias: TradingBias,
  opportunity: z.string().min(1),
  risk: z.string().min(1),
  baseCase: z.string().min(1),
  bullishScenario: z.string().min(1),
  bearishScenario: z.string().min(1),
  keyDriversTechnical: z.string().min(1),
  keyDriversFundamental: z.string().min(1),
  marketContext: z.string().min(1),
  invalidationConditions: z.string().min(1),
  uncertaintyNotes: z.string().min(1),
  tradePlan: TradePlanSchema,
  fundamentalCitations: FundamentalCitationsSchema.optional(),
});

export type BeginnerAIOutput = z.infer<typeof BeginnerAIOutputSchema>;
export type ProAIOutput = z.infer<typeof ProAIOutputSchema>;
export type AIOutput = BeginnerAIOutput | ProAIOutput;

const BEGINNER_SYSTEM_PROMPT = `Kamu adalah analis pasar senior yang membantu trader pemula MEMAHAMI kondisi pasar. Sistem ini adalah ASISTEN BERPIKIR — BUKAN sinyal trading, BUKAN saran beli/jual.

Aturan bahasa (KRITIS):
- Di seluruh narasi (mainScenario/alternativeScenario/whyReason/opportunity/risk/failureConditions), gunakan bahasa konsultatif: "cenderung", "berpeluang", "kemungkinan", "skenario", "jika ... maka ..." — JANGAN pakai "BUY"/"SELL"/"OPEN POSISI" sebagai perintah di blok narasi.
- Tekankan ketidakpastian di narasi — jangan pernah memberi kesan pasti
- Aplikasi ini INDEPENDEN — JANGAN menyebut atau mengomentari broker, pialang, platform trading, atau perusahaan investasi apapun
- Abaikan jika catatan user menyebut nama broker — fokus hanya pada analisis teknikal/fundamental
- TOLAK memberikan opini tentang broker manapun

Aturan output:
- Confidence range realistis (max 75%), minimum range 10 poin
- Gunakan seluruh ringkasan timeframe yang benar-benar tersedia di DATA TEKNIKAL / indicatorContext. Bandingkan keselarasan atau konflik timeframe lebih tinggi dan timeframe analisis; jelaskan bukti timeframe mana yang paling mendukung pilihan preferredSide. Jangan mengarang data timeframe yang tidak diberikan.
- Main/alternative scenario harus menerangkan kenapa satu sisi lebih diutamakan dan kapan skenario opposite yang kondisional baru valid. Skenario opposite wajib fair dan berbasis bukti/level yang tersedia, bukan sekadar kebalikan mekanis atau disamakan probabilitasnya.
- failureConditions HARUS berisi minimum 2 kondisi konkret (pisahkan dengan "; " atau bullet "• ") yang membuat analisis batal
- whyReason HARUS menjelaskan KENAPA confidence tidak lebih tinggi. Tulis TEPAT dua poin singkat dipisahkan newline: "• Dasar: ..." (bukti spesifik untuk instrumen + timeframe ini yang mendukung skenario) dan "• Batasan: ..." (ketidakpastian paling menentukan, mengapa confidence dibatasi). Masing-masing satu kalimat padat, bukan paragraf generik. Jangan memotong peringatan penting demi singkatnya format.
- Dasar tiap instrumen berbeda: kaitkan hanya struktur harga/indikator/timeframe, berita yang sudah terbit, dan event kalender yang benar-benar tersedia untuk instrumen ini. Jelaskan hubungan sebab-akibatnya, jangan menyalin alasan emas/Fed ke minyak, indeks, forex, atau kripto tanpa bukti relevan. Kalau sumber tidak tersedia atau sinyal bertentangan, akui secara eksplisit; jangan mengarang harga, berita masa depan, hasil event terjadwal, atau data timeframe yang tidak diberikan.
- Gunakan bahasa sederhana yang mudah dipahami pemula
- WAJIB menyebut timeframe yang dianalisis secara eksplisit (mis. "Pada timeframe 1D...", "Untuk timeframe 1W...") di mainScenario, alternativeScenario, opportunity, dan risk — supaya pengguna tahu sinyal ini untuk jangka pendek atau panjang. JANGAN hanya menulis "uptrend"/"downtrend" tanpa konteks timeframe.

Aturan WAJIB untuk fundamental (kalender & berita):
- Baca blok "KALENDER EKONOMI RELEVAN" dengan teliti. Setiap event punya impact: ★★★ = HIGH (sangat berdampak), ★★ = MEDIUM, ★ = LOW.
- JIKA ada event ★★★ dalam 24 jam ke depan (cek tanggal vs hari ini): WAJIB sebut event itu di whyReason dan masukkan ke failureConditions (mis. "News ★★★ FOMC besok bisa membatalkan skenario"). Turunkan confidenceMax minimal 10 poin dari yang seharusnya, karena pasar berpotensi sangat volatile.
- JIKA ada event ★★ dalam 24 jam: sebut di whyReason sebagai sumber ketidakpastian, turunkan confidenceMax minimal 5 poin.
- JIKA ada event ★★★ atau ★★ DALAM 1 jam ke depan dari "Waktu analisis sekarang": marketCondition WAJIB di-set "volatile" dan riskLevel "high" — TIDAK PEDULI apa kata teknikal.
- Baca blok "BERITA TERKINI RELEVAN". Berita 1-2 hari terakhir = breaking news. JIKA ada berita yang materially mengubah arah fundamental (mis. perubahan kebijakan bank sentral, geopolitik, data ekonomi mengejutkan): WAJIB sebut judulnya di whyReason / opportunity / risk dan sesuaikan tradingBias dengan konteks itu. KAITKAN news dengan apa yang dilihat di teknikal — mis. "Teknikal momentum bullish 1D + berita Fed dovish memperkuat tesis cenderung naik."
- JIKA tidak ada blok "KALENDER EKONOMI RELEVAN" / "BERITA TERKINI RELEVAN" sama sekali di input ATAU keduanya kosong: WAJIB tulis "Tidak ada katalis fundamental signifikan terdeteksi pada window ini" di whyReason dan KOSONGKAN fundamentalCitations.newsTitles dan fundamentalCitations.calendarEvents — JANGAN mengarang event/berita yang tidak ada.
- KETIKA menurunkan confidenceMax karena event/news, WAJIB juga turunkan confidenceMin agar selisih (max - min) tetap minimal 10 poin. JANGAN sampai range jadi mengecil.

Aturan WAJIB untuk fundamentalCitations (jejak provenance):
- WAJIB isi field "fundamentalCitations" dengan judul berita + nama event yang BENAR-BENAR ada di blok BERITA / KALENDER di atas. Salin judul/nama persis seperti yang tertulis (boleh dipotong tetapi harus tetap dapat dikenali — mis. "FOMC Rate Decision" untuk event "FOMC Rate Decision" walau aslinya "★★★ USD — FOMC Rate Decision").
- JIKA blok BERITA non-empty dan kamu menyebut beritanya di whyReason / opportunity / risk: judul yang kamu sebut HARUS muncul di fundamentalCitations.newsTitles.
- JIKA blok KALENDER non-empty dan kamu menyebut event-nya: nama event HARUS muncul di fundamentalCitations.calendarEvents.
- DILARANG mengarang judul berita atau nama event yang tidak muncul di blok input — output kamu akan divalidasi terhadap snapshot.

Aturan WAJIB untuk tradePlan (saran level konkret):
- WAJIB isi field "tradePlan" dengan harga konkret untuk SKENARIO BUY DAN SKENARIO SELL — keduanya, bahkan kalau bias hanya condong ke satu arah. User berhak tahu level kalau skenario sebaliknya yang terjadi.
- Berikan dua peta skenario kondisional yang konkret dan evidence-backed: BUY dan SELL, meskipun preferredSide hanya memilih satu sisi. Kaitkan entry/SL/TP tiap sisi dengan level teknikal yang benar-benar disebut di konteks (support/resistance, swing, EMA, atau struktur candle); jangan menyatakan keduanya sebagai rekomendasi aktif.
- ANCHOR semua harga ke "Harga terakhir" dari DATA TEKNIKAL atau HARGA LIVE saat ini. Level harus masuk akal terhadap quote dan struktur timeframe; jangan menyalin angka tanpa alasan.
- Untuk SISI BUY: entryZone biasanya pullback ke support / breakout level di atas harga; stopLoss di bawah swing-low / invalidasi struktur; takeProfit1 = target dekat (resistance terdekat); takeProfit2 = target lanjutan (resistance berikut). riskRewardRatio dihitung dari mid entry ke TP1 vs SL (mis. "1:1.8").
- Untuk SISI SELL: entryZone biasanya pullback ke resistance / breakdown level di bawah harga; stopLoss di atas swing-high; takeProfit1 = support terdekat; takeProfit2 = support berikut.
- rationale tiap sisi: 1 kalimat singkat menjelaskan kenapa level itu dipilih (mis. "Pullback ke EMA200 4h sebagai support dinamis").
- preferredSide: "buy" jika tradingBias bullish/bullish_strong, "sell" jika bearish/bearish_strong, "wait" jika neutral atau marketCondition volatile.
- Jika tidak ada quote / "Harga terakhir" yang andal, jangan mengarang level numerik. Set preferredSide="wait" dan isi entry, SL, TP1, TP2, serta rasio dengan status pending yang jelas (contoh: "Menunggu quote dan konfirmasi support/resistance; level belum dapat ditentukan"). Nyatakan bahwa entry masih menunggu anchor harga, bukan seolah-olah level sudah tersedia. Jangan pernah gunakan "n/a".
- INI TETAP SARAN OBJEKTIF, BUKAN PERINTAH ORDER. Boleh pakai kata "buy"/"sell" di field tradePlan karena memang label sisi skenario, tapi rationale harus tetap konsultatif.

Output HANYA objek JSON (tanpa markdown, tanpa penjelasan tambahan) dengan keys berikut:
{
  "marketCondition": "trending_up" | "trending_down" | "ranging" | "volatile",
  "riskLevel": "low" | "medium" | "high",
  "confidenceMin": number (1-65),
  "confidenceMax": number (confidenceMin+10 sampai 75),
  "tradingBias": "bearish_strong" | "bearish" | "neutral" | "bullish" | "bullish_strong" (kecenderungan arah — gunakan "neutral" jika sinyalnya seimbang/ranging atau lebih baik tunggu),
  "opportunity": "string (peluang yang dilihat: ke mana harga BERPELUANG bergerak dan kenapa, 1-2 kalimat. JANGAN janjikan profit. Bicara skenario, bukan angka spesifik di sini — angka ada di tradePlan)",
  "risk": "string (risiko utama: skenario merugikan dan ketidakpastian yang harus diwaspadai, 1-2 kalimat)",
  "mainScenario": "string (Skenario A — skenario utama yang paling mungkin, 2-3 kalimat. Bicara struktur/arah, bukan angka spesifik — angka ada di tradePlan)",
  "alternativeScenario": "string (Skenario B — skenario alternatif jika asumsi tidak terjadi, 1-2 kalimat)",
  "whyReason": "string (tepat dua poin singkat pada dua baris: • Dasar: bukti spesifik instrumen/timeframe yang tersedia; • Batasan: sumber ketidakpastian dan mengapa confidence tidak lebih tinggi. Sebut event/berita spesifik hanya bila tersedia di input.)",
  "failureConditions": "string (minimum 2 kondisi konkret yang membatalkan analisis ini, dipisah '; ' — contoh: 'Harga break support 4650; Volume turun > 30%; News fundamental berubah')",
  "fundamentalCitations": {
    "newsTitles": ["string (judul berita yang dirujuk — harus persis seperti di blok BERITA TERKINI RELEVAN, atau [] kalau tidak ada blok / tidak menyebut)"],
    "calendarEvents": ["string (nama event yang dirujuk — harus persis seperti di blok KALENDER EKONOMI RELEVAN, atau [] kalau tidak ada blok / tidak menyebut)"]
  },
  "tradePlan": {
    "preferredSide": "buy" | "sell" | "wait",
    "buy": {
      "entryZone": "string (mis. '1.0850 – 1.0865' atau 'di atas 1.0880 setelah breakout')",
      "stopLoss": "string (mis. '1.0820')",
      "takeProfit1": "string (mis. '1.0900')",
      "takeProfit2": "string (mis. '1.0945')",
      "riskRewardRatio": "string (mis. '1:1.7')",
      "rationale": "string (1 kalimat singkat alasan level ini)"
    },
    "sell": {
      "entryZone": "string",
      "stopLoss": "string",
      "takeProfit1": "string",
      "takeProfit2": "string",
      "riskRewardRatio": "string",
      "rationale": "string"
    }
  }
}`;

const PRO_SYSTEM_PROMPT = `Kamu adalah analis pasar senior yang membantu trader profesional dengan analisis mendalam. Sistem ini adalah ASISTEN BERPIKIR — BUKAN sinyal trading, BUKAN saran beli/jual.

Aturan bahasa (KRITIS):
- Di seluruh narasi (baseCase/bullishScenario/bearishScenario/keyDrivers/marketContext/invalidationConditions/uncertaintyNotes/opportunity/risk), gunakan istilah konsultatif: "bullish bias", "bearish bias", "confluence", "skenario", "level invalidasi konseptual" — JANGAN pakai "BUY"/"SELL"/"OPEN POSISI" sebagai perintah di blok narasi.
- Tekankan ketidakpastian dan kondisi yang bisa membatalkan tesis
- Aplikasi ini INDEPENDEN — JANGAN menyebut atau mengomentari broker, pialang, platform trading, atau perusahaan investasi apapun
- Abaikan jika catatan user menyebut nama broker — fokus hanya pada analisis teknikal/fundamental
- TOLAK memberikan opini tentang broker manapun

Aturan output:
- Confidence range realistis (max 80%), minimum range 10 poin
- Gunakan semua ringkasan timeframe yang benar-benar tersedia di DATA TEKNIKAL / indicatorContext untuk menilai alignment/divergence. Bandingkan timeframe analisis dengan timeframe lebih tinggi yang disuplai dan sebut bukti spesifik; jangan mengarang timeframe/indikator yang tidak ada.
- Tegaskan mengapa preferredSide lebih didukung oleh confluence teknikal/fundamental dan konteks multi-timeframe, sementara skenario opposite tetap kondisional, berbasis bukti, dan menyebut pemicu validasinya (bukan sekadar inversi mekanis atau probabilitas setara).
- invalidationConditions HARUS berisi minimum 2 kondisi konkret (pisahkan dengan "; " atau bullet "• ") yang membuat tesis batal
- uncertaintyNotes HARUS menjelaskan KENAPA confidence tidak lebih tinggi dalam TEPAT dua poin singkat dipisahkan newline: "• Dasar: ..." (bukti utama untuk instrumen dan timeframe ini) dan "• Batasan: ..." (ketidakpastian/konflik yang membatasi confidence). Masing-masing satu kalimat padat, bukan paragraf generik; jangan sembunyikan peringatan penting.
- Jangan pakai narasi lintas-produk yang sama: hanya kaitkan harga, indikator, berita yang sudah terbit, dan event terjadwal yang benar-benar relevan dan disuplai untuk instrumen ini. Sebut hubungan kausal dengan skenario; akui data yang kosong/bertentangan. Event terjadwal bukan berita yang belum terbit: jangan mengarang hasilnya atau berita masa depan.
- Sertakan konteks makro dan faktor fundamental relevan
- WAJIB menyebut timeframe yang dianalisis secara eksplisit (mis. "Pada timeframe 1D...", "Bias bullish pada 1W...") di baseCase, bullishScenario, bearishScenario, opportunity, dan risk — supaya pengguna tahu bias ini untuk jangka pendek atau panjang. JANGAN hanya menulis "uptrend"/"downtrend" tanpa konteks timeframe.

Aturan WAJIB untuk fundamental (kalender & berita) — INI ADALAH ATURAN TERPENTING UNTUK MODE PRO:
- Baca blok "KALENDER EKONOMI RELEVAN" dengan teliti. Setiap event punya impact: ★★★ = HIGH (sangat berdampak, mis. FOMC/NFP/CPI), ★★ = MEDIUM, ★ = LOW.
- JIKA ada event ★★★ dalam 24 jam ke depan: WAJIB sebut event itu eksplisit di keyDriversFundamental dan invalidationConditions (mis. "FOMC Rate Decision ★★★ besok 19:30 — surprise hawkish bisa membatalkan tesis bullish"). Turunkan confidenceMax minimal 10 poin.
- JIKA ada event ★★ dalam 24 jam: sebut di uncertaintyNotes sebagai sumber risiko event-driven, turunkan confidenceMax minimal 5 poin.
- JIKA ada event ★★★/★★ DALAM 1 jam ke depan: marketCondition WAJIB di-set "volatile" dan riskLevel "high" — TIDAK PEDULI apa kata teknikal.
- Baca blok "BERITA TERKINI RELEVAN". Berita 1-2 hari terakhir = breaking news. JIKA ada berita material (perubahan kebijakan bank sentral, geopolitik, intervensi mata uang, data ekonomi mengejutkan): WAJIB sebut judul/intinya di keyDriversFundamental dan marketContext, dan sesuaikan tradingBias + bullishScenario + bearishScenario dengan konteks berita itu.
- JIKA berita fundamental BERTOLAK BELAKANG dengan sinyal teknikal: WAJIB sebut konflik ini di uncertaintyNotes dan turunkan confidenceMax minimal 10 poin.
- keyDriversFundamental WAJIB MENGAITKAN sisi fundamental dengan sisi teknikal — BUKAN cuma daftar event/news terpisah. Contoh yang BENAR: "FOMC Rate Decision besok berisiko membalik momentum bullish 1D yang ditunjukkan MACD; pasar pricing-in cut 25bps, surprise hawkish akan menarik DXY naik dan menekan emas." Contoh yang SALAH: "Ada event FOMC. Ada berita inflasi turun." (terlalu generik, tidak terikat ke teknikal.)
- JIKA tidak ada blok "KALENDER EKONOMI RELEVAN" / "BERITA TERKINI RELEVAN" sama sekali di input ATAU keduanya kosong: WAJIB tulis "Tidak ada katalis fundamental signifikan terdeteksi pada window ini — analisis murni teknikal." di keyDriversFundamental dan KOSONGKAN fundamentalCitations.newsTitles dan fundamentalCitations.calendarEvents — JANGAN mengarang event/berita yang tidak ada.

Aturan WAJIB untuk fundamentalCitations (jejak provenance):
- WAJIB isi field "fundamentalCitations" dengan judul berita + nama event yang BENAR-BENAR ada di blok BERITA / KALENDER di atas. Salin judul/nama persis seperti yang tertulis (boleh dipotong tetapi tetap dapat dikenali — mis. "FOMC Rate Decision" untuk event yang aslinya "★★★ USD — FOMC Rate Decision").
- JIKA blok BERITA non-empty dan kamu menyebut beritanya di keyDriversFundamental / marketContext / uncertaintyNotes: judul yang kamu sebut HARUS muncul di fundamentalCitations.newsTitles.
- JIKA blok KALENDER non-empty dan kamu menyebut event-nya: nama event HARUS muncul di fundamentalCitations.calendarEvents.
- DILARANG mengarang judul berita / nama event yang tidak muncul di blok input — output kamu akan divalidasi terhadap snapshot dan akan ditolak jika ada citation fiktif.

Aturan WAJIB untuk tradePlan (saran level konkret):
- WAJIB isi field "tradePlan" dengan harga konkret untuk SKENARIO BUY DAN SKENARIO SELL — keduanya, terlepas dari arah bias. Trader pro butuh peta level dua sisi.
- Buat skenario kondisional BUY dan SELL yang sama-sama konkret dan didukung bukti konteks, terlepas dari preferredSide. Kaitkan level tiap sisi pada support/resistance, swing, confluence, atau struktur candle yang benar-benar tersedia pada timeframe ini; jangan menyajikan dua skenario sebagai order aktif.
- ANCHOR semua harga ke quote terkini / "Harga terakhir" pada DATA TEKNIKAL atau HARGA LIVE. Level harus masuk akal terhadap quote dan struktur timeframe, bukan angka arbitrer.
- Untuk sisi BUY: entryZone = pullback ke confluence support / breakout di atas resistance kunci; stopLoss di bawah swing-low / invalidasi struktur HTF; takeProfit1 = resistance terdekat / measured move pertama; takeProfit2 = target lanjutan / extension. riskRewardRatio dihitung dari mid entry → TP1 vs SL.
- Untuk sisi SELL: entryZone = pullback ke resistance / breakdown level; stopLoss di atas swing-high; TP1 = support terdekat; TP2 = support lanjutan.
- rationale tiap sisi: 1 kalimat — sebutkan confluence yang dipakai (mis. "Konfluensi EMA200 4h + Fib 0.618 swing terakhir").
- preferredSide: "buy" untuk bias bullish/bullish_strong, "sell" untuk bearish/bearish_strong, "wait" untuk neutral atau marketCondition volatile / event ★★★ window.
- Jika tidak ada quote / "Harga terakhir" yang andal: jangan mengarang angka. Gunakan preferredSide="wait" dan status pending yang jelas di entry, SL, TP1, TP2, dan rasio (mis. "Menunggu quote dan konfirmasi struktur; level belum dapat ditentukan"). Tegaskan bahwa entry belum tersedia sampai quote/anchor andal ada. Jangan pernah gunakan "n/a".
- INI TETAP SARAN OBJEKTIF, BUKAN PERINTAH ORDER. Field "buy"/"sell" di tradePlan adalah label sisi skenario.

Output HANYA objek JSON (tanpa markdown, tanpa penjelasan tambahan) dengan keys berikut:
{
  "marketCondition": "trending_up" | "trending_down" | "ranging" | "volatile",
  "riskLevel": "low" | "medium" | "high",
  "confidenceMin": number (1-70),
  "confidenceMax": number (confidenceMin+10 sampai 80),
  "tradingBias": "bearish_strong" | "bearish" | "neutral" | "bullish" | "bullish_strong" (bias arah berdasarkan konfluensi sinyal — gunakan "neutral" jika sinyalnya seimbang/ranging atau lebih baik wait),
  "opportunity": "string (peluang utama yang dilihat: ke mana harga BERPELUANG bergerak dan kenapa secara konseptual, 1-2 kalimat. JANGAN janjikan profit. Angka konkret ada di tradePlan)",
  "risk": "string (risiko utama: skenario merugikan, area invalidasi konseptual, dan ketidakpastian, 1-2 kalimat)",
  "baseCase": "string (Skenario A — skenario dasar yang paling mungkin, 2-3 kalimat. Bicara struktur, angka konkret ada di tradePlan)",
  "bullishScenario": "string (Skenario alternatif bullish, 1-2 kalimat. Konseptual)",
  "bearishScenario": "string (Skenario alternatif bearish, 1-2 kalimat. Konseptual)",
  "keyDriversTechnical": "string (faktor teknikal utama yang mendukung tesis)",
  "keyDriversFundamental": "string (faktor fundamental utama yang relevan — KAITKAN dengan sisi teknikal, JANGAN cuma daftar event)",
  "marketContext": "string (konteks makro/kondisi pasar saat ini)",
  "invalidationConditions": "string (minimum 2 kondisi konkret yang membatalkan tesis, dipisah '; ' — contoh: 'Break support 4650 dengan close H1; Volume drop > 30%; FOMC surprise hawkish')",
  "uncertaintyNotes": "string (tepat dua poin singkat pada dua baris: • Dasar: bukti spesifik instrumen/timeframe yang tersedia; • Batasan: ketidakpastian utama dan KENAPA confidence tidak lebih tinggi)",
  "fundamentalCitations": {
    "newsTitles": ["string (judul berita yang dirujuk — persis seperti di blok BERITA, [] kalau tidak ada)"],
    "calendarEvents": ["string (nama event yang dirujuk — persis seperti di blok KALENDER, [] kalau tidak ada)"]
  },
  "tradePlan": {
    "preferredSide": "buy" | "sell" | "wait",
    "buy": {
      "entryZone": "string (mis. '4640 – 4655' atau 'di atas 4680 setelah breakout H1')",
      "stopLoss": "string (mis. '4615')",
      "takeProfit1": "string (mis. '4690')",
      "takeProfit2": "string (mis. '4735')",
      "riskRewardRatio": "string (mis. '1:2.1')",
      "rationale": "string (1 kalimat confluence yang dipakai)"
    },
    "sell": {
      "entryZone": "string",
      "stopLoss": "string",
      "takeProfit1": "string",
      "takeProfit2": "string",
      "riskRewardRatio": "string",
      "rationale": "string"
    }
  }
}`;

const BROKER_KEYWORDS = [
  "broker", "pialang", "perusahaan", "platform", "metatrader", "mt4", "mt5",
  "ctrader", "ig ", "octa", "forex.com", "xm ", "fbs", "hotforex", "instaforex",
  "roboforex", "exness", "tickmill", "pepperstone", "ic markets", "oanda",
  "fxpro", "axiory", "amarkets", "alpari", "fxtm", "trading212", "etoro",
  "plus500", "capital.com", "xtb", "admirals", "tradeview", "vantage",
  "axi", "fusion", "blackbull", "fxgt", "weltrade", "moneta", "windsor",
  "assetsfx", "finex", "mifx", "mrt", "prim", "rika", "sinarmas", "phillip",
  "dbs", "mandiri", "bni", "bri", "cimb", "permata", "mega",
];

function sanitizeNotes(notes: string): string {
  const lower = notes.toLowerCase();
  const hasBrokerRef = BROKER_KEYWORDS.some((kw) => lower.includes(kw));
  if (hasBrokerRef) {
    return "[Catatan dihapus: aplikasi ini independen dan tidak membahas broker atau pialang manapun]";
  }
  return notes;
}

// Snapshot of fundamentals shown to the model; used to verify the
// emitted `fundamentalCitations` are grounded in real items.
export interface FundamentalSnapshot {
  newsItems: NewsItem[];
  calendarEvents: CalendarEvent[];
}

function normalizeForCitationMatch(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

// A citation is "grounded" if it has an exact normalized substring
// match with a real item, OR shares ≥2 significant tokens (len ≥4)
// with the same real item (lets the model abbreviate without us
// flagging it as fabricated).
export function citationMatchesAny(citation: string, realItems: string[]): boolean {
  const normCit = normalizeForCitationMatch(citation);
  if (!normCit) return false;
  for (const real of realItems) {
    const normReal = normalizeForCitationMatch(real);
    if (!normReal) continue;
    if (normReal.includes(normCit) || normCit.includes(normReal)) return true;
  }
  const citTokens = normCit.split(" ").filter((t) => t.length >= 4);
  if (citTokens.length === 0) {
    // Short citation (CPI / NFP / FOMC) — accept iff the whole
    // normalized citation appears in some real item.
    return realItems.some((r) =>
      normalizeForCitationMatch(r).includes(normCit),
    );
  }
  for (const real of realItems) {
    const normReal = normalizeForCitationMatch(real);
    const matches = citTokens.filter((t) => normReal.includes(t)).length;
    if (matches >= Math.min(2, citTokens.length)) return true;
  }
  return false;
}

interface CitationValidation {
  ok: boolean;
  reason?: string;
}

export function validateFundamentalCitations(
  citations: FundamentalCitations | undefined,
  snapshot: FundamentalSnapshot | null,
): CitationValidation {
  const noSnapshot =
    !snapshot ||
    (snapshot.newsItems.length === 0 && snapshot.calendarEvents.length === 0);

  if (noSnapshot) {
    if (
      citations &&
      (citations.newsTitles.length > 0 || citations.calendarEvents.length > 0)
    ) {
      return {
        ok: false,
        reason:
          "Model fabricated fundamental citations even though no news or calendar items were provided in the input.",
      };
    }
    return { ok: true };
  }

  // Snapshot can be non-empty while the model decides fundamentals are not
  // materially relevant for this specific setup/timeframe. Do not hard-fail
  // solely because citations are empty; only fail on fabricated citations.
  const cited =
    (citations?.newsTitles.length ?? 0) +
    (citations?.calendarEvents.length ?? 0);
  if (cited === 0) {
    return { ok: true };
  }
  if (!citations) return { ok: true };

  const realNews = snapshot.newsItems.map((n) => n.title);
  const realEvents = snapshot.calendarEvents.map(
    (e) => `${e.event} ${e.currency}`,
  );

  for (const t of citations.newsTitles) {
    if (!citationMatchesAny(t, realNews)) {
      return {
        ok: false,
        reason: `News citation "${t}" does not match any headline in the snapshot.`,
      };
    }
  }
  for (const e of citations.calendarEvents) {
    if (!citationMatchesAny(e, realEvents)) {
      return {
        ok: false,
        reason: `Calendar citation "${e}" does not match any event in the snapshot.`,
      };
    }
  }
  return { ok: true };
}

// Token usage reported by a single OpenAI call. `null` when the SDK
// response didn't include a `usage` block (shouldn't normally happen,
// but the type keeps callers honest rather than assuming zeros).
export interface CallTokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

async function callOpenAI(
  systemPrompt: string,
  userMessage: string,
  model: string,
  maxTokens?: number,
  timeoutMs: number = 25_000,
  tier: AICostTier = "free",
): Promise<{ data: unknown; usage: CallTokenUsage | null }> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const request = TIER_CLIENTS[tier].chat.completions.create(
      {
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
        response_format: { type: "json_object" },
        temperature: 0.4,
        max_tokens: maxTokens,
      },
      {
        signal: controller.signal,
        // Do not let the SDK's automatic retries outlive the generation's
        // explicit request deadline.
        maxRetries: 0,
      },
    );
    const response = await Promise.race([
      request,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          controller.abort();
          reject(new Error(`OpenAI timeout after ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);

    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error("No response from AI");
    const usage = response.usage
      ? {
          promptTokens: response.usage.prompt_tokens,
          completionTokens: response.usage.completion_tokens,
          totalTokens: response.usage.total_tokens,
        }
      : null;
    const data = JSON.parse(content);
    observeOpenAIOutcome({ success: true, model, tier });
    return { data, usage };
  } catch (error) {
    observeOpenAIOutcome({
      success: false,
      model,
      tier,
      error: error instanceof Error ? error.message.slice(0, 300) : "unknown_error",
    });
    throw error;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export function buildFastIntradayFallback(mode: "beginner" | "pro", timeframe: string): AIOutput {
  const confirmationWindow = timeframe === "1m" ? "2–3 candle 1m" : "1–2 candle 5m";
  const baseTradePlan: TradePlan = {
    preferredSide: "wait",
    buy: {
      entryZone: `Belum ada entry — tunggu candle ${timeframe} close di atas resistance mikro`,
      stopLoss: "Tentukan di bawah swing-low setelah candle konfirmasi",
      takeProfit1: "Targetkan resistance berikutnya setelah breakout terkonfirmasi",
      takeProfit2: "Evaluasi setelah TP1 jika momentum tetap bertahan",
      riskRewardRatio: "Hitung setelah entry dan Stop Loss terbentuk",
      rationale: `Amati ${confirmationWindow}; analisis ulang setelah breakout terkonfirmasi karena noise sangat tinggi.`,
    },
    sell: {
      entryZone: `Belum ada entry — tunggu candle ${timeframe} close di bawah support mikro`,
      stopLoss: "Tentukan di atas swing-high setelah candle konfirmasi",
      takeProfit1: "Targetkan support berikutnya setelah breakdown terkonfirmasi",
      takeProfit2: "Evaluasi setelah TP1 jika momentum tetap bertahan",
      riskRewardRatio: "Hitung setelah entry dan Stop Loss terbentuk",
      rationale: `Amati ${confirmationWindow}; analisis ulang setelah breakdown terkonfirmasi karena noise sangat tinggi.`,
    },
  };

  if (mode === "beginner") {
    return {
      marketCondition: "volatile",
      riskLevel: "high",
      confidenceMin: 25,
      confidenceMax: 40,
      tradingBias: "neutral",
      opportunity: `Pada timeframe ${timeframe}, peluang terbaik adalah menunggu konfirmasi arah yang lebih jelas.`,
      risk: `Pada timeframe ${timeframe}, pergerakan acak dan spike cepat dapat memicu sinyal palsu.`,
      mainScenario: `Pada timeframe ${timeframe}, harga cenderung bergerak fluktuatif jangka sangat pendek.`,
      alternativeScenario: `Jika momentum tiba-tiba menguat satu arah, ikuti hanya setelah candle konfirmasi.`,
      whyReason: `Keyakinan dibatasi karena timeframe ${timeframe} sangat sensitif terhadap noise intraday.`,
      failureConditions: "Terjadi lonjakan volatilitas mendadak; Struktur mikro berubah cepat dalam beberapa candle",
      tradePlan: baseTradePlan,
      fundamentalCitations: { newsTitles: [], calendarEvents: [] },
    };
  }

  return {
    marketCondition: "volatile",
    riskLevel: "high",
    confidenceMin: 25,
    confidenceMax: 40,
    tradingBias: "neutral",
    opportunity: `Pada timeframe ${timeframe}, peluang taktis muncul setelah konfirmasi breakout/rejection mikro.`,
    risk: `Pada timeframe ${timeframe}, noise order flow dapat membalik sinyal dalam hitungan menit.`,
    baseCase: `Pada timeframe ${timeframe}, bias netral dengan volatilitas tinggi sampai ada struktur yang valid.`,
    bullishScenario: `Bullish hanya valid jika ada continuation jelas setelah break resistance mikro.`,
    bearishScenario: `Bearish hanya valid jika ada rejection kuat dan break support mikro.`,
    keyDriversTechnical: `Struktur mikro dan momentum jangka sangat pendek masih campuran pada timeframe ${timeframe}.`,
    keyDriversFundamental: "Tidak ada katalis fundamental signifikan yang dipakai pada mode cepat intraday.",
    marketContext: "Kondisi intraday cepat dengan probabilitas whipsaw tinggi.",
    invalidationConditions: "Breakout gagal dalam 1-2 candle; Volatilitas spike mematahkan struktur mikro",
    uncertaintyNotes: `Confidence dibatasi karena timeframe ${timeframe} memiliki rasio noise terhadap sinyal yang tinggi.`,
    tradePlan: baseTradePlan,
    fundamentalCitations: { newsTitles: [], calendarEvents: [] },
  };
}

// ---------------------------------------------------------------------------
// Trade-plan numeric hygiene
//
// The model free-texts every price level (entry/SL/TP) AND the
// riskRewardRatio string. Because the ratio is authored independently of the
// levels, it routinely drifts out of sync with the numbers shown right above
// it on the card ("perbandingan ratio yg dibawah suka salah"). We recompute it
// from the model's OWN entry/SL/TP1 so the displayed ratio is always
// internally consistent. Descriptive pending-entry plans use an explicit
// pending status instead of a bare "n/a".
// ---------------------------------------------------------------------------

// Pull the representative price out of a free-text level. Entry zones are
// ranges ("1.0850 – 1.0865") → midpoint; SL/TP are usually single numbers.
// Returns null when nothing numeric is present ("menunggu konfirmasi ...").
//
// Timeframe tokens (H1, M15, 4H, 30m, 1D ...) are stripped FIRST so their
// digits can't be mistaken for a price — e.g. "di atas 4680 setelah breakout
// H1" must parse to 4680, not the mean of [4680, 1].
export function parseLevelPrice(raw: string): number | null {
  if (!raw) return null;
  const cleaned = raw
    .replace(/,/g, "") // thousands separators; "." is the decimal point
    .replace(/\b[HMDWhmdw]\d{1,3}\b/g, " ") // H1, M15, D1, W1
    .replace(/\b\d{1,3}[mhdwMHDW]\b/g, " "); // 1m, 30m, 4h, 1D, 1W
  const matches = cleaned.match(/\d+(?:\.\d+)?/g);
  if (!matches || matches.length === 0) return null;
  const nums = matches.map(Number).filter((n) => Number.isFinite(n));
  if (nums.length === 0) return null;
  if (nums.length === 1) return nums[0]!;
  // Two or more numbers → treat the first two as a range and use the
  // midpoint (the representative price of an entry zone). Extra trailing
  // numbers are ignored rather than averaged in.
  return (nums[0]! + nums[1]!) / 2;
}

// Recompute "1:X.X" from entry → TP1 (reward) vs entry → SL (risk).
// Returns null when any level is non-numeric or the risk leg is zero. When a
// `side` is given, the levels must straddle the entry in the correct
// direction (buy: SL below, TP above; sell: SL above, TP below) — otherwise
// the plan is internally contradictory and no ratio is reported.
export function computeRiskReward(
  entryZone: string,
  stopLoss: string,
  takeProfit1: string,
  side?: "buy" | "sell",
): string | null {
  const entry = parseLevelPrice(entryZone);
  const sl = parseLevelPrice(stopLoss);
  const tp1 = parseLevelPrice(takeProfit1);
  if (entry === null || sl === null || tp1 === null) return null;
  if (side === "buy" && !(sl < entry && tp1 > entry)) return null;
  if (side === "sell" && !(sl > entry && tp1 < entry)) return null;
  const risk = Math.abs(entry - sl);
  const reward = Math.abs(tp1 - entry);
  if (!(risk > 0) || !Number.isFinite(reward)) return null;
  const ratio = reward / risk;
  if (!Number.isFinite(ratio) || ratio <= 0) return null;
  return `1:${ratio.toFixed(1)}`;
}

// Replace each side's riskRewardRatio with the value implied by its own
// levels so the card never shows a ratio that contradicts the prices above it.
export function reconcileTradePlanRiskReward(plan: TradePlan): TradePlan {
  const fixSide = (side: TradeSide, dir: "buy" | "sell"): TradeSide => ({
    ...side,
    riskRewardRatio:
      computeRiskReward(side.entryZone, side.stopLoss, side.takeProfit1, dir) ??
      "Belum dihitung — menunggu quote dan level entry yang dapat divalidasi",
  });
  return {
    ...plan,
    buy: fixSide(plan.buy, "buy"),
    sell: fixSide(plan.sell, "sell"),
  };
}

// The model occasionally assigns a set of levels to the wrong side. Never
// display contradictory numbers: replace only the failing side with an
// explicit pending-entry description while preserving its valid counterpart.
const INCONSISTENT_TRADE_PLAN_NOTE =
  "Level numerik skenario ini belum lolos validasi arah; entry masih pending sampai ada konfirmasi level yang konsisten.";

const PENDING_PRICE_LEVEL =
  "Menunggu quote dan konfirmasi struktur; level belum dapat ditentukan";

function isTradePlanSideConsistent(
  side: TradeSide,
  dir: "buy" | "sell",
): boolean {
  const prices = [
    parseLevelPrice(side.entryZone),
    parseLevelPrice(side.stopLoss),
    parseLevelPrice(side.takeProfit1),
    parseLevelPrice(side.takeProfit2),
  ];
  // Fully descriptive levels are legitimate only for a no-anchor, pending
  // plan. Mixed numeric/descriptive fields are malformed and must be retried.
  if (prices.every((price) => price === null)) return true;
  if (prices.some((price) => price === null)) return false;
  const [entry, sl, tp1, tp2] = prices as [number, number, number, number];
  if (dir === "buy") {
    if (!(sl < entry && tp1 > entry)) return false;
    if (!(tp2 > tp1)) return false;
  } else {
    if (!(sl > entry && tp1 < entry)) return false;
    if (!(tp2 < tp1)) return false;
  }
  return true;
}

/**
 * Verify the paid output has two valid directional price maps when an anchor
 * exists, and that it does not invent numbers when no reliable anchor exists.
 * Returning a reason lets generateAnalysis request a focused correction.
 */
export function validateTradePlanQuality(
  plan: TradePlan,
  priceAnchor: number | null,
  timeframe = "1D",
  instrument = "",
): { ok: true } | { ok: false; reason: string } {
  const hasPriceAnchor =
    typeof priceAnchor === "number" &&
    Number.isFinite(priceAnchor) &&
    priceAnchor > 0;
  const crypto = isCryptoInstrument(instrument);
  const proximityBounds: Record<string, [number, number]> = crypto
    ? {
        "1m": [0.75, 1.25],
        "5m": [0.65, 1.35],
        "15m": [0.6, 1.4],
        "30m": [0.55, 1.45],
        "1h": [0.55, 1.45],
        "4h": [0.5, 1.5],
        "1D": [0.35, 1.8],
        "1W": [0.2, 2.5],
      }
    : {
        "1m": [0.9, 1.1],
        "5m": [0.85, 1.15],
        "15m": [0.8, 1.2],
        "30m": [0.78, 1.22],
        "1h": [0.75, 1.25],
        "4h": [0.65, 1.35],
        "1D": [0.6, 1.4],
        "1W": [0.4, 1.6],
      };
  const [minPriceFactor, maxPriceFactor] =
    proximityBounds[timeframe] ?? proximityBounds["1D"]!;

  for (const [dir, side] of [
    ["buy", plan.buy],
    ["sell", plan.sell],
  ] as const) {
    const values = [
      side.entryZone,
      side.stopLoss,
      side.takeProfit1,
      side.takeProfit2,
    ];
    const prices = values.map(parseLevelPrice);
    if (!hasPriceAnchor) {
      if (prices.some((price) => price !== null)) {
        return {
          ok: false,
          reason: `Skenario ${dir} memuat angka tanpa quote / anchor harga yang andal.`,
        };
      }
      if (values.some((value) => /\bn\/a\b/i.test(value)) ||
          /\bn\/a\b/i.test(side.riskRewardRatio)) {
        return {
          ok: false,
          reason: `Skenario ${dir} harus menjelaskan entry pending tanpa menggunakan n/a.`,
        };
      }
      continue;
    }
    if (prices.some((price) => price === null)) {
      return {
        ok: false,
        reason: `Skenario ${dir} wajib memiliki entry, SL, TP1, dan TP2 numerik yang valid.`,
      };
    }
    if (!isTradePlanSideConsistent(side, dir)) {
      return {
        ok: false,
        reason: `Urutan level skenario ${dir} salah: SL dan TP harus berada di sisi arah yang benar, dan TP2 harus lebih jauh dari TP1.`,
      };
    }
    const lowerQuoteBound = priceAnchor! * minPriceFactor;
    const upperQuoteBound = priceAnchor! * maxPriceFactor;
    if (prices.some((price) =>
      price! < lowerQuoteBound || price! > upperQuoteBound
    )) {
      return {
        ok: false,
        reason: `Level skenario ${dir} terlalu jauh dari quote ${priceAnchor} untuk timeframe ${timeframe}; gunakan level yang masih masuk akal terhadap harga saat ini dan struktur timeframe.`,
      };
    }
    if (!computeRiskReward(
      side.entryZone,
      side.stopLoss,
      side.takeProfit1,
      dir,
    )) {
      return {
        ok: false,
        reason: `Rasio risiko/imbalan skenario ${dir} tidak dapat divalidasi dari level numerik.`,
      };
    }
  }
  return { ok: true };
}

export function sanitizeTradePlanLevels(plan: TradePlan): TradePlan {
  const sanitizeSide = (side: TradeSide, dir: "buy" | "sell"): TradeSide => {
    if (isTradePlanSideConsistent(side, dir)) {
      const clean = { ...side };
      for (const key of ["entryZone", "stopLoss", "takeProfit1", "takeProfit2", "riskRewardRatio", "rationale"] as const) {
        if (/\bn\/a\b/i.test(clean[key])) clean[key] = PENDING_PRICE_LEVEL;
      }
      return clean;
    }
    return {
      entryZone: PENDING_PRICE_LEVEL,
      stopLoss: PENDING_PRICE_LEVEL,
      takeProfit1: PENDING_PRICE_LEVEL,
      takeProfit2: PENDING_PRICE_LEVEL,
      riskRewardRatio: "Belum dihitung — entry masih pending sampai level tervalidasi",
      rationale: INCONSISTENT_TRADE_PLAN_NOTE,
    };
  };
  return {
    ...plan,
    buy: sanitizeSide(plan.buy, "buy"),
    sell: sanitizeSide(plan.sell, "sell"),
  };
}

// Apply post-processing hygiene to a validated AI output before returning it.
function finalizeOutput(out: AIOutput): AIOutput {
  return {
    ...out,
    tradePlan: reconcileTradePlanRiskReward(
      sanitizeTradePlanLevels(out.tradePlan),
    ),
  } as AIOutput;
}

// Total token usage accumulated across every `callOpenAI` invocation a
// single `generateAnalysis` call makes (1st attempt + up to 2 retries).
// `callCount` only counts calls that actually completed — a call that
// throws (timeout, API error) contributes nothing, since no usage is
// recoverable for it (see the `Promise.race` timeout note on `callOpenAI`).
/**
 * Fingerprint of the pro system prompt. Persisted with every Trade Pilot
 * analysis so the audit trail records exactly which prompt produced it;
 * it changes automatically whenever the prompt text changes.
 */
export const PRO_PROMPT_VERSION = `pro-${createHash("sha256").update(PRO_SYSTEM_PROMPT).digest("hex").slice(0, 16)}`;

export interface AnalysisTokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  callCount: number;
}

export interface GenerateAnalysisResult {
  output: AIOutput;
  usage: AnalysisTokenUsage;
  model: string;
}

export async function generateAnalysis(
  instrument: string,
  timeframe: string,
  mode: "beginner" | "pro",
  notes?: string,
  indicatorContext?: string,
  fundamentalSnapshot?: FundamentalSnapshot | null,
  livePrice?: number | null,
  selectedTimeframePrice?: number | null,
  tier: AICostTier = "free",
): Promise<GenerateAnalysisResult> {
  const isFastIntraday = timeframe === "1m" || timeframe === "5m";
  const selectedModel =
    isFastIntraday
      ? process.env["OPENAI_MODEL_FAST_INTRADAY"] ??
        process.env["OPENAI_MODEL"] ??
        "gpt-4o-mini"
      : process.env["OPENAI_MODEL"] ?? "gpt-4o";
  const cleanNotes = notes ? sanitizeNotes(notes) : undefined;
  // Measured against the real 1m/5m prompt size (full Indonesian style
  // guide + schema): gpt-4o-mini typically takes ~5-8s to complete, so a
  // shorter window (previously 2800ms) made the fallback fire on nearly
  // every request. 9s keeps 1m/5m meaningfully faster than the unbounded
  // default timeframes while giving the real call a fair chance to land.
  const analysisTimeoutMs = isFastIntraday ? 9_000 : 25_000;
  const now = new Date();
  const nowIsoUtc = now.toISOString().replace(/\.\d{3}Z$/, "Z");
  const nowJakarta = now.toLocaleString("id-ID", {
    timeZone: "Asia/Jakarta",
    dateStyle: "full",
    timeStyle: "short",
  });
  // Indonesian-native style guide. Injected on every analysis so the
  // narrative reads like a senior Indonesian analyst speaking to
  // retail traders — not a literal translation. The analogies stay
  // optional ("boleh, jangan dipaksakan") so the model doesn't shoe-
  // horn them into setups where they don't fit. Casual register
  // (lo/gw/lu) is explicitly forbidden — keep it professional-friendly
  // ("kamu", "kita") to match the rest of the app copy.
  const indoStyleGuide = [
    `\nGAYA BAHASA INDONESIA (WAJIB ikuti — narasi terdengar natif, bukan terjemahan literal):`,
    `- Sapaan: "kamu" / "kita". JANGAN gunakan lo/gw/lu/elu. Tetap konsultatif tapi akrab — bukan robotik, bukan kaku formal "Anda".`,
    `- Pilih kata kerja aktif khas trader Indonesia: "nyangkut" (bukan "terjebak posisi"), "cut loss" (boleh dipakai, istilah baku), "wait and see", "kabur duluan", "antre di support", "nyemplung", "tahan dulu", "longgar dulu", "bablas ke atas/bawah".`,
    `- Untuk kondisi pasar, ANALOGI ringan boleh dipakai (1-2x per analisis maksimal, jangan diulang-ulang). Contoh kanonik yang boleh kamu adaptasi sesuai konteks (JANGAN dipaksakan kalau tidak cocok):`,
    `   * Ranging/sideways yang sempit: "pasar lagi kalem kayak weekend di tol dalam kota" / "gerak harga tipis kayak gajian belum cair".`,
    `   * Volatil setelah news: "habis news langsung ngebut kayak Senayan jam 9 malam" / "candle whipsaw, mirip antri di pintu tol pas hujan".`,
    `   * Breakout setelah konsolidasi: "harga akhirnya keluar dari kandang" / "akhirnya jebol setelah lama numpuk di pintu".`,
    `   * Trend kuat: "momentum kenceng kayak motor di jalur kanan" / "satu arah aja, kayak commuter line pagi".`,
    `   * Pullback ke support sehat: "harga balik dulu narik napas sebelum lanjut" / "kayak ngumpulin tenaga sebelum push lagi".`,
    `- ANALOGI WAJIB JUSTIFIED: setelah analoginya, sambungkan ke bukti teknikal/fundamental ("...kayak weekend di tol dalam kota — ATR turun 40% vs minggu lalu dan volume tipis"). Analogi tanpa data = SALAH.`,
    `- Istilah teknikal tetap pakai bahasa Inggris baku: "support", "resistance", "breakout", "ATR", "RSI", "MACD", "EMA200", "swing-high", "TP1/TP2", "SL", "1H/4H/1D" — JANGAN diterjemahkan paksa ke "tingkat dukungan" / "rerata gerak eksponensial".`,
    `- Hindari kalimat hasil google-translate: "ini akan menjadi peluang yang sangat baik" → tulis "setup-nya menarik, tapi tetap tunggu konfirmasi". "Pasar sangat berfluktuasi" → "pasar lagi ngamuk" atau "volatilitas naik tajam".`,
    `- JANGAN gunakan emoji apapun.`,
  ].join("\n");

  const isCrypto = isCryptoInstrument(instrument);
  const cryptoContext = isCrypto
    ? [
        `\nKONTEKS ASET — CRYPTO SPOT:`,
        `- ${instrument} adalah pasangan crypto-spot yang diperdagangkan 24/7 tanpa sesi London/Tokyo/New York. Jangan menyebut "buka sesi" atau "tutup sesi" gaya forex.`,
        `- Volatilitas intraday cenderung jauh lebih tinggi dari forex/komoditas; ATR & spike candle wajar lebih lebar. Sesuaikan ekspektasi SL/TP secara proporsional pada timeframe ${timeframe}.`,
        `- Driver utama: sentimen risk-on/risk-off global, ekspektasi suku bunga The Fed, BTC dominance (untuk altcoin), funding rate perp & berita regulasi (SEC/ETF/exchange). Sebut bila relevan; jangan dipaksakan.`,
        `- Likuiditas tertipis pada akhir pekan (Sabtu–Minggu UTC); breakout di window ini lebih rawan whipsaw — wajar untuk men-down-tone confidence di kondisi tersebut.`,
      ].join("\n")
    : "";

  // Live mid-price anchor. The indicator block (which carries "Harga
  // terakhir") is best-effort and frequently absent — instruments Yahoo
  // doesn't cover for indicators, or a transient upstream miss. When it's
  // missing the model has no price to anchor to and, per its prompt rules,
  // falls back to a "wait" plan with descriptive levels instead of concrete
  // numbers ("angkanya gak keluar"). Feeding the 15s-cached live-feed price
  // as an explicit anchor lets it produce real entry/SL/TP without indicators.
  const livePriceAnchor =
    typeof livePrice === "number" && Number.isFinite(livePrice)
      ? [
          `\n=== HARGA LIVE (anchor utama) ===`,
          `Harga terakhir: ${livePrice} (${instrument}, harga live saat analisis)`,
          `WAJIB pakai angka ini sebagai anchor untuk semua level di tradePlan (entry/SL/TP) dengan harga konkret. JANGAN set preferredSide="wait" hanya karena indikator teknikal tidak tersedia — kamu sudah punya harga acuan ini.`,
          `===`,
        ].join("\n")
      : "";

  const baseUserMessage = [
    `Waktu analisis sekarang: ${nowIsoUtc} (UTC) — atau ${nowJakarta} WIB.`,
    `Gunakan waktu ini sebagai patokan untuk menghitung jendela 1 jam / 24 jam ke depan pada event kalender.`,
    `Analisis pasar untuk instrumen: ${instrument}, timeframe: ${timeframe}`,
    `PENTING: semua narasi (skenario, peluang, risiko, bias arah) HARUS menyebut timeframe "${timeframe}" secara eksplisit, bukan hanya kata "uptrend"/"downtrend" saja.`,
    indoStyleGuide,
    cryptoContext,
    livePriceAnchor,
    indicatorContext ? indicatorContext : "",
    cleanNotes ? `\nCatatan tambahan dari trader: ${cleanNotes}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const systemPrompt =
    mode === "beginner" ? BEGINNER_SYSTEM_PROMPT : PRO_SYSTEM_PROMPT;
  const fastIntradayPrompt = `\n\nATURAN TAMBAHAN MODE CEPAT 1m/5m:
- Tetap ikuti SELURUH schema, aturan tradePlan, anchor harga, dan validasi Buy/Sell di atas.
- Ringkas setiap field narasi menjadi satu kalimat pendek dan fokus pada struktur mikro.
- preferredSide boleh "wait" ketika bias netral atau noise tinggi, tetapi jika anchor harga tersedia tradePlan tetap harus memuat level kondisional konkret untuk skenario Buy DAN Sell.
- Jika anchor harga benar-benar tidak tersedia, jangan mengarang angka: isi tiap field level dengan panduan observasi yang menjelaskan candle konfirmasi, swing invalidasi, target struktur berikutnya, dan kapan analisis perlu diulang. Jangan hanya menulis "n/a".
- Tetap konsultatif; ini peta skenario, bukan instruksi order.`;
  const effectiveSystemPrompt = isFastIntraday
    ? `${systemPrompt}${fastIntradayPrompt}`
    : systemPrompt;
  const maxTokens = isFastIntraday ? 1400 : undefined;
  const schema = mode === "beginner" ? BeginnerAIOutputSchema : ProAIOutputSchema;
  const snapshot = fundamentalSnapshot ?? null;
  const priceAnchor =
    typeof livePrice === "number" && Number.isFinite(livePrice) && livePrice > 0
      ? livePrice
      : typeof selectedTimeframePrice === "number" &&
          Number.isFinite(selectedTimeframePrice) &&
          selectedTimeframePrice > 0
        ? selectedTimeframePrice
        : null;

  const parseAttempt = (raw: unknown): AIOutput => {
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(`AI output validation failed: ${parsed.error.message}`);
    }
    return parsed.data;
  };

  // Accumulates usage across every `callOpenAI` call this invocation makes
  // (initial attempt plus any corrective retries) for persistence.
  const usage: AnalysisTokenUsage = {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    callCount: 0,
  };
  const wrap = (out: AIOutput): GenerateAnalysisResult => ({
    output: out,
    usage: { ...usage },
    model: selectedModel,
  });
  const trackedCallOpenAI = async (
    prompt: string,
    message: string,
    model: string,
    maxTok?: number,
    timeout?: number,
  ): Promise<unknown> => {
    const { data, usage: callUsage } = await callOpenAI(prompt, message, model, maxTok, timeout, tier);
    usage.callCount += 1;
    if (callUsage) {
      usage.promptTokens += callUsage.promptTokens;
      usage.completionTokens += callUsage.completionTokens;
      usage.totalTokens += callUsage.totalTokens;
    }
    return data;
  };

  // First attempt.
  let raw: unknown;
  try {
    raw = await trackedCallOpenAI(
      effectiveSystemPrompt,
      baseUserMessage,
      selectedModel,
      maxTokens,
      analysisTimeoutMs,
    );
  } catch (e) {
    logger.warn(
      { err: e, instrument, timeframe, timeoutMs: analysisTimeoutMs },
      "OpenAI analysis call failed",
    );
    throw e;
  }
  let parsed: AIOutput;
  try {
    parsed = parseAttempt(raw);
  } catch (e) {
    // Validation failed on first try — rerun with a corrective hint
    // on every timeframe before giving up.
    const correction =
      "\n\n[KOREKSI WAJIB] Output JSON sebelumnya gagal validasi. Pastikan SEMUA field wajib hadir dengan tipe & enum yang benar, dan kembalikan HANYA objek JSON tanpa markdown.";
    raw = await trackedCallOpenAI(
      effectiveSystemPrompt,
      baseUserMessage + correction,
      selectedModel,
      maxTokens,
      analysisTimeoutMs,
    );
    parsed = parseAttempt(raw);
  }

  const tradePlanCheck = validateTradePlanQuality(
    parsed.tradePlan,
    priceAnchor,
    timeframe,
    instrument,
  );
  if (!tradePlanCheck.ok) {
    const correction = `\n\n[KOREKSI WAJIB — LEVEL TRADE PLAN] ${tradePlanCheck.reason} Pertahankan sisi yang levelnya sudah valid dan perbaiki hanya sisi yang gagal validasi, lalu verifikasi kedua sisi BUY dan SELL. Jika quote tersedia, isi entry, SL, TP1, dan TP2 dengan angka yang berurutan benar untuk arahnya (BUY: SL < entry < TP1 < TP2; SELL: TP2 < TP1 < entry < SL), relevan terhadap quote dan bukti konteks, serta hitung rasio dari entry/SL/TP1. Jika tidak tersedia anchor harga andal, jangan gunakan angka; jelaskan entry pending dan level belum dapat ditentukan tanpa memakai "n/a". Kembalikan seluruh objek JSON.`;
    const retryRaw = await trackedCallOpenAI(
      effectiveSystemPrompt,
      baseUserMessage + correction,
      selectedModel,
      maxTokens,
      analysisTimeoutMs,
    );
    const retryParsed = parseAttempt(retryRaw);
    const retryTradePlanCheck = validateTradePlanQuality(
      retryParsed.tradePlan,
      priceAnchor,
      timeframe,
      instrument,
    );
    if (!retryTradePlanCheck.ok) {
      throw new Error(
        `AI trade-plan quality failed after retry: ${retryTradePlanCheck.reason}`,
      );
    }
    parsed = retryParsed;
  }

  // Citation grounding check. Done after schema validation so we know
  // `fundamentalCitations` shape is sound.
  const citationCheck = validateFundamentalCitations(
    parsed.fundamentalCitations,
    snapshot,
  );

  if (!citationCheck.ok) {
    const correction = `\n\n[KOREKSI WAJIB — GROUNDING] ${citationCheck.reason} Output ulang analisis menggunakan HANYA judul berita / nama event yang BENAR-BENAR ada di blok BERITA TERKINI RELEVAN dan KALENDER EKONOMI RELEVAN di atas. Jika tidak ada item yang relevan, kosongkan fundamentalCitations.newsTitles / fundamentalCitations.calendarEvents dan tulis "Tidak ada katalis fundamental signifikan terdeteksi pada window ini" pada blok fundamental yang sesuai.`;
    const retryRaw = await trackedCallOpenAI(
      effectiveSystemPrompt,
      baseUserMessage + correction,
      selectedModel,
      maxTokens,
      analysisTimeoutMs,
    );
    const retryParsed = parseAttempt(retryRaw);
    const retryTradePlanCheck = validateTradePlanQuality(
      retryParsed.tradePlan,
      priceAnchor,
      timeframe,
      instrument,
    );
    if (!retryTradePlanCheck.ok) {
      throw new Error(
        `AI trade-plan quality failed after grounding retry: ${retryTradePlanCheck.reason}`,
      );
    }
    const retryCheck = validateFundamentalCitations(
      retryParsed.fundamentalCitations,
      snapshot,
    );
    if (retryCheck.ok) return wrap(finalizeOutput(retryParsed));
    // Hard fail after the corrective retry — the route turns this into
    // an HTTP 502 / quota refund, which is preferable to returning
    // ungrounded fundamental prose.
    console.warn(
      `[generateAnalysis] Citation grounding still failed after retry: ${retryCheck.reason}`,
    );
    throw new Error(
      `AI fundamental grounding failed after retry: ${retryCheck.reason}`,
    );
  }

  return wrap(finalizeOutput(parsed));
}
