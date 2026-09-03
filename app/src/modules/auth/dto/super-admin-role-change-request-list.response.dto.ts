import { ApiProperty } from '@nestjs/swagger';

import { SuperAdminRoleChangeRequestResponseDto } from './super-admin-role-change-request.response.dto';

export class SuperAdminRoleChangeRequestListResponseDto {
  @ApiProperty({ type: SuperAdminRoleChangeRequestResponseDto, isArray: true })
  readonly items!: SuperAdminRoleChangeRequestResponseDto[];

  @ApiProperty({ nullable: true, type: String, example: null, description: 'Con trỏ trang kế tiếp; hiện chưa dùng phân trang tiếp nối.' })
  readonly nextCursor!: string | null;
}
