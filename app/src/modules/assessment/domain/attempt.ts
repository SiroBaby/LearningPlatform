import type {
  AttemptSelection,
  GradedAnswer,
  GradingQuiz,
  PersistedAttempt,
} from '../contracts/quiz-attempt-store.port';

export type GradeAttemptResult =
  | { readonly kind: 'graded'; readonly attempt: PersistedAttempt }
  | { readonly kind: 'invalid' };

export interface GradeAttemptCommand {
  readonly attemptId: string;
  readonly ownerId: string;
  readonly quiz: GradingQuiz;
  readonly selections: readonly AttemptSelection[];
}

export type GradePracticeFeedbackResult =
  | { readonly feedback: GradedAnswer; readonly kind: 'graded' }
  | { readonly kind: 'invalid' };

export interface GradePracticeFeedbackCommand {
  readonly quiz: GradingQuiz;
  readonly selection: AttemptSelection;
}

export function gradePracticeFeedback(
  command: GradePracticeFeedbackCommand,
): GradePracticeFeedbackResult {
  const question = command.quiz.questions.find(
    (candidate) => candidate.id === command.selection.questionId,
  );
  const option = question?.options.find(
    (candidate) => candidate.id === command.selection.optionId,
  );
  if (!question || !option) {
    return { kind: 'invalid' };
  }
  return {
    feedback: {
      citation: question.citation,
      explanation: question.explanation,
      isCorrect: option.isCorrect,
      questionId: question.id,
      selectedOptionId: option.id,
    },
    kind: 'graded',
  };
}

export function gradeAttempt(command: GradeAttemptCommand): GradeAttemptResult {
  if (command.selections.length !== command.quiz.questions.length) {
    return { kind: 'invalid' };
  }

  const selectionsByQuestion = new Map<string, AttemptSelection>();
  for (const selection of command.selections) {
    if (selectionsByQuestion.has(selection.questionId)) {
      return { kind: 'invalid' };
    }
    selectionsByQuestion.set(selection.questionId, selection);
  }

  const answers = [];
  for (const question of command.quiz.questions) {
    const selection = selectionsByQuestion.get(question.id);
    const option = question.options.find((candidate) => candidate.id === selection?.optionId);
    if (!selection || !option) {
      return { kind: 'invalid' };
    }
    answers.push({
      citation: question.citation,
      explanation: question.explanation,
      isCorrect: option.isCorrect,
      questionId: question.id,
      selectedOptionId: option.id,
    });
  }

  return {
    kind: 'graded',
    attempt: {
      id: command.attemptId,
      ownerId: command.ownerId,
      questionCount: command.quiz.questions.length,
      quizId: command.quiz.id,
      results: answers,
      score: answers.filter((answer) => answer.isCorrect).length,
    },
  };
}
