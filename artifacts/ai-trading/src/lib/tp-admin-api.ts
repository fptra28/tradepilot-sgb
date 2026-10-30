import { keepPreviousData, useQuery } from "@tanstack/react-query";

/*
 * Klien API dashboard admin TradePilot v1 (`/api/admin/trade-pilot/*`).
 * Memakai cookie sesi web (role admin/super_admin) — bukan API key v1.
 */

export type Mode = "demo" | "real";
export type KeyCount = { key: string; count: number };
export type HealthStatus = "healthy" | "warning" | "critical" | "unknown";

/** Hasil analisis per kategori: TP (TP1+TP2), SL, kedaluwarsa, masih berjalan. */
export type QualityRow = { key: string; total: number; tp: number; sl: number; expired: number; open: number };

export type Overview = {
  days: number;
  users: { total: number; new24h: number; newInRange: number; activeInRange: number };
  analyses: {
    total: number;
    last24h: number;
    byMode: KeyCount[];
    byInstrument: KeyCount[];
    byTimeframe: KeyCount[];
    byStatus: KeyCount[];
    byDirection: KeyCount[];
  };
  /** Opsional: backend sebelum kualitas sinyal tidak mengirim field ini. */
  quality?: {
    byInstrument: QualityRow[];
    byTimeframe: QualityRow[];
    byDirection: QualityRow[];
  };
  ai: {
    tokens: number;
    costUsd: number;
    costUsd24h: number;
    cacheHits: number;
    cacheHitRate: number;
    avgCostPerAnalysisUsd: number;
    byModel: KeyCount[];
  };
  daily: Array<{ date: string; analyses: number; users: number; costUsd: number; tokens: number; cacheHits: number }>;
  alerts: { active: number; triggeredInRange: number };
  credits: Array<{
    mode: Mode;
    allowance: number;
    period: "daily" | "weekly" | "monthly";
    usersInPeriod: number;
    consumed: number;
    allowanceTotal?: number;
    exhausted: number;
  }>;
  topUsers: Array<{ userId: string; analyses: number; costUsd: number; lastAnalysisAt: string | null }>;
};

export type AnalysisRow = {
  id: string;
  userId: string;
  mode: Mode;
  instrumentId: string;
  instrumentLabel: string;
  timeframe: string;
  timeframeLabel: string;
  direction: string;
  marketSentiment: string;
  status: string;
  priceAtAnalysis: string;
  analyzedAt: string;
  validUntil: string;
  resolvedAt: string | null;
  model: string | null;
  aiCacheHit: boolean;
  totalTokens: number;
  estimatedCostUsd: number;
  requestId: string | null;
};

export type Page<T> = { page: number; limit: number; total: number; items: T[] };

export type Levels = { entry: string; stopLoss: string; takeProfitOne: string; takeProfitTwo: string };

export type AlertRow = {
  id: string;
  side: string;
  levels: string[];
  channels: string[];
  active: boolean;
  lastTriggeredLevel: string | null;
  triggeredLevels: Record<string, string>;
  createdAt: string;
  updatedAt: string;
};

export type AnalysisDetail = Omit<AnalysisRow, "model" | "aiCacheHit" | "totalTokens" | "estimatedCostUsd" | "requestId"> & {
  activeSide: string | null;
  lastEvaluatedPrice: string | null;
  buyLevels: Levels;
  sellLevels: Levels;
  indicators: Array<{ key?: string; label: string; group: string; value: string; status: string; marker: number }>;
  marketContext: Record<string, { title: string; description: string; note: string }> | null;
  takeProfitOneHitAt: string | null;
  candleCount: number | null;
  candleAsOf: string | null;
  audit: {
    model: string | null;
    promptVersion: string | null;
    requestId: string | null;
    aiCacheHit: boolean;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    estimatedCostUsd: number;
    aiInput: unknown;
    aiOutput: unknown;
  };
  alerts: AlertRow[];
  tradingPlans: Array<{
    id: string;
    variant: string;
    accountType: string;
    tradingCapital: string;
    lossLimit: string;
    riskStyle: string;
    result: Record<string, unknown> | null;
    createdAt: string;
  }>;
};

export type CreditView = {
  mode: Mode;
  allowance: number;
  consumed: number;
  remaining: number;
  resetsAt: string | null;
  inPeriod: boolean;
} | null;

export type UserRow = {
  userId: string;
  firstSeenMode: Mode;
  createdAt: string;
  bootstrappedAt: string | null;
  analyses: number;
  costUsd: number;
  lastAnalysisAt: string | null;
  activeAlerts: number;
  credits: Partial<Record<Mode, CreditView>>;
};

export type UserDetail = {
  userId: string;
  firstSeenMode: Mode;
  createdAt: string;
  bootstrappedAt: string | null;
  credits: NonNullable<CreditView>[];
  statsByMode: Array<{ mode: Mode; analyses: number; costUsd: number; tokens: number; lastAnalysisAt: string | null }>;
  byStatus: KeyCount[];
  tradingPlans: number;
  recentAnalyses: Array<{
    id: string;
    mode: Mode;
    instrumentLabel: string;
    timeframeLabel: string;
    direction: string;
    status: string;
    analyzedAt: string;
    estimatedCostUsd: number;
    aiCacheHit: boolean;
  }>;
  alerts: Array<AlertRow & { analysisId: string; mode: Mode; instrumentLabel: string; timeframeLabel: string }>;
};

export type CreditsAlerts = {
  policies: Array<{
    mode: Mode;
    allowance: number;
    period: "daily" | "weekly" | "monthly";
    usersInPeriod: number;
    consumed: number;
    allowanceTotal: number;
    exhausted: number;
    partiallyUsed: number;
  }>;
  exhausted: Array<{ userId: string; mode: Mode; allowance: number; consumed: number; resetsAt: string; updatedAt: string }>;
  alerts: Array<AlertRow & {
    userId: string;
    analysisId: string;
    mode: Mode;
    instrumentLabel: string;
    timeframeLabel: string;
    analysisStatus: string;
  }>;
};

export class AdminApiError extends Error {
  constructor(
    readonly status: number,
    /** Kode error dari server (mis. "last_super_admin"), bila ada. */
    readonly code: string | null = null,
  ) {
    super(`Admin API request failed (${status})`);
  }
}

function buildUrl(path: string, params?: Record<string, string | number | undefined | null>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== undefined && value !== null && value !== "") search.set(key, String(value));
  }
  const query = search.toString();
  return `/api/admin/trade-pilot${path}${query ? `?${query}` : ""}`;
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { credentials: "include", headers: { Accept: "application/json" } });
  if (!response.ok) throw new AdminApiError(response.status);
  return response.json() as Promise<T>;
}

export function useOverview(days: number) {
  const url = buildUrl("/overview", { days });
  return useQuery({ queryKey: ["tp-admin", url], queryFn: () => getJson<Overview>(url), placeholderData: keepPreviousData });
}

export type AnalysisFilters = {
  page?: number;
  limit?: number;
  mode?: string;
  instrumentId?: string;
  timeframe?: string;
  status?: string;
  direction?: string;
  cacheHit?: string;
  userId?: string;
  q?: string;
  from?: string;
  to?: string;
};

/** Ringkasan hasil untuk filter yang sama (opsional: backend lama tidak mengirim). */
export type AnalysisSummary = { total: number; tp: number; sl: number; expired: number; open: number; costUsd: number };
export type AnalysisPage = Page<AnalysisRow> & { summary?: AnalysisSummary };

export function useAnalyses(filters: AnalysisFilters) {
  const url = buildUrl("/analyses", filters);
  return useQuery({ queryKey: ["tp-admin", url], queryFn: () => getJson<AnalysisPage>(url), placeholderData: keepPreviousData });
}

export function useAnalysisDetail(id: string) {
  const url = buildUrl(`/analyses/${encodeURIComponent(id)}`);
  return useQuery({ queryKey: ["tp-admin", url], queryFn: () => getJson<AnalysisDetail>(url) });
}

export function useUsers(params: { page?: number; q?: string; sort?: string }) {
  const url = buildUrl("/users", { ...params, limit: 25 });
  return useQuery({ queryKey: ["tp-admin", url], queryFn: () => getJson<Page<UserRow>>(url), placeholderData: keepPreviousData });
}

export type EmailLookupResult =
  | { found: true; userId: string }
  | { found: false; userId: null };

/** POST supaya email tidak masuk URL/log akses; tidak di-cache. */
export async function lookupUserByEmail(email: string): Promise<EmailLookupResult> {
  const response = await fetch(buildUrl("/users/lookup"), {
    method: "POST",
    credentials: "include",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  if (!response.ok) throw new AdminApiError(response.status);
  return response.json() as Promise<EmailLookupResult>;
}

export type CreditAdjustment = { action: "reset" } | { action: "set"; remaining: number };

/** Khusus super_admin: ubah kredit periode berjalan untuk satu pengguna & mode. */
export async function adjustUserCredit(userId: string, mode: Mode, adjustment: CreditAdjustment) {
  const response = await fetch(buildUrl(`/users/${encodeURIComponent(userId)}/credits/${mode}`), {
    method: "POST",
    credentials: "include",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(adjustment),
  });
  if (!response.ok) throw new AdminApiError(response.status);
  return response.json() as Promise<{ credit: NonNullable<CreditView> }>;
}

/** "budi.santoso@gmail.com" -> "b***o@gmail.com" */
export function maskEmail(email: string) {
  const [local = "", domain = ""] = email.split("@");
  if (!domain) return "***";
  const head = local.slice(0, 1);
  const tail = local.length > 2 ? local.slice(-1) : "";
  return `${head}***${tail}@${domain}`;
}

export function useUserDetail(userId: string) {
  const url = buildUrl(`/users/${encodeURIComponent(userId)}`);
  return useQuery({ queryKey: ["tp-admin", url], queryFn: () => getJson<UserDetail>(url) });
}

export function useCreditsAlerts(alertStatus: string) {
  const url = buildUrl("/credits-alerts", { alertStatus });
  return useQuery({ queryKey: ["tp-admin", url], queryFn: () => getJson<CreditsAlerts>(url), placeholderData: keepPreviousData });
}

// ---------------------------------------------------------------------------
// Formatter (zona waktu operasional: Asia/Jakarta)
// ---------------------------------------------------------------------------

const TZ = "Asia/Jakarta";

export function formatDateTime(value: string | null | undefined, lang: "en" | "id") {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(lang === "id" ? "id-ID" : "en-GB", {
    timeZone: TZ,
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function formatShortDate(value: string, lang: "en" | "id") {
  const date = new Date(`${value}T00:00:00Z`);
  return new Intl.DateTimeFormat(lang === "id" ? "id-ID" : "en-GB", { timeZone: "UTC", day: "2-digit", month: "short" }).format(date);
}

export function formatNumber(value: number, lang: "en" | "id") {
  return new Intl.NumberFormat(lang === "id" ? "id-ID" : "en-US").format(value);
}

export function formatUsd(value: number, lang: "en" | "id") {
  const digits = value !== 0 && Math.abs(value) < 0.1 ? 4 : 2;
  return new Intl.NumberFormat(lang === "id" ? "id-ID" : "en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

export function formatPercent(value: number, lang: "en" | "id") {
  return new Intl.NumberFormat(lang === "id" ? "id-ID" : "en-US", { style: "percent", maximumFractionDigits: 1 }).format(value);
}

export function shortId(value: string, size = 10) {
  return value.length > size ? `${value.slice(0, size)}…` : value;
}

export function fill(template: string, values: Record<string, string | number>) {
  return Object.entries(values).reduce((text, [key, value]) => text.replaceAll(`{${key}}`, String(value)), template);
}

// ---------------------------------------------------------------------------
// Log audit, pengaturan, akun admin
// ---------------------------------------------------------------------------

async function sendJson<T>(method: "POST" | "PUT" | "PATCH", path: string, body: unknown): Promise<T> {
  const response = await fetch(buildUrl(path), {
    method,
    credentials: "include",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: unknown } | null;
    throw new AdminApiError(response.status, typeof payload?.error === "string" ? payload.error : null);
  }
  return response.json() as Promise<T>;
}

export type AuditItem = {
  id: number;
  action: string;
  adminUserId: number;
  adminEmail: string | null;
  adminName: string | null;
  adminRole: string | null;
  targetUserId: string | null;
  found: boolean;
  requestId: string | null;
  details: Record<string, unknown> | null;
  createdAt: string;
};

export type AuditPage = Page<AuditItem> & {
  admins: Array<{ id: number; email: string; displayName: string }>;
};

export function useAudit(params: { page?: number; action?: string; adminUserId?: string; targetUserId?: string }) {
  const url = buildUrl("/audit", params);
  return useQuery({ queryKey: ["tp-admin", url], queryFn: () => getJson<AuditPage>(url), placeholderData: keepPreviousData });
}

export type CreditPeriod = "daily" | "weekly" | "monthly";
export type QuotaSettings = Record<Mode, { allowance: number; period: CreditPeriod }>;
export type Toggles<K extends string> = Partial<Record<K, boolean>>;
export type AvailabilitySettings = {
  enabled: boolean;
  modes: Toggles<Mode>;
  instruments: Toggles<"gold" | "brent" | "hang-seng" | "nikkei">;
  timeframes: Toggles<"1" | "5" | "15" | "30" | "60" | "240" | "D" | "W" | "M">;
  message: { id: string | null; en: string | null };
};
type SettingMeta = { updatedAt: string | null; updatedBy: string | null } | null;

export type SettingsResponse = {
  quota: { current: QuotaSettings; defaults: QuotaSettings; custom: boolean; meta: SettingMeta };
  availability: { current: AvailabilitySettings; meta: SettingMeta };
};

export function useSettings() {
  const url = buildUrl("/settings");
  return useQuery({ queryKey: ["tp-admin", url], queryFn: () => getJson<SettingsResponse>(url) });
}

export type SystemHealth = {
  capturedAt: string;
  overall: HealthStatus;
  candles: {
    status: HealthStatus;
    observed: number;
    items: Array<{
      instrumentId: string;
      timeframe: string;
      status: HealthStatus;
      checkedAt: string | null;
      lastSuccessAt: string | null;
      lastFailureAt: string | null;
      candleAsOf: string | null;
      sourceFetchedAt: string | null;
      sourceMaxAgeMs: number | null;
      staleReason: string | null;
      observationAgeMs: number | null;
    }>;
  };
  openai: {
    status: HealthStatus;
    total: number;
    failed: number;
    failureRate: number;
    windowHours: number;
    lastSuccessAt: string | null;
    lastFailureAt: string | null;
    checkedAt: string | null;
    details: Record<string, unknown>;
  };
  jobs: Array<{
    key: "signal_evaluation" | "performance_aggregation";
    status: HealthStatus;
    lastSuccessAt: string | null;
    lastFailureAt: string | null;
    checkedAt: string | null;
    details: Record<string, unknown>;
  }>;
  webhook: {
    configured: boolean;
    status: HealthStatus;
    total: number;
    failed: number;
    failureRate: number;
    windowHours: number;
    lastSuccessAt: string | null;
    lastFailureAt: string | null;
    checkedAt: string | null;
    details: Record<string, unknown>;
  };
};

export function useSystemHealth() {
  const url = buildUrl("/health");
  return useQuery({
    queryKey: ["tp-admin", url],
    queryFn: () => getJson<SystemHealth>(url),
    refetchInterval: 30_000,
  });
}

export function saveQuotaSettings(quota: QuotaSettings, applyToCurrentPeriod: boolean) {
  return sendJson<{ quota: QuotaSettings; applied: Partial<Record<Mode, number>> }>(
    "PUT",
    "/settings/quota",
    { ...quota, applyToCurrentPeriod },
  );
}

export function saveAvailabilitySettings(availability: AvailabilitySettings) {
  return sendJson<{ availability: AvailabilitySettings }>("PUT", "/settings/availability", availability);
}

export type StaffRole = "admin" | "super_admin";
export type StaffMember = {
  id: number;
  email: string;
  displayName: string;
  role: StaffRole;
  createdAt: string;
  hasPassword: boolean;
  lastSessionAt: string | null;
};

export function useStaff() {
  const url = buildUrl("/staff");
  return useQuery({ queryKey: ["tp-admin", url], queryFn: () => getJson<{ items: StaffMember[] }>(url) });
}

export function createStaff(input: { email: string; displayName?: string; role: StaffRole; password?: string }) {
  return sendJson<{ id: number; created: boolean }>("POST", "/staff", input);
}

export function changeStaffRole(id: number, role: StaffRole | "user") {
  return sendJson<{ id: number; role: string }>("PATCH", `/staff/${id}/role`, { role });
}

export function resetStaffPassword(id: number, newPassword: string) {
  return sendJson<{ id: number; reset: boolean }>("POST", `/staff/${id}/password`, { newPassword });
}
