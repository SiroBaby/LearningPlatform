import { Body, Controller, HttpCode, HttpStatus, Inject, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { LEASE_AUTHORITY, type LeaseAuthority } from './contracts/lease-authority.contract';
import { ValidateLeaseRequestDto } from './dto/validate-lease.request.dto';
import { InternalLeaseGuard } from './internal-lease.guard';

@ApiTags('Internal lease authority')
@Controller('internal/v1/lease-authority')
@UseGuards(InternalLeaseGuard)
export class InternalLeaseController {
  constructor(@Inject(LEASE_AUTHORITY) private readonly leaseAuthority: LeaseAuthority) {}

  @Post('validate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Validate an AI-owned processing lease fence.' })
  async validate(@Body() request: ValidateLeaseRequestDto): Promise<{ readonly valid: boolean }> {
    return { valid: await this.leaseAuthority.validate(request) };
  }
}
