import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsOptional, MaxLength } from 'class-validator';

import { IsNonBlankString } from '../../../common/validators/is-non-blank-string.validator';

export class CreateCustomModelConfigDto {
  @ApiProperty({ example: 'Company proxy' })
  @IsNonBlankString()
  @MaxLength(120)
  displayName!: string;

  @ApiProperty({ example: 'https://proxy.example.com/v1', format: 'uri' })
  @IsNonBlankString()
  baseUrl!: string;

  @ApiProperty({ example: 'gpt-4.1-mini' })
  @IsNonBlankString()
  @MaxLength(255)
  model!: string;

  @ApiProperty({ example: 'v1' })
  @IsNonBlankString()
  @MaxLength(100)
  capabilityVersion!: string;

  @ApiProperty({ enum: ['responses', 'chat-completions'], example: 'responses' })
  @IsEnum(['responses', 'chat-completions'])
  transport!: 'responses' | 'chat-completions';

  @ApiProperty({ enum: ['json-object', 'json-schema-strict'], example: 'json-schema-strict' })
  @IsEnum(['json-object', 'json-schema-strict'])
  structuredOutputMode!: 'json-object' | 'json-schema-strict';

  @ApiProperty({ example: 'sk-...', required: false, writeOnly: true })
  @IsOptional()
  apiKey?: string;
}
