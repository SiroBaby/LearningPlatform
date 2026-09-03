import { Mapper } from '@automapper/core';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { CurrentUser } from '../../common/current-user.decorator';
import { MAPPER } from '../../common/mapping/mapper.provider';
import {
  GradedAttemptResult,
  AttemptHistoryResult,
  PersistedAttemptResult,
  PracticeFeedbackResult,
  QuizSummaryResult,
  ServedQuizResult,
} from './contracts/quiz-attempt.result';
import { GradedAttemptResponseDto } from './dto/graded-attempt.response.dto';
import {
  AttemptHistoryResponseDto,
  AttemptResultResponseDto,
} from './dto/attempt-result.response.dto';
import { QuizSummaryResponseDto } from './dto/quiz-summary.response.dto';
import { QuizResponseDto } from './dto/quiz.response.dto';
import { PracticeFeedbackRequestDto } from './dto/practice-feedback.request.dto';
import { PracticeFeedbackResponseDto } from './dto/practice-feedback.response.dto';
import { SubmitQuizAttemptDto } from './dto/submit-quiz-attempt.dto';
import { AssessmentService } from './assessment.service';
import { SessionAuthGuard } from '../auth/session-auth.guard';

@ApiBearerAuth()
@ApiTags('Quizzes')
@Controller('quizzes')
@UseGuards(SessionAuthGuard)
export class AssessmentController {
  constructor(
    private readonly assessment: AssessmentService,
    @Inject(MAPPER) private readonly mapper: Mapper,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List Quiz summaries owned by the current Owner.' })
  @ApiOkResponse({ type: QuizSummaryResponseDto, isArray: true })
  async listQuizzes(@CurrentUser() ownerId: string): Promise<QuizSummaryResponseDto[]> {
    const results = await this.assessment.getQuizzes(ownerId);
    return this.mapper.mapArray(results, QuizSummaryResult, QuizSummaryResponseDto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get an owned Quiz without revealing correct answers.' })
  @ApiNotFoundResponse({ description: 'Quiz does not belong to the current Owner.' })
  @ApiOkResponse({ type: QuizResponseDto })
  async getQuiz(
    @CurrentUser() ownerId: string,
    @Param('id', new ParseUUIDPipe()) quizId: string,
  ): Promise<QuizResponseDto> {
    const result = await this.assessment.getQuiz(ownerId, quizId);
    return this.mapper.map(result, ServedQuizResult, QuizResponseDto);
  }

  @Post(':id/practice-feedback')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Grade one owned Quiz Question without creating an Attempt.' })
  @ApiBadRequestResponse({ description: 'Question or Option does not belong to the Quiz.' })
  @ApiNotFoundResponse({ description: 'Quiz does not belong to the current Owner.' })
  @ApiOkResponse({ type: PracticeFeedbackResponseDto })
  async getPracticeFeedback(
    @CurrentUser() ownerId: string,
    @Param('id', new ParseUUIDPipe()) quizId: string,
    @Body() dto: PracticeFeedbackRequestDto,
  ): Promise<PracticeFeedbackResponseDto> {
    const result = await this.assessment.getPracticeFeedback(ownerId, quizId, {
      optionId: dto.optionId,
      questionId: dto.questionId,
    });
    return this.mapper.map(result, PracticeFeedbackResult, PracticeFeedbackResponseDto);
  }

  @Get(':id/attempts/:attemptId')
  @ApiOperation({ summary: 'Get a persisted graded Attempt result owned by the current Owner.' })
  @ApiNotFoundResponse({ description: 'Attempt does not belong to the current Owner or Quiz.' })
  @ApiOkResponse({ type: AttemptResultResponseDto })
  async getAttemptResult(
    @CurrentUser() ownerId: string,
    @Param('id', new ParseUUIDPipe()) quizId: string,
    @Param('attemptId', new ParseUUIDPipe()) attemptId: string,
  ): Promise<AttemptResultResponseDto> {
    const result = await this.assessment.getAttemptResult(ownerId, quizId, attemptId);
    return this.mapper.map(result, PersistedAttemptResult, AttemptResultResponseDto);
  }

  @Get(':id/attempts')
  @ApiOperation({ summary: 'List graded Attempt history for an owned Quiz.' })
  @ApiNotFoundResponse({ description: 'Quiz does not belong to the current Owner.' })
  @ApiOkResponse({ type: AttemptHistoryResponseDto, isArray: true })
  async listAttemptHistory(
    @CurrentUser() ownerId: string,
    @Param('id', new ParseUUIDPipe()) quizId: string,
  ): Promise<AttemptHistoryResponseDto[]> {
    const results = await this.assessment.getAttemptHistory(ownerId, quizId);
    return this.mapper.mapArray(results, AttemptHistoryResult, AttemptHistoryResponseDto);
  }

  @Post(':id/attempts')
  @ApiOperation({ summary: 'Submit and synchronously grade one MCQ Attempt.' })
  @ApiBadRequestResponse({ description: 'Answers do not cover the Quiz exactly once.' })
  @ApiNotFoundResponse({ description: 'Quiz does not belong to the current Owner.' })
  @ApiCreatedResponse({ type: GradedAttemptResponseDto })
  async submitAttempt(
    @CurrentUser() ownerId: string,
    @Param('id', new ParseUUIDPipe()) quizId: string,
    @Body() dto: SubmitQuizAttemptDto,
  ): Promise<GradedAttemptResponseDto> {
    const result = await this.assessment.submitAttempt(
      ownerId,
      quizId,
      dto.answers.map((answer) => ({
        optionId: answer.optionId,
        questionId: answer.questionId,
      })),
    );
    return this.mapper.map(result, GradedAttemptResult, GradedAttemptResponseDto);
  }
}
