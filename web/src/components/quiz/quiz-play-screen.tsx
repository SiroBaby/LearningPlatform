"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";
import { clearQuizDraft } from "@/components/quiz/quiz-session";
import { Phase0ClientError, submitPhase0QuizAttempt } from "@/lib/phase0/client";
import type { Phase0QuizResponse } from "@/lib/phase0/contracts";
import { routes } from "@/lib/routes";
import type { QuizMode } from "@/lib/types";
import { QuizLeaveDialog, QuizPaletteCard, QuizQuestionCard } from "./quiz-play-panels";
import {
  buildSubmitAnswers,
  formatDuration,
  getDisplayPosition,
  type MissingAnswerSummary,
} from "./quiz-play-utils";
import { usePracticeFeedback } from "./use-practice-feedback";
import { useQuizLeaveNavigation } from "./use-quiz-leave-navigation";
import { useQuizSession } from "./use-quiz-session";

interface QuizPlayScreenProps {
  readonly quiz: Phase0QuizResponse;
  readonly mode: QuizMode;
  readonly resume: boolean;
}

export function QuizPlayScreen({ quiz, mode, resume }: QuizPlayScreenProps) {
  const router = useRouter();
  const { notify } = useToast();
  const summaryId = useId();
  const errorSummaryRef = useRef<HTMLDivElement | null>(null);
  const questionRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isLeaving, setIsLeaving] = useState<boolean>(false);
  const [isLeaveDialogOpen, setIsLeaveDialogOpen] = useState<boolean>(false);
  const [missingAnswerSummary, setMissingAnswerSummary] = useState<MissingAnswerSummary | null>(null);
  const { draftState, draftStateRef, isDraftReady, updateDraftState, persistDraftSnapshot } = useQuizSession({
    quiz,
    mode,
    resume,
  });
  const { feedbackByQuestionId, loadPracticeFeedback, resetQuestionFeedback } = usePracticeFeedback({
    answers: draftState.answers,
  });

  const { answers, currentIndex, elapsedSec, flaggedQuestionIds } = draftState;

  const currentQuestion = quiz.questions[currentIndex];
  const flaggedSet = useMemo(() => new Set(flaggedQuestionIds), [flaggedQuestionIds]);
  const answeredCount = useMemo(
    () => quiz.questions.filter((question) => typeof answers[question.id] === "string").length,
    [answers, quiz.questions],
  );
  const unansweredCount = quiz.questions.length - answeredCount;
  const progressValue = quiz.questions.length === 0 ? 0 : Math.round(((currentIndex + 1) / quiz.questions.length) * 100);
  const canCheckCurrentAnswer = mode === "practice" && typeof answers[currentQuestion?.id ?? ""] === "string";
  const isCheckingCurrentAnswer = feedbackByQuestionId[currentQuestion?.id ?? ""]?.status === "loading";


  useEffect(() => {
    if (missingAnswerSummary) {
      errorSummaryRef.current?.focus();
    }
  }, [missingAnswerSummary]);

  const confirmLeaveNavigation = useQuizLeaveNavigation({
    isDraftReady,
    quizId: quiz.id,
    mode,
    getDraftSnapshot: () => draftStateRef.current,
    onBeforeConfirmedLeave: () => {
      setIsLeaveDialogOpen(false);
    },
  });

  async function leaveQuiz(): Promise<void> {
    if (isSubmitting || isLeaving) {
      return;
    }

    setIsLeaving(true);
    confirmLeaveNavigation();
    window.location.assign(routes.quizStart(quiz.id));
  }

  function selectOption(questionId: string, optionId: string): void {
    updateDraftState((currentDraft) => ({
      ...currentDraft,
      answers: {
        ...currentDraft.answers,
        [questionId]: optionId,
      },
    }));
    setSubmitError(null);
    setMissingAnswerSummary(null);

    if (mode === "practice") {
      resetQuestionFeedback(questionId, optionId);
    }
  }

  function toggleFlag(questionId: string): void {
    updateDraftState((currentDraft) => ({
      ...currentDraft,
      flaggedQuestionIds: currentDraft.flaggedQuestionIds.includes(questionId)
        ? currentDraft.flaggedQuestionIds.filter((currentQuestionId) => currentQuestionId !== questionId)
        : [...currentDraft.flaggedQuestionIds, questionId],
    }));
  }

  function moveToQuestion(index: number): void {
    updateDraftState((currentDraft) => ({
      ...currentDraft,
      currentIndex: Math.min(Math.max(index, 0), quiz.questions.length - 1),
    }));
  }

  function focusQuestionPaletteButton(questionId: string): void {
    window.requestAnimationFrame(() => {
      questionRefs.current[questionId]?.focus();
    });
  }

  async function handleCheckAnswer(): Promise<void> {
    if (!currentQuestion || !currentAnswer || isSubmitting || isLeaving) {
      return;
    }

    await loadPracticeFeedback({
      quizId: quiz.id,
      questionId: currentQuestion.id,
      optionId: currentAnswer,
    });
  }

  async function handleSubmit(): Promise<void> {
    if (isSubmitting) {
      return;
    }

    const firstIncompleteIndex = quiz.questions.findIndex((question) => typeof answers[question.id] !== "string");

    if (firstIncompleteIndex >= 0) {
      const firstIncomplete = quiz.questions[firstIncompleteIndex];
      if (firstIncomplete) {
        setMissingAnswerSummary({
          count: unansweredCount,
          firstQuestionId: firstIncomplete.id,
          firstDisplayPosition: getDisplayPosition(firstIncompleteIndex),
        });
        setSubmitError(null);
        moveToQuestion(firstIncompleteIndex);
        focusQuestionPaletteButton(firstIncomplete.id);
      }
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);
    persistDraftSnapshot(draftStateRef.current);

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
  const currentFeedback = feedbackByQuestionId[currentQuestion.id];
  const visiblePracticeFeedback = currentAnswer && currentFeedback?.selectedOptionId === currentAnswer
    ? currentFeedback
    : null;

  return (
    <section className="grid gap-6 xl:grid-cols-[minmax(0,1.3fr)_320px]">
      <QuizQuestionCard
        quiz={quiz}
        mode={mode}
        currentIndex={currentIndex}
        elapsedSecLabel={formatDuration(elapsedSec)}
        progressValue={progressValue}
        currentQuestionId={currentQuestion.id}
        currentQuestionStem={currentQuestion.stem}
        currentQuestionOptions={currentQuestion.options}
        currentQuestionTone={currentQuestionTone}
        currentAnswer={currentAnswer}
        missingAnswerSummary={missingAnswerSummary}
        submitError={submitError}
        summaryId={summaryId}
        errorSummaryRef={errorSummaryRef}
        visiblePracticeFeedback={visiblePracticeFeedback}
        flaggedSet={flaggedSet}
        isSubmitting={isSubmitting}
        isLeaving={isLeaving}
        canCheckCurrentAnswer={canCheckCurrentAnswer}
        isCheckingCurrentAnswer={isCheckingCurrentAnswer}
        onSelectOption={selectOption}
        onLeave={() => setIsLeaveDialogOpen(true)}
        onPrevious={() => moveToQuestion(currentIndex - 1)}
        onToggleFlag={() => toggleFlag(currentQuestion.id)}
        onCheckAnswer={() => {
          void handleCheckAnswer();
        }}
        onNext={() => moveToQuestion(currentIndex + 1)}
        onSubmit={() => {
          void handleSubmit();
        }}
      />

      <QuizPaletteCard
        questionIds={quiz.questions.map((question) => question.id)}
        currentQuestionId={currentQuestion.id}
        flaggedSet={flaggedSet}
        answers={answers}
        isSubmitting={isSubmitting}
        setQuestionRef={(questionId, node) => {
          questionRefs.current[questionId] = node;
        }}
        onSelectQuestion={moveToQuestion}
        answeredCount={answeredCount}
        flaggedCount={flaggedQuestionIds.length}
        unansweredCount={unansweredCount}
      />

      <QuizLeaveDialog
        isOpen={isLeaveDialogOpen}
        isLeaving={isLeaving}
        onClose={() => {
          if (isLeaving) {
            return;
          }
          setIsLeaveDialogOpen(false);
        }}
        onConfirmLeave={() => {
          void leaveQuiz();
        }}
      />
    </section>
  );
}
