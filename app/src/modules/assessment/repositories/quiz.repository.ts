import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager, In } from 'typeorm';

import type {
  GradingQuiz,
  PersistedAttempt,
  QuizAttemptStore,
  ServedQuiz,
} from '../contracts/quiz-attempt-store.port';
import type { QuizPersistence } from '../contracts/quiz-persistence.port';
import type { QuizDiscovery, QuizDiscoverySummary } from '../contracts/quiz-discovery.port';
import type { PersistedQuiz } from '../contracts/quiz-generation-handoff.contract';
import { BaseRepository } from '../../../database/base.repository';
import { AssessmentError, AssessmentErrorCode } from '../domain/assessment.error';
import type { Quiz } from '../domain/quiz';
import { AttemptAnswerEntity } from '../entities/attempt-answer.entity';
import { AttemptEntity } from '../entities/attempt.entity';
import { QuestionEntity } from '../entities/question.entity';
import { QuestionOptionEntity } from '../entities/question-option.entity';
import { QuizEntity } from '../entities/quiz.entity';

@Injectable()
export class QuizRepository
  extends BaseRepository<QuizEntity>
  implements QuizAttemptStore, QuizDiscovery, QuizPersistence
{
  constructor(private readonly dataSource: DataSource) {
    super(QuizEntity, dataSource);
  }

  async persist(quiz: Quiz): Promise<PersistedQuiz> {
    return this.dataSource.transaction(async (manager) => {
      const inserted = await manager
        .createQueryBuilder()
        .insert()
        .into(QuizEntity)
        .values({
          documentId: quiz.documentId,
          id: quiz.id,
          idempotencyKey: quiz.idempotencyKey,
          ownerId: quiz.ownerId,
          promptVersion: quiz.promptVersion,
        })
        .orIgnore()
        .returning(['id'])
        .execute();

      if (!Array.isArray(inserted.raw) || inserted.raw.length === 0) {
        return this.existingResult(manager, quiz.idempotencyKey, quiz.ownerId);
      }

      await manager.save(QuestionEntity, quiz.questions.map((question) => manager.create(QuestionEntity, {
        chunkId: question.chunkId,
        chunkIndex: question.chunkIndex,
        citation: question.citation,
        explanation: question.explanation,
        id: question.id,
        idempotencyKey: question.idempotencyKey,
        ordinal: question.ordinal,
        ownerId: quiz.ownerId,
        quizId: quiz.id,
        stem: question.stem,
      })));
      await manager.save(
        QuestionOptionEntity,
        quiz.questions.flatMap((question) => question.options.map((option) => manager.create(QuestionOptionEntity, {
          content: option.content,
          id: option.id,
          isCorrect: option.isCorrect,
          optionIndex: option.optionIndex,
          ownerId: quiz.ownerId,
          questionId: question.id,
        }))),
      );

      return {
        optionCount: quiz.questions.reduce((count, question) => count + question.options.length, 0),
        questionCount: quiz.questions.length,
        questionIds: quiz.questions.map((question) => question.id),
        quizId: quiz.id,
      };
    });
  }

  async findServedByOwnerId(ownerId: string, quizId: string): Promise<ServedQuiz | null> {
    const quiz = await this.findOne({
      select: { id: true },
      where: { id: quizId, ownerId },
    });
    if (!quiz) {
      return null;
    }

    const questions = await this.dataSource.getRepository(QuestionEntity).find({
      order: { ordinal: 'ASC', id: 'ASC' },
      select: { id: true, ordinal: true, stem: true },
      where: { ownerId, quizId },
    });
    const options = questions.length === 0
      ? []
      : await this.dataSource.getRepository(QuestionOptionEntity).find({
        order: { optionIndex: 'ASC' },
        select: {
          content: true,
          id: true,
          optionIndex: true,
          questionId: true,
        },
        where: {
          ownerId,
          questionId: In(questions.map((question) => question.id)),
        },
      });

    return {
      id: quiz.id,
      questions: questions.map((question) => ({
        id: question.id,
        ordinal: question.ordinal,
        options: options
          .filter((option) => option.questionId === question.id)
          .map((option) => ({
            content: option.content,
            id: option.id,
            optionIndex: option.optionIndex,
          })),
        stem: question.stem,
      })),
    };
  }

  async findForGradingByOwnerId(
    ownerId: string,
    quizId: string,
  ): Promise<GradingQuiz | null> {
    const quiz = await this.findOne({
      select: { id: true },
      where: { id: quizId, ownerId },
    });
    if (!quiz) {
      return null;
    }

    const questions = await this.dataSource.getRepository(QuestionEntity).find({
      order: { ordinal: 'ASC', id: 'ASC' },
      where: { ownerId, quizId },
    });
    const options = questions.length === 0
      ? []
      : await this.dataSource.getRepository(QuestionOptionEntity).find({
        order: { optionIndex: 'ASC' },
        where: {
          ownerId,
          questionId: In(questions.map((question) => question.id)),
        },
      });

    return {
      id: quiz.id,
      questions: questions.map((question) => ({
        citation: question.citation,
        explanation: question.explanation,
        id: question.id,
        ordinal: question.ordinal,
        options: options
          .filter((option) => option.questionId === question.id)
          .map((option) => ({
            content: option.content,
            id: option.id,
            isCorrect: option.isCorrect,
            optionIndex: option.optionIndex,
          })),
        stem: question.stem,
      })),
    };
  }

  async findByOwnerAndDocumentId(
    ownerId: string,
    documentId: string,
  ): Promise<QuizDiscoverySummary | null> {
    const quiz = await this.findOne({
      select: { documentId: true, id: true },
      where: { documentId, ownerId },
    });
    if (!quiz) {
      return null;
    }
    const questionCount = await this.dataSource.getRepository(QuestionEntity).count({
      where: { ownerId, quizId: quiz.id },
    });
    return { documentId: quiz.documentId, questionCount, quizId: quiz.id };
  }

  async persistAttempt(attempt: PersistedAttempt): Promise<boolean> {
    return this.dataSource.transaction(async (manager) => {
      const quiz = await manager.findOneBy(QuizEntity, {
        id: attempt.quizId,
        ownerId: attempt.ownerId,
      });
      if (!quiz) {
        return false;
      }

      await manager.save(AttemptEntity, manager.create(AttemptEntity, {
        id: attempt.id,
        ownerId: attempt.ownerId,
        questionCount: attempt.questionCount,
        quizId: attempt.quizId,
        score: attempt.score,
      }));
      await manager.save(
        AttemptAnswerEntity,
        attempt.results.map((result) => manager.create(AttemptAnswerEntity, {
          attemptId: attempt.id,
          isCorrect: result.isCorrect,
          ownerId: attempt.ownerId,
          questionId: result.questionId,
          selectedOptionId: result.selectedOptionId,
        })),
      );
      return true;
    });
  }

  private async existingResult(
    manager: EntityManager,
    idempotencyKey: string,
    ownerId: string,
  ): Promise<PersistedQuiz> {
    const quiz = await manager.findOneBy(QuizEntity, { idempotencyKey, ownerId });
    if (!quiz) {
      throw new AssessmentError(AssessmentErrorCode.IDEMPOTENCY_OWNER_CONFLICT);
    }
    const questions = await manager.find(QuestionEntity, {
      where: { ownerId, quizId: quiz.id },
      order: { ordinal: 'ASC', id: 'ASC' },
    });
    const optionCount = questions.length === 0
      ? 0
      : await manager.count(QuestionOptionEntity, {
        where: { ownerId, questionId: In(questions.map((question) => question.id)) },
      });

    return {
      optionCount,
      questionCount: questions.length,
      questionIds: questions.map((question) => question.id),
      quizId: quiz.id,
    };
  }
}
