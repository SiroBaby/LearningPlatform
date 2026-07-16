import { Mapper } from '@automapper/core';
import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';

import { CurrentUser } from '../../common/current-user.decorator';
import { MAPPER } from '../../common/mapping/mapper.provider';
import {
  GradedAttemptResult,
  ServedQuizResult,
} from './contracts/quiz-attempt.result';
import { GradedAttemptResponseDto } from './dto/graded-attempt.response.dto';
import { QuizResponseDto } from './dto/quiz.response.dto';
import { SubmitQuizAttemptDto } from './dto/submit-quiz-attempt.dto';
import { AssessmentService } from './assessment.service';

@ApiSecurity('ownerId')
@ApiTags('Quizzes')
@Controller('quizzes')
export class AssessmentController {
  constructor(
    private readonly assessment: AssessmentService,
    @Inject(MAPPER) private readonly mapper: Mapper,
  ) {}

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
