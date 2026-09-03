import { ApiProperty } from '@nestjs/swagger';
import { IsNonBlankString } from '../../../common/validators/is-non-blank-string.validator';
import { MaxLength } from 'class-validator';

export class SuperAdminBreakGlassDto {
  @ApiProperty({ description: 'JWS approval token issued by the external operations workflow.' })
  @IsNonBlankString()
  @MaxLength(8192)
  approvalToken!: string;
}
