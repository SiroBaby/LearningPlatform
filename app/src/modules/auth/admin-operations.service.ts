import { ConflictException, ForbiddenException, Inject, Injectable } from '@nestjs/common';

import { ApplicationConfigService } from '../../config/application-config.service';
import type { AuthUser } from './contracts/google-auth.contracts';
import { AccountRole } from './enums/account-role.enum';
import { AccountStatus } from './enums/account-status.enum';
import { AI_OPERATIONAL_SNAPSHOT, type AiOperationalSnapshot } from '../ai/contracts/ai-operational-snapshot.port';
import { SuperAdminRoleChangeRequestResult } from './contracts/super-admin-role-change-request.result';
import { hashOAuthValue } from './oauth-crypto';
import { verifyExternalApprovalToken } from './external-approval-token';
import { SuperAdminBootstrapMode } from './enums/super-admin-bootstrap-mode.enum';
import { AuthRepository } from './repositories/auth.repository';

@Injectable()
export class AdminOperationsService {
  constructor(
    @Inject(AI_OPERATIONAL_SNAPSHOT) private readonly operationalSnapshot: AiOperationalSnapshot,
    private readonly authRepository: AuthRepository,
    private readonly config?: ApplicationConfigService,
  ) {}

  async readSnapshot(actor: AuthUser): Promise<Awaited<ReturnType<AiOperationalSnapshot['readSnapshot']>>> {
    this.assertRole(actor, AccountRole.ADMIN, AccountRole.SUPER_ADMIN);
    return this.operationalSnapshot.readSnapshot();
  }

  async bootstrapFirstSuperAdmin(actor: AuthUser): Promise<void> {
    this.assertRole(actor, AccountRole.ADMIN);
    if (!await this.authRepository.bootstrapFirstSuperAdmin(actor.id)) {
      throw new ConflictException('First SUPER_ADMIN bootstrap is unavailable');
    }
  }

  async readSuperAdminBootstrapStatus(actor: AuthUser): Promise<{
    readonly activeSuperAdminCount: number;
    readonly available: boolean;
    readonly mode: SuperAdminBootstrapMode;
  }> {
    this.assertRole(actor, AccountRole.ADMIN, AccountRole.SUPER_ADMIN);
    const status = await this.authRepository.getSuperAdminBootstrapStatus();
    return {
      activeSuperAdminCount: status.activeSuperAdminCount,
      available: status.mode === SuperAdminBootstrapMode.FIRST_BOOTSTRAP || status.mode === SuperAdminBootstrapMode.SEED_SECOND || status.mode === SuperAdminBootstrapMode.QUORUM_RECOVERY,
      mode: status.mode,
    };
  }

  async grantBreakGlassSecondSuperAdmin(actor: AuthUser, approvalToken: string): Promise<void> {
    this.assertRole(actor, AccountRole.ADMIN);
    if (!this.config) throw new ForbiddenException('External approval is not configured');
    const verified = verifyExternalApprovalToken(
      approvalToken,
      this.config.application.externalApproval,
      this.config.application.environment,
    );
    if (!verified || verified.action !== 'GRANT_BREAK_GLASS_SUPER_ADMIN' || verified.targetUserId !== actor.id) {
      throw new ForbiddenException('External approval is not valid for this account');
    }
    const granted = await this.authRepository.grantBreakGlassSecondSuperAdmin({
      approval: {
        action: verified.action,
        audience: verified.audience,
        environment: verified.environment,
        expiresAt: verified.expiresAt,
        jtiHash: hashOAuthValue(verified.jti),
      },
      targetUserId: actor.id,
    });
    if (!granted) throw new ConflictException('Break-glass elevation is unavailable');
  }

  async requestRoleChange(actor: AuthUser, targetUserId: string, desiredRole: 'ADMIN' | 'SUPER_ADMIN'): Promise<{ readonly requestId: string }> {
    this.assertRole(actor, AccountRole.ADMIN, AccountRole.SUPER_ADMIN);
    const requestId = await this.authRepository.createSuperAdminRoleChangeRequest({
      desiredRole,
      requesterId: actor.id,
      targetUserId,
    });
    if (!requestId) throw new ConflictException('Role change requires two active SUPER_ADMIN accounts and an active target');
    return { requestId };
  }

  async approveRoleChange(actor: AuthUser, requestId: string): Promise<{ readonly completed: boolean }> {
    this.assertRole(actor, AccountRole.SUPER_ADMIN);
    const state = await this.authRepository.approveSuperAdminRoleChange({ approverId: actor.id, requestId });
    if (state === 0) throw new ForbiddenException('Approval is not eligible or is a duplicate');
    return { completed: state === 2 };
  }

  async listRoleChangeRequests(
    actor: AuthUser,
    status: 'pending',
    limit: number,
  ): Promise<{ readonly items: SuperAdminRoleChangeRequestResult[]; readonly nextCursor: null }> {
    this.assertRole(actor, AccountRole.ADMIN, AccountRole.SUPER_ADMIN);
    if (status !== 'pending') throw new ConflictException('Unsupported role-change request status');

    const rows = await this.authRepository.listPendingSuperAdminRoleChangeRequests({
      requesterId: actor.role === AccountRole.ADMIN ? actor.id : undefined,
      limit,
    });
    return {
      items: rows.map((row) => Object.assign(new SuperAdminRoleChangeRequestResult(), {
        approvalCount: row.approvalCount,
        canApprove: actor.role === AccountRole.SUPER_ADMIN
          && actor.id !== row.requesterId
          && actor.id !== row.targetUserId,
        createdAt: row.createdAt,
        desiredRole: row.desiredRole,
        expiresAt: row.expiresAt,
        id: row.id,
        requesterId: row.requesterId,
        requiredApprovals: 2 as const,
        targetUserId: row.targetUserId,
      })),
      nextCursor: null,
    };
  }

  private assertRole(actor: AuthUser, ...roles: readonly AccountRole[]): void {
    if (actor.status !== AccountStatus.ACTIVE || !roles.includes(actor.role)) {
      throw new ForbiddenException('Insufficient account role');
    }
  }
}
