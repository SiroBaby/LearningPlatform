import { classes } from '@automapper/classes';
import { createMapper, type Mapper } from '@automapper/core';
import { beforeEach, describe, expect, it } from '@jest/globals';

import { SuperAdminRoleChangeRequestResult } from '../contracts/super-admin-role-change-request.result';
import { SuperAdminRoleChangeRequestResponseDto } from '../dto/super-admin-role-change-request.response.dto';
import { AdminOperationsMappingProfile } from './admin-operations-mapping.profile';

describe('AdminOperationsMappingProfile', () => {
  let mapper: Mapper;

  beforeEach(() => {
    mapper = createMapper({ strategyInitializer: classes() });
    new AdminOperationsMappingProfile(mapper);
  });

  it('maps role-change expiry as a UTC ISO timestamp for the admin API', () => {
    const request = Object.assign(new SuperAdminRoleChangeRequestResult(), {
      approvalCount: 1,
      canApprove: true,
      createdAt: new Date('2026-09-02T08:00:00.000Z'),
      desiredRole: 'SUPER_ADMIN' as const,
      expiresAt: new Date('2026-09-02T08:30:00.000Z'),
      id: '5a8bc836-a508-4b2f-8bea-a0ee2518bbb6',
      requesterId: 'f387b115-f93f-4e21-8c8e-6433b155d55d',
      requiredApprovals: 2 as const,
      targetUserId: 'aeb863c3-78ba-4e38-b86e-a5f04b9f8fc5',
    });

    expect(mapper.map(request, SuperAdminRoleChangeRequestResult, SuperAdminRoleChangeRequestResponseDto)).toEqual({
      approvalCount: 1,
      canApprove: true,
      createdAt: '2026-09-02T08:00:00.000Z',
      desiredRole: 'SUPER_ADMIN',
      expiresAt: '2026-09-02T08:30:00.000Z',
      id: request.id,
      requesterId: request.requesterId,
      requiredApprovals: 2,
      targetUserId: request.targetUserId,
    });
  });
});
