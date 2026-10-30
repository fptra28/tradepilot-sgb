import { Link } from "wouter";
import { useTranslation } from "@/lib/i18n";
import { fill, formatDateTime, formatNumber, useCreditsAlerts } from "@/lib/tp-admin-api";
import { AdminShell } from "@/components/tp-admin/admin-shell";
import { SectionTabs } from "@/components/tp-admin/section-tabs";
import { useUrlFilters } from "@/components/tp-admin/use-url-filters";
import {
  Kpi,
  ModeBadge,
  PageHeader,
  Panel,
  QueryState,
  Segmented,
  StatusBadge,
  TableShell,
  UserIdLink,
  td,
  th,
} from "@/components/tp-admin/ui";

type AlertFilter = "active" | "triggered" | "all";

export default function TpAdminCreditsAlertsPage() {
  const { t, lang } = useTranslation();
  const { values, set } = useUrlFilters(["alerts"] as const);
  const alertStatus = (["active", "triggered", "all"].includes(values.alerts) ? values.alerts : "active") as AlertFilter;
  const query = useCreditsAlerts(alertStatus);
  const data = query.data;
  const num = (value: number) => formatNumber(value, lang);
  const periodLabel = (period: string) =>
    period === "daily" ? t.tpAdmin.period_daily : period === "weekly" ? t.tpAdmin.period_weekly : t.tpAdmin.period_monthly;

  return (
    <AdminShell>
      <SectionTabs section="users" />
      <PageHeader title={t.tpAdmin.credits_alerts_title} subtitle={t.tpAdmin.credits_alerts_subtitle} />

      <QueryState isLoading={query.isLoading} error={query.error} onRetry={() => void query.refetch()}>
        {data ? (
          <>
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              {data.policies.map((policy) => (
                <Panel
                  key={policy.mode}
                  title={
                    <span className="inline-flex items-center gap-2">
                      <ModeBadge mode={policy.mode} />
                      <span className="font-normal text-muted-foreground">
                        {fill(t.tpAdmin.credits_policy, { allowance: policy.allowance, period: periodLabel(policy.period) })}
                      </span>
                    </span>
                  }
                >
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                    <Kpi label={t.tpAdmin.credits_users} value={num(policy.usersInPeriod)} />
                    <Kpi
                      label={t.tpAdmin.credits_consumed}
                      value={num(policy.consumed)}
                      hint={policy.allowanceTotal > 0 ? `/ ${num(policy.allowanceTotal)}` : undefined}
                    />
                    <Kpi label={t.tpAdmin.partially_used} value={num(policy.partiallyUsed)} />
                    <Kpi label={t.tpAdmin.credits_exhausted} value={num(policy.exhausted)} />
                  </div>
                </Panel>
              ))}
            </div>

            <Panel title={t.tpAdmin.exhausted_title} bodyClassName="p-0">
              {data.exhausted.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">{t.tpAdmin.empty}</p>
              ) : (
                <TableShell>
                  <table className="w-full">
                    <thead>
                      <tr>
                        <th className={th}>{t.tpAdmin.user}</th>
                        <th className={th}>{t.tpAdmin.mode}</th>
                        <th className={`${th} text-right`}>{t.tpAdmin.credits}</th>
                        <th className={th}>{t.tpAdmin.updated}</th>
                        <th className={th}>{t.tpAdmin.resets_at}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.exhausted.map((row) => (
                        <tr key={`${row.userId}-${row.mode}`} className="border-t border-border">
                          <td className={td}><UserIdLink userId={row.userId} size={12} /></td>
                          <td className={td}><ModeBadge mode={row.mode} /></td>
                          <td className={`${td} tabular text-right`}>{num(row.consumed)}/{num(row.allowance)}</td>
                          <td className={`${td} text-muted-foreground`}>{formatDateTime(row.updatedAt, lang)}</td>
                          <td className={`${td} text-muted-foreground`}>{formatDateTime(row.resetsAt, lang)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableShell>
              )}
            </Panel>

            <Panel
              title={t.tpAdmin.alerts_title}
              bodyClassName="p-0"
              actions={
                <Segmented
                  label={t.tpAdmin.alerts_title}
                  value={alertStatus}
                  onChange={(v) => set("alerts", v === "active" ? "" : v)}
                  options={[
                    { value: "active", label: t.tpAdmin.alert_filter_active },
                    { value: "triggered", label: t.tpAdmin.alert_filter_triggered },
                    { value: "all", label: t.tpAdmin.alert_filter_all },
                  ]}
                />
              }
            >
              {data.alerts.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">{t.tpAdmin.empty}</p>
              ) : (
                <TableShell>
                  <table className="w-full">
                    <thead>
                      <tr>
                        <th className={th}>{t.tpAdmin.updated}</th>
                        <th className={th}>{t.tpAdmin.user}</th>
                        <th className={th}>{t.tpAdmin.analysis}</th>
                        <th className={th}>{t.tpAdmin.mode}</th>
                        <th className={th}>{t.tpAdmin.side}</th>
                        <th className={th}>{t.tpAdmin.alerts_short}</th>
                        <th className={th}>{t.tpAdmin.status}</th>
                        <th className={th}>{t.tpAdmin.channels}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.alerts.map((alert) => {
                        const triggered = Object.keys(alert.triggeredLevels ?? {});
                        return (
                          <tr key={alert.id} className="border-t border-border">
                            <td className={`${td} text-muted-foreground`}>{formatDateTime(alert.updatedAt, lang)}</td>
                            <td className={td}><UserIdLink userId={alert.userId} size={8} /></td>
                            <td className={td}>
                              <Link href={`/admin/analyses/${alert.analysisId}`} className="text-primary hover:underline">
                                {alert.instrumentLabel} · {alert.timeframeLabel}
                              </Link>
                            </td>
                            <td className={td}><ModeBadge mode={alert.mode} /></td>
                            <td className={`${td} uppercase`}>{alert.side}</td>
                            <td className={td}>
                              {alert.active ? t.tpAdmin.alert_active : t.tpAdmin.alert_inactive}
                              {triggered.length ? (
                                <span className="ml-1.5 text-xs text-muted-foreground">
                                  {fill(t.tpAdmin.alert_triggered, { levels: triggered.join(", ") })}
                                </span>
                              ) : null}
                            </td>
                            <td className={td}><StatusBadge status={alert.analysisStatus} /></td>
                            <td className={`${td} text-muted-foreground`}>{alert.channels.join(", ")}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </TableShell>
              )}
            </Panel>
          </>
        ) : null}
      </QueryState>
    </AdminShell>
  );
}
