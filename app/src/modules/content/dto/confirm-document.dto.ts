import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

export class ConfirmDocumentDto {
  @ApiProperty({
    description: 'Owner confirms the right to use the video and its subtitle. Required for YOUTUBE Documents.',
    example: true,
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  rightsConfirmed?: boolean;
}
