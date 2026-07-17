import { AutoMap } from '@automapper/classes';

export class DocumentEstimateResult {
  @AutoMap()
  estimatedCredits!: number;

  @AutoMap()
  precision!: 'COARSE';

  @AutoMap()
  selectedModelKind!: 'PLAN' | 'CUSTOM';

  @AutoMap()
  selectedModelLabel!: string;
}
