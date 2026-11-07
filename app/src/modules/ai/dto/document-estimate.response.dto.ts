import { ApiProperty } from '@nestjs/swagger';
import { AutoMap } from '@automapper/classes';

export class DocumentEstimateResponseDto {
  @ApiProperty({ description: 'Coarse platform credit projection. CUSTOM models return zero because their provider usage is not platform-billed. Null for audio/video: the amount is calculated from the probed duration after the media check.', example: 1000, minimum: 0, nullable: true, type: Number })
  @AutoMap(() => Number)
  readonly estimatedCredits: number | null;

  @ApiProperty({ description: 'Estimate precision. COARSE is not an authoritative settlement or a reservation. AFTER_MEDIA_CHECK means audio/video credits are only calculated after the file is checked.', enum: ['COARSE', 'AFTER_MEDIA_CHECK'], example: 'COARSE' })
  @AutoMap()
  readonly precision: 'COARSE' | 'AFTER_MEDIA_CHECK';

  @ApiProperty({ description: 'Validated source of the selected model.', enum: ['PLAN', 'CUSTOM'], example: 'PLAN' })
  @AutoMap()
  readonly selectedModelKind: 'PLAN' | 'CUSTOM';

  @ApiProperty({ description: 'Configured display label for the selected model; never a custom credential or endpoint.', example: 'Fast platform model' })
  @AutoMap()
  readonly selectedModelLabel: string;
}
