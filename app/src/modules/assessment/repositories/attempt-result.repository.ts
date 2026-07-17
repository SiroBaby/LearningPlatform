import { Injectable } from '@nestjs/common';
import { DataSource, In } from 'typeorm';

import { BaseRepository } from '../../../database/base.repository';
import type { AttemptResultReader } from '../contracts/attempt-result-reader.port';
import type { PersistedAttemptResult } from '../contracts/quiz-attempt-store.port';
import { AttemptAnswerEntity } from '../entities/attempt-answer.entity';
import { AttemptEntity } from '../entities/attempt.entity';
import { QuestionEntity } from '../entities/question.entity';
import { QuestionOptionEntity } from '../entities/question-option.entity';

@Injectable()
export class AttemptResultRepository
  extends BaseRepository<AttemptEntity>
  implements AttemptResultReader
{
  constructor(private readonly dataSource: DataSource) {
    super(AttemptEntity, dataSource);
  }

  async findByOwnerQuizAndAttemptId(
    ownerId: string,
    quizId: string,
    attemptId: string,
  ): Promise<PersistedAttemptResult | null> {
    const attempt = await this.findOne({ where: { id: attemptId, ownerId, quizId } });
    if (!attempt) {
      return null;
    }
    const answers = await this.dataSource.getRepository(AttemptAnswerEntity).find({
      where: { attemptId, ownerId },
    });
    const questions = answers.length === 0 ? [] : await this.dataSource.getRepository(QuestionEntity).find({
      order: { ordinal: 'ASC', id: 'ASC' },
      where: { id: In(answers.map((answer) => answer.questionId)), ownerId, quizId },
    });
    if (questions.length !== answers.length) {
      return null;
    }
    const options = questions.length === 0 ? [] : await this.dataSource.getRepository(QuestionOptionEntity).find({
      where: { ownerId, questionId: In(questions.map((question) => question.id)) },
    });
    const results = [];
    for (const question of questions) {
      const answer = answers.find((entry) => entry.questionId === question.id);
      const selectedOption = options.find(
        (option) => option.id === answer?.selectedOptionId && option.questionId === question.id,
      );
      const correctOption = options.find(
        (option) => option.questionId === question.id && option.isCorrect,
      );
      if (!answer || !selectedOption || !correctOption) {
        return null;
      }
      results.push({
        citation: question.citation,
        correctOptionContent: correctOption.content,
        correctOptionId: correctOption.id,
        explanation: question.explanation,
        isCorrect: answer.isCorrect,
        ordinal: question.ordinal,
        questionId: question.id,
        selectedOptionContent: selectedOption.content,
        selectedOptionId: selectedOption.id,
        stem: question.stem,
      });
    }
    return {
      id: attempt.id,
      questionCount: attempt.questionCount,
      quizId: attempt.quizId,
      results,
      score: attempt.score,
      submittedAt: attempt.createdAt,
    };
  }
}
