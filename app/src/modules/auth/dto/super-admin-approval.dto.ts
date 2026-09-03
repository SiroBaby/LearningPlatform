import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class SuperAdminApprovalDto {
  @ApiProperty({ description: 'UUID of the pending role-change request.', example: '00000000-0000-0000-0000-000000000010' })
  @IsUUID()
  requestId!: string;
}
