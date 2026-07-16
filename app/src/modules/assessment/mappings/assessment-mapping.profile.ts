import { Inject, Injectable } from '@nestjs/common';
import { createMap, forMember, mapFrom, type Mapper } from '@automapper/core';

import { MAPPER } from '../../../common/mapping/mapper.provider';
import {
  GradedAttemptResult,
  GradedQuestionResult,
  ServedOptionResult,
  ServedQuestionResult,
  ServedQuizResult,
} from '../contracts/quiz-attempt.result';
import {
  GradedAttemptResponseDto,
  GradedQuestionResponseDto,
} from '../dto/graded-attempt.response.dto';
import {
  QuizOptionResponseDto,
  QuizQuestionResponseDto,
  QuizResponseDto,
} from '../dto/quiz.response.dto';

@Injectable()
export class AssessmentMappingProfile {
  constructor(@Inject(MAPPER) mapper: Mapper) {
    createMap(mapper, ServedOptionResult, QuizOptionResponseDto);
    createMap(mapper, ServedQuestionResult, QuizQuestionResponseDto);
    createMap(mapper, ServedQuizResult, QuizResponseDto);
    createMap(
      mapper,
      GradedQuestionResult,
      GradedQuestionResponseDto,
      forMember(
        (destination) => destination.citation,
        mapFrom((source) => source.citation),
      ),
    );
    createMap(
      mapper,
      GradedAttemptResult,
      GradedAttemptResponseDto,
      forMember(
        (destination) => destination.attemptId,
        mapFrom((source) => source.id),
      ),
    );
  }
}
