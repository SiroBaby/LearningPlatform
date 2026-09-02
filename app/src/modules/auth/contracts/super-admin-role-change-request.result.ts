import { AutoMap } from '@automapper/classes';

export class SuperAdminRoleChangeRequestResult {
  @AutoMap()
  id!: string;

  @AutoMap()
  requesterId!: string;

  @AutoMap()
  targetUserId!: string;

  @AutoMap()
  desiredRole!: 'ADMIN' | 'SUPER_ADMIN';

  @AutoMap()
  createdAt!: Date;

  @AutoMap()
  expiresAt!: Date;

  @AutoMap()
  approvalCount!: number;

  @AutoMap()
  requiredApprovals!: 2;

  @AutoMap()
  canApprove!: boolean;
}
