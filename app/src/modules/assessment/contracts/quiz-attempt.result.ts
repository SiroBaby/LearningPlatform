import { AutoMap } from '@automapper/classes';

import type { CitationCandidate } from './quiz-generation-handoff.contract';

export class ServedOptionResult {
  @AutoMap()
  content!: string;

  @AutoMap()
  id!: string;

  @AutoMap()
  optionIndex!: number;
}

export class ServedQuestionResult {
  @AutoMap()
  id!: string;

  @AutoMap()
  ordinal!: number;

  @AutoMap(() => [ServedOptionResult])
  options!: ServedOptionResult[];

  @AutoMap()
  stem!: string;
}

export class ServedQuizResult {
  @AutoMap()
  id!: string;

  @AutoMap(() => [ServedQuestionResult])
  questions!: ServedQuestionResult[];
}

export class GradedQuestionResult {
  citation!: CitationCandidate;

  @AutoMap()
  explanation!: string;

  @AutoMap()
  isCorrect!: boolean;

  @AutoMap()
  questionId!: string;

  @AutoMap()
  selectedOptionId!: string;
}

export class GradedAttemptResult {
  @AutoMap()
  id!: string;

  @AutoMap()
  questionCount!: number;

  @AutoMap(() => [GradedQuestionResult])
  results!: GradedQuestionResult[];

  @AutoMap()
  score!: number;
}

export class PersistedAttemptQuestionResult {
  citation!: CitationCandidate;

  @AutoMap()
  correctOptionContent!: string;

  @AutoMap()
  correctOptionId!: string;

  @AutoMap()
  explanation!: string;

  @AutoMap()
  isCorrect!: boolean;

  @AutoMap()
  ordinal!: number;

  @AutoMap()
  questionId!: string;

  @AutoMap()
  selectedOptionContent!: string;

  @AutoMap()
  selectedOptionId!: string;

  @AutoMap()
  stem!: string;
}

export class PersistedAttemptResult {
  @AutoMap()
  id!: string;

  @AutoMap()
  questionCount!: number;

  @AutoMap()
  quizId!: string;

  @AutoMap(() => [PersistedAttemptQuestionResult])
  results!: PersistedAttemptQuestionResult[];

  @AutoMap()
  score!: number;

  submittedAt!: Date;
}
