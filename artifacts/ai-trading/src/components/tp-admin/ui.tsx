import { useState, type ReactNode } from "react";
import { Link } from "wouter";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Copy,
  Hourglass,
  Loader2,
  RefreshCw,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/lib/i18n";
import { fill, shortId } from "@/lib/tp-admin-api";

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="flex flex-col gap-4 pb-1 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.025em] text-foreground sm:text-[30px]">{title}</h1>
        {subtitle ? <p className="mt-1.5 max-w-3xl text-[13px] leading-5 text-muted-foreground sm:text-sm">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Panel({
  title,
  actions,
  children,
  className,
  bodyClassName,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cn("min-w-0 overflow-hidden rounded-[11px] border border-card-border bg-card shadow-[0_1px_2px_hsl(220_20%_2%/0.18)]", className)}>
      {title || actions ? (
        <header className="flex min-h-[52px] items-center justify-between gap-3 border-b border-card-border px-4 py-3 sm:px-5">
          {title ? <h2 className="text-[13px] font-semibold tracking-[-0.01em] text-foreground sm:text-sm">{title}</h2> : <span />}
          {actions}
        </header>
      ) : null}
      <div className={cn("p-4 sm:p-5", bodyClassName)}>{children}</div>
    </section>
  );
}

export function Kpi({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="group relative min-w-0 overflow-hidden rounded-[11px] border border-card-border bg-card px-4 py-4 transition hover:border-primary/30 sm:px-5">
      <span className="absolute inset-x-0 top-0 h-px bg-primary/60 opacity-0 transition group-hover:opacity-100" />
      <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">{label}</p>
      <p className="tabular mt-2 truncate text-[25px] font-semibold leading-none tracking-[-0.025em] text-foreground">{value}</p>
      {hint ? <p className="mt-2 min-h-4 text-[11px] leading-4 text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

const STATUS_META: Record<string, { icon: typeof Clock3; color: string }> = {
  still_valid: { icon: Clock3, color: "var(--viz-series-1)" },
  take_profit_1: { icon: CheckCircle2, color: "var(--viz-good)" },
  take_profit_2: { icon: CheckCircle2, color: "var(--viz-good)" },
  stop_loss: { icon: XCircle, color: "var(--viz-critical)" },
  expired: { icon: Hourglass, color: "var(--viz-neutral)" },
  invalid: { icon: AlertTriangle, color: "var(--viz-warning)" },
};

export function useStatusLabel() {
  const { t } = useTranslation();
  return (status: string) =>
    (t.tpAdmin as Record<string, string>)[`status_${status}`] ?? status;
}

export function StatusBadge({ status }: { status: string }) {
  const label = useStatusLabel()(status);
  const meta = STATUS_META[status] ?? { icon: Clock3, color: "var(--viz-neutral)" };
  const Icon = meta.icon;
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-medium text-foreground">
      <Icon className="h-3.5 w-3.5 shrink-0" style={{ color: meta.color }} aria-hidden />
      {label}
    </span>
  );
}

export function statusColor(status: string) {
  return (STATUS_META[status] ?? { color: "var(--viz-neutral)" }).color;
}

export function ModeBadge({ mode }: { mode: string }) {
  const { t } = useTranslation();
  return (
    <span
      className={cn(
        "inline-flex rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em]",
        mode === "real" ? "border-primary/35 bg-primary/8 text-primary" : "border-border bg-muted/40 text-muted-foreground",
      )}
    >
      {mode === "real" ? t.tpAdmin.mode_real : t.tpAdmin.mode_demo}
    </span>
  );
}

export function useDirectionLabel() {
  const { t } = useTranslation();
  return (direction: string) =>
    direction === "bullish"
      ? t.tpAdmin.direction_bullish
      : direction === "bearish"
        ? t.tpAdmin.direction_bearish
        : t.tpAdmin.direction_neutral;
}

export function DirectionText({ direction }: { direction: string }) {
  const label = useDirectionLabel()(direction);
  const arrow = direction === "bullish" ? "↑" : direction === "bearish" ? "↓" : "→";
  return (
    <span className="whitespace-nowrap text-xs text-foreground">
      <span aria-hidden className="mr-1 text-muted-foreground">{arrow}</span>
      {label}
    </span>
  );
}

export function CopyButton({ value, className }: { value: string; className?: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={cn(
        "inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition hover:bg-accent hover:text-primary",
        className,
      )}
      title={copied ? t.tpAdmin.copied : t.tpAdmin.copy}
      aria-label={copied ? t.tpAdmin.copied : t.tpAdmin.copy}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void navigator.clipboard?.writeText(value).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1200);
        });
      }}
    >
      {copied ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

export function UserIdLink({ userId, size = 10 }: { userId: string; size?: number }) {
  return (
    <span className="inline-flex items-center gap-0.5">
      <Link
        href={`/admin/users/${userId}`}
        className="font-mono text-xs text-primary hover:underline"
        title={userId}
      >
        {shortId(userId, size)}
      </Link>
      <CopyButton value={userId} />
    </span>
  );
}

export function Pagination({
  page,
  limit,
  total,
  onPage,
}: {
  page: number;
  limit: number;
  total: number;
  onPage: (page: number) => void;
}) {
  const { t, lang } = useTranslation();
  const pages = Math.max(1, Math.ceil(total / limit));
  const from = total === 0 ? 0 : (page - 1) * limit + 1;
  const to = Math.min(page * limit, total);
  const fmt = (n: number) => new Intl.NumberFormat(lang === "id" ? "id-ID" : "en-US").format(n);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-card-border px-4 py-3 text-xs text-muted-foreground sm:px-5">
      <span className="tabular">{fill(t.tpAdmin.showing, { from: fmt(from), to: fmt(to), total: fmt(total) })}</span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          className="inline-flex h-8 items-center gap-1 rounded-lg border border-border px-2.5 text-foreground transition hover:border-primary/30 hover:bg-accent disabled:opacity-40"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          {t.tpAdmin.prev}
        </button>
        <span className="tabular px-2">{fill(t.tpAdmin.page_of, { page, pages })}</span>
        <button
          type="button"
          className="inline-flex h-8 items-center gap-1 rounded-lg border border-border px-2.5 text-foreground transition hover:border-primary/30 hover:bg-accent disabled:opacity-40"
          disabled={page >= pages}
          onClick={() => onPage(page + 1)}
        >
          {t.tpAdmin.next}
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

export function QueryState({
  isLoading,
  error,
  onRetry,
  isEmpty,
  children,
}: {
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
  isEmpty?: boolean;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  if (isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t.tpAdmin.loading}
      </div>
    );
  }
  if (error) {
    const notFound = (error as { status?: number }).status === 404;
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16 text-sm text-muted-foreground">
        <p>{notFound ? t.tpAdmin.not_found : t.tpAdmin.load_error}</p>
        {notFound ? null : (
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-foreground transition hover:border-primary/30 hover:bg-accent"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            {t.tpAdmin.retry}
          </button>
        )}
      </div>
    );
  }
  if (isEmpty) {
    return <p className="py-16 text-center text-sm text-muted-foreground">{t.tpAdmin.empty}</p>;
  }
  return <>{children}</>;
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: Array<{ value: NoInfer<T>; label: string }>;
  onChange: (value: NoInfer<T>) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-lg border border-border bg-[hsl(var(--control))] p-1">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            "rounded-md px-3 py-1.5 text-[11px] font-medium transition",
            value === option.value ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-accent hover:text-foreground",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function SelectFilter({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  const { t } = useTranslation();
  return (
    <label className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">
      {label}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 rounded-lg border border-input bg-[hsl(var(--control))] px-2.5 text-[13px] text-foreground outline-none transition hover:border-primary/30 focus:border-primary/60 focus:ring-2 focus:ring-ring/20"
      >
        <option value="">{t.tpAdmin.all}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function TextFilter({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: "text" | "date";
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">
      {label}
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 rounded-lg border border-input bg-[hsl(var(--control))] px-2.5 text-[13px] text-foreground outline-none transition placeholder:text-muted-foreground/60 hover:border-primary/30 focus:border-primary/60 focus:ring-2 focus:ring-ring/20"
      />
    </label>
  );
}

export function KeyValues({ items }: { items: Array<{ label: string; value: ReactNode }> }) {
  return (
    <dl className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
      {items.map((item) => (
        <div key={item.label} className="flex min-w-0 items-baseline justify-between gap-3 border-b border-border/70 pb-2.5 sm:block">
          <dt className="text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground">{item.label}</dt>
          <dd className="min-w-0 break-words text-[13px] text-foreground sm:mt-1">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function JsonBlock({ value }: { value: unknown }) {
  const text = value === null || value === undefined ? "—" : JSON.stringify(value, null, 2);
  return (
    <div className="relative">
      {value ? <CopyButton value={text} className="absolute right-2 top-2 bg-card" /> : null}
      <pre className="max-h-96 overflow-auto rounded-lg border border-border bg-[hsl(var(--code))] p-4 font-mono text-[11px] leading-relaxed text-foreground">
        {text}
      </pre>
    </div>
  );
}

export function TableShell({ children }: { children: ReactNode }) {
  return <div className="tp-admin-table overflow-x-auto">{children}</div>;
}

export const th = "whitespace-nowrap px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-[0.09em] text-muted-foreground";
export const td = "whitespace-nowrap px-4 py-3 text-[13px] text-foreground";
