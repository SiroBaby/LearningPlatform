import { SetMetadata } from '@nestjs/common';

import type { AccountRole } from './enums/account-role.enum';

export const REQUIRED_ACCOUNT_ROLES = 'requiredAccountRoles';

export const RequireRoles = (...roles: readonly AccountRole[]) => SetMetadata(REQUIRED_ACCOUNT_ROLES, roles);
