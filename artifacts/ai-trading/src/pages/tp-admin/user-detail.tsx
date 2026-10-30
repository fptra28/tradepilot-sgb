import { useState } from "react";
import { Link } from "wouter";
import { ArrowLeft, Eye, EyeOff, Mail } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { fill, formatDateTime, formatNumber, formatUsd, maskEmail, shortId, useUserDetail } from "@/lib/tp-admin-api";
import { AdminShell } from "@/components/tp-admin/admin-shell";
import { BreakdownBars } from "@/components/tp-admin/charts";
import { CreditAdjuster } from "@/components/tp-admin/credit-adjuster";
import { useAuth } from "@/components/auth-provider";
import {
  CopyButton,
  DirectionText,
  KeyValues,
  Kpi,
  ModeBadge,
  PageHeader,
  Panel,
  QueryState,
  StatusBadge,
  TableShell,
  statusColor,
  td,
  th,
  useStatusLabel,
} from "@/components/tp-admin/ui";
import { CreditCell } from "./users";

/** Email yang diketik admin saat pencarian (dari history state, bukan dari server). */
function useLookupEmail(): string | null {
  const [email] = useState<string | null>(() => {
    const state = typeof window !== "undefined" ? (window.history.state as { lookupEmail?: unknown } | null) : null;
    return typeof state?.lookupEmail === "string" ? state.lookupEmail : null;
  });
  return email;
}

function SearchedEmail({ email }: { email: string }) {
  const { t } = useTranslation();
  const [revealed, setRevealed] = useState(false);
  return (
    <span className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-2.5 py-1 text-xs text-foreground">
      <Mail className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
      <span className="text-muted-foreground">{t.tpAdmin.searched_email}:</span>
      <span className="font-mono" data-testid="searched-email">{revealed ? email : maskEmail(email)}</span>
      <button
        type="button"
        onClick={() => setRevealed((value) => !value)}
        className="inline-flex items-center gap-1 text-primary hover:underline"
      >
        {revealed ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
        {revealed ? t.tpAdmin.hide : t.tpAdmin.show}
      </button>
    </span>
  );
}

export default function TpAdminUserDetailPage({ params }: { params: { userId: string } }) {
  const { t, lang } = useTranslation();
  const statusLabel = useStatusLabel();
  const query = useUserDetail(params.userId);
  const lookupEmail = useLookupEmail();
  const { user } = useAuth();
  const isSuperAdmin = user?.role === "super_admin";
  const data = query.data;
  const num = (value: number) => formatNumber(value, lang);
  const totalAnalyses = data?.statsByMode.reduce((sum, row) => sum + row.analyses, 0) ?? 0;
  const totalCost = data?.statsByMode.reduce((sum, row) => sum + row.costUsd, 0) ?? 0;

  return (
    <AdminShell>
      <Link href="/admin/users" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" />
        {t.tpAdmin.nav_users}
      </Link>
      <QueryState isLoading={query.isLoading} error={query.error} onRetry={() => void query.refetch()}>
        {data ? (
          <>
            <PageHeader
              title={t.tpAdmin.user_detail}
              subtitle={data.userId}
              actions={
                <>
                  {lookupEmail ? <SearchedEmail email={lookupEmail} /> : null}
                  <CopyButton value={data.userId} />
                </>
              }
            />

            <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
              <Kpi label={t.tpAdmin.kpi_analyses} value={num(totalAnalyses)} />
              <Kpi label={t.tpAdmin.kpi_cost} value={formatUsd(totalCost, lang)} />
              <Kpi label={t.tpAdmin.trading_plans} value={num(data.tradingPlans)} />
              <Kpi label={t.tpAdmin.kpi_alerts} value={num(data.alerts.filter((a) => a.active).length)} />
            </div>

            {isSuperAdmin ? <CreditAdjuster userId={data.userId} credits={data.credits} /> : null}

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
              <Panel title={t.tpAdmin.section_summary}>
                <KeyValues
                  items={[
                    { label: t.tpAdmin.first_mode, value: <ModeBadge mode={data.firstSeenMode} /> },
                    { label: t.tpAdmin.first_seen, value: formatDateTime(data.createdAt, lang) },
                    ...data.credits.map((credit) => ({
                      label: `${t.tpAdmin.credits} ${credit.mode === "real" ? t.tpAdmin.mode_real : t.tpAdmin.mode_demo}`,
                      value: (
                        <div>
                          <CreditCell credit={credit} />
                          <p className="mt-1 text-xs text-muted-foreground">
                            {fill(t.tpAdmin.resets, { date: formatDateTime(credit.resetsAt, lang) })}
                          </p>
                        </div>
                      ),
                    })),
                  ]}
                />
              </Panel>
              <Panel title={t.tpAdmin.stats_by_mode} bodyClassName="p-0">
                {data.statsByMode.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">{t.tpAdmin.empty}</p>
                ) : (
                  <TableShell>
                  <table className="w-full">
                    <thead>
                      <tr>
                        <th className={th}>{t.tpAdmin.mode}</th>
                        <th className={`${th} text-right`}>{t.tpAdmin.kpi_analyses}</th>
                        <th className={`${th} text-right`}>{t.tpAdmin.cost}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.statsByMode.map((row) => (
                        <tr key={row.mode} className="border-t border-border">
                          <td className={td}><ModeBadge mode={row.mode} /></td>
                          <td className={`${td} tabular text-right`}>{num(row.analyses)}</td>
                          <td className={`${td} tabular text-right`}>{formatUsd(row.costUsd, lang)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  </TableShell>
                )}
              </Panel>
              <BreakdownBars
                title={t.tpAdmin.breakdown_status}
                items={data.byStatus}
                labelFor={statusLabel}
                colorFor={statusColor}
                formatValue={num}
              />
            </div>

            <Panel title={t.tpAdmin.recent_analyses} bodyClassName="p-0">
              {data.recentAnalyses.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">{t.tpAdmin.empty}</p>
              ) : (
                <TableShell>
                  <table className="w-full">
                    <thead>
                      <tr>
                        <th className={th}>{t.tpAdmin.time}</th>
                        <th className={th}>{t.tpAdmin.analysis}</th>
                        <th className={th}>{t.tpAdmin.mode}</th>
                        <th className={th}>{t.tpAdmin.instrument}</th>
                        <th className={th}>{t.tpAdmin.direction}</th>
                        <th className={th}>{t.tpAdmin.status}</th>
                        <th className={`${th} text-right`}>{t.tpAdmin.cost}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.recentAnalyses.map((row) => (
                        <tr key={row.id} className="border-t border-border transition hover:bg-accent/40">
                          <td className={`${td} text-muted-foreground`}>{formatDateTime(row.analyzedAt, lang)}</td>
                          <td className={td}>
                            <Link href={`/admin/analyses/${row.id}`} className="font-mono text-xs text-primary hover:underline" title={row.id}>
                              {shortId(row.id, 14)}
                            </Link>
                          </td>
                          <td className={td}><ModeBadge mode={row.mode} /></td>
                          <td className={td}>
                            {row.instrumentLabel} <span className="text-muted-foreground">· {row.timeframeLabel}</span>
                          </td>
                          <td className={td}><DirectionText direction={row.direction} /></td>
                          <td className={td}><StatusBadge status={row.status} /></td>
                          <td className={`${td} tabular text-right`}>{formatUsd(row.estimatedCostUsd, lang)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableShell>
              )}
            </Panel>

            <Panel title={t.tpAdmin.section_alerts} bodyClassName="p-0">
              {data.alerts.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">{t.tpAdmin.empty}</p>
              ) : (
                <TableShell>
                  <table className="w-full">
                    <thead>
                      <tr>
                        <th className={th}>{t.tpAdmin.analysis}</th>
                        <th className={th}>{t.tpAdmin.mode}</th>
                        <th className={th}>{t.tpAdmin.side}</th>
                        <th className={th}>{t.tpAdmin.status}</th>
                        <th className={th}>{t.tpAdmin.updated}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.alerts.map((alert) => {
                        const triggered = Object.keys(alert.triggeredLevels ?? {});
                        return (
                          <tr key={alert.id} className="border-t border-border">
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
                            <td className={`${td} text-muted-foreground`}>{formatDateTime(alert.updatedAt, lang)}</td>
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
