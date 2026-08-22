import { cn } from "@/lib/cn";

/** Progress ring for mastery / readiness scores. */
export function ProgressRing({
  value,
  size = 64,
  strokeWidth = 6,
  label,
  tone = "brand",
}: {
  value: number;
  size?: number;
  strokeWidth?: number;
  label?: string;
  tone?: "brand" | "success" | "warning" | "mastery" | "review";
}) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (Math.min(100, Math.max(0, value)) / 100) * circumference;
  const strokeColor = {
    brand: "stroke-brand-500",
    success: "stroke-success-500",
    warning: "stroke-warning-500",
    mastery: "stroke-mastery-500",
    review: "stroke-review-500",
  }[tone];

  return (
    <div
      className="relative inline-flex items-center justify-center"
      style={{ width: size, height: size }}
      role="img"
      aria-label={`${label ?? "Tiến độ"}: ${value}%`}
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={strokeWidth}
          className="fill-none stroke-ink-100"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className={cn("fill-none transition-all", strokeColor)}
        />
      </svg>
      <span className="absolute text-sm font-semibold text-ink-800">
        {value}%
      </span>
    </div>
  );
}

export function ProgressBar({
  value,
  tone = "brand",
  className,
}: {
  value: number;
  tone?: "brand" | "success" | "warning" | "error" | "mastery" | "review";
  className?: string;
}) {
  const fill = {
    brand: "bg-brand-500",
    success: "bg-success-500",
    warning: "bg-warning-500",
    error: "bg-error-500",
    mastery: "bg-mastery-500",
    review: "bg-review-500",
  }[tone];
  return (
    <div
      className={cn("h-2 w-full overflow-hidden rounded-full bg-ink-100", className)}
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className={cn("h-full rounded-full transition-all", fill)}
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  );
}
