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
}

export class QuizResponseDto {
  @ApiProperty({ format: 'uuid' })
  @AutoMap()
  readonly id: string;

  @ApiProperty({ isArray: true, type: QuizQuestionResponseDto })
  @AutoMap(() => [QuizQuestionResponseDto])
  readonly questions: QuizQuestionResponseDto[];
}
