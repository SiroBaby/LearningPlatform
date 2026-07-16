import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SubmitQuizAnswerDto {
  @ApiProperty({ description: 'Question being answered.', format: 'uuid' })
  @IsUUID()
  questionId!: string;

  @ApiProperty({ description: 'Selected Option for the Question.', format: 'uuid' })
  @IsUUID()
  optionId!: string;
}

export class SubmitQuizAttemptDto {
  @ApiProperty({
    description: 'Exactly one selected Option for every Question in the Quiz.',
    isArray: true,
    type: SubmitQuizAnswerDto,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SubmitQuizAnswerDto)
  answers!: SubmitQuizAnswerDto[];
}
