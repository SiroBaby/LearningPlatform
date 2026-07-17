import { CircleCheckBig, Loader2, XCircle } from "lucide-react";
import { CitationSnippet } from "@/components/ui/citation";
import { toCitationSnippet, type QuestionPracticeFeedbackState } from "./quiz-play-utils";

interface PracticeFeedbackPanelProps {
  readonly feedback: QuestionPracticeFeedbackState | null;
}

export function PracticeFeedbackPanel({ feedback }: PracticeFeedbackPanelProps) {
  if (feedback?.status === "loading") {
    return (
      <div className="rounded-2xl border border-brand-100 bg-brand-50/60 p-4 text-sm text-brand-700" aria-live="polite">
        <div className="flex items-center gap-2 font-medium">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Đang kiểm tra lựa chọn của bạn…
        </div>
      </div>
    );
  }

  if (feedback?.status === "error") {
    return (
      <div className="rounded-2xl border border-warning-100 bg-warning-50 p-4 text-sm text-warning-900" aria-live="polite">
        Chưa thể tải phản hồi cho câu này. Bạn vẫn có thể tiếp tục làm bài và nộp bình thường.
      </div>
    );
  }

  if (feedback?.status !== "ready" || !feedback.response) {
    return null;
  }

  return (
    <div
      className={`rounded-2xl border p-4 ${feedback.response.isCorrect ? "border-success-100 bg-success-50/70" : "border-error-100 bg-error-50/70"}`}
      aria-live="polite"
    >
      <div className="flex items-start gap-3">
        {feedback.response.isCorrect ? (
          <CircleCheckBig className="mt-0.5 h-5 w-5 text-success-700" aria-hidden />
        ) : (
          <XCircle className="mt-0.5 h-5 w-5 text-error-700" aria-hidden />
        )}
        <div className="space-y-3">
          <div>
            <p className={`text-sm font-semibold ${feedback.response.isCorrect ? "text-success-900" : "text-error-900"}`}>
              {feedback.response.isCorrect ? "Chính xác" : "Chưa đúng"}
            </p>
            <p className="mt-1 text-sm leading-6 text-ink-700">{feedback.response.explanation}</p>
          </div>
          <CitationSnippet citation={toCitationSnippet(feedback.response)} />
        </div>
      </div>
    </div>
  );
}
