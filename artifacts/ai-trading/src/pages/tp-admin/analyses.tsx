import { useState } from "react";
import { Link, useLocation } from "wouter";
import { ChevronDown, RotateCcw, SlidersHorizontal } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { formatDateTime, formatNumber, formatPercent, formatUsd, shortId, useAnalyses, type AnalysisSummary } from "@/lib/tp-admin-api";
import { AdminShell } from "@/components/tp-admin/admin-shell";
import { DateField } from "@/components/tp-admin/date-field";
import { DraftTextFilter } from "@/components/tp-admin/draft-input";
import { useUrlFilters } from "@/components/tp-admin/use-url-filters";
import {
  DirectionText,
  ModeBadge,
  PageHeader,
  Pagination,
  Panel,
  QueryState,
  Segmented,
  SelectFilter,
  StatusBadge,
  TableShell,
  UserIdLink,
  td,
  th,
  useStatusLabel,
} from "@/components/tp-admin/ui";

const FILTER_KEYS = [
  "page",
  "mode",
  "instrumentId",
  "timeframe",
  "status",
  "direction",
  "cacheHit",
  "userId",
  "q",
  "from",
  "to",
] as const;
const ADVANCED_KEYS = ["mode", "direction", "cacheHit", "userId"] as const;

const INSTRUMENTS = [
  { value: "gold", label: "XAU/USD" },
  { value: "brent", label: "BCO" },
  { value: "hang-seng", label: "HKK" },
  { value: "nikkei", label: "JPK" },
];
const TIMEFRAMES = [
  ["1", "1m"], ["5", "5m"], ["15", "15m"], ["30", "30m"], ["60", "1h"], ["240", "4h"], ["D", "1D"], ["W", "1W"], ["M", "1M"],
].map(([value, label]) => ({ value, label }));
const STATUSES = ["still_valid", "take_profit_1", "take_profit_2", "stop_loss", "expired", "invalid"];

type Period = "all" | "today" | "7d" | "30d" | "custom";

/** Tanggal (YYYY-MM-DD) di zona Jakarta, mundur `daysBack` hari. */
function jakartaDate(daysBack = 0) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date(Date.now() - daysBack * 86_400_000));
}

function periodFromRange(from: string, to: string): Period {
  if (!from && !to) return "all";
  const today = jakartaDate();
  if (to === today && from === today) return "today";
  if (to === today && from === jakartaDate(6)) return "7d";
  if (to === today && from === jakartaDate(29)) return "30d";
  return "custom";
}

const cellCompact = "py-2.5";

function SummaryStrip({ summary }: { summary: AnalysisSummary }) {
  const { t, lang } = useTranslation();
  const num = (value: number) => formatNumber(value, lang);
  const resolved = summary.tp + summary.sl;
  const items = [
    { label: t.tpAdmin.summary_total, value: num(summary.total) },
    { label: t.tpAdmin.quality_tp, value: num(summary.tp), color: "var(--viz-good)" },
    { label: t.tpAdmin.quality_sl, value: num(summary.sl), color: "var(--viz-critical)" },
    { label: t.tpAdmin.quality_rate, value: resolved > 0 ? formatPercent(summary.tp / resolved, lang) : "—" },
    { label: t.tpAdmin.quality_open, value: num(summary.open) },
    { label: t.tpAdmin.summary_cost, value: formatUsd(summary.costUsd, lang) },
  ];
  return (
    <div className="grid grid-cols-2 overflow-hidden rounded-[11px] border border-card-border bg-card sm:grid-cols-3 xl:grid-cols-6">
      {items.map((item) => (
        <div key={item.label} className="border-b border-r border-card-border px-4 py-3 last:border-r-0 xl:border-b-0">
          <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground">{item.label}</p>
          <p className="tabular mt-1 text-lg font-semibold leading-tight" style={item.color ? { color: item.color } : undefined}>
            {item.value}
          </p>
        </div>
      ))}
    </div>
  );
}

export default function TpAdminAnalysesPage() {
  const { t, lang } = useTranslation();
  const statusLabel = useStatusLabel();
  const [, setLocation] = useLocation();
  const { values, set, reset } = useUrlFilters(FILTER_KEYS);
  const page = Math.max(1, Number(values.page) || 1);
  const query = useAnalyses({ ...values, page, limit: 25 });
  const data = query.data;
  const hasFilters = FILTER_KEYS.some((key) => key !== "page" && values[key]);
  const advancedCount = ADVANCED_KEYS.filter((key) => values[key]).length;
  const [showAdvanced, setShowAdvanced] = useState(advancedCount > 0);
  const rangePeriod = periodFromRange(values.from, values.to);
  const [customOpen, setCustomOpen] = useState(rangePeriod === "custom");
  const period: Period = customOpen ? "custom" : rangePeriod;

  const choosePeriod = (next: Period) => {
    if (next === "custom") {
      setCustomOpen(true);
      return;
    }
    setCustomOpen(false);
    const today = jakartaDate();
    const from = next === "today" ? today : next === "7d" ? jakartaDate(6) : next === "30d" ? jakartaDate(29) : "";
    set("from", from);
    set("to", next === "all" ? "" : today);
  };

  return (
    <AdminShell>
      <PageHeader title={t.tpAdmin.analyses_title} subtitle={t.tpAdmin.analyses_subtitle} />

      <Panel>
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-[minmax(220px,1.4fr)_repeat(3,minmax(0,1fr))]">
            <DraftTextFilter
              label={t.tpAdmin.filter_search}
              value={values.q}
              onCommit={(v) => set("q", v)}
              placeholder={t.tpAdmin.filter_analysis_placeholder}
            />
            <SelectFilter label={t.tpAdmin.instrument} value={values.instrumentId} onChange={(v) => set("instrumentId", v)} options={INSTRUMENTS} />
            <SelectFilter label={t.tpAdmin.timeframe} value={values.timeframe} onChange={(v) => set("timeframe", v)} options={TIMEFRAMES} />
            <SelectFilter
              label={t.tpAdmin.status}
              value={values.status}
              onChange={(v) => set("status", v)}
              options={STATUSES.map((value) => ({ value, label: statusLabel(value) }))}
            />
          </div>

          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div className="flex flex-col gap-3 md:flex-row md:items-end">
              <div className="flex flex-col gap-1 text-xs text-muted-foreground">
                {t.tpAdmin.filter_period}
                <div className="overflow-x-auto">
                  <Segmented
                    label={t.tpAdmin.filter_period}
                    value={period}
                    onChange={choosePeriod}
                    options={[
                      { value: "all", label: t.tpAdmin.filter_period_all },
                      { value: "today", label: t.tpAdmin.filter_period_today },
                      { value: "7d", label: t.tpAdmin.filter_period_7d },
                      { value: "30d", label: t.tpAdmin.filter_period_30d },
                      { value: "custom", label: t.tpAdmin.filter_period_custom },
                    ]}
                  />
                </div>
              </div>
              {period === "custom" ? (
                <div className="grid grid-cols-2 gap-3 md:w-[320px]">
                  <DateField label={t.tpAdmin.filter_from} value={values.from} onChange={(v) => set("from", v)} pickerLabel={t.tpAdmin.filter_open_calendar} />
                  <DateField label={t.tpAdmin.filter_to} value={values.to} onChange={(v) => set("to", v)} pickerLabel={t.tpAdmin.filter_open_calendar} />
                </div>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setShowAdvanced((open) => !open)}
                aria-expanded={showAdvanced}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-xs text-foreground transition hover:border-primary/30 hover:bg-accent"
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
                {t.tpAdmin.filter_more}
                {advancedCount > 0 ? (
                  <span className="tabular rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground">{advancedCount}</span>
                ) : null}
                <ChevronDown className={`h-3.5 w-3.5 transition ${showAdvanced ? "rotate-180" : ""}`} />
              </button>
              {hasFilters ? (
                <button
                  type="button"
                  onClick={() => {
                    setCustomOpen(false);
                    reset();
                  }}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-xs text-muted-foreground transition hover:bg-accent hover:text-foreground"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  {t.tpAdmin.filter_reset}
                </button>
              ) : null}
            </div>
          </div>

          {showAdvanced ? (
            <div className="grid grid-cols-2 gap-3 border-t border-border pt-4 md:grid-cols-4">
              <SelectFilter
                label={t.tpAdmin.mode}
                value={values.mode}
                onChange={(v) => set("mode", v)}
                options={[
                  { value: "demo", label: t.tpAdmin.mode_demo },
                  { value: "real", label: t.tpAdmin.mode_real },
                ]}
              />
              <SelectFilter
                label={t.tpAdmin.direction}
                value={values.direction}
                onChange={(v) => set("direction", v)}
                options={[
                  { value: "bullish", label: t.tpAdmin.direction_bullish },
                  { value: "bearish", label: t.tpAdmin.direction_bearish },
                  { value: "neutral", label: t.tpAdmin.direction_neutral },
                ]}
              />
              <SelectFilter
                label={t.tpAdmin.cache}
                value={values.cacheHit}
                onChange={(v) => set("cacheHit", v)}
                options={[
                  { value: "true", label: t.tpAdmin.cache_hit },
                  { value: "false", label: t.tpAdmin.cache_miss },
                ]}
              />
              <DraftTextFilter
                label={t.tpAdmin.filter_user}
                value={values.userId}
                onCommit={(v) => set("userId", v.toLowerCase())}
                placeholder={t.tpAdmin.filter_user_placeholder}
              />
            </div>
          ) : null}
        </div>
      </Panel>

      {data?.summary ? <SummaryStrip summary={data.summary} /> : null}

      <Panel bodyClassName="p-0">
        <QueryState
          isLoading={query.isLoading}
          error={query.error}
          onRetry={() => void query.refetch()}
          isEmpty={data?.items.length === 0}
        >
          {data ? (
            <>
              <TableShell>
                <table className="w-full">
                  <thead>
                    <tr>
                      <th className={th}>{t.tpAdmin.time}</th>
                      <th className={th}>{t.tpAdmin.instrument}</th>
                      <th className={th}>{t.tpAdmin.direction}</th>
                      <th className={th}>{t.tpAdmin.status}</th>
                      <th className={th}>{t.tpAdmin.user}</th>
                      <th className={th}>{t.tpAdmin.mode}</th>
                      <th className={`${th} text-right`}>{t.tpAdmin.cost}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map((row) => (
                      <tr
                        key={row.id}
                        onClick={(event) => {
                          // Klik baris = buka detail, kecuali saat klik link/tombol di dalamnya.
                          if ((event.target as HTMLElement).closest("a,button")) return;
                          setLocation(`/admin/analyses/${row.id}`);
                        }}
                        className="cursor-pointer border-t border-border transition hover:bg-accent/40"
                      >
                        <td className={`${td} ${cellCompact}`}>
                          <Link href={`/admin/analyses/${row.id}`} className="block text-foreground hover:text-primary" title={row.id}>
                            {formatDateTime(row.analyzedAt, lang)}
                          </Link>
                          <span className="mt-0.5 block font-mono text-[10px] text-muted-foreground">{shortId(row.id, 16)}</span>
                        </td>
                        <td className={`${td} ${cellCompact}`}>
                          <span className="font-medium">{row.instrumentLabel}</span>
                          <span className="ml-1.5 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{row.timeframeLabel}</span>
                        </td>
                        <td className={`${td} ${cellCompact}`}><DirectionText direction={row.direction} /></td>
                        <td className={`${td} ${cellCompact}`}><StatusBadge status={row.status} /></td>
                        <td className={`${td} ${cellCompact}`}><UserIdLink userId={row.userId} size={10} /></td>
                        <td className={`${td} ${cellCompact}`}><ModeBadge mode={row.mode} /></td>
                        <td className={`${td} ${cellCompact} text-right`}>
                          <span className="tabular block">{formatUsd(row.estimatedCostUsd, lang)}</span>
                          <span className="tabular mt-0.5 block text-[10px] text-muted-foreground">
                            {row.aiCacheHit ? `${t.tpAdmin.cache_hit} · ` : ""}
                            {formatNumber(row.totalTokens, lang)} {t.tpAdmin.tokens.toLowerCase()}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableShell>
              <Pagination page={data.page} limit={data.limit} total={data.total} onPage={(p) => set("page", String(p))} />
            </>
          ) : null}
        </QueryState>
      </Panel>
    </AdminShell>
  );
}
