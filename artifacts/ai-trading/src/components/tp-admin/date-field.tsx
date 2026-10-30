import { useEffect, useRef, useState } from "react";
import { CalendarDays } from "lucide-react";

/** "2026-10-28" -> "28/10/2026" */
function toDisplay(iso: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : "";
}

/** "28/10/2026" -> "2026-10-28"; null bila tidak valid. */
function toIso(display: string) {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(display.trim());
  if (!match) return null;
  const [day, month, year] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Input tanggal berformat dd/mm/yyyy (tidak tergantung locale browser) dengan
 * tombol kalender bawaan browser. Nilai yang dikirim tetap ISO (YYYY-MM-DD).
 */
export function DateField({
  label,
  value,
  onChange,
  pickerLabel,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  pickerLabel: string;
}) {
  const [draft, setDraft] = useState(toDisplay(value));
  const [invalid, setInvalid] = useState(false);
  const pickerRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    setDraft(toDisplay(value));
    setInvalid(false);
  }, [value]);

  const commit = () => {
    if (!draft.trim()) {
      setInvalid(false);
      if (value) onChange("");
      return;
    }
    const iso = toIso(draft);
    setInvalid(iso === null);
    if (iso && iso !== value) onChange(iso);
  };

  return (
    <label className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">
      {label}
      <span className="relative">
        <input
          type="text"
          inputMode="numeric"
          value={draft}
          placeholder="dd/mm/yyyy"
          aria-invalid={invalid}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") commit();
          }}
          className={`h-9 w-full rounded-lg border bg-[hsl(var(--control))] pl-2.5 pr-9 text-[13px] text-foreground outline-none transition placeholder:text-muted-foreground/60 hover:border-primary/30 focus:ring-2 focus:ring-ring/20 ${
            invalid ? "border-[var(--viz-critical)]" : "border-input focus:border-primary/60"
          }`}
        />
        <button
          type="button"
          aria-label={pickerLabel}
          title={pickerLabel}
          onClick={() => {
            try {
              pickerRef.current?.showPicker();
            } catch {
              pickerRef.current?.focus();
            }
          }}
          className="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-muted-foreground hover:text-foreground"
        >
          <CalendarDays className="h-4 w-4" />
        </button>
        <input
          ref={pickerRef}
          type="date"
          tabIndex={-1}
          aria-hidden="true"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="pointer-events-none absolute bottom-0 right-0 h-0 w-0 opacity-0"
        />
      </span>
    </label>
  );
}
