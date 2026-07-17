import { ApiProperty } from '@nestjs/swagger';

export class ModelCatalogItemDto {
  @ApiProperty({ example: 'platform-default' })
  readonly id: string;

  @ApiProperty({ enum: ['PLAN', 'CUSTOM'], example: 'PLAN' })
  readonly kind: 'PLAN' | 'CUSTOM';

  @ApiProperty({ example: 'platform-default' })
  readonly label: string;
}
