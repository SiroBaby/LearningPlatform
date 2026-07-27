import { ApiProperty } from '@nestjs/swagger';

export class HealthResponseDto {
  @ApiProperty({
    description: 'Stable readiness indicator after successful bootstrap.',
    example: 'ok',
  })
  status!: 'ok';
}
