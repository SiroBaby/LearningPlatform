import { Inject, Injectable } from '@nestjs/common';
import { createMap, forMember, mapFrom, type Mapper } from '@automapper/core';

import { MAPPER } from '../../../common/mapping/mapper.provider';
import { DateTimeUtil } from '../../../common/datetime.util';
import {
  GradedAttemptResult,
  AttemptHistoryResult,
  GradedQuestionResult,
  PersistedAttemptQuestionResult,
  PersistedAttemptResult,
  PracticeFeedbackResult,
  QuizSummaryResult,
  ServedOptionResult,
  ServedQuestionResult,
  ServedQuizResult,
} from '../contracts/quiz-attempt.result';
import {
  GradedAttemptResponseDto,
  GradedQuestionResponseDto,
} from '../dto/graded-attempt.response.dto';
import {
  AttemptResultQuestionResponseDto,
  AttemptHistoryResponseDto,
  AttemptResultResponseDto,
} from '../dto/attempt-result.response.dto';
import {
  QuizOptionResponseDto,
  QuizQuestionResponseDto,
  QuizResponseDto,
} from '../dto/quiz.response.dto';
import { PracticeFeedbackResponseDto } from '../dto/practice-feedback.response.dto';
import { QuizSummaryResponseDto } from '../dto/quiz-summary.response.dto';

@Injectable()
export class AssessmentMappingProfile {
  constructor(@Inject(MAPPER) mapper: Mapper) {
    createMap(mapper, ServedOptionResult, QuizOptionResponseDto);
    createMap(mapper, ServedQuestionResult, QuizQuestionResponseDto);
    createMap(mapper, ServedQuizResult, QuizResponseDto);
    createMap(
      mapper,
      QuizSummaryResult,
      QuizSummaryResponseDto,
      forMember(
        (destination) => destination.id,
        mapFrom((source) => source.quizId),
      ),
    );
    createMap(
      mapper,
      AttemptHistoryResult,
      AttemptHistoryResponseDto,
      forMember(
        (destination) => destination.attemptId,
        mapFrom((source) => source.id),
      ),
      forMember(
        (destination) => destination.submittedAt,
        mapFrom((source) => DateTimeUtil.toUtcIsoString(source.submittedAt)),
      ),
    );
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
      PracticeFeedbackResult,
      PracticeFeedbackResponseDto,
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
    createMap(
      mapper,
      PersistedAttemptQuestionResult,
      AttemptResultQuestionResponseDto,
      forMember(
        (destination) => destination.citation,
        mapFrom((source) => source.citation),
      ),
    );
    createMap(
      mapper,
      PersistedAttemptResult,
      AttemptResultResponseDto,
      forMember(
        (destination) => destination.attemptId,
        mapFrom((source) => source.id),
      ),
      forMember(
        (destination) => destination.submittedAt,
        mapFrom((source) => DateTimeUtil.toUtcIsoString(source.submittedAt)),
      ),
    );
  }
}
