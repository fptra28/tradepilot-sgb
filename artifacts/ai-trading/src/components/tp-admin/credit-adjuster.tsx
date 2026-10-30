import { useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, RotateCcw, Save } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { AdminApiError, adjustUserCredit, fill, formatDateTime, type CreditView, type Mode } from "@/lib/tp-admin-api";
import { ModeBadge, Panel } from "./ui";

function CreditRow({ userId, mode, credit }: { userId: string; mode: Mode; credit: CreditView | undefined }) {
  const { t, lang } = useTranslation();
  const queryClient = useQueryClient();
  const [confirmReset, setConfirmReset] = useState(false);
  const [remaining, setRemaining] = useState(credit ? String(credit.remaining) : "");
  const [pending, setPending] = useState<"reset" | "set" | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const run = async (kind: "reset" | "set") => {
    setPending(kind);
    setMessage(null);
    try {
      const result = await adjustUserCredit(
        userId,
        mode,
        kind === "reset" ? { action: "reset" } : { action: "set", remaining: Number(remaining) },
      );
      setRemaining(String(result.credit.remaining));
      setMessage({ tone: "ok", text: t.tpAdmin.credit_saved });
      await queryClient.invalidateQueries({ queryKey: ["tp-admin"] });
    } catch (error) {
      const status = error instanceof AdminApiError ? error.status : 0;
      setMessage({ tone: "error", text: status === 403 ? t.tpAdmin.credit_forbidden : t.tpAdmin.credit_error });
    } finally {
      setPending(null);
      setConfirmReset(false);
    }
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const value = Number(remaining);
    if (!Number.isInteger(value) || value < 0 || value > 1000) return;
    void run("set");
  };

  return (
    <div className="rounded-[10px] border border-border bg-[hsl(var(--control))] p-4" data-testid={`credit-row-${mode}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ModeBadge mode={mode} />
          <span className="tabular text-sm text-foreground">
            {credit ? `${credit.consumed}/${credit.allowance} ${t.tpAdmin.credit_used}` : t.tpAdmin.no_balance}
          </span>
          {credit?.resetsAt ? (
            <span className="text-xs text-muted-foreground">
              {fill(t.tpAdmin.resets, { date: formatDateTime(credit.resetsAt, lang) })}
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-1.5">
          {confirmReset ? (
            <button
              type="button"
              onClick={() => setConfirmReset(false)}
              className="h-8 rounded-md px-2.5 text-xs text-muted-foreground hover:text-foreground"
            >
              {t.tpAdmin.cancel}
            </button>
          ) : null}
          <button
            type="button"
            disabled={pending !== null}
            onClick={() => (confirmReset ? void run("reset") : setConfirmReset(true))}
            className={
              confirmReset
                ? "inline-flex h-8 items-center gap-1.5 rounded-lg bg-[var(--viz-critical)] px-2.5 text-xs font-medium text-white disabled:opacity-50"
                : "inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs text-foreground transition hover:border-primary/30 hover:bg-accent disabled:opacity-50"
            }
            data-testid={`button-credit-reset-${mode}`}
          >
            {pending === "reset" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
            {confirmReset ? t.tpAdmin.credit_reset_confirm : t.tpAdmin.credit_reset}
          </button>
        </div>
      </div>
      <form onSubmit={onSubmit} className="mt-3 flex items-end gap-2">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {t.tpAdmin.credit_set_label}
          <input
            type="number"
            min={0}
            max={1000}
            step={1}
            required
            value={remaining}
            onChange={(event) => setRemaining(event.target.value)}
            className="tabular h-8 w-28 rounded-lg border border-input bg-card px-2 text-sm text-foreground outline-none transition focus:border-primary/60 focus:ring-2 focus:ring-ring/20"
            data-testid={`input-credit-remaining-${mode}`}
          />
        </label>
        <button
          type="submit"
          disabled={pending !== null || remaining === ""}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground transition hover:brightness-105 disabled:opacity-50"
          data-testid={`button-credit-save-${mode}`}
        >
          {pending === "set" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          {t.tpAdmin.credit_save}
        </button>
      </form>
      {message ? (
        <p
          role="status"
          className="mt-2 text-xs"
          style={{ color: message.tone === "ok" ? "var(--viz-good)" : "var(--viz-critical)" }}
        >
          {message.text}
        </p>
      ) : null}
    </div>
  );
}

/** Panel penyesuaian kredit, hanya dirender untuk super_admin. */
export function CreditAdjuster({ userId, credits }: { userId: string; credits: NonNullable<CreditView>[] }) {
  const { t } = useTranslation();
  return (
    <Panel title={t.tpAdmin.credit_manage_title}>
      <p className="mb-3 text-xs text-muted-foreground">{t.tpAdmin.credit_manage_desc}</p>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {(["demo", "real"] as const).map((mode) => (
          <CreditRow
            key={`${mode}-${credits.find((c) => c.mode === mode)?.allowance ?? "none"}-${credits.find((c) => c.mode === mode)?.consumed ?? "none"}`}
            userId={userId}
            mode={mode}
            credit={credits.find((c) => c.mode === mode)}
          />
        ))}
      </div>
    </Panel>
  );
}
