import { Flag, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getDisplayPosition, getQuestionTone } from "./quiz-play-utils";

interface QuizActionBarProps {
  readonly mode: "practice" | "test";
  readonly currentIndex: number;
  readonly questionCount: number;
  readonly currentQuestionId: string;
  readonly flaggedSet: ReadonlySet<string>;
  readonly isSubmitting: boolean;
  readonly isLeaving: boolean;
  readonly canCheckCurrentAnswer: boolean;
  readonly isCheckingCurrentAnswer: boolean;
  readonly onLeave: () => void;
  readonly onPrevious: () => void;
  readonly onToggleFlag: () => void;
  readonly onCheckAnswer: () => void;
  readonly onNext: () => void;
  readonly onSubmit: () => void;
}

export function QuizActionBar({
  mode,
  currentIndex,
  questionCount,
  currentQuestionId,
  flaggedSet,
  isSubmitting,
  isLeaving,
  canCheckCurrentAnswer,
  isCheckingCurrentAnswer,
  onLeave,
  onPrevious,
  onToggleFlag,
  onCheckAnswer,
  onNext,
  onSubmit,
}: QuizActionBarProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ink-100 pt-4">
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={onLeave} disabled={isSubmitting || isLeaving}>
          Rời bài
        </Button>
        <Button variant="outline" onClick={onPrevious} disabled={currentIndex === 0 || isSubmitting || isLeaving}>
          Câu trước
        </Button>
        <Button
          variant={flaggedSet.has(currentQuestionId) ? "secondary" : "outline"}
          onClick={onToggleFlag}
          disabled={isSubmitting || isLeaving}
        >
          <Flag className="h-4 w-4" aria-hidden />
          {flaggedSet.has(currentQuestionId) ? "Đã đánh dấu" : "Đánh dấu xem lại"}
        </Button>
      </div>
      <div className="flex flex-wrap gap-2">
        {mode === "practice" ? (
          <Button
            variant="secondary"
            onClick={onCheckAnswer}
            disabled={!canCheckCurrentAnswer || isCheckingCurrentAnswer || isSubmitting || isLeaving}
          >
            {isCheckingCurrentAnswer ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            Kiểm tra đáp án
          </Button>
        ) : null}
        <Button variant="outline" onClick={onNext} disabled={currentIndex >= questionCount - 1 || isSubmitting || isLeaving}>
          Câu tiếp theo
        </Button>
        <Button onClick={onSubmit} disabled={isSubmitting || isLeaving}>
          {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
          Nộp bài
        </Button>
      </div>
    </div>
  );
}

interface QuizPaletteProps {
  readonly questionIds: readonly string[];
  readonly currentQuestionId: string;
  readonly flaggedSet: ReadonlySet<string>;
  readonly answers: Readonly<Record<string, string | null>>;
  readonly isSubmitting: boolean;
  readonly setQuestionRef: (questionId: string, node: HTMLButtonElement | null) => void;
  readonly onSelectQuestion: (index: number) => void;
  readonly answeredCount: number;
  readonly flaggedCount: number;
  readonly unansweredCount: number;
}

export function QuizPalette({
  questionIds,
  currentQuestionId,
  flaggedSet,
  answers,
  isSubmitting,
  setQuestionRef,
  onSelectQuestion,
  answeredCount,
  flaggedCount,
  unansweredCount,
}: QuizPaletteProps) {
  return (
    <>
      <div className="grid grid-cols-5 gap-2">
        {questionIds.map((questionId, index) => (
          <button
            key={questionId}
            ref={(node) => {
              setQuestionRef(questionId, node);
            }}
            type="button"
            onClick={() => onSelectQuestion(index)}
            className={`flex h-11 items-center justify-center rounded-xl border text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 ${getQuestionTone(questionId, currentQuestionId, flaggedSet, answers)}`}
            aria-current={questionId === currentQuestionId ? "step" : undefined}
            aria-label={`Đi tới câu ${getDisplayPosition(index)}`}
            disabled={isSubmitting}
          >
            {getDisplayPosition(index)}
          </button>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
        <div className="rounded-2xl border border-success-100 bg-success-50 px-4 py-3 text-sm text-success-800">
          Đã trả lời: {answeredCount}
        </div>
        <div className="rounded-2xl border border-warning-100 bg-warning-50 px-4 py-3 text-sm text-warning-800">
          Đã đánh dấu: {flaggedCount}
        </div>
        <div className="rounded-2xl border border-ink-100 bg-ink-50 px-4 py-3 text-sm text-ink-700">
          Chưa trả lời: {unansweredCount}
        </div>
      </div>
      <div className="rounded-2xl border border-brand-100 bg-brand-50/60 p-4 text-sm leading-6 text-brand-700">
        Phần làm dở của bạn được giữ lại trên thiết bị này để có thể tiếp tục khi quay lại.
      </div>
    </>
  );
}
