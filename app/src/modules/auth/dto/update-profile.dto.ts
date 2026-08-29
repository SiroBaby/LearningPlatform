import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateProfileDto {
  @ApiProperty({ required: false, nullable: true, maxLength: 200, example: 'Ngoc Phat' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  displayName?: string | null;

  @ApiProperty({ required: false, nullable: true, maxLength: 80, example: 'exam-prep' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  learningGoal?: string | null;

  @ApiProperty({ required: false, nullable: true, enum: ['vi', 'en'] })
  @IsOptional()
  @IsIn(['vi', 'en'])
  preferredLanguage?: 'vi' | 'en' | null;

  @ApiProperty({ required: false, nullable: true, enum: ['BEGINNER', 'INTERMEDIATE', 'ADVANCED'] })
  @IsOptional()
  @IsIn(['BEGINNER', 'INTERMEDIATE', 'ADVANCED'])
  proficiencyLevel?: 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED' | null;

  @ApiProperty({ required: false, enum: ['complete', 'skip', 'reset'] })
  @IsOptional()
  @IsIn(['complete', 'skip', 'reset'])
  onboardingAction?: 'complete' | 'skip' | 'reset';
}
