import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsUUID } from 'class-validator';

export class SuperAdminRequestDto {
  @ApiProperty({ description: 'UUID of the target account.', example: '00000000-0000-0000-0000-000000000002' })
  @IsUUID()
  targetUserId!: string;

  @ApiProperty({ description: 'Requested final role.', enum: ['SUPER_ADMIN', 'ADMIN'], example: 'SUPER_ADMIN' })
  @IsIn(['SUPER_ADMIN', 'ADMIN'])
  desiredRole!: 'SUPER_ADMIN' | 'ADMIN';
}
