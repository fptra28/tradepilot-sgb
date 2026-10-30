import { useState, type ReactNode } from "react";
import { Link } from "wouter";
import { Activity, ChevronRight, Coins, PauseCircle, ShieldCheck } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import {
  fill,
  formatDateTime,
  formatNumber,
  formatPercent,
  formatUsd,
  useOverview,
  useSettings,
  useSystemHealth,
  type HealthStatus,
  type Overview,
  type QualityRow,
} from "@/lib/tp-admin-api";
import { useAuth } from "@/components/auth-provider";
import { AdminShell } from "@/components/tp-admin/admin-shell";
import { SectionTabs } from "@/components/tp-admin/section-tabs";
import { BreakdownList, DailyBarChart } from "@/components/tp-admin/charts";
import { useScopeLabels } from "@/components/tp-admin/scope-labels";
import {
  Kpi,
  ModeBadge,
  PageHeader,
  Panel,
  QueryState,
  Segmented,
  TableShell,
  UserIdLink,
  statusColor,
  td,
  th,
  useDirectionLabel,
  useStatusLabel,
} from "@/components/tp-admin/ui";

type Tone = "good" | "warning" | "critical" | "neutral";

const TONE_COLOR: Record<Tone, string> = {
  good: "var(--viz-good)",
  warning: "var(--viz-warning)",
  critical: "var(--viz-critical)",
  neutral: "var(--viz-neutral)",
};

function healthTone(status: HealthStatus | undefined): Tone {
  return status === "healthy" ? "good" : status === "warning" ? "warning" : status === "critical" ? "critical" : "neutral";
}

/** Tingkat TP = TP / (TP + SL); null bila belum ada analisis yang selesai. */
function tpRate(row: { tp: number; sl: number }) {
  return row.tp + row.sl > 0 ? row.tp / (row.tp + row.sl) : null;
}

function StatusCard({
  icon,
  label,
  value,
  tone,
  href,
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  tone: Tone;
  href?: string;
}) {
  const { t } = useTranslation();
  const body = (
    <>
      <span
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
        style={{ background: `color-mix(in srgb, ${TONE_COLOR[tone]} 14%, transparent)`, color: TONE_COLOR[tone] }}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">{label}</span>
        <span className="mt-1 block truncate text-sm font-semibold text-foreground">{value}</span>
      </span>
      {href ? (
        <span className="inline-flex shrink-0 items-center gap-0.5 text-[11px] text-muted-foreground transition group-hover:text-primary">
          {t.tpAdmin.status_open}
          <ChevronRight className="h-3.5 w-3.5" />
        </span>
      ) : null}
    </>
  );
  const className =
    "group flex min-w-0 items-center gap-3 rounded-[11px] border border-card-border bg-card px-4 py-3.5 transition";
  return href ? (
    <Link href={href} className={`${className} hover:border-primary/35`}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}

function StatusStrip({ data }: { data: Overview }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const settings = useSettings();
  const health = useSystemHealth();
  const labels = useScopeLabels();
  const availability = settings.data?.availability.current;
  const paused = availability ? labels.pausedScopes(availability) : [];
  const availabilityTone: Tone = !availability ? "neutral" : !availability.enabled ? "critical" : paused.length ? "warning" : "good";
  const availabilityText = !availability
    ? "—"
    : !availability.enabled
      ? t.tpAdmin.status_availability_global
      : paused.length
        ? fill(t.tpAdmin.status_availability_partial, { items: paused.join(", ") })
        : t.tpAdmin.status_availability_all;

  const overall = health.data?.overall;
  const exhausted = data.credits.reduce((sum, row) => sum + row.exhausted, 0);

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
      <StatusCard
        icon={availabilityTone === "good" ? <ShieldCheck className="h-[18px] w-[18px]" /> : <PauseCircle className="h-[18px] w-[18px]" />}
        label={t.tpAdmin.status_availability}
        value={<span title={availabilityText}>{availabilityText}</span>}
        tone={availabilityTone}
        href={user?.role === "super_admin" ? "/admin/settings" : undefined}
      />
      <StatusCard
        icon={<Activity className="h-[18px] w-[18px]" />}
        label={t.tpAdmin.status_health}
        value={overall ? (t.tpAdmin as Record<string, string>)[`health_status_${overall}`] : "—"}
        tone={healthTone(overall)}
        href="/admin/health"
      />
      <StatusCard
        icon={<Coins className="h-[18px] w-[18px]" />}
        label={t.tpAdmin.status_credits}
        value={exhausted > 0 ? fill(t.tpAdmin.status_credits_exhausted, { n: exhausted }) : t.tpAdmin.status_credits_none}
        tone={exhausted > 0 ? "warning" : "good"}
        href="/admin/users/credits"
      />
    </div>
  );
}

const OUTCOME_ORDER = ["take_profit_2", "take_profit_1", "stop_loss", "expired", "still_valid"] as const;

function OutcomePanel({ data }: { data: Overview }) {
  const { t, lang } = useTranslation();
  const statusLabel = useStatusLabel();
  const counts = new Map(data.analyses.byStatus.map((item) => [item.key, item.count]));
  const items = [
    ...OUTCOME_ORDER.map((key) => ({ key, count: counts.get(key) ?? 0 })),
    ...data.analyses.byStatus.filter((item) => !OUTCOME_ORDER.includes(item.key as (typeof OUTCOME_ORDER)[number])),
  ];
  const total = items.reduce((sum, item) => sum + item.count, 0);
  const open = counts.get("still_valid") ?? 0;
  const pct = (value: number) => formatPercent(total > 0 ? value / total : 0, lang);

  return (
    <Panel title={t.tpAdmin.outcome_title}>
      {total === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">{t.tpAdmin.empty}</p>
      ) : (
        <>
          <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted" role="img" aria-label={t.tpAdmin.outcome_title}>
            {items.filter((item) => item.count > 0).map((item) => (
              <span
                key={item.key}
                title={`${statusLabel(item.key)}: ${formatNumber(item.count, lang)} (${pct(item.count)})`}
                style={{ width: `${(item.count / total) * 100}%`, background: statusColor(item.key) }}
                className="h-full border-r border-card last:border-r-0"
              />
            ))}
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            {fill(t.tpAdmin.outcome_resolved, { n: formatNumber(total - open, lang), m: formatNumber(open, lang) })}
          </p>
          <ul className="mt-4 space-y-2.5">
            {items.map((item) => (
              <li key={item.key} className="flex items-center justify-between gap-3 text-xs">
                <span className="flex items-center gap-2 text-foreground">
                  <span className="h-2.5 w-2.5 rounded-sm" style={{ background: statusColor(item.key) }} />
                  {statusLabel(item.key)}
                </span>
                <span className="tabular text-muted-foreground">
                  <span className="font-medium text-foreground">{formatNumber(item.count, lang)}</span> · {pct(item.count)}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Panel>
  );
}

type QualityDim = "instrument" | "timeframe" | "direction";

function QualityPanel({ data }: { data: Overview }) {
  const { t, lang } = useTranslation();
  const directionLabel = useDirectionLabel();
  const [dim, setDim] = useState<QualityDim>("instrument");
  const quality = data.quality ?? { byInstrument: [], byTimeframe: [], byDirection: [] };
  const rows: QualityRow[] =
    dim === "instrument" ? quality.byInstrument : dim === "timeframe" ? quality.byTimeframe : quality.byDirection;
  const label = (key: string) => (dim === "direction" ? directionLabel(key) : key);
  const num = (value: number) => formatNumber(value, lang);

  return (
    <Panel
      title={t.tpAdmin.quality_title}
      bodyClassName="p-0"
      className="xl:col-span-2"
      actions={
        <Segmented
          label={t.tpAdmin.quality_title}
          value={dim}
          onChange={setDim}
          options={[
            { value: "instrument", label: t.tpAdmin.instrument },
            { value: "timeframe", label: t.tpAdmin.timeframe },
            { value: "direction", label: t.tpAdmin.direction },
          ]}
        />
      }
    >
      {rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">{t.tpAdmin.empty}</p>
      ) : (
        <TableShell>
          <table className="w-full">
            <thead>
              <tr>
                <th className={th}>{dim === "instrument" ? t.tpAdmin.instrument : dim === "timeframe" ? t.tpAdmin.timeframe : t.tpAdmin.direction}</th>
                <th className={`${th} text-right`}>{t.tpAdmin.kpi_analyses}</th>
                <th className={`${th} text-right`}>{t.tpAdmin.quality_tp}</th>
                <th className={`${th} text-right`}>{t.tpAdmin.quality_sl}</th>
                <th className={`${th} hidden text-right md:table-cell`}>{t.tpAdmin.quality_expired}</th>
                <th className={`${th} hidden text-right md:table-cell`}>{t.tpAdmin.quality_open}</th>
                <th className={`${th} w-[30%]`}>{t.tpAdmin.quality_rate}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const rate = tpRate(row);
                return (
                  <tr key={row.key} className="border-t border-border">
                    <td className={`${td} font-medium`}>{label(row.key)}</td>
                    <td className={`${td} tabular text-right`}>{num(row.total)}</td>
                    <td className={`${td} tabular text-right`} style={{ color: "var(--viz-good)" }}>{num(row.tp)}</td>
                    <td className={`${td} tabular text-right`} style={{ color: "var(--viz-critical)" }}>{num(row.sl)}</td>
                    <td className={`${td} tabular hidden text-right text-muted-foreground md:table-cell`}>{num(row.expired)}</td>
                    <td className={`${td} tabular hidden text-right text-muted-foreground md:table-cell`}>{num(row.open)}</td>
                    <td className={td}>
                      {rate === null ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <div className="flex items-center gap-3">
                          <div className="h-1.5 min-w-16 flex-1 overflow-hidden rounded-full" style={{ background: "color-mix(in srgb, var(--viz-critical) 45%, transparent)" }}>
                            <div className="h-full rounded-full" style={{ width: `${rate * 100}%`, background: "var(--viz-good)" }} />
                          </div>
                          <span className="tabular w-12 text-right font-medium">{formatPercent(rate, lang)}</span>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableShell>
      )}
      <p className="border-t border-border px-4 py-3 text-[11px] text-muted-foreground sm:px-5">{t.tpAdmin.quality_hint}</p>
    </Panel>
  );
}

type UsageDim = "instrument" | "timeframe" | "mode" | "direction";

function UsagePanel({ data }: { data: Overview }) {
  const { t, lang } = useTranslation();
  const directionLabel = useDirectionLabel();
  const [dim, setDim] = useState<UsageDim>("instrument");
  const items =
    dim === "instrument"
      ? data.analyses.byInstrument
      : dim === "timeframe"
        ? data.analyses.byTimeframe
        : dim === "mode"
          ? data.analyses.byMode
          : data.analyses.byDirection;
  const labelFor =
    dim === "mode"
      ? (key: string) => (key === "real" ? t.tpAdmin.mode_real : t.tpAdmin.mode_demo)
      : dim === "direction"
        ? directionLabel
        : undefined;

  return (
    <Panel title={t.tpAdmin.usage_title}>
      <div className="mb-4 overflow-x-auto">
        <Segmented
          label={t.tpAdmin.usage_title}
          value={dim}
          onChange={setDim}
          options={[
            { value: "instrument", label: t.tpAdmin.instrument },
            { value: "timeframe", label: t.tpAdmin.timeframe },
            { value: "mode", label: t.tpAdmin.mode },
            { value: "direction", label: t.tpAdmin.direction },
          ]}
        />
      </div>
      <BreakdownList items={items} labelFor={labelFor} formatValue={(value) => formatNumber(value, lang)} />
    </Panel>
  );
}

function CreditsPanel({ data }: { data: Overview }) {
  const { t, lang } = useTranslation();
  const num = (value: number) => formatNumber(value, lang);
  const periodLabel = (period: string) =>
    period === "daily" ? t.tpAdmin.period_daily : period === "weekly" ? t.tpAdmin.period_weekly : t.tpAdmin.period_monthly;

  return (
    <Panel
      title={t.tpAdmin.credits_title}
      actions={
        <Link href="/admin/users/credits" className="inline-flex items-center gap-0.5 text-[11px] text-muted-foreground hover:text-primary">
          {t.tpAdmin.status_open}
          <ChevronRight className="h-3.5 w-3.5" />
        </Link>
      }
    >
      <div className="space-y-5">
        {data.credits.map((row) => {
          const allowanceTotal = row.allowanceTotal ?? 0;
          const ratio = allowanceTotal > 0 ? Math.min(1, row.consumed / allowanceTotal) : 0;
          return (
            <div key={row.mode}>
              <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2">
                  <ModeBadge mode={row.mode} />
                  <span className="text-xs text-muted-foreground">
                    {fill(t.tpAdmin.credits_policy, { allowance: row.allowance, period: periodLabel(row.period) })}
                  </span>
                </span>
                <span className="tabular text-xs font-medium text-foreground">{formatPercent(ratio, lang)}</span>
              </div>
              <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full" style={{ width: `${ratio * 100}%`, background: "var(--viz-series-1)" }} />
              </div>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                <span>{fill(t.tpAdmin.credits_used_of, { n: num(row.consumed), m: num(allowanceTotal) })}</span>
                <span>
                  {fill(t.tpAdmin.credits_period_users, { n: num(row.usersInPeriod) })}
                  {row.exhausted > 0 ? (
                    <>
                      {" · "}
                      <span style={{ color: "var(--viz-warning)" }}>
                        {num(row.exhausted)} {t.tpAdmin.credits_exhausted.toLowerCase()}
                      </span>
                    </>
                  ) : null}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

function TopUsersPanel({ data }: { data: Overview }) {
  const { t, lang } = useTranslation();
  return (
    <Panel title={t.tpAdmin.top_users} bodyClassName="p-0">
      {data.topUsers.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">{t.tpAdmin.empty}</p>
      ) : (
        <ol className="divide-y divide-border">
          {data.topUsers.map((row, index) => (
            <li key={row.userId} className="flex items-center gap-3 px-4 py-3 sm:px-5">
              <span className="tabular w-4 shrink-0 text-xs text-muted-foreground">{index + 1}</span>
              <span className="min-w-0 flex-1">
                <UserIdLink userId={row.userId} size={12} />
                <span className="mt-0.5 block text-[11px] text-muted-foreground">
                  {fill(t.tpAdmin.top_users_line, { n: formatNumber(row.analyses, lang), cost: formatUsd(row.costUsd, lang) })}
                </span>
              </span>
              <span className="shrink-0 text-right text-[11px] text-muted-foreground">{formatDateTime(row.lastAnalysisAt, lang)}</span>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}

export default function TpAdminOverviewPage() {
  const { t, lang } = useTranslation();
  const [days, setDays] = useState<"7" | "30" | "90">("30");
  const query = useOverview(Number(days));
  const data = query.data;
  const num = (value: number) => formatNumber(value, lang);
  const usd = (value: number) => formatUsd(value, lang);
  const resolved = data
    ? (data.quality?.byDirection ?? []).reduce((acc, row) => ({ tp: acc.tp + row.tp, sl: acc.sl + row.sl }), { tp: 0, sl: 0 })
    : { tp: 0, sl: 0 };
  const winRate = tpRate(resolved);

  return (
    <AdminShell>
      <SectionTabs section="monitor" />
      <PageHeader
        title={t.tpAdmin.overview_title}
        subtitle={t.tpAdmin.overview_subtitle}
        actions={
          <Segmented
            label={t.tpAdmin.range_label}
            value={days}
            onChange={setDays}
            options={(["7", "30", "90"] as const).map((value) => ({
              value,
              label: fill(t.tpAdmin.range_days, { n: value }),
            }))}
          />
        }
      />

      <QueryState isLoading={query.isLoading} error={query.error} onRetry={() => void query.refetch()}>
        {data ? (
          <>
            <StatusStrip data={data} />

            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
              <Kpi
                label={t.tpAdmin.kpi_active}
                value={num(data.users.activeInRange)}
                hint={fill(t.tpAdmin.kpi_active_total_hint, { n: num(data.users.total), m: num(data.users.newInRange) })}
              />
              <Kpi
                label={t.tpAdmin.kpi_analyses}
                value={num(data.analyses.total)}
                hint={fill(t.tpAdmin.kpi_analyses_hint, { n: num(data.analyses.last24h) })}
              />
              <Kpi
                label={t.tpAdmin.kpi_win_rate}
                value={winRate === null ? "—" : formatPercent(winRate, lang)}
                hint={
                  winRate === null
                    ? t.tpAdmin.kpi_win_rate_empty
                    : fill(t.tpAdmin.kpi_win_rate_hint, { tp: num(resolved.tp), sl: num(resolved.sl) })
                }
              />
              <Kpi
                label={t.tpAdmin.kpi_cost}
                value={usd(data.ai.costUsd)}
                hint={fill(t.tpAdmin.kpi_cost_hint, { n: usd(data.ai.costUsd24h), m: usd(data.ai.avgCostPerAnalysisUsd) })}
              />
              <Kpi
                label={t.tpAdmin.kpi_cache}
                value={formatPercent(data.ai.cacheHitRate, lang)}
                hint={fill(t.tpAdmin.kpi_cache_hint, { n: num(data.ai.cacheHits), m: num(data.analyses.total) })}
              />
            </div>

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              <DailyBarChart
                title={t.tpAdmin.chart_daily_analyses}
                data={data.daily.map((d) => ({ date: d.date, value: d.analyses }))}
                format={num}
              />
              <DailyBarChart
                title={t.tpAdmin.chart_daily_cost}
                data={data.daily.map((d) => ({ date: d.date, value: d.costUsd }))}
                format={usd}
                series={2}
                integer={false}
              />
            </div>

            <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-3">
              <OutcomePanel data={data} />
              <QualityPanel data={data} />
            </div>

            <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2 xl:grid-cols-3">
              <UsagePanel data={data} />
              <CreditsPanel data={data} />
              <TopUsersPanel data={data} />
            </div>
          </>
        ) : null}
      </QueryState>
    </AdminShell>
  );
}
