import { Fragment, useState } from "react";
import { CheckCircle2, ChevronDown, ChevronRight, RotateCcw, XCircle } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { formatDateTime, shortId, useAudit, type AuditItem } from "@/lib/tp-admin-api";
import { AdminShell } from "@/components/tp-admin/admin-shell";
import { SectionTabs } from "@/components/tp-admin/section-tabs";
import { DraftTextFilter } from "@/components/tp-admin/draft-input";
import { useUrlFilters } from "@/components/tp-admin/use-url-filters";
import {
  CopyButton,
  JsonBlock,
  PageHeader,
  Pagination,
  Panel,
  QueryState,
  SelectFilter,
  TableShell,
  UserIdLink,
  td,
  th,
} from "@/components/tp-admin/ui";

const FILTER_KEYS = ["page", "action", "adminUserId", "targetUserId"] as const;

const ACTIONS = [
  "email_lookup",
  "credit_reset",
  "credit_set",
  "settings_quota",
  "settings_availability",
  "staff_create",
  "staff_role",
  "staff_password",
] as const;

function ActionLabel({ action }: { action: string }) {
  const { t } = useTranslation();
  return (t.tpAdmin as Record<string, string>)[`audit_action_${action}`] ?? action;
}

function AdminIdentity({ row }: { row: AuditItem }) {
  const { t } = useTranslation();
  const name = row.adminName || row.adminEmail || t.tpAdmin.audit_unknown_admin;
  return (
    <div className="min-w-[180px]">
      <p className="text-sm font-medium text-foreground">{name}</p>
      {row.adminName && row.adminEmail ? <p className="text-xs text-muted-foreground">{row.adminEmail}</p> : null}
      <p className="text-[11px] text-muted-foreground">
        {row.adminRole === "super_admin" ? t.tpAdmin.role_super_admin : t.tpAdmin.role_admin} · #{row.adminUserId}
      </p>
    </div>
  );
}

export default function TpAdminAuditPage() {
  const { t, lang } = useTranslation();
  const { values, set, reset } = useUrlFilters(FILTER_KEYS);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const page = Math.max(1, Number(values.page) || 1);
  const query = useAudit({ ...values, page });
  const data = query.data;
  const hasFilters = FILTER_KEYS.some((key) => key !== "page" && values[key]);

  return (
    <AdminShell>
      <SectionTabs section="settings" />
      <PageHeader title={t.tpAdmin.audit_title} subtitle={t.tpAdmin.audit_subtitle} />

      <Panel>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <SelectFilter
            label={t.tpAdmin.audit_filter_action}
            value={values.action}
            onChange={(value) => set("action", value)}
            options={ACTIONS.map((action) => ({
              value: action,
              label: (t.tpAdmin as Record<string, string>)[`audit_action_${action}`] ?? action,
            }))}
          />
          <SelectFilter
            label={t.tpAdmin.audit_filter_admin}
            value={values.adminUserId}
            onChange={(value) => set("adminUserId", value)}
            options={(data?.admins ?? []).map((admin) => ({
              value: String(admin.id),
              label: admin.displayName ? `${admin.displayName} · ${admin.email}` : admin.email,
            }))}
          />
          <DraftTextFilter
            label={t.tpAdmin.audit_filter_target}
            value={values.targetUserId}
            onCommit={(value) => set("targetUserId", value.trim().toLowerCase())}
            placeholder={t.tpAdmin.audit_filter_target_placeholder}
          />
          {hasFilters ? (
            <div className="flex items-end">
              <button
                type="button"
                onClick={reset}
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-xs text-muted-foreground transition hover:bg-accent hover:text-foreground"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                {t.tpAdmin.filter_reset}
              </button>
            </div>
          ) : null}
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
                      <th className={th}>{t.tpAdmin.time}</th>
                      <th className={th}>{t.tpAdmin.audit_action}</th>
                      <th className={th}>{t.tpAdmin.audit_admin}</th>
                      <th className={th}>{t.tpAdmin.audit_target}</th>
                      <th className={th}>{t.tpAdmin.audit_result}</th>
                      <th className={th}>{t.tpAdmin.request_id}</th>
                      <th className={th}>{t.tpAdmin.audit_details}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map((row) => (
                      <Fragment key={row.id}>
                      <tr className="border-t border-border align-top transition hover:bg-accent/40">
                        <td className={`${td} text-muted-foreground`}>{formatDateTime(row.createdAt, lang)}</td>
                        <td className={td}>
                          <span className="font-medium"><ActionLabel action={row.action} /></span>
                          <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">#{row.id}</p>
                        </td>
                        <td className={td}><AdminIdentity row={row} /></td>
                        <td className={td}>
                          {row.targetUserId ? <UserIdLink userId={row.targetUserId} size={12} /> : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className={td}>
                          <span className="inline-flex items-center gap-1.5" style={{ color: row.found ? "var(--viz-good)" : "var(--viz-critical)" }}>
                            {row.found ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
                            {row.found ? t.tpAdmin.audit_result_success : t.tpAdmin.audit_result_not_found}
                          </span>
                        </td>
                        <td className={td}>
                          {row.requestId ? (
                            <span className="inline-flex items-center gap-0.5 font-mono text-xs text-muted-foreground" title={row.requestId}>
                              {shortId(row.requestId, 14)}
                              <CopyButton value={row.requestId} />
                            </span>
                          ) : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className={`${td} min-w-[150px] whitespace-normal`}>
                          {row.details ? (
                            <button
                              type="button"
                              onClick={() => setExpandedId((current) => current === row.id ? null : row.id)}
                              className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
                              aria-expanded={expandedId === row.id}
                            >
                              {expandedId === row.id ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                              {expandedId === row.id ? t.tpAdmin.audit_hide_details : t.tpAdmin.audit_show_details}
                            </button>
                          ) : <span className="text-muted-foreground">—</span>}
                        </td>
                      </tr>
                      {row.details && expandedId === row.id ? (
                        <tr className="border-t border-border bg-[hsl(var(--code))]">
                          <td colSpan={7} className="px-4 py-4 sm:px-5">
                            <JsonBlock value={row.details} />
                          </td>
                        </tr>
                      ) : null}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </TableShell>
              <Pagination page={data.page} limit={data.limit} total={data.total} onPage={(next) => set("page", String(next))} />
            </>
          ) : null}
        </QueryState>
      </Panel>
    </AdminShell>
  );
}
