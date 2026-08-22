import { cn } from "@/lib/cn";

export interface ChartDatum {
  label: string;
  value: number;
  tone?: "brand" | "success" | "warning" | "error" | "mastery" | "review";
}

const toneClassMap: Record<NonNullable<ChartDatum["tone"]>, string> = {
  brand: "bg-brand-500",
  success: "bg-success-500",
  warning: "bg-warning-500",
  error: "bg-error-500",
  mastery: "bg-mastery-500",
  review: "bg-review-500",
};

/** Accessible mini bar chart with textual values beside bars. */
export function BarChart({
  data,
  summary,
  className,
}: {
  data: readonly ChartDatum[];
  summary: string;
  className?: string;
}) {
  const maxValue = Math.max(...data.map((item) => item.value), 1);
  return (
    <div className={cn("space-y-3", className)}>
      <div className="sr-only">{summary}</div>
      {data.map((item) => (
        <div key={item.label} className="space-y-1.5">
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="text-ink-600">{item.label}</span>
            <span className="font-medium text-ink-900">{item.value}%</span>
          </div>
          <div className="h-2 rounded-full bg-ink-100">
            <div
              className={cn(
                "h-2 rounded-full",
                toneClassMap[item.tone ?? "brand"],
              )}
              style={{ width: `${(item.value / maxValue) * 100}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Lightweight trend chart using points + connecting segments. */
export function TrendChart({
  data,
  summary,
  className,
}: {
  data: readonly ChartDatum[];
  summary: string;
  className?: string;
}) {
  const maxValue = Math.max(...data.map((item) => item.value), 1);
  return (
    <div className={cn("space-y-3", className)}>
      <div className="sr-only">{summary}</div>
      <div className="flex items-end gap-3 rounded-2xl border border-ink-100 bg-ink-50/70 p-4">
        {data.map((item) => {
          const height = Math.max(16, (item.value / maxValue) * 120);
          return (
            <div key={item.label} className="flex min-w-0 flex-1 flex-col items-center gap-2">
              <span className="text-xs font-medium text-ink-800">{item.value}%</span>
              <div className="flex h-32 items-end">
                <div
                  className={cn(
                    "w-8 rounded-t-xl",
                    toneClassMap[item.tone ?? "brand"],
                  )}
                  style={{ height }}
                />
              </div>
              <span className="text-center text-xs text-ink-500">{item.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
