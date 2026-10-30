import { useState, type FormEvent } from "react";
import { useLocation } from "wouter";
import { Loader2, Search, ShieldCheck } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { AdminApiError, lookupUserByEmail } from "@/lib/tp-admin-api";
import { Panel } from "./ui";

/**
 * Pencarian nasabah via email (blind index di server). Email hanya dikirim di
 * body POST, tidak masuk URL; saat ketemu diteruskan ke halaman detail lewat
 * history state (bukan query string) supaya bisa ditampilkan tersamar.
 */
export function EmailLookup() {
  const { t } = useTranslation();
  const [, setLocation] = useLocation();
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const value = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      setMessage(t.tpAdmin.email_lookup_invalid);
      return;
    }
    setPending(true);
    setMessage(null);
    try {
      const result = await lookupUserByEmail(value);
      if (result.found) {
        setLocation(`/admin/users/${result.userId}`, { state: { lookupEmail: value } });
        return;
      }
      setMessage(t.tpAdmin.email_lookup_not_found);
    } catch (error) {
      const status = error instanceof AdminApiError ? error.status : 0;
      setMessage(
        status === 503
          ? t.tpAdmin.email_lookup_not_configured
          : status === 429
            ? t.tpAdmin.email_lookup_rate_limited
            : status === 400
              ? t.tpAdmin.email_lookup_invalid
              : t.tpAdmin.load_error,
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <Panel title={t.tpAdmin.email_lookup_title}>
      <form onSubmit={onSubmit} className="flex flex-col gap-2 sm:flex-row" data-testid="form-email-lookup">
        <input
          type="email"
          inputMode="email"
          autoComplete="off"
          spellCheck={false}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder={t.tpAdmin.email_lookup_placeholder}
          aria-label={t.tpAdmin.email_lookup_title}
          className="h-10 min-w-0 flex-1 rounded-lg border border-input bg-[hsl(var(--control))] px-3 text-[13px] text-foreground outline-none transition placeholder:text-muted-foreground/60 hover:border-primary/30 focus:border-primary/60 focus:ring-2 focus:ring-ring/20"
        />
        <button
          type="submit"
          disabled={pending}
          className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg bg-primary px-4 text-[13px] font-semibold text-primary-foreground transition hover:brightness-105 disabled:opacity-50"
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          {t.tpAdmin.email_lookup_button}
        </button>
      </form>
      {message ? (
        <p role="status" className="mt-2 text-sm text-foreground">
          {message}
        </p>
      ) : null}
      <p className="mt-2 flex items-start gap-1.5 text-xs text-muted-foreground">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        {t.tpAdmin.email_lookup_desc}
      </p>
    </Panel>
  );
}
