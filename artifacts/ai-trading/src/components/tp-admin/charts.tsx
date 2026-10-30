import { useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useTranslation } from "@/lib/i18n";
import { formatShortDate } from "@/lib/tp-admin-api";
import { Panel, Segmented, td, th } from "./ui";

type DailyPoint = { date: string; value: number };

/**
 * Bar chart harian satu seri (satu sumbu). Tooltip per batang dan opsi tampilan
 * tabel untuk aksesibilitas. Warna seri dari token --viz-series-*.
 */
export function DailyBarChart({
  title,
  data,
  format,
  series = 1,
  integer = true,
}: {
  title: string;
  data: DailyPoint[];
  format: (value: number) => string;
  series?: 1 | 2;
  /** false untuk nilai pecahan (mis. biaya USD) supaya skala sumbu tidak melebar. */
  integer?: boolean;
}) {
  const { t, lang } = useTranslation();
  const [view, setView] = useState<"chart" | "table">("chart");
  const color = `var(--viz-series-${series})`;

  return (
    <Panel
      title={title}
      actions={
        <Segmented
          label={title}
          value={view}
          onChange={setView}
          options={[
            { value: "chart", label: t.tpAdmin.view_chart },
            { value: "table", label: t.tpAdmin.view_table },
          ]}
        />
      }
    >
      {view === "chart" ? (
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 0 }} barCategoryGap="22%">
              <CartesianGrid vertical={false} stroke="var(--viz-grid)" strokeWidth={1} />
              <XAxis
                dataKey="date"
                tickFormatter={(value: string) => formatShortDate(value, lang)}
                tick={{ fill: "var(--viz-axis)", fontSize: 11 }}
                axisLine={{ stroke: "var(--viz-grid)" }}
                tickLine={false}
                minTickGap={24}
              />
              <YAxis
                tickFormatter={(value: number) => format(value)}
                tick={{ fill: "var(--viz-axis)", fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                width={64}
                allowDecimals={!integer}
              />
              <Tooltip
                cursor={{ fill: "hsl(var(--accent))" }}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const point = payload[0].payload as DailyPoint;
                  return (
                    <div className="rounded-lg border border-popover-border bg-popover px-3 py-2 text-xs shadow-xl">
                      <p className="text-muted-foreground">{formatShortDate(point.date, lang)}</p>
                      <p className="tabular mt-0.5 font-semibold text-foreground">{format(point.value)}</p>
                    </div>
                  );
                }}
              />
              <Bar dataKey="value" fill={color} radius={[3, 3, 0, 0]} maxBarSize={24} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="max-h-56 overflow-auto">
          <table className="w-full">
            <thead>
              <tr>
                <th className={th}>{t.tpAdmin.date}</th>
                <th className={`${th} text-right`}>{title}</th>
              </tr>
            </thead>
            <tbody>
              {[...data].reverse().map((point) => (
                <tr key={point.date} className="border-t border-border">
                  <td className={td}>{formatShortDate(point.date, lang)}</td>
                  <td className={`${td} tabular text-right`}>{format(point.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

type BreakdownProps = {
  items: Array<{ key: string; count: number }>;
  labelFor?: (key: string) => string;
  colorFor?: (key: string) => string;
  formatValue: (value: number) => string;
};

/**
 * Daftar batang horizontal (HTML) untuk breakdown kategori. Label & angka
 * memakai warna teks; batang memakai satu warna seri (atau warna status).
 */
export function BreakdownList({ items, labelFor = (key) => key, colorFor, formatValue }: BreakdownProps) {
  const { t, lang } = useTranslation();
  const total = items.reduce((sum, item) => sum + item.count, 0);
  const max = Math.max(1, ...items.map((item) => item.count));
  const pct = (value: number) =>
    new Intl.NumberFormat(lang === "id" ? "id-ID" : "en-US", { style: "percent", maximumFractionDigits: 0 }).format(
      total > 0 ? value / total : 0,
    );

  if (items.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">{t.tpAdmin.empty}</p>;
  }
  return (
    <ul className="space-y-3.5">
      {items.map((item) => (
        <li key={item.key} title={`${labelFor(item.key)}: ${formatValue(item.count)} (${pct(item.count)})`}>
          <div className="flex items-baseline justify-between gap-3 text-xs">
            <span className="truncate text-foreground">{labelFor(item.key)}</span>
            <span className="tabular shrink-0 text-muted-foreground">
              <span className="font-medium text-foreground">{formatValue(item.count)}</span> · {pct(item.count)}
            </span>
          </div>
          <div className="mt-1.5 h-1.5 w-full rounded-full bg-muted">
            <div
              className="h-1.5 rounded-full"
              style={{
                width: `${Math.max(2, (item.count / max) * 100)}%`,
                background: colorFor ? colorFor(item.key) : "var(--viz-series-1)",
              }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function BreakdownBars({ title, ...props }: BreakdownProps & { title: string }) {
  return (
    <Panel title={title}>
      <BreakdownList {...props} />
    </Panel>
  );
}
