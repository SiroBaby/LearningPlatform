import { IsOptional, IsString, MaxLength } from 'class-validator';

export class GoogleStartQuery {
  @IsOptional()
  @IsString()
  @MaxLength(320)
  login_hint?: string;
}

export class GoogleExchangeRequest {
  @IsString()
  @MaxLength(4_096)
  code!: string;

  @IsString()
  @MaxLength(512)
  state!: string;
}
