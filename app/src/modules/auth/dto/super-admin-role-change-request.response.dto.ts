import { AutoMap } from '@automapper/classes';
import { ApiProperty } from '@nestjs/swagger';

export class SuperAdminRoleChangeRequestResponseDto {
  @ApiProperty({ format: 'uuid' })
  @AutoMap()
  readonly id!: string;

  @ApiProperty({ format: 'uuid' })
  @AutoMap()
  readonly requesterId!: string;

  @ApiProperty({ format: 'uuid' })
  @AutoMap()
  readonly targetUserId!: string;

  @ApiProperty({ enum: ['ADMIN', 'SUPER_ADMIN'], example: 'SUPER_ADMIN' })
  @AutoMap()
  readonly desiredRole!: 'ADMIN' | 'SUPER_ADMIN';

  @ApiProperty({ format: 'date-time', example: '2026-09-02T08:00:00.000Z' })
  @AutoMap()
  readonly createdAt!: string;

  @ApiProperty({ format: 'date-time', example: '2026-09-02T08:30:00.000Z' })
  @AutoMap()
  readonly expiresAt!: string;

  @ApiProperty({ minimum: 0, maximum: 2, example: 1 })
  @AutoMap()
  readonly approvalCount!: number;

  @ApiProperty({ example: 2, default: 2 })
  @AutoMap()
  readonly requiredApprovals!: 2;

  @ApiProperty({ example: true })
  @AutoMap()
  readonly canApprove!: boolean;
}
