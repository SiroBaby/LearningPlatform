import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsInt, IsUUID, Min } from 'class-validator';

import { LEASE_AUTHORITY_AUDIENCE, LEASE_AUTHORITY_SCOPE } from '../contracts/lease-authority.contract';

export class ValidateLeaseRequestDto {
  @ApiProperty({ example: 1, minimum: 1 })
  @IsInt()
  @Min(1)
  attempt!: number;

  @ApiProperty({ example: LEASE_AUTHORITY_AUDIENCE })
  @IsIn([LEASE_AUTHORITY_AUDIENCE])
  audience!: typeof LEASE_AUTHORITY_AUDIENCE;

  @ApiProperty({ example: '116b0f94-f7e2-44ae-a686-c1298f638797', format: 'uuid' })
  @IsUUID()
  jobId!: string;

  @ApiProperty({ example: 'be997f29-8cb0-4a48-8fd6-11f176c3b6f0', format: 'uuid' })
  @IsUUID()
  leaseId!: string;

  @ApiProperty({ example: LEASE_AUTHORITY_SCOPE })
  @IsIn([LEASE_AUTHORITY_SCOPE])
  scope!: typeof LEASE_AUTHORITY_SCOPE;
}
