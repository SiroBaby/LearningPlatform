import { cn } from "@/lib/cn";
import type { DocumentStatus, DocumentType, Difficulty } from "@/lib/types";

type Tone =
  | "brand"
  | "success"
  | "warning"
  | "error"
  | "mastery"
  | "review"
  | "neutral";

const tones: Record<Tone, string> = {
  brand: "bg-brand-50 text-brand-700 border-brand-100",
  success: "bg-success-50 text-success-700 border-success-100",
  warning: "bg-warning-50 text-warning-700 border-warning-100",
  error: "bg-error-50 text-error-700 border-error-100",
  mastery: "bg-mastery-50 text-mastery-600 border-mastery-100",
  review: "bg-review-50 text-review-600 border-review-100",
  neutral: "bg-ink-100 text-ink-600 border-ink-200",
};

export function Badge({
  tone = "neutral",
  className,
  children,
}: {
  tone?: Tone;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

const statusMap: Record<
  DocumentStatus,
  { tone: Tone; label: string; dot: string }
> = {
  uploaded: { tone: "neutral", label: "Đã tải lên", dot: "bg-ink-400" },
  processing: { tone: "brand", label: "Đang xử lý", dot: "bg-brand-500" },
  ready: { tone: "success", label: "Sẵn sàng", dot: "bg-success-500" },
  failed: { tone: "error", label: "Thất bại", dot: "bg-error-500" },
};

/** Status pill — never relies on color alone (text + dot + label). */
export function StatusPill({ status }: { status: DocumentStatus }) {
  const s = statusMap[status];
  return (
    <Badge tone={s.tone}>
      <span className={cn("h-1.5 w-1.5 rounded-full", s.dot)} aria-hidden />
      {s.label}
    </Badge>
  );
}

const typeLabels: Record<DocumentType, string> = {
  pdf: "PDF",
  text: "Văn bản",
  video: "Video",
  audio: "Audio",
};

export function TypeBadge({ type }: { type: DocumentType }) {
  return <Badge tone="neutral">{typeLabels[type]}</Badge>;
}

const diffMap: Record<Difficulty, { tone: Tone; label: string }> = {
  easy: { tone: "success", label: "Dễ" },
  medium: { tone: "warning", label: "Trung bình" },
  hard: { tone: "error", label: "Khó" },
};

export function DifficultyBadge({ difficulty }: { difficulty: Difficulty }) {
  const d = diffMap[difficulty];
  return <Badge tone={d.tone}>{d.label}</Badge>;
}
