"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Flag, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { ProgressBar } from "@/components/ui/progress";
import { useToast } from "@/components/ui/toast";
import {
  clearQuizDraft,
  readQuizDraft,
  writeQuizDraft,
  type QuizDraftState,
} from "@/components/quiz/quiz-session";
import { Phase0ClientError, submitPhase0QuizAttempt } from "@/lib/phase0/client";
import type { Phase0QuizResponse } from "@/lib/phase0/contracts";
import { routes } from "@/lib/routes";
import type { QuizMode } from "@/lib/types";

interface QuizPlayScreenProps {
  readonly quiz: Phase0QuizResponse;
  readonly mode: QuizMode;
  readonly resume: boolean;
}

interface MissingAnswerItem {
  readonly questionId: string;
  readonly ordinal: number;
}

function formatDuration(totalSec: number): string {
  const safeTotal = Math.max(0, totalSec);
  const hours = Math.floor(safeTotal / 3600);
  const minutes = Math.floor((safeTotal % 3600) / 60);
  const seconds = safeTotal % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function createEmptyAnswers(quiz: Phase0QuizResponse): Record<string, string | null> {
  return Object.fromEntries(quiz.questions.map((question) => [question.id, null]));
}

function buildSubmitAnswers(
  quiz: Phase0QuizResponse,
  answers: Readonly<Record<string, string | null>>,
): Array<{ questionId: string; optionId: string }> {
  return quiz.questions.flatMap((question) => {
    const optionId = answers[question.id];
    if (typeof optionId !== "string") {
      return [];
    }
    return [{ questionId: question.id, optionId }];
  });
}

function sanitizeDraft(quiz: Phase0QuizResponse, draft: QuizDraftState | null): QuizDraftState {
  const validQuestionIds = new Set(quiz.questions.map((question) => question.id));
  const validOptionsByQuestion = new Map(
    quiz.questions.map((question) => [question.id, new Set(question.options.map((option) => option.id))]),
  );
  const answers = createEmptyAnswers(quiz);

  if (draft) {
    for (const question of quiz.questions) {
      const selectedOptionId = draft.answers[question.id];
      if (typeof selectedOptionId !== "string") {
        continue;
      }
      if (validOptionsByQuestion.get(question.id)?.has(selectedOptionId)) {
        answers[question.id] = selectedOptionId;
      }
    }
  }

  const currentIndex = draft ? Math.min(Math.max(draft.currentIndex, 0), Math.max(quiz.questions.length - 1, 0)) : 0;

  return {
    answers,
    currentIndex,
    elapsedSec: draft ? Math.max(0, draft.elapsedSec) : 0,
    flaggedQuestionIds: draft
      ? draft.flaggedQuestionIds.filter((questionId) => validQuestionIds.has(questionId))
      : [],
    mode: draft?.mode ?? "practice",
    updatedAt: draft?.updatedAt ?? new Date().toISOString(),
  };
}

function getQuestionTone(questionId: string, currentQuestionId: string, flaggedSet: ReadonlySet<string>, answers: Readonly<Record<string, string | null>>): string {
  if (questionId === currentQuestionId) {
    return "border-brand-300 bg-brand-50 text-brand-700";
  }
  if (flaggedSet.has(questionId)) {
    return "border-warning-200 bg-warning-50 text-warning-800";
  }
  if (answers[questionId]) {
    return "border-success-200 bg-success-50 text-success-800";
  }
  return "border-ink-200 bg-white text-ink-600 hover:border-brand-200 hover:bg-brand-50/40";
}

export function QuizPlayScreen({ quiz, mode, resume }: QuizPlayScreenProps) {
  const router = useRouter();
  const { notify } = useToast();
  const summaryId = useId();
  const errorSummaryRef = useRef<HTMLDivElement | null>(null);
  const questionRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const savedDraft = resume ? readQuizDraft(quiz.id, mode) : null;
  const initialDraft = useMemo(() => sanitizeDraft(quiz, savedDraft), [quiz, savedDraft]);
  const [answers, setAnswers] = useState<Record<string, string | null>>(initialDraft.answers);
  const [currentIndex, setCurrentIndex] = useState<number>(initialDraft.currentIndex);
  const [elapsedSec, setElapsedSec] = useState<number>(initialDraft.elapsedSec);
  const [flaggedQuestionIds, setFlaggedQuestionIds] = useState<string[]>([...initialDraft.flaggedQuestionIds]);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [missingAnswers, setMissingAnswers] = useState<readonly MissingAnswerItem[]>([]);

  const currentQuestion = quiz.questions[currentIndex];
  const flaggedSet = useMemo(() => new Set(flaggedQuestionIds), [flaggedQuestionIds]);
  const answeredCount = useMemo(
    () => quiz.questions.filter((question) => typeof answers[question.id] === "string").length,
    [answers, quiz.questions],
  );
  const unansweredCount = quiz.questions.length - answeredCount;
  const progressValue = quiz.questions.length === 0 ? 0 : Math.round(((currentIndex + 1) / quiz.questions.length) * 100);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setElapsedSec((value) => value + 1);
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    writeQuizDraft(quiz.id, mode, {
      answers,
      currentIndex,
      elapsedSec,
      flaggedQuestionIds,
      mode,
      updatedAt: new Date().toISOString(),
    });
  }, [answers, currentIndex, elapsedSec, flaggedQuestionIds, mode, quiz.id]);

  useEffect(() => {
    if (missingAnswers.length > 0) {
      errorSummaryRef.current?.focus();
    }
  }, [missingAnswers]);

  function selectOption(questionId: string, optionId: string): void {
    setAnswers((currentAnswers) => ({
      ...currentAnswers,
      [questionId]: optionId,
    }));
    setSubmitError(null);
    setMissingAnswers((currentMissing) => currentMissing.filter((item) => item.questionId !== questionId));
  }

  function toggleFlag(questionId: string): void {
    setFlaggedQuestionIds((currentFlags) => (
      currentFlags.includes(questionId)
        ? currentFlags.filter((currentQuestionId) => currentQuestionId !== questionId)
        : [...currentFlags, questionId]
    ));
  }

  function moveToQuestion(index: number): void {
    setCurrentIndex(Math.min(Math.max(index, 0), quiz.questions.length - 1));
  }

  function focusQuestionPaletteButton(questionId: string): void {
    window.requestAnimationFrame(() => {
      questionRefs.current[questionId]?.focus();
    });
  }

  async function handleSubmit(): Promise<void> {
    if (isSubmitting) {
      return;
    }

    const incompleteQuestions = quiz.questions
      .filter((question) => typeof answers[question.id] !== "string")
      .map((question) => ({ questionId: question.id, ordinal: question.ordinal }));

    if (incompleteQuestions.length > 0) {
      const firstIncomplete = incompleteQuestions[0];
      setMissingAnswers(incompleteQuestions);
      setSubmitError(null);
      if (firstIncomplete) {
        moveToQuestion(quiz.questions.findIndex((question) => question.id === firstIncomplete.questionId));
        focusQuestionPaletteButton(firstIncomplete.questionId);
      }
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const response = await submitPhase0QuizAttempt(quiz.id, {
        answers: buildSubmitAnswers(quiz, answers),
      });
      clearQuizDraft(quiz.id, mode);
      router.push(routes.quizResult(quiz.id, response.attemptId));
    } catch (error) {
      const message = error instanceof Phase0ClientError
        ? error.message
        : "Chưa thể nộp bài lúc này. Phần làm dở của bạn vẫn được giữ lại để thử lại.";
      setSubmitError(message);
      notify(message, "error");
      setIsSubmitting(false);
      return;
    }

    setIsSubmitting(false);
  }

  if (!currentQuestion) {
    return null;
  }

  const currentAnswer = answers[currentQuestion.id];
  const currentQuestionTone = flaggedSet.has(currentQuestion.id)
    ? "warning"
    : currentAnswer
      ? "success"
      : "neutral";

  return (
    <section className="grid gap-6 xl:grid-cols-[minmax(0,1.3fr)_320px]">
      <Card>
        <CardHeader className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="neutral">Câu {currentQuestion.ordinal + 1}/{quiz.questions.length}</Badge>
                <Badge tone={currentQuestionTone}>{flaggedSet.has(currentQuestion.id) ? "Đã đánh dấu" : currentAnswer ? "Đã trả lời" : "Chưa trả lời"}</Badge>
                <Badge>{mode === "test" ? "Chế độ kiểm tra" : "Chế độ luyện tập"}</Badge>
              </div>
              <CardTitle className="mt-3 text-xl">{currentQuestion.stem}</CardTitle>
            </div>
            <div className="text-sm font-medium text-ink-600">Thời gian · {formatDuration(elapsedSec)}</div>
          </div>
          <ProgressBar value={progressValue} />
        </CardHeader>
        <CardBody className="space-y-5">
          {missingAnswers.length > 0 ? (
            <div
              ref={errorSummaryRef}
              tabIndex={-1}
              role="alert"
              aria-live="polite"
              className="rounded-2xl border border-error-100 bg-error-50 p-4 text-sm text-error-800 focus:outline-none focus:ring-2 focus:ring-error-500 focus:ring-offset-2"
            >
              <p className="font-semibold">Bạn cần trả lời tất cả câu hỏi trước khi nộp bài.</p>
              <ul className="mt-2 list-inside list-disc space-y-1">
                {missingAnswers.map((item) => (
                  <li key={item.questionId}>Câu {item.ordinal + 1} chưa có đáp án.</li>
                ))}
              </ul>
            </div>
          ) : null}

          {submitError ? (
            <div role="alert" aria-live="polite" className="rounded-2xl border border-error-100 bg-error-50 p-4 text-sm text-error-800">
              {submitError}
            </div>
          ) : null}

          <fieldset className="space-y-3" aria-describedby={summaryId}>
            <legend className="sr-only">Chọn một đáp án</legend>
            {currentQuestion.options.map((option) => {
              const inputId = `${currentQuestion.id}-${option.id}`;
              const isChecked = currentAnswer === option.id;

              return (
                <label
                  key={option.id}
                  htmlFor={inputId}
                  className={`flex cursor-pointer items-start gap-3 rounded-2xl border p-4 transition-colors ${
                    isChecked
                      ? "border-brand-200 bg-brand-50"
                      : "border-ink-100 bg-white hover:border-brand-200 hover:bg-brand-50/40"
                  }`}
                >
                  <input
                    id={inputId}
                    type="radio"
                    name={currentQuestion.id}
                    value={option.id}
                    checked={isChecked}
                    onChange={() => selectOption(currentQuestion.id, option.id)}
                    className="mt-1 h-4 w-4 border-ink-300 text-brand-600 focus:ring-brand-500"
                  />
                  <div>
                    <p className="text-sm font-medium text-ink-900">{option.content}</p>
                  </div>
                </label>
              );
            })}
          </fieldset>

          <div id={summaryId} className="rounded-2xl border border-ink-100 bg-ink-50/70 p-4 text-sm leading-6 text-ink-600">
            Bạn có thể xem lại câu đang làm, đáp án đã chọn và đánh dấu câu cần quay lại trước khi nộp bài.
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ink-100 pt-4">
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={() => moveToQuestion(currentIndex - 1)}
                disabled={currentIndex === 0 || isSubmitting}
              >
                Câu trước
              </Button>
              <Button
                variant={flaggedSet.has(currentQuestion.id) ? "secondary" : "outline"}
                onClick={() => toggleFlag(currentQuestion.id)}
                disabled={isSubmitting}
              >
                <Flag className="h-4 w-4" aria-hidden />
                {flaggedSet.has(currentQuestion.id) ? "Đã đánh dấu" : "Đánh dấu xem lại"}
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={() => moveToQuestion(currentIndex + 1)}
                disabled={currentIndex >= quiz.questions.length - 1 || isSubmitting}
              >
                Câu tiếp theo
              </Button>
              <Button onClick={() => void handleSubmit()} disabled={isSubmitting}>
                {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                Nộp bài
              </Button>
            </div>
          </div>
        </CardBody>
      </Card>

      <Card>
          <CardHeader>
            <CardTitle>Danh sách câu hỏi</CardTitle>
          </CardHeader>

        <CardBody className="space-y-4">
          <div className="grid grid-cols-5 gap-2">
            {quiz.questions.map((question, index) => (
              <button
                key={question.id}
                ref={(node) => {
                  questionRefs.current[question.id] = node;
                }}
                type="button"
                onClick={() => moveToQuestion(index)}
                className={`flex h-11 items-center justify-center rounded-xl border text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 ${getQuestionTone(question.id, currentQuestion.id, flaggedSet, answers)}`}
                aria-current={question.id === currentQuestion.id ? "step" : undefined}
                aria-label={`Đi tới câu ${question.ordinal + 1}`}
                disabled={isSubmitting}
              >
                {question.ordinal + 1}
              </button>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
              <div className="rounded-2xl border border-success-100 bg-success-50 px-4 py-3 text-sm text-success-800">
                Đã trả lời: {answeredCount}
              </div>
              <div className="rounded-2xl border border-warning-100 bg-warning-50 px-4 py-3 text-sm text-warning-800">
                Đã đánh dấu: {flaggedQuestionIds.length}
              </div>
              <div className="rounded-2xl border border-ink-100 bg-ink-50 px-4 py-3 text-sm text-ink-700">
                Chưa trả lời: {unansweredCount}
              </div>

          </div>
          <div className="rounded-2xl border border-brand-100 bg-brand-50/60 p-4 text-sm leading-6 text-brand-700">
            Phần làm dở của bạn được giữ lại trên thiết bị này để có thể tiếp tục khi quay lại.
          </div>
        </CardBody>
      </Card>
    </section>
  );
}
