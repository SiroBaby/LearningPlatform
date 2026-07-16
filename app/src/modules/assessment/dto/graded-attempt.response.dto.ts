import { AutoMap } from '@automapper/classes';
import { ApiProperty } from '@nestjs/swagger';

import type { CitationCandidate } from '../contracts/quiz-generation-handoff.contract';

export class GradedQuestionResponseDto {
  @ApiProperty({ format: 'uuid' })
  @AutoMap()
  readonly questionId: string;

  @ApiProperty({ format: 'uuid' })
  @AutoMap()
  readonly selectedOptionId: string;

  @ApiProperty({ example: true })
  @AutoMap()
  readonly isCorrect: boolean;

  @ApiProperty({ example: 'Đáp án được suy ra trực tiếp từ đoạn nguồn.' })
  @AutoMap()
  readonly explanation: string;

  @ApiProperty({
    example: {
      chunkId: 'f9f69d06-312c-4fcb-baba-46c2c8889f09',
      locator: { kind: 'page', page: 1 },
      snippet: 'Đoạn nguồn dùng để tạo câu hỏi.',
    },
  })
  readonly citation: CitationCandidate;
}

export class GradedAttemptResponseDto {
  @ApiProperty({ format: 'uuid' })
  @AutoMap()
  readonly attemptId: string;

  @ApiProperty({ description: 'Number of correctly answered Questions.', example: 1 })
  @AutoMap()
  readonly score: number;

  @ApiProperty({ description: 'Total number of Questions in the Attempt.', example: 2 })
  @AutoMap()
  readonly questionCount: number;

  @ApiProperty({ isArray: true, type: GradedQuestionResponseDto })
  @AutoMap(() => [GradedQuestionResponseDto])
  readonly results: GradedQuestionResponseDto[];
}
