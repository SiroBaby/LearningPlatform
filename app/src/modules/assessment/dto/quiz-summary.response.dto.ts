import { AutoMap } from '@automapper/classes';
import { ApiProperty } from '@nestjs/swagger';

export class QuizSummaryResponseDto {
  @ApiProperty({ format: 'uuid' })
  @AutoMap()
  readonly id: string;

  @ApiProperty({ format: 'uuid' })
  @AutoMap()
  readonly documentId: string;

  @ApiProperty({ example: 5 })
  @AutoMap()
  readonly questionCount: number;
}
