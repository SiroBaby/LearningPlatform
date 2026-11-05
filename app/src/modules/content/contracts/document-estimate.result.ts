import { AutoMap } from '@automapper/classes';

export class DocumentEstimateResult {
  /** Null when the amount is only known after the media check (AFTER_MEDIA_CHECK). */
  @AutoMap(() => Number)
  estimatedCredits!: number | null;

  @AutoMap()
  precision!: 'COARSE' | 'AFTER_MEDIA_CHECK';

  @AutoMap()
  selectedModelKind!: 'PLAN' | 'CUSTOM';

  @AutoMap()
  selectedModelLabel!: string;
}
