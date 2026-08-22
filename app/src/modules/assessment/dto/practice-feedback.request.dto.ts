import { IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class PracticeFeedbackRequestDto {
  @ApiProperty({
    description: 'Question being practiced within the owned Quiz.',
    example: 'f387b115-f93f-4e21-8c8e-6433b155d55d',
    format: 'uuid',
  })
  @IsUUID()
  questionId!: string;

  @ApiProperty({
    description: 'Selected Option belonging to the practiced Question.',
    example: '5a8bc836-a508-4b2f-8bea-a0ee2518bbb6',
    format: 'uuid',
  })
  @IsUUID()
  optionId!: string;
}
