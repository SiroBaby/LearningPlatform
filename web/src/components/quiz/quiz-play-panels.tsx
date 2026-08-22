import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { ProgressBar } from "@/components/ui/progress";
import type { Phase0QuizResponse } from "@/lib/phase0/contracts";
import type { QuizMode } from "@/lib/types";
import { PracticeFeedbackPanel } from "./practice-feedback-panel";
import { QuizActionBar, QuizPalette } from "./quiz-play-sections";
import { getDisplayPosition, type MissingAnswerSummary, type QuestionPracticeFeedbackState } from "./quiz-play-utils";

interface QuizQuestionCardProps {
  readonly quiz: Phase0QuizResponse;
  readonly mode: QuizMode;
  readonly currentIndex: number;
  readonly elapsedSecLabel: string;
  readonly progressValue: number;
  readonly currentQuestionId: string;
  readonly currentQuestionStem: string;
  readonly currentQuestionOptions: readonly { readonly id: string; readonly content: string }[];
  readonly currentQuestionTone: "warning" | "success" | "neutral";
  readonly currentAnswer: string | null;
  readonly missingAnswerSummary: MissingAnswerSummary | null;
  readonly submitError: string | null;
  readonly summaryId: string;
  readonly errorSummaryRef: React.RefObject<HTMLDivElement | null>;
  readonly visiblePracticeFeedback: QuestionPracticeFeedbackState | null;
  readonly flaggedSet: ReadonlySet<string>;
  readonly isSubmitting: boolean;
  readonly isLeaving: boolean;
  readonly canCheckCurrentAnswer: boolean;
  readonly isCheckingCurrentAnswer: boolean;
  readonly onSelectOption: (questionId: string, optionId: string) => void;
  readonly onLeave: () => void;
  readonly onPrevious: () => void;
  readonly onToggleFlag: () => void;
  readonly onCheckAnswer: () => void;
  readonly onNext: () => void;
  readonly onSubmit: () => void;
}

export function QuizQuestionCard({
  quiz,
  mode,
  currentIndex,
  elapsedSecLabel,
  progressValue,
  currentQuestionId,
  currentQuestionStem,
  currentQuestionOptions,
  currentQuestionTone,
  currentAnswer,
  missingAnswerSummary,
  submitError,
  summaryId,
  errorSummaryRef,
  visiblePracticeFeedback,
  flaggedSet,
  isSubmitting,
  isLeaving,
  canCheckCurrentAnswer,
  isCheckingCurrentAnswer,
  onSelectOption,
  onLeave,
  onPrevious,
  onToggleFlag,
  onCheckAnswer,
  onNext,
  onSubmit,
}: QuizQuestionCardProps) {
  const currentDisplayPosition = getDisplayPosition(currentIndex);

  return (
    <Card>
      <CardHeader className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="neutral">Câu {currentDisplayPosition}/{quiz.questions.length}</Badge>
              <Badge tone={currentQuestionTone}>{flaggedSet.has(currentQuestionId) ? "Đã đánh dấu" : currentAnswer ? "Đã trả lời" : "Chưa trả lời"}</Badge>
              <Badge>{mode === "test" ? "Chế độ kiểm tra" : "Chế độ luyện tập"}</Badge>
            </div>
            <CardTitle className="mt-3 text-xl">{currentQuestionStem}</CardTitle>
          </div>
          <div className="text-sm font-medium text-ink-600">Thời gian · {elapsedSecLabel}</div>
        </div>
        <ProgressBar value={progressValue} />
      </CardHeader>
      <CardBody className="space-y-5">
        {missingAnswerSummary ? (
          <div
            ref={errorSummaryRef}
            tabIndex={-1}
            role="alert"
            aria-live="polite"
            className="rounded-2xl border border-error-100 bg-error-50 p-4 text-sm text-error-800 focus:outline-none focus:ring-2 focus:ring-error-500 focus:ring-offset-2"
          >
            <p className="font-semibold">Bạn còn {missingAnswerSummary.count} câu chưa trả lời.</p>
            <p className="mt-1">Hãy bắt đầu từ câu {missingAnswerSummary.firstDisplayPosition} rồi nộp bài lại.</p>
          </div>
        ) : null}

        {submitError ? (
          <div role="alert" aria-live="polite" className="rounded-2xl border border-error-100 bg-error-50 p-4 text-sm text-error-800">
            {submitError}
          </div>
        ) : null}

        <fieldset className="space-y-3" aria-describedby={summaryId}>
          <legend className="sr-only">Chọn một đáp án</legend>
          {currentQuestionOptions.map((option) => {
            const inputId = `${currentQuestionId}-${option.id}`;
            const isChecked = currentAnswer === option.id;
            const practiceResponse = visiblePracticeFeedback?.status === "ready" ? visiblePracticeFeedback.response : null;
            const isFeedbackOption = practiceResponse?.selectedOptionId === option.id;
            const optionFeedbackTone = isFeedbackOption
              ? practiceResponse.isCorrect
                ? "border-success-200 bg-success-50"
                : "border-error-200 bg-error-50"
              : isChecked
                ? "border-brand-200 bg-brand-50"
                : "border-ink-100 bg-white hover:border-brand-200 hover:bg-brand-50/40";

            return (
              <label
                key={option.id}
                htmlFor={inputId}
                className={`flex cursor-pointer items-start gap-3 rounded-2xl border p-4 transition-colors ${optionFeedbackTone}`}
              >
                <input
                  id={inputId}
                  type="radio"
                  name={currentQuestionId}
                  value={option.id}
                  checked={isChecked}
                  onChange={() => onSelectOption(currentQuestionId, option.id)}
                  className="mt-1 h-4 w-4 border-ink-300 text-brand-600 focus:ring-brand-500"
                />
                <div className="space-y-1">
                  <p className="text-sm font-medium text-ink-900">{option.content}</p>
                  {isFeedbackOption && practiceResponse ? (
                    <p className={`text-xs font-medium ${practiceResponse.isCorrect ? "text-success-800" : "text-error-800"}`}>
                      {practiceResponse.isCorrect ? "Bạn đã chọn đúng." : "Lựa chọn này chưa đúng."}
                    </p>
                  ) : null}
                </div>
              </label>
            );
          })}
        </fieldset>

        {mode === "practice" ? <PracticeFeedbackPanel feedback={visiblePracticeFeedback} /> : null}

        <div id={summaryId} className="rounded-2xl border border-ink-100 bg-ink-50/70 p-4 text-sm leading-6 text-ink-600">
          {mode === "practice"
            ? "Chọn đáp án rồi bấm Kiểm tra đáp án khi bạn muốn xem giải thích cho câu này."
            : "Bạn có thể chuyển câu, xem lại đáp án đã chọn và nộp bài khi đã sẵn sàng."}
        </div>

        <QuizActionBar
          mode={mode}
          currentIndex={currentIndex}
          questionCount={quiz.questions.length}
          currentQuestionId={currentQuestionId}
          flaggedSet={flaggedSet}
          isSubmitting={isSubmitting}
          isLeaving={isLeaving}
          canCheckCurrentAnswer={canCheckCurrentAnswer}
          isCheckingCurrentAnswer={isCheckingCurrentAnswer}
          onLeave={onLeave}
          onPrevious={onPrevious}
          onToggleFlag={onToggleFlag}
          onCheckAnswer={onCheckAnswer}
          onNext={onNext}
          onSubmit={onSubmit}
        />
      </CardBody>
    </Card>
  );
}

interface QuizLeaveDialogProps {
  readonly isOpen: boolean;
  readonly isLeaving: boolean;
  readonly onClose: () => void;
  readonly onConfirmLeave: () => void;
}

export function QuizLeaveDialog({ isOpen, isLeaving, onClose, onConfirmLeave }: QuizLeaveDialogProps) {
  return (
    <Dialog
      open={isOpen}
      onClose={onClose}
      title="Rời bài?"
      footer={(
        <>
          <Button variant="outline" onClick={onClose} disabled={isLeaving}>
            Ở lại
          </Button>
          <Button onClick={onConfirmLeave} disabled={isLeaving}>
            {isLeaving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            Rời bài
          </Button>
        </>
      )}
    >
      <p className="text-sm leading-6 text-ink-600">Phần đang làm sẽ được lưu để bạn tiếp tục khi quay lại.</p>
    </Dialog>
  );
}

interface QuizPaletteCardProps {
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

export function QuizPaletteCard(props: QuizPaletteCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Danh sách câu hỏi</CardTitle>
      </CardHeader>
      <CardBody className="space-y-4">
        <QuizPalette {...props} />
      </CardBody>
    </Card>
  );
}
