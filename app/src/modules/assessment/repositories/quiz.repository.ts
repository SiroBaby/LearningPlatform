import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager, In } from 'typeorm';

import type { QuizPersistence } from '../contracts/quiz-persistence.port';
import type { PersistedQuiz } from '../contracts/quiz-generation-handoff.contract';
import { BaseRepository } from '../../../database/base.repository';
import { AssessmentError, AssessmentErrorCode } from '../domain/assessment.error';
import type { Quiz } from '../domain/quiz';
import { QuestionEntity } from '../entities/question.entity';
import { QuestionOptionEntity } from '../entities/question-option.entity';
import { QuizEntity } from '../entities/quiz.entity';

@Injectable()
export class QuizRepository extends BaseRepository<QuizEntity> implements QuizPersistence {
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
      order: { ordinal: 'ASC' },
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
