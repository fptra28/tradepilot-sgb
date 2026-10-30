import {
  Activity,
  AlertTriangle,
  Bot,
  CheckCircle2,
  Clock3,
  RefreshCw,
  Radio,
  Webhook,
  XCircle,
} from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import {
  fill,
  formatDateTime,
  useSystemHealth,
  type HealthStatus,
} from "@/lib/tp-admin-api";
import { AdminShell } from "@/components/tp-admin/admin-shell";
import { SectionTabs } from "@/components/tp-admin/section-tabs";
import { PageHeader, Panel, QueryState } from "@/components/tp-admin/ui";

const STATUS_META: Record<HealthStatus, { icon: typeof CheckCircle2; color: string }> = {
  healthy: { icon: CheckCircle2, color: "var(--viz-good)" },
  warning: { icon: AlertTriangle, color: "var(--viz-warning)" },
  critical: { icon: XCircle, color: "var(--viz-critical)" },
  unknown: { icon: Clock3, color: "var(--viz-neutral)" },
};

function StatusPill({ status }: { status: HealthStatus }) {
  const { t } = useTranslation();
  const meta = STATUS_META[status];
  const Icon = meta.icon;
  const label = {
    healthy: t.tpAdmin.health_status_healthy,
    warning: t.tpAdmin.health_status_warning,
    critical: t.tpAdmin.health_status_critical,
    unknown: t.tpAdmin.health_status_unknown,
  }[status];
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-[hsl(var(--control))] px-2.5 py-1 text-[11px] font-semibold" style={{ color: meta.color }}>
      <Icon className="h-3.5 w-3.5" />
      {label}
    </span>
  );
}

function HealthCard({
  icon: Icon,
  title,
  value,
  hint,
  status,
}: {
  icon: typeof Activity;
  title: string;
  value: string;
  hint: string;
  status: HealthStatus;
}) {
  const color = STATUS_META[status].color;
  return (
    <div className="min-w-0 rounded-[11px] border border-card-border bg-card p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[hsl(var(--control))]">
          <Icon className="h-4.5 w-4.5" style={{ color }} />
        </span>
        <StatusPill status={status} />
      </div>
      <p className="mt-4 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{title}</p>
      <p className="tabular mt-1.5 truncate text-xl font-semibold tracking-[-0.02em] text-foreground">{value}</p>
      <p className="mt-2 min-h-8 text-[11px] leading-4 text-muted-foreground">{hint}</p>
    </div>
  );
}

function relativeAge(value: string | null, lang: "id" | "en", fallback: string): string {
  if (!value) return fallback;
  const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000));
  const formatter = new Intl.RelativeTimeFormat(lang === "id" ? "id-ID" : "en-US", { numeric: "auto" });
  if (seconds < 60) return formatter.format(-seconds, "second");
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return formatter.format(-minutes, "minute");
  return formatter.format(-Math.round(minutes / 60), "hour");
}

export default function TpAdminHealthPage() {
  const { t, lang } = useTranslation();
  const query = useSystemHealth();
  const health = query.data;
  const percent = (value: number) => new Intl.NumberFormat(lang === "id" ? "id-ID" : "en-US", {
    style: "percent",
    maximumFractionDigits: 1,
  }).format(value);
  const instrumentLabel = (id: string) => ({
    gold: t.tpAdmin.availability_instrument_gold,
    brent: t.tpAdmin.availability_instrument_brent,
    "hang-seng": t.tpAdmin.availability_instrument_hang_seng,
    nikkei: t.tpAdmin.availability_instrument_nikkei,
  } as Record<string, string>)[id] ?? id;

  return (
    <AdminShell>
      <SectionTabs section="monitor" />
      <PageHeader
        title={t.tpAdmin.health_title}
        subtitle={t.tpAdmin.health_subtitle}
        actions={(
          <button
            type="button"
            onClick={() => void query.refetch()}
            disabled={query.isFetching}
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-3 text-xs font-medium text-foreground transition hover:border-primary/35 hover:bg-accent disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${query.isFetching ? "animate-spin" : ""}`} />
            {t.tpAdmin.health_refresh}
          </button>
        )}
      />
      <QueryState isLoading={query.isLoading} error={query.error} onRetry={() => void query.refetch()}>
        {health ? (
          <>
            <Panel>
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[hsl(var(--control))]">
                    <Activity className="h-5 w-5" style={{ color: STATUS_META[health.overall].color }} />
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-foreground">{t.tpAdmin.health_overall}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {health.overall === "healthy"
                        ? t.tpAdmin.health_overall_healthy
                        : health.overall === "warning"
                          ? t.tpAdmin.health_overall_warning
                          : health.overall === "critical"
                            ? t.tpAdmin.health_overall_critical
                            : t.tpAdmin.health_overall_unknown}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <StatusPill status={health.overall} />
                  <span className="text-[11px] text-muted-foreground">{formatDateTime(health.capturedAt, lang)}</span>
                </div>
              </div>
            </Panel>

            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <HealthCard
                icon={Radio}
                title={t.tpAdmin.health_candle_title}
                value={fill(t.tpAdmin.health_candle_observed, { count: health.candles.observed })}
                hint={t.tpAdmin.health_candle_hint}
                status={health.candles.status}
              />
              <HealthCard
                icon={Bot}
                title={t.tpAdmin.health_openai_title}
                value={percent(health.openai.failureRate)}
                hint={fill(t.tpAdmin.health_openai_hint, { failed: health.openai.failed, total: health.openai.total })}
                status={health.openai.status}
              />
              <HealthCard
                icon={Clock3}
                title={t.tpAdmin.health_jobs_title}
                value={fill(t.tpAdmin.health_jobs_value, { count: health.jobs.filter((job) => job.status === "healthy").length, total: health.jobs.length })}
                hint={t.tpAdmin.health_jobs_hint}
                status={health.jobs.some((job) => job.status === "critical") ? "critical" : health.jobs.some((job) => job.status === "warning") ? "warning" : health.jobs.every((job) => job.status === "unknown") ? "unknown" : "healthy"}
              />
              <HealthCard
                icon={Webhook}
                title={t.tpAdmin.health_webhook_title}
                value={health.webhook.configured ? percent(health.webhook.failureRate) : t.tpAdmin.health_not_configured}
                hint={health.webhook.configured
                  ? fill(t.tpAdmin.health_webhook_hint, { failed: health.webhook.failed, total: health.webhook.total })
                  : t.tpAdmin.health_webhook_disabled_hint}
                status={health.webhook.status}
              />
            </div>

            <div className="grid gap-5 xl:grid-cols-[1.35fr_0.65fr]">
              <Panel title={t.tpAdmin.health_candle_detail_title} bodyClassName="p-0 sm:p-0">
                {health.candles.items.length ? (
                  <div className="tp-admin-table overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead><tr className="text-muted-foreground">
                        <th className="px-4 py-3 font-medium">{t.tpAdmin.instrument}</th>
                        <th className="px-4 py-3 font-medium">{t.tpAdmin.timeframe}</th>
                        <th className="px-4 py-3 font-medium">{t.tpAdmin.status}</th>
                        <th className="px-4 py-3 font-medium">{t.tpAdmin.health_candle_as_of}</th>
                        <th className="px-4 py-3 font-medium">{t.tpAdmin.health_last_checked}</th>
                        <th className="px-4 py-3 font-medium">{t.tpAdmin.health_reason}</th>
                      </tr></thead>
                      <tbody>
                        {health.candles.items.map((item) => (
                          <tr key={`${item.instrumentId}:${item.timeframe}`} className="border-t border-border">
                            <td className="px-4 py-3 font-medium text-foreground">{instrumentLabel(item.instrumentId)}</td>
                            <td className="px-4 py-3 text-foreground">{item.timeframe}</td>
                            <td className="px-4 py-3"><StatusPill status={item.status} /></td>
                            <td className="px-4 py-3 text-muted-foreground">{item.candleAsOf ? formatDateTime(item.candleAsOf, lang) : "—"}</td>
                            <td className="px-4 py-3 text-muted-foreground">{relativeAge(item.checkedAt, lang, t.tpAdmin.health_never)}</td>
                            <td className="px-4 py-3 text-muted-foreground">{item.staleReason ?? "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : <p className="p-5 text-sm text-muted-foreground">{t.tpAdmin.health_candle_empty}</p>}
              </Panel>

              <Panel title={t.tpAdmin.health_job_detail_title}>
                <div className="space-y-4">
                  {health.jobs.map((job) => (
                    <div key={job.key} className="rounded-lg border border-border bg-[hsl(var(--control))] p-3.5">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-xs font-semibold text-foreground">
                          {job.key === "signal_evaluation" ? t.tpAdmin.health_job_signal : t.tpAdmin.health_job_performance}
                        </p>
                        <StatusPill status={job.status} />
                      </div>
                      <p className="mt-2 text-[11px] text-muted-foreground">
                        {fill(t.tpAdmin.health_last_success, { time: relativeAge(job.lastSuccessAt, lang, t.tpAdmin.health_never) })}
                      </p>
                      {job.lastFailureAt ? <p className="mt-1 text-[11px] text-muted-foreground">{fill(t.tpAdmin.health_last_failure, { time: relativeAge(job.lastFailureAt, lang, t.tpAdmin.health_never) })}</p> : null}
                    </div>
                  ))}
                </div>
              </Panel>
            </div>
          </>
        ) : null}
      </QueryState>
    </AdminShell>
  );
}
