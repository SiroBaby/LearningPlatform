import type { QuizGenerationHandoff } from '../contracts/quiz-generation-handoff.contract';
import { AssessmentError, AssessmentErrorCode } from './assessment.error';
import { sha256, uuidFromSha256 } from './deterministic-id';
import { Question } from './question';

export class Quiz {
  private constructor(
    readonly documentId: string,
    readonly id: string,
    readonly idempotencyKey: string,
    readonly ownerId: string,
    readonly promptVersion: string,
    readonly questions: readonly Question[],
  ) {}

  static create(handoff: QuizGenerationHandoff): Quiz {
    const idempotencyKey = sha256(`${handoff.documentId}:${handoff.promptVersion}`);
    const quizId = uuidFromSha256(idempotencyKey);
    const stems = new Set<string>();
    const questionKeys = new Set<string>();
    const questions: Question[] = [];

    for (const candidate of [...handoff.questions].sort(compareCandidates)) {
      const question = Question.create(candidate, quizId);
      if (
        question &&
        !stems.has(question.normalizedStem) &&
        !questionKeys.has(question.idempotencyKey)
      ) {
        stems.add(question.normalizedStem);
        questionKeys.add(question.idempotencyKey);
        questions.push(question);
      }
    }

    if (
      !Number.isSafeInteger(handoff.minimumQuestionCount) ||
      handoff.minimumQuestionCount < 1 ||
      questions.length < handoff.minimumQuestionCount
    ) {
      throw new AssessmentError(
        AssessmentErrorCode.INSUFFICIENT_VALID_QUESTIONS,
        questions.length,
        handoff.questions.length,
      );
    }

    return new Quiz(
      handoff.documentId,
      quizId,
      idempotencyKey,
      handoff.ownerId,
      handoff.promptVersion,
      questions,
    );
  }
}

function compareCandidates(
  left: QuizGenerationHandoff['questions'][number],
  right: QuizGenerationHandoff['questions'][number],
): number {
  return (
    left.chunkIndex - right.chunkIndex ||
    left.ordinal - right.ordinal ||
    left.chunkId.localeCompare(right.chunkId) ||
    left.stem.localeCompare(right.stem)
  );
}
