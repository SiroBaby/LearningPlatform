import { useEffect, useRef, useState } from "react";
import { requestPhase0PracticeFeedback } from "@/lib/phase0/client";
import type { Phase0PracticeFeedbackResponse } from "@/lib/phase0/contracts";
import type { QuestionPracticeFeedbackState } from "./quiz-play-utils";

interface LoadPracticeFeedbackParams {
  readonly quizId: string;
  readonly questionId: string;
  readonly optionId: string;
}

interface UsePracticeFeedbackParams {
  readonly answers: Readonly<Record<string, string | null>>;
}

interface UsePracticeFeedbackResult {
  readonly feedbackByQuestionId: Readonly<Record<string, QuestionPracticeFeedbackState>>;
  readonly loadPracticeFeedback: (params: LoadPracticeFeedbackParams) => Promise<void>;
  readonly resetQuestionFeedback: (questionId: string, optionId: string) => void;
}

export function usePracticeFeedback({ answers }: UsePracticeFeedbackParams): UsePracticeFeedbackResult {
  const [feedbackByQuestionId, setFeedbackByQuestionId] = useState<Readonly<Record<string, QuestionPracticeFeedbackState>>>({});
  const answersRef = useRef(answers);
  const practiceRequestIdsRef = useRef<Record<string, number>>({});

  useEffect(() => {
    answersRef.current = answers;
  }, [answers]);

  const resetQuestionFeedback = (questionId: string, optionId: string): void => {
    practiceRequestIdsRef.current[questionId] = (practiceRequestIdsRef.current[questionId] ?? 0) + 1;
    setFeedbackByQuestionId((currentFeedback) => ({
      ...currentFeedback,
      [questionId]: {
        selectedOptionId: optionId,
        status: "idle",
        response: null,
      },
    }));
  };

  const loadPracticeFeedback = async ({ quizId: nextQuizId, questionId, optionId }: LoadPracticeFeedbackParams): Promise<void> => {
    const requestId = (practiceRequestIdsRef.current[questionId] ?? 0) + 1;
    practiceRequestIdsRef.current[questionId] = requestId;
    setFeedbackByQuestionId((currentFeedback) => ({
      ...currentFeedback,
      [questionId]: {
        selectedOptionId: optionId,
        status: "loading",
        response: null,
      },
    }));

    const applyResponse = (status: QuestionPracticeFeedbackState["status"], response: Phase0PracticeFeedbackResponse | null) => {
      setFeedbackByQuestionId((currentFeedback) => {
        const latestFeedback = currentFeedback[questionId];
        const selectedAnswer = answersRef.current[questionId];
        if (
          requestId !== practiceRequestIdsRef.current[questionId]
          || selectedAnswer !== optionId
          || latestFeedback?.selectedOptionId !== optionId
        ) {
          return currentFeedback;
        }
        return {
          ...currentFeedback,
          [questionId]: {
            selectedOptionId: optionId,
            status,
            response,
          },
        };
      });
    };

    try {
      const response = await requestPhase0PracticeFeedback(nextQuizId, {
        questionId,
        optionId,
      });
      applyResponse("ready", response);
    } catch {
      applyResponse("error", null);
    }
  };

  return {
    feedbackByQuestionId,
    loadPracticeFeedback,
    resetQuestionFeedback,
  };
}
