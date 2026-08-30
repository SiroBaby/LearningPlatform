import type { ComponentType, ReactNode } from "react";
import { AlertCircle, CheckCircle2, Info } from "lucide-react";
import { Badge, Card, CardBody, CardTitle } from "@/components/ui";
import { cn } from "@/lib/cn";

type StatusTone = "info" | "success" | "warning";

const statusStyles: Record<
  StatusTone,
  {
    icon: ComponentType<{ className?: string }>;
    containerClassName: string;
    iconClassName: string;
    eyebrow: string;
  }
> = {
  info: {
    icon: Info,
    containerClassName: "border-brand-100 bg-brand-50/70",
    iconClassName: "bg-white text-brand-600",
    eyebrow: "Thông tin",
  },
  success: {
    icon: CheckCircle2,
    containerClassName: "border-success-100 bg-success-50/80",
    iconClassName: "bg-white text-success-600",
    eyebrow: "Sẵn sàng",
  },
  warning: {
    icon: AlertCircle,
    containerClassName: "border-warning-100 bg-warning-50/80",
    iconClassName: "bg-white text-warning-600",
    eyebrow: "Lưu ý",
  },
};

export function AuthStatusMessage({
  title,
  description,
  tone = "info",
  children,
}: {
  title: string;
  description: string;
  tone?: StatusTone;
  children?: ReactNode;
}): ReactNode {
  const style = statusStyles[tone];
  const Icon = style.icon;

  return (
    <Card className={style.containerClassName} role="status" aria-live="polite">
      <CardBody className="space-y-4">
        <div className="flex items-start gap-3">
          <div
            className={cn(
              "flex h-10 w-10 shrink-0 items-center justify-center rounded-full",
              style.iconClassName,
            )}
          >
            <Icon className="h-5 w-5" aria-hidden />
          </div>
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ink-500">
              {style.eyebrow}
            </p>
            <h2 className="text-base font-semibold text-ink-900">{title}</h2>
            <p className="text-sm leading-6 text-ink-700">{description}</p>
          </div>
        </div>
        {children}
      </CardBody>
    </Card>
  );
}

export function AuthHelperPanel({
  badge,
  title,
  description,
  items,
}: {
  badge?: string;
  title: string;
  description: string;
  items: readonly string[];
}): ReactNode {
  return (
    <Card className="border-ink-200 bg-ink-50/70">
      <CardBody className="space-y-4">
        <div className="space-y-2">
          {badge ? <Badge tone="brand">{badge}</Badge> : null}
          <CardTitle>{title}</CardTitle>
          <p className="text-sm leading-6 text-ink-600">{description}</p>
        </div>
        <ul className="space-y-2 text-sm text-ink-700">
          {items.map((item) => (
            <li key={item} className="flex items-start gap-2">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500" aria-hidden />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}

export function AuthOptionCard({
  id,
  title,
  description,
  detail,
  isSelected,
  onSelect,
}: {
  id: string;
  title: string;
  description: string;
  detail?: string;
  isSelected: boolean;
  onSelect: () => void;
}): ReactNode {
  return (
    <button
      id={id}
      type="button"
      role="radio"
      aria-checked={isSelected}
      onClick={onSelect}
      className={cn(
        "w-full rounded-2xl border p-4 text-left transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500/40",
        isSelected
          ? "border-brand-400 bg-brand-50 shadow-sm"
          : "border-ink-200 bg-white hover:border-brand-200 hover:bg-brand-50/40",
      )}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border",
            isSelected
              ? "border-brand-500 bg-brand-500"
              : "border-ink-300 bg-white",
          )}
          aria-hidden
        >
          <span
            className={cn(
              "h-2 w-2 rounded-full bg-white transition-opacity",
              isSelected ? "opacity-100" : "opacity-0",
            )}
          />
        </span>
        <div className="space-y-1">
          <h3 className="text-sm font-semibold text-ink-900">{title}</h3>
          <p className="text-sm leading-6 text-ink-600">{description}</p>
          {detail ? <p className="text-xs text-ink-500">{detail}</p> : null}
        </div>
      </div>
    </button>
  );
}
