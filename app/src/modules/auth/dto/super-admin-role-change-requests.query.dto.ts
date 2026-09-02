import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

export class SuperAdminRoleChangeRequestsQueryDto {
  @ApiProperty({ enum: ['pending'], example: 'pending', description: 'Chỉ hỗ trợ các yêu cầu đang chờ duyệt.' })
  @IsIn(['pending'])
  status!: 'pending';

  @ApiPropertyOptional({ default: 50, minimum: 1, maximum: 50, example: 50, description: 'Số yêu cầu tối đa trả về trong một lần.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit = 50;
}
