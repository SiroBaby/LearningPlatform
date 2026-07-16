import { AutoMap } from '@automapper/classes';
import { ApiProperty } from '@nestjs/swagger';

export class DocumentQuizResponseDto {
  @ApiProperty({ format: 'uuid' })
  @AutoMap()
  readonly quizId: string;

  @ApiProperty({ format: 'uuid' })
  @AutoMap()
  readonly documentId: string;

  @ApiProperty({ description: 'Number of Questions in the discovered Quiz.', example: 5 })
  @AutoMap()
  readonly questionCount: number;
}
