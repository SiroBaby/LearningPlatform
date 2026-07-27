import { randomUUID } from 'crypto';

import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { Mapper } from '@automapper/core';

import { PracticeFeedbackResult } from './contracts/quiz-attempt.result';
import { AssessmentService } from './assessment.service';
import { AssessmentController } from './assessment.controller';

describe('AssessmentController', () => {
  const ownerId = randomUUID();
  const quizId = randomUUID();
  const questionId = randomUUID();
  const optionId = randomUUID();
  let assessment: Pick<AssessmentService, 'getPracticeFeedback'>;
  let controller: AssessmentController;
  let mapper: Pick<Mapper, 'map'>;

  beforeEach(() => {
    assessment = {
      getPracticeFeedback: jest.fn(async () => Object.assign(new PracticeFeedbackResult(), {
        citation: {
          chunkId: randomUUID(),
          locator: { kind: 'page', page: 1 },
          snippet: 'Source',
        },
        explanation: 'Explanation',
        isCorrect: true,
        questionId,
        selectedOptionId: optionId,
      })),
    };
    mapper = {
      map: jest.fn((source) => source),
    };
    controller = new AssessmentController(
      assessment as AssessmentService,
      mapper as Mapper,
    );
  });

  it('forwards one selection to the service and maps only practice feedback', async () => {
    const actual = await controller.getPracticeFeedback(ownerId, quizId, { optionId, questionId });

    expect(assessment.getPracticeFeedback).toHaveBeenCalledWith(ownerId, quizId, {
      optionId,
      questionId,
    });
    expect(mapper.map).toHaveBeenCalledTimes(1);
    expect(actual).toEqual(expect.objectContaining({ questionId, selectedOptionId: optionId }));
  });
});
