import { ApiProperty } from '@nestjs/swagger';

import { SuperAdminBootstrapMode } from '../enums/super-admin-bootstrap-mode.enum';

export class SuperAdminBootstrapStatusResponseDto {
  @ApiProperty({
    description: 'Current SUPER_ADMIN bootstrap and recovery mode.',
    enum: SuperAdminBootstrapMode,
    example: SuperAdminBootstrapMode.SEED_SECOND,
  })
  mode!: SuperAdminBootstrapMode;
}
