import { AutoMap } from '@automapper/classes';
import { ApiProperty } from '@nestjs/swagger';

import type { CitationCandidate } from '../contracts/quiz-generation-handoff.contract';

export class AttemptResultQuestionResponseDto {
  @ApiProperty({ format: 'uuid' })
  @AutoMap()
  readonly questionId: string;

  @ApiProperty({ example: 0, minimum: 0 })
  @AutoMap()
  readonly ordinal: number;

  @ApiProperty({ example: 'Cấu trúc dữ liệu là gì?' })
  @AutoMap()
  readonly stem: string;

  @ApiProperty({ format: 'uuid' })
  @AutoMap()
  readonly selectedOptionId: string;

  @ApiProperty({ example: 'Cấu trúc dữ liệu tổ chức và lưu trữ dữ liệu.' })
  @AutoMap()
  readonly selectedOptionContent: string;

  @ApiProperty({ format: 'uuid' })
  @AutoMap()
  readonly correctOptionId: string;

  @ApiProperty({ example: 'Cấu trúc dữ liệu tổ chức và lưu trữ dữ liệu.' })
  @AutoMap()
  readonly correctOptionContent: string;

  @ApiProperty({ example: true })
  @AutoMap()
  readonly isCorrect: boolean;

  @ApiProperty({ example: 'Đáp án được suy ra trực tiếp từ đoạn nguồn.' })
  @AutoMap()
  readonly explanation: string;

  @ApiProperty({ example: { chunkId: 'f9f69d06-312c-4fcb-baba-46c2c8889f09', locator: { kind: 'page', page: 1 }, snippet: 'Đoạn nguồn dùng để tạo câu hỏi.' } })
  readonly citation: CitationCandidate;
}

export class AttemptResultResponseDto {
  @ApiProperty({ format: 'uuid' })
  @AutoMap()
  readonly attemptId: string;

  @ApiProperty({ format: 'uuid' })
  @AutoMap()
  readonly quizId: string;

  @ApiProperty({ format: 'date-time', example: '2026-07-16T00:00:00.000Z' })
  @AutoMap()
  readonly submittedAt: string;

  @ApiProperty({ example: 1 })
  @AutoMap()
  readonly score: number;

  @ApiProperty({ example: 2 })
  @AutoMap()
  readonly questionCount: number;

  @ApiProperty({ isArray: true, type: AttemptResultQuestionResponseDto })
  @AutoMap(() => [AttemptResultQuestionResponseDto])
  readonly results: AttemptResultQuestionResponseDto[];
}

export class AttemptHistoryResponseDto {
  @ApiProperty({ format: 'uuid' })
  @AutoMap()
  readonly attemptId: string;

  @ApiProperty({ format: 'uuid' })
  @AutoMap()
  readonly quizId: string;

  @ApiProperty({ format: 'date-time', example: '2026-07-16T00:00:00.000Z' })
  readonly submittedAt: string;

  @ApiProperty({ example: 1 })
  @AutoMap()
  readonly score: number;

  @ApiProperty({ example: 2 })
  @AutoMap()
  readonly questionCount: number;
}
