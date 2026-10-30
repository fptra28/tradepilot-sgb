import { useTranslation } from "@/lib/i18n";
import { formatDateTime, formatNumber, formatUsd, useUsers, type CreditView } from "@/lib/tp-admin-api";
import { AdminShell } from "@/components/tp-admin/admin-shell";
import { SectionTabs } from "@/components/tp-admin/section-tabs";
import { DraftTextFilter } from "@/components/tp-admin/draft-input";
import { EmailLookup } from "@/components/tp-admin/email-lookup";
import { useUrlFilters } from "@/components/tp-admin/use-url-filters";
import {
  ModeBadge,
  PageHeader,
  Pagination,
  Panel,
  QueryState,
  Segmented,
  TableShell,
  UserIdLink,
  td,
  th,
} from "@/components/tp-admin/ui";

const FILTER_KEYS = ["page", "q", "sort"] as const;
type Sort = "recent" | "active" | "analyses" | "cost";

export function CreditCell({ credit }: { credit: CreditView | undefined }) {
  const { t, lang } = useTranslation();
  if (!credit) return <span className="text-xs text-muted-foreground">{t.tpAdmin.no_balance}</span>;
  const ratio = credit.allowance > 0 ? credit.consumed / credit.allowance : 0;
  const exhausted = credit.remaining === 0;
  return (
    <div className="min-w-[96px]">
      <p className="tabular text-sm text-foreground">
        {formatNumber(credit.consumed, lang)}/{formatNumber(credit.allowance, lang)}
      </p>
      <div className="mt-1 h-1 w-full rounded-full bg-muted" aria-hidden>
        <div
          className="h-1 rounded-full"
          style={{
            width: `${Math.min(100, Math.max(ratio * 100, credit.consumed > 0 ? 4 : 0))}%`,
            background: exhausted ? "var(--viz-critical)" : "var(--viz-series-1)",
          }}
        />
      </div>
    </div>
  );
}

export default function TpAdminUsersPage() {
  const { t, lang } = useTranslation();
  const { values, set } = useUrlFilters(FILTER_KEYS);
  const page = Math.max(1, Number(values.page) || 1);
  const sort = (["recent", "active", "analyses", "cost"].includes(values.sort) ? values.sort : "recent") as Sort;
  const query = useUsers({ page, q: values.q, sort });
  const data = query.data;

  return (
    <AdminShell>
      <SectionTabs section="users" />
      <PageHeader title={t.tpAdmin.users_title} subtitle={t.tpAdmin.users_subtitle} />

      <EmailLookup />

      <Panel>
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div className="w-full md:max-w-sm">
            <DraftTextFilter
              label={t.tpAdmin.filter_user}
              value={values.q}
              onCommit={(v) => set("q", v.toLowerCase())}
              placeholder={t.tpAdmin.filter_user_placeholder}
            />
          </div>
          <div className="flex flex-col gap-1 text-xs text-muted-foreground">
            {t.tpAdmin.sort}
            <Segmented
              label={t.tpAdmin.sort}
              value={sort}
              onChange={(v) => set("sort", v === "recent" ? "" : v)}
              options={[
                { value: "recent", label: t.tpAdmin.sort_recent },
                { value: "active", label: t.tpAdmin.sort_active },
                { value: "analyses", label: t.tpAdmin.sort_analyses },
                { value: "cost", label: t.tpAdmin.sort_cost },
              ]}
            />
          </div>
        </div>
      </Panel>

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
                      <th className={th}>{t.tpAdmin.user}</th>
                      <th className={th}>{t.tpAdmin.first_mode}</th>
                      <th className={th}>{t.tpAdmin.first_seen}</th>
                      <th className={th}>{t.tpAdmin.last_analysis}</th>
                      <th className={`${th} text-right`}>{t.tpAdmin.kpi_analyses}</th>
                      <th className={`${th} text-right`}>{t.tpAdmin.cost}</th>
                      <th className={th}>{`${t.tpAdmin.credits} ${t.tpAdmin.mode_demo}`}</th>
                      <th className={th}>{`${t.tpAdmin.credits} ${t.tpAdmin.mode_real}`}</th>
                      <th className={`${th} text-right`}>{t.tpAdmin.alerts_short}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map((row) => (
                      <tr key={row.userId} className="border-t border-border transition hover:bg-accent/40">
                        <td className={td}><UserIdLink userId={row.userId} size={12} /></td>
                        <td className={td}><ModeBadge mode={row.firstSeenMode} /></td>
                        <td className={`${td} text-muted-foreground`}>{formatDateTime(row.createdAt, lang)}</td>
                        <td className={`${td} text-muted-foreground`}>{formatDateTime(row.lastAnalysisAt, lang)}</td>
                        <td className={`${td} tabular text-right`}>{formatNumber(row.analyses, lang)}</td>
                        <td className={`${td} tabular text-right`}>{formatUsd(row.costUsd, lang)}</td>
                        <td className={td}><CreditCell credit={row.credits.demo} /></td>
                        <td className={td}><CreditCell credit={row.credits.real} /></td>
                        <td className={`${td} tabular text-right`}>{formatNumber(row.activeAlerts, lang)}</td>
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
