import { AutoMap } from '@automapper/classes';
import { ApiProperty } from '@nestjs/swagger';

export class QuizOptionResponseDto {
  @ApiProperty({ format: 'uuid' })
  @AutoMap()
  readonly id: string;

  @ApiProperty({ example: 0, minimum: 0 })
  @AutoMap()
  readonly optionIndex: number;

  @ApiProperty({ example: 'Cấu trúc dữ liệu tổ chức và lưu trữ dữ liệu.' })
  @AutoMap()
  readonly content: string;
}

export class QuizQuestionTimeRangeResponseDto {
  @ApiProperty({ example: 12.5, minimum: 0 })
  @AutoMap()
  readonly startSec: number;

  @ApiProperty({ example: 18, minimum: 0 })
  @AutoMap()
  readonly endSec: number;
}

export class QuizQuestionResponseDto {
  @ApiProperty({ format: 'uuid' })
  @AutoMap()
  readonly id: string;

  @ApiProperty({ example: 0, minimum: 0 })
  @AutoMap()
  readonly ordinal: number;

  @ApiProperty({ example: 'Cấu trúc dữ liệu là gì?' })
  @AutoMap()
  readonly stem: string;

  @ApiProperty({ isArray: true, type: QuizOptionResponseDto })
  @AutoMap(() => [QuizOptionResponseDto])
  readonly options: QuizOptionResponseDto[];

  @ApiProperty({
    description: 'Time range of the source in the media, or null when the source has no time locator.',
    nullable: true,
    type: QuizQuestionTimeRangeResponseDto,
  })
  readonly timeRange: QuizQuestionTimeRangeResponseDto | null;
}

export class QuizResponseDto {
  @ApiProperty({ format: 'uuid' })
  @AutoMap()
  readonly documentId: string;

  @ApiProperty({ format: 'uuid' })
  @AutoMap()
  readonly id: string;

  @ApiProperty({ isArray: true, type: QuizQuestionResponseDto })
  @AutoMap(() => [QuizQuestionResponseDto])
  readonly questions: QuizQuestionResponseDto[];
}
