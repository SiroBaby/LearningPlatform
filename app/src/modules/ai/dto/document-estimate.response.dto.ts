import { ApiProperty } from '@nestjs/swagger';
import { AutoMap } from '@automapper/classes';

export class DocumentEstimateResponseDto {
  @ApiProperty({ description: 'Coarse platform credit projection. CUSTOM models return zero because their provider usage is not platform-billed.', example: 1000, minimum: 0 })
  @AutoMap()
  readonly estimatedCredits: number;

  @ApiProperty({ description: 'Estimate precision. COARSE is not an authoritative settlement or a reservation.', example: 'COARSE' })
  @AutoMap()
  readonly precision: 'COARSE';

  @ApiProperty({ description: 'Validated source of the selected model.', enum: ['PLAN', 'CUSTOM'], example: 'PLAN' })
  @AutoMap()
  readonly selectedModelKind: 'PLAN' | 'CUSTOM';

  @ApiProperty({ description: 'Configured display label for the selected model; never a custom credential or endpoint.', example: 'Fast platform model' })
  @AutoMap()
  readonly selectedModelLabel: string;
}
