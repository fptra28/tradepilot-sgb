import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Ban, CheckCircle2, Loader2, Power, Save, ShieldCheck, Undo2 } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import {
  AdminApiError,
  fill,
  formatDateTime,
  saveAvailabilitySettings,
  saveQuotaSettings,
  useSettings,
  type AvailabilitySettings,
  type CreditPeriod,
  type Mode,
  type QuotaSettings,
} from "@/lib/tp-admin-api";
import { AdminShell } from "@/components/tp-admin/admin-shell";
import { SectionTabs } from "@/components/tp-admin/section-tabs";
import { ModeBadge, PageHeader, Panel, QueryState } from "@/components/tp-admin/ui";
import { SCOPE_INSTRUMENTS, SCOPE_TIMEFRAMES, useScopeLabels } from "@/components/tp-admin/scope-labels";

type Message = { tone: "ok" | "error"; text: string };
const MODES: Mode[] = ["demo", "real"];
const PERIODS: CreditPeriod[] = ["daily", "weekly", "monthly"];
const INSTRUMENTS = SCOPE_INSTRUMENTS;
const TIMEFRAMES = SCOPE_TIMEFRAMES;

/**
 * Bar simpan yang menempel di bawah layar selama ada perubahan, supaya admin
 * tidak perlu menggulir ke tombol simpan dan tidak lupa menyimpan.
 */
function SaveBar({
  dirty,
  confirm,
  confirmText,
  confirmTone,
  pending,
  message,
  saveLabel,
  confirmLabel,
  onSave,
  onDiscard,
  testId,
}: {
  dirty: boolean;
  confirm: boolean;
  confirmText: string;
  confirmTone: "critical" | "warning";
  pending: boolean;
  message: Message | null;
  saveLabel: string;
  confirmLabel: string;
  onSave: () => void;
  onDiscard: () => void;
  testId: string;
}) {
  const { t } = useTranslation();
  if (!dirty && !message) return null;
  const toneColor = confirmTone === "critical" ? "var(--viz-critical)" : "var(--viz-warning)";
  return (
    <div className="sticky bottom-3 z-20 mt-5 rounded-[10px] border border-border bg-card/95 p-3 shadow-[0_8px_24px_hsl(220_30%_2%/0.35)] backdrop-blur sm:px-4">
      {dirty ? (
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <p className="flex items-start gap-2 text-xs text-foreground">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" style={{ color: confirm ? toneColor : "var(--viz-warning)" }} />
            {confirm ? confirmText : t.tpAdmin.settings_unsaved}
          </p>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={onDiscard}
              disabled={pending}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-xs text-muted-foreground transition hover:bg-accent hover:text-foreground disabled:opacity-50"
            >
              <Undo2 className="h-3.5 w-3.5" />
              {t.tpAdmin.settings_discard}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={onSave}
              className={`inline-flex h-9 items-center gap-2 rounded-lg px-4 text-xs font-semibold transition hover:brightness-105 disabled:opacity-50 ${confirm ? "" : "bg-primary text-primary-foreground"}`}
              style={confirm ? { background: toneColor, color: "white" } : undefined}
              data-testid={testId}
            >
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {confirm ? confirmLabel : saveLabel}
            </button>
          </div>
        </div>
      ) : null}
      {message ? (
        <p role="status" className={`flex items-center gap-2 text-xs ${dirty ? "mt-2" : ""}`} style={{ color: message.tone === "ok" ? "var(--viz-good)" : "var(--viz-critical)" }}>
          {message.tone === "ok" ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
          {message.text}
        </p>
      ) : null}
    </div>
  );
}

function AvailabilityToggle({
  checked,
  label,
  onChange,
  testId,
}: {
  checked: boolean;
  label: string;
  onChange: (checked: boolean) => void;
  testId: string;
}) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      data-testid={testId}
      className={`flex min-h-12 items-center justify-between gap-3 rounded-lg border px-3.5 py-2.5 text-left transition focus:outline-none focus:ring-2 focus:ring-ring/30 ${
        checked
          ? "border-border bg-card hover:border-primary/35"
          : "border-[var(--viz-critical)]/40 bg-[var(--viz-critical)]/8"
      }`}
    >
      <span>
        <span className="block text-sm font-medium text-foreground">{label}</span>
        <span className="mt-0.5 block text-[11px] text-muted-foreground">
          {checked ? t.tpAdmin.availability_enabled : t.tpAdmin.availability_paused}
        </span>
      </span>
      <span
        aria-hidden="true"
        className={`relative h-5 w-9 shrink-0 rounded-full transition ${checked ? "bg-[var(--viz-good)]" : "bg-[var(--viz-critical)]"}`}
      >
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition ${checked ? "left-[18px]" : "left-0.5"}`} />
      </span>
    </button>
  );
}

function QuotaEditor({
  mode,
  value,
  defaults,
  onChange,
}: {
  mode: Mode;
  value: QuotaSettings[Mode];
  defaults: QuotaSettings[Mode];
  onChange: (next: QuotaSettings[Mode]) => void;
}) {
  const { t } = useTranslation();
  const periodLabel = (period: CreditPeriod) =>
    period === "daily" ? t.tpAdmin.period_daily : period === "weekly" ? t.tpAdmin.period_weekly : t.tpAdmin.period_monthly;

  return (
    <div className="rounded-[10px] border border-border bg-[hsl(var(--control))] p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <ModeBadge mode={mode} />
          <div>
            <p className="text-sm font-semibold text-foreground">{mode === "demo" ? t.tpAdmin.quota_demo_title : t.tpAdmin.quota_real_title}</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {fill(t.tpAdmin.quota_default_hint, { allowance: defaults.allowance, period: periodLabel(defaults.period) })}
            </p>
          </div>
        </div>
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5 text-xs font-medium text-muted-foreground">
          {t.tpAdmin.quota_allowance}
          <input
            type="number"
            min={0}
            max={10000}
            step={1}
            required
            value={value.allowance}
            onChange={(event) => onChange({ ...value, allowance: Number(event.target.value) })}
            className="tabular h-10 rounded-lg border border-input bg-card px-3 text-sm text-foreground outline-none transition focus:border-primary/60 focus:ring-2 focus:ring-ring/20"
            data-testid={`input-quota-${mode}`}
          />
        </label>
        <label className="flex flex-col gap-1.5 text-xs font-medium text-muted-foreground">
          {t.tpAdmin.quota_period}
          <select
            value={value.period}
            onChange={(event) => onChange({ ...value, period: event.target.value as CreditPeriod })}
            className="h-10 rounded-lg border border-input bg-card px-3 text-sm text-foreground outline-none transition focus:border-primary/60 focus:ring-2 focus:ring-ring/20"
            data-testid={`select-quota-period-${mode}`}
          >
            {PERIODS.map((period) => <option key={period} value={period}>{periodLabel(period)}</option>)}
          </select>
        </label>
      </div>
    </div>
  );
}

export default function TpAdminQuotaSettingsPage() {
  const { t, lang } = useTranslation();
  const query = useSettings();
  const [quota, setQuota] = useState<QuotaSettings | null>(null);
  const [availability, setAvailability] = useState<AvailabilitySettings | null>(null);
  const [applyCurrent, setApplyCurrent] = useState(false);
  const [confirmSave, setConfirmSave] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);
  const [availabilityConfirm, setAvailabilityConfirm] = useState(false);
  const [availabilityPending, setAvailabilityPending] = useState(false);
  const [availabilityMessage, setAvailabilityMessage] = useState<Message | null>(null);

  useEffect(() => {
    if (query.data?.quota.current) setQuota(query.data.quota.current);
  }, [query.data?.quota.current]);

  useEffect(() => {
    if (query.data?.availability.current) setAvailability(query.data.availability.current);
  }, [query.data?.availability.current]);

  const dirty = useMemo(() => {
    if (!quota || !query.data) return false;
    return JSON.stringify(quota) !== JSON.stringify(query.data.quota.current);
  }, [quota, query.data]);

  const availabilityDirty = useMemo(() => {
    if (!availability || !query.data) return false;
    return JSON.stringify(availability) !== JSON.stringify(query.data.availability.current);
  }, [availability, query.data]);

  const pausedScopeCount = useMemo(() => {
    if (!availability) return 0;
    return [
      ...Object.values(availability.modes),
      ...Object.values(availability.instruments),
      ...Object.values(availability.timeframes),
    ].filter((value) => value === false).length;
  }, [availability]);

  const changeMode = (mode: Mode, next: QuotaSettings[Mode]) => {
    setQuota((current) => current ? { ...current, [mode]: next } : current);
    setConfirmSave(false);
    setMessage(null);
  };

  const save = async () => {
    if (!quota || !dirty) return;
    if (!confirmSave) {
      setConfirmSave(true);
      return;
    }
    setPending(true);
    setMessage(null);
    try {
      const result = await saveQuotaSettings(quota, applyCurrent);
      const appliedDemo = result.applied.demo ?? 0;
      const appliedReal = result.applied.real ?? 0;
      setMessage({
        tone: "ok",
        text: applyCurrent
          ? fill(t.tpAdmin.quota_saved_applied, { demo: appliedDemo, real: appliedReal })
          : t.tpAdmin.quota_saved,
      });
      setConfirmSave(false);
      await query.refetch();
    } catch (error) {
      const forbidden = error instanceof AdminApiError && error.status === 403;
      setMessage({ tone: "error", text: forbidden ? t.tpAdmin.quota_forbidden : t.tpAdmin.quota_error });
      setConfirmSave(false);
    } finally {
      setPending(false);
    }
  };

  const changeAvailability = (next: AvailabilitySettings) => {
    setAvailability(next);
    setAvailabilityConfirm(false);
    setAvailabilityMessage(null);
  };

  const changeAvailabilityScope = (
    scope: "modes" | "instruments" | "timeframes",
    key: string,
    enabled: boolean,
  ) => {
    if (!availability) return;
    if (scope === "modes") {
      changeAvailability({ ...availability, modes: { ...availability.modes, [key as Mode]: enabled } });
      return;
    }
    if (scope === "instruments") {
      changeAvailability({
        ...availability,
        instruments: { ...availability.instruments, [key as (typeof INSTRUMENTS)[number]]: enabled },
      });
      return;
    }
    changeAvailability({
      ...availability,
      timeframes: { ...availability.timeframes, [key as (typeof TIMEFRAMES)[number]]: enabled },
    });
  };

  const saveAvailability = async () => {
    if (!availability || !availabilityDirty) return;
    if (!availabilityConfirm) {
      setAvailabilityConfirm(true);
      return;
    }
    setAvailabilityPending(true);
    setAvailabilityMessage(null);
    try {
      await saveAvailabilitySettings(availability);
      setAvailabilityMessage({ tone: "ok", text: t.tpAdmin.availability_saved });
      setAvailabilityConfirm(false);
      await query.refetch();
    } catch (error) {
      const forbidden = error instanceof AdminApiError && error.status === 403;
      setAvailabilityMessage({
        tone: "error",
        text: forbidden ? t.tpAdmin.availability_forbidden : t.tpAdmin.availability_error,
      });
      setAvailabilityConfirm(false);
    } finally {
      setAvailabilityPending(false);
    }
  };

  const scopeLabels = useScopeLabels();
  const instrumentLabels = scopeLabels.instrument;
  const timeframeLabels = scopeLabels.timeframe;
  const pausedScopes = availability ? scopeLabels.pausedScopes(availability) : [];

  const discardAvailability = () => {
    if (query.data) setAvailability(query.data.availability.current);
    setAvailabilityConfirm(false);
    setAvailabilityMessage(null);
  };
  const discardQuota = () => {
    if (query.data) setQuota(query.data.quota.current);
    setApplyCurrent(false);
    setConfirmSave(false);
    setMessage(null);
  };

  return (
    <AdminShell>
      <SectionTabs section="settings" />
      <PageHeader title={t.tpAdmin.settings_title} subtitle={t.tpAdmin.settings_subtitle} />
      <QueryState isLoading={query.isLoading} error={query.error} onRetry={() => void query.refetch()}>
        {query.data && quota && availability ? (
          <>
            <Panel>
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-3">
                  <span
                    className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                      !availability.enabled
                        ? "bg-[var(--viz-critical)]/12"
                        : pausedScopes.length > 0
                          ? "bg-[var(--viz-warning)]/12"
                          : "bg-[var(--viz-good)]/12"
                    }`}
                  >
                    {!availability.enabled
                      ? <Ban className="h-5 w-5" style={{ color: "var(--viz-critical)" }} />
                      : pausedScopes.length > 0
                        ? <AlertTriangle className="h-5 w-5" style={{ color: "var(--viz-warning)" }} />
                        : <ShieldCheck className="h-5 w-5" style={{ color: "var(--viz-good)" }} />}
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-foreground">{t.tpAdmin.availability_status_title}</p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      {!availability.enabled
                        ? t.tpAdmin.availability_status_global_paused
                        : pausedScopeCount > 0
                          ? fill(t.tpAdmin.availability_status_partial, { count: pausedScopeCount })
                          : t.tpAdmin.availability_status_active}
                    </p>
                    {availability.enabled && pausedScopes.length > 0 ? (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {pausedScopes.map((label) => (
                          <span
                            key={label}
                            className="rounded-md border border-[var(--viz-critical)]/35 bg-[var(--viz-critical)]/10 px-2 py-0.5 text-[11px] text-foreground"
                          >
                            {label}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    <p className="mt-2 text-[11px] text-muted-foreground">
                      {query.data.availability.meta?.updatedAt
                        ? fill(t.tpAdmin.availability_last_updated, {
                            date: formatDateTime(query.data.availability.meta.updatedAt, lang),
                            admin: query.data.availability.meta.updatedBy ?? "—",
                          })
                        : t.tpAdmin.availability_not_updated}
                    </p>
                  </div>
                </div>
                <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                  <CheckCircle2 className="h-4 w-4" />
                  {t.tpAdmin.availability_no_restart}
                </span>
              </div>
            </Panel>

            {/* overflow-visible: bar simpan memakai position: sticky. */}
            <Panel title={t.tpAdmin.availability_title} className="overflow-visible">
              <div
                className={`rounded-[10px] border p-4 sm:p-5 ${
                  availability.enabled ? "border-border bg-[hsl(var(--control))]" : "border-[var(--viz-critical)]/40 bg-[var(--viz-critical)]/8"
                }`}
              >
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-start gap-3">
                    <Power className="mt-0.5 h-5 w-5 shrink-0" style={{ color: availability.enabled ? "var(--viz-good)" : "var(--viz-critical)" }} />
                    <div>
                      <p className="text-sm font-semibold text-foreground">{t.tpAdmin.availability_global_title}</p>
                      <p className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">{t.tpAdmin.availability_global_desc}</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={availability.enabled}
                    onClick={() => changeAvailability({ ...availability, enabled: !availability.enabled })}
                    data-testid="switch-availability-global"
                    className={`inline-flex h-10 shrink-0 items-center gap-2 rounded-lg border px-4 text-xs font-semibold transition focus:outline-none focus:ring-2 focus:ring-ring/30 ${
                      availability.enabled
                        ? "border-[var(--viz-good)]/35 bg-[var(--viz-good)]/10 text-foreground"
                        : "border-[var(--viz-critical)]/40 bg-[var(--viz-critical)]/12 text-foreground"
                    }`}
                  >
                    {availability.enabled ? <ShieldCheck className="h-4 w-4" /> : <Ban className="h-4 w-4" />}
                    {availability.enabled ? t.tpAdmin.availability_global_on : t.tpAdmin.availability_global_off}
                  </button>
                </div>
              </div>

              <div className="mt-5 grid gap-6 xl:grid-cols-3">
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">{t.tpAdmin.availability_modes_title}</h3>
                  <div className="mt-2.5 grid gap-2">
                    {MODES.map((mode) => (
                      <AvailabilityToggle
                        key={mode}
                        checked={availability.modes[mode] !== false}
                        label={mode === "demo" ? t.tpAdmin.mode_demo : t.tpAdmin.mode_real}
                        onChange={(enabled) => changeAvailabilityScope("modes", mode, enabled)}
                        testId={`switch-availability-mode-${mode}`}
                      />
                    ))}
                  </div>
                </div>
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">{t.tpAdmin.availability_instruments_title}</h3>
                  <div className="mt-2.5 grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
                    {INSTRUMENTS.map((instrument) => (
                      <AvailabilityToggle
                        key={instrument}
                        checked={availability.instruments[instrument] !== false}
                        label={instrumentLabels[instrument]}
                        onChange={(enabled) => changeAvailabilityScope("instruments", instrument, enabled)}
                        testId={`switch-availability-instrument-${instrument}`}
                      />
                    ))}
                  </div>
                </div>
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">{t.tpAdmin.availability_timeframes_title}</h3>
                  <div className="mt-2.5 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-2">
                    {TIMEFRAMES.map((timeframe) => (
                      <AvailabilityToggle
                        key={timeframe}
                        checked={availability.timeframes[timeframe] !== false}
                        label={timeframeLabels[timeframe]}
                        onChange={(enabled) => changeAvailabilityScope("timeframes", timeframe, enabled)}
                        testId={`switch-availability-timeframe-${timeframe}`}
                      />
                    ))}
                  </div>
                </div>
              </div>

              <div className="mt-6 grid gap-4 border-t border-border pt-5 lg:grid-cols-2">
                <label className="flex flex-col gap-1.5 text-xs font-medium text-muted-foreground">
                  {t.tpAdmin.availability_message_id}
                  <textarea
                    value={availability.message.id ?? ""}
                    maxLength={300}
                    rows={3}
                    onChange={(event) => changeAvailability({ ...availability, message: { ...availability.message, id: event.target.value || null } })}
                    placeholder={t.tpAdmin.availability_message_id_placeholder}
                    className="resize-y rounded-lg border border-input bg-card px-3 py-2.5 text-sm text-foreground outline-none transition focus:border-primary/60 focus:ring-2 focus:ring-ring/20"
                    data-testid="textarea-availability-message-id"
                  />
                </label>
                <label className="flex flex-col gap-1.5 text-xs font-medium text-muted-foreground">
                  {t.tpAdmin.availability_message_en}
                  <textarea
                    value={availability.message.en ?? ""}
                    maxLength={300}
                    rows={3}
                    onChange={(event) => changeAvailability({ ...availability, message: { ...availability.message, en: event.target.value || null } })}
                    placeholder={t.tpAdmin.availability_message_en_placeholder}
                    className="resize-y rounded-lg border border-input bg-card px-3 py-2.5 text-sm text-foreground outline-none transition focus:border-primary/60 focus:ring-2 focus:ring-ring/20"
                    data-testid="textarea-availability-message-en"
                  />
                </label>
              </div>
              <p className="mt-2 text-[11px] leading-5 text-muted-foreground">{t.tpAdmin.availability_message_hint}</p>

              <SaveBar
                dirty={availabilityDirty}
                confirm={availabilityConfirm}
                confirmText={t.tpAdmin.availability_confirm}
                confirmTone="critical"
                pending={availabilityPending}
                message={availabilityMessage}
                saveLabel={t.tpAdmin.availability_save}
                confirmLabel={t.tpAdmin.availability_confirm_save}
                onSave={() => void saveAvailability()}
                onDiscard={discardAvailability}
                testId="button-availability-save"
              />
            </Panel>

            <Panel
              title={t.tpAdmin.quota_title}
              className="overflow-visible"
              actions={
                <span className="inline-flex items-center gap-1.5 text-[11px]" style={{ color: "var(--viz-good)" }}>
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  {t.tpAdmin.quota_no_restart}
                </span>
              }
            >
              <div className="mb-5 flex flex-col gap-1 border-b border-border pb-4">
                <p className="text-xs text-muted-foreground">{t.tpAdmin.quota_subtitle}</p>
                <p className="text-[11px] text-muted-foreground">
                  <span className="font-medium text-foreground">
                    {query.data.quota.custom ? t.tpAdmin.quota_source_custom : t.tpAdmin.quota_source_environment}
                  </span>
                  {" · "}
                  {query.data.quota.meta?.updatedAt
                    ? fill(t.tpAdmin.quota_last_updated, {
                        date: formatDateTime(query.data.quota.meta.updatedAt, lang),
                        admin: query.data.quota.meta.updatedBy ?? "—",
                      })
                    : t.tpAdmin.quota_not_updated}
                </p>
              </div>
              <div className="grid gap-4 xl:grid-cols-2">
                {MODES.map((mode) => (
                  <QuotaEditor
                    key={mode}
                    mode={mode}
                    value={quota[mode]}
                    defaults={query.data.quota.defaults[mode]}
                    onChange={(next) => changeMode(mode, next)}
                  />
                ))}
              </div>

              <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-[10px] border border-border bg-[hsl(var(--control))] p-4">
                <input
                  type="checkbox"
                  checked={applyCurrent}
                  onChange={(event) => {
                    setApplyCurrent(event.target.checked);
                    setConfirmSave(false);
                  }}
                  className="mt-0.5 h-4 w-4 accent-[var(--tp-primary-500)]"
                />
                <span>
                  <span className="block text-sm font-medium text-foreground">{t.tpAdmin.quota_apply_current}</span>
                  <span className="mt-1 block text-xs leading-5 text-muted-foreground">{t.tpAdmin.quota_apply_current_desc}</span>
                </span>
              </label>

              <SaveBar
                dirty={dirty}
                confirm={confirmSave}
                confirmText={applyCurrent ? t.tpAdmin.quota_confirm_current : t.tpAdmin.quota_confirm_future}
                confirmTone="warning"
                pending={pending}
                message={message}
                saveLabel={t.tpAdmin.quota_save}
                confirmLabel={t.tpAdmin.quota_confirm_save}
                onSave={() => void save()}
                onDiscard={discardQuota}
                testId="button-quota-save"
              />
            </Panel>
          </>
        ) : null}
      </QueryState>
    </AdminShell>
  );
}
