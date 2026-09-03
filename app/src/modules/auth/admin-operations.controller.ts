import { Mapper } from '@automapper/core';
import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBadRequestResponse, ApiBearerAuth, ApiForbiddenResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentAuthUser } from '../../common/current-auth-user.decorator';
import { InternalAuthGuard } from '../../common/internal-mtls.guard';
import { MAPPER } from '../../common/mapping/mapper.provider';
import type { AuthUser } from './contracts/google-auth.contracts';
import { SuperAdminRoleChangeRequestResult } from './contracts/super-admin-role-change-request.result';
import { SuperAdminApprovalDto } from './dto/super-admin-approval.dto';
import { SuperAdminBreakGlassDto } from './dto/super-admin-break-glass.dto';
import { SuperAdminBootstrapStatusResponseDto } from './dto/super-admin-bootstrap-status.response.dto';
import { SuperAdminRoleChangeRequestListResponseDto } from './dto/super-admin-role-change-request-list.response.dto';
import { SuperAdminRoleChangeRequestsQueryDto } from './dto/super-admin-role-change-requests.query.dto';
import { SuperAdminRoleChangeRequestResponseDto } from './dto/super-admin-role-change-request.response.dto';
import { SuperAdminRequestDto } from './dto/super-admin-request.dto';
import { AccountRole } from './enums/account-role.enum';
import { RequireRoles } from './roles.decorator';
import { RolesGuard } from './roles.guard';
import { SessionAuthGuard } from './session-auth.guard';
import { AdminOperationsService } from './admin-operations.service';

@ApiBearerAuth()
@ApiTags('Admin operations')
@Controller('admin')
// Administrative operations are available only through the internal BFF mTLS boundary.
@UseGuards(InternalAuthGuard, SessionAuthGuard, RolesGuard)
export class AdminOperationsController {
  constructor(
    private readonly operations: AdminOperationsService,
    @Inject(MAPPER) private readonly mapper: Mapper,
  ) {}

  @Get('operations')
  @RequireRoles(AccountRole.ADMIN, AccountRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Read the redacted operational health, job, failure-class, and resource allowlist.' })
  @ApiOkResponse({ description: 'Read-only redacted operational snapshot.' })
  getOperations(@CurrentAuthUser() actor: AuthUser) {
    return this.operations.readSnapshot(actor);
  }

  @Get('super-admin/role-change-requests')
  @RequireRoles(AccountRole.ADMIN, AccountRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'List pending SUPER_ADMIN role changes visible to the current administrator.' })
  @ApiBadRequestResponse({ description: 'The status or page size is invalid.' })
  @ApiForbiddenResponse({ description: 'The account is not an active administrator.' })
  @ApiOkResponse({ type: SuperAdminRoleChangeRequestListResponseDto })
  async listRoleChangeRequests(
    @CurrentAuthUser() actor: AuthUser,
    @Query() query: SuperAdminRoleChangeRequestsQueryDto,
  ): Promise<SuperAdminRoleChangeRequestListResponseDto> {
    const result = await this.operations.listRoleChangeRequests(actor, query.status, query.limit);
    return {
      items: this.mapper.mapArray(
        result.items,
        SuperAdminRoleChangeRequestResult,
        SuperAdminRoleChangeRequestResponseDto,
      ),
      nextCursor: result.nextCursor,
    };
  }

  @Post('super-admin/bootstrap')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireRoles(AccountRole.ADMIN)
  @ApiOperation({ summary: 'Bootstrap the first SUPER_ADMIN exactly once from an existing ADMIN session.' })
  async bootstrap(@CurrentAuthUser() actor: AuthUser): Promise<void> {
    await this.operations.bootstrapFirstSuperAdmin(actor);
  }

  @Get('super-admin/bootstrap/status')
  @RequireRoles(AccountRole.ADMIN, AccountRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Read the current SUPER_ADMIN bootstrap and recovery mode.' })
  @ApiOkResponse({ type: SuperAdminBootstrapStatusResponseDto })
  async readSuperAdminBootstrapStatus(@CurrentAuthUser() actor: AuthUser): Promise<SuperAdminBootstrapStatusResponseDto> {
    const status = await this.operations.readSuperAdminBootstrapStatus(actor);
    return { mode: status.mode };
  }

  @Post('super-admin/break-glass')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireRoles(AccountRole.ADMIN)
  @ApiOperation({ summary: 'Temporarily elevate the current ADMIN with an independently issued external approval.' })
  async grantBreakGlass(@CurrentAuthUser() actor: AuthUser, @Body() dto: SuperAdminBreakGlassDto): Promise<void> {
    await this.operations.grantBreakGlassSecondSuperAdmin(actor, dto.approvalToken);
  }

  @Post('super-admin/role-change-requests')
  @RequireRoles(AccountRole.ADMIN, AccountRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Request a SUPER_ADMIN promotion or demotion after two SUPER_ADMIN accounts exist.' })
  requestRoleChange(@CurrentAuthUser() actor: AuthUser, @Body() dto: SuperAdminRequestDto) {
    return this.operations.requestRoleChange(actor, dto.targetUserId, dto.desiredRole);
  }

  @Post('super-admin/role-change-approvals')
  @RequireRoles(AccountRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Approve a pending SUPER_ADMIN role change; requester and target are ineligible.' })
  approveRoleChange(@CurrentAuthUser() actor: AuthUser, @Body() dto: SuperAdminApprovalDto) {
    return this.operations.approveRoleChange(actor, dto.requestId);
  }
}
