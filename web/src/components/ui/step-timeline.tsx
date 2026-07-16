import { Check, Loader2, X, Circle } from "lucide-react";
import { cn } from "@/lib/cn";
import type { ProcessingStep } from "@/lib/types";

/** Transparent pipeline timeline — processing shown as steps, not a vague spinner. */
export function StepTimeline({ steps }: { steps: ProcessingStep[] }) {
  return (
    <ol className="space-y-3">
      {steps.map((step) => (
        <li key={step.key} className="flex items-center gap-3">
          <span
            className={cn(
              "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border",
              step.status === "done" &&
                "border-success-500 bg-success-50 text-success-600",
              step.status === "running" &&
                "border-brand-500 bg-brand-50 text-brand-600",
              step.status === "failed" &&
                "border-error-500 bg-error-50 text-error-600",
              step.status === "pending" &&
                "border-ink-200 bg-white text-ink-300",
            )}
          >
            {step.status === "done" && <Check className="h-4 w-4" aria-hidden />}
            {step.status === "running" && (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            )}
            {step.status === "failed" && <X className="h-4 w-4" aria-hidden />}
            {step.status === "pending" && (
              <Circle className="h-3 w-3" aria-hidden />
            )}
          </span>
          <span
            className={cn(
              "text-sm",
              step.status === "pending" ? "text-ink-400" : "text-ink-800",
              step.status === "running" && "font-medium",
            )}
          >
            {step.label}
            {step.status === "running" && (
              <span className="ml-2 text-xs text-brand-600">đang chạy…</span>
            )}
            {step.status === "failed" && (
              <span className="ml-2 text-xs text-error-600">thất bại</span>
            )}
          </span>
        </li>
      ))}
    </ol>
  );
}
