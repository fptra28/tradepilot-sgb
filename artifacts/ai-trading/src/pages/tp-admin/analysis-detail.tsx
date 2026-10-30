import { Link } from "wouter";
import { ArrowLeft } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { fill, formatDateTime, formatNumber, formatUsd, useAnalysisDetail, type Levels } from "@/lib/tp-admin-api";
import { AdminShell } from "@/components/tp-admin/admin-shell";
import {
  CopyButton,
  DirectionText,
  JsonBlock,
  KeyValues,
  ModeBadge,
  PageHeader,
  Panel,
  QueryState,
  StatusBadge,
  TableShell,
  UserIdLink,
  td,
  th,
} from "@/components/tp-admin/ui";

function LevelsTable({ title, levels }: { title: string; levels: Levels }) {
  const { t } = useTranslation();
  const rows: Array<[string, string]> = [
    [t.tpAdmin.level_entry, levels.entry],
    [t.tpAdmin.level_stop_loss, levels.stopLoss],
    [t.tpAdmin.level_tp1, levels.takeProfitOne],
    [t.tpAdmin.level_tp2, levels.takeProfitTwo],
  ];
  return (
    <div>
      <p className="mb-1.5 text-xs font-semibold text-muted-foreground">{title}</p>
      <dl className="divide-y divide-border rounded-md border border-border">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between px-3 py-1.5 text-sm">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="tabular font-medium text-foreground">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function EmptyRow() {
  const { t } = useTranslation();
  return <p className="py-8 text-center text-sm text-muted-foreground">{t.tpAdmin.empty}</p>;
}

export default function TpAdminAnalysisDetailPage({ params }: { params: { id: string } }) {
  const { t, lang } = useTranslation();
  const query = useAnalysisDetail(params.id);
  const data = query.data;
  const context = data?.marketContext ? (data.marketContext[lang] ?? data.marketContext.id ?? null) : null;

  return (
    <AdminShell>
      <Link href="/admin/analyses" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" />
        {t.tpAdmin.nav_analyses}
      </Link>
      <QueryState isLoading={query.isLoading} error={query.error} onRetry={() => void query.refetch()}>
        {data ? (
          <>
            <PageHeader
              title={`${data.instrumentLabel} · ${data.timeframeLabel}`}
              subtitle={`${t.tpAdmin.analysis_detail} — ${data.id}`}
              actions={
                <>
                  <ModeBadge mode={data.mode} />
                  <DirectionText direction={data.direction} />
                  <StatusBadge status={data.status} />
                </>
              }
            />

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
              <Panel title={t.tpAdmin.section_summary} className="xl:col-span-2">
                <KeyValues
                  items={[
                    { label: t.tpAdmin.user, value: <UserIdLink userId={data.userId} size={16} /> },
                    { label: t.tpAdmin.analyzed_at, value: formatDateTime(data.analyzedAt, lang) },
                    { label: t.tpAdmin.valid_until, value: formatDateTime(data.validUntil, lang) },
                    { label: t.tpAdmin.resolved_at, value: formatDateTime(data.resolvedAt, lang) },
                    { label: t.tpAdmin.price_at_analysis, value: <span className="tabular">{data.priceAtAnalysis}</span> },
                    { label: t.tpAdmin.last_price, value: <span className="tabular">{data.lastEvaluatedPrice ?? "—"}</span> },
                    { label: t.tpAdmin.active_side, value: data.activeSide ?? "—" },
                    {
                      label: t.tpAdmin.candles,
                      value:
                        data.candleCount === null
                          ? "—"
                          : `${formatNumber(data.candleCount, lang)} · ${formatDateTime(data.candleAsOf, lang)}`,
                    },
                  ]}
                />
              </Panel>
              <Panel title={t.tpAdmin.section_levels}>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-1">
                  <LevelsTable title={t.tpAdmin.section_buy} levels={data.buyLevels} />
                  <LevelsTable title={t.tpAdmin.section_sell} levels={data.sellLevels} />
                </div>
              </Panel>
            </div>

            <Panel title={t.tpAdmin.section_audit}>
              <KeyValues
                items={[
                  { label: t.tpAdmin.model, value: data.audit.model ?? "—" },
                  {
                    label: t.tpAdmin.prompt_version,
                    value: data.audit.promptVersion ? (
                      <span className="inline-flex items-center gap-1 font-mono text-xs">
                        {data.audit.promptVersion.slice(0, 16)}…
                        <CopyButton value={data.audit.promptVersion} />
                      </span>
                    ) : (
                      "—"
                    ),
                  },
                  {
                    label: t.tpAdmin.request_id,
                    value: data.audit.requestId ? (
                      <span className="inline-flex items-center gap-1 font-mono text-xs">
                        {data.audit.requestId}
                        <CopyButton value={data.audit.requestId} />
                      </span>
                    ) : (
                      "—"
                    ),
                  },
                  { label: t.tpAdmin.cache, value: data.audit.aiCacheHit ? t.tpAdmin.cache_hit : t.tpAdmin.cache_miss },
                  { label: t.tpAdmin.prompt_tokens, value: <span className="tabular">{formatNumber(data.audit.promptTokens, lang)}</span> },
                  {
                    label: t.tpAdmin.completion_tokens,
                    value: <span className="tabular">{formatNumber(data.audit.completionTokens, lang)}</span>,
                  },
                  { label: t.tpAdmin.tokens, value: <span className="tabular">{formatNumber(data.audit.totalTokens, lang)}</span> },
                  { label: t.tpAdmin.cost, value: <span className="tabular">{formatUsd(data.audit.estimatedCostUsd, lang)}</span> },
                ]}
              />
              <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
                <div className="min-w-0">
                  <p className="mb-1.5 text-xs font-semibold text-muted-foreground">{t.tpAdmin.section_ai_input}</p>
                  <JsonBlock value={data.audit.aiInput} />
                </div>
                <div className="min-w-0">
                  <p className="mb-1.5 text-xs font-semibold text-muted-foreground">{t.tpAdmin.section_ai_output}</p>
                  <JsonBlock value={data.audit.aiOutput} />
                </div>
              </div>
            </Panel>

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              <Panel title={t.tpAdmin.section_indicators} bodyClassName="p-0">
                {data.indicators.length === 0 ? (
                  <EmptyRow />
                ) : (
                  <TableShell>
                    <table className="w-full">
                      <thead>
                        <tr>
                          <th className={th}>{t.tpAdmin.section_indicators}</th>
                          <th className={`${th} text-right`}>{t.tpAdmin.value}</th>
                          <th className={th}>{t.tpAdmin.status}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.indicators.map((indicator) => (
                          <tr key={indicator.key ?? indicator.label} className="border-t border-border">
                            <td className={td}>{indicator.label}</td>
                            <td className={`${td} tabular text-right`}>{indicator.value}</td>
                            <td className={`${td} text-xs uppercase text-muted-foreground`}>{indicator.status}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </TableShell>
                )}
              </Panel>
              <Panel title={t.tpAdmin.section_context}>
                {context ? (
                  <div className="space-y-2 text-sm">
                    <p className="font-medium text-foreground">{context.title}</p>
                    <p className="leading-6 text-muted-foreground">{context.description}</p>
                    {context.note ? <p className="text-xs text-muted-foreground">{context.note}</p> : null}
                  </div>
                ) : (
                  <EmptyRow />
                )}
              </Panel>
            </div>

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              <Panel title={t.tpAdmin.section_alerts} bodyClassName="p-0">
                {data.alerts.length === 0 ? (
                  <EmptyRow />
                ) : (
                  <TableShell>
                    <table className="w-full">
                      <thead>
                        <tr>
                          <th className={th}>{t.tpAdmin.side}</th>
                          <th className={th}>{t.tpAdmin.status}</th>
                          <th className={th}>{t.tpAdmin.channels}</th>
                          <th className={th}>{t.tpAdmin.updated}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.alerts.map((alert) => {
                          const triggered = Object.keys(alert.triggeredLevels ?? {});
                          return (
                            <tr key={alert.id} className="border-t border-border">
                              <td className={`${td} uppercase`}>{alert.side}</td>
                              <td className={td}>
                                {alert.active ? t.tpAdmin.alert_active : t.tpAdmin.alert_inactive}
                                {triggered.length ? (
                                  <span className="ml-1.5 text-xs text-muted-foreground">
                                    {fill(t.tpAdmin.alert_triggered, { levels: triggered.join(", ") })}
                                  </span>
                                ) : null}
                              </td>
                              <td className={`${td} text-muted-foreground`}>{alert.channels.join(", ")}</td>
                              <td className={`${td} text-muted-foreground`}>{formatDateTime(alert.updatedAt, lang)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </TableShell>
                )}
              </Panel>
              <Panel title={t.tpAdmin.section_plans} bodyClassName="p-0">
                {data.tradingPlans.length === 0 ? (
                  <EmptyRow />
                ) : (
                  <TableShell>
                    <table className="w-full">
                      <thead>
                        <tr>
                          <th className={th}>{t.tpAdmin.side}</th>
                          <th className={th}>{t.tpAdmin.account_type}</th>
                          <th className={`${th} text-right`}>{t.tpAdmin.capital}</th>
                          <th className={`${th} text-right`}>{t.tpAdmin.loss_limit}</th>
                          <th className={th}>{t.tpAdmin.risk_style}</th>
                          <th className={th}>{t.tpAdmin.time}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.tradingPlans.map((plan) => (
                          <tr key={plan.id} className="border-t border-border">
                            <td className={`${td} uppercase`}>{plan.variant}</td>
                            <td className={`${td} capitalize`}>{plan.accountType}</td>
                            <td className={`${td} tabular text-right`}>{plan.tradingCapital}</td>
                            <td className={`${td} tabular text-right`}>{plan.lossLimit}</td>
                            <td className={td}>{plan.riskStyle}</td>
                            <td className={`${td} text-muted-foreground`}>{formatDateTime(plan.createdAt, lang)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </TableShell>
                )}
              </Panel>
            </div>
          </>
        ) : null}
      </QueryState>
    </AdminShell>
  );
}
