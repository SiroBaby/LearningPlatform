import { describe, expect, it } from '@jest/globals';
import { MODULE_METADATA } from '@nestjs/common/constants';

import { AiModule } from '../ai/ai.module';
import { AdminOperationsController } from './admin-operations.controller';
import { AdminOperationsModule } from './admin-operations.module';
import { AuthModule } from './auth.module';

describe('AdminOperationsModule wiring', () => {
  it('keeps the admin operation graph separate from the auth-only module', () => {
    const authImports = Reflect.getMetadata(MODULE_METADATA.IMPORTS, AuthModule) as readonly unknown[];
    const authControllers = Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, AuthModule) as readonly unknown[];
    const adminImports = Reflect.getMetadata(MODULE_METADATA.IMPORTS, AdminOperationsModule) as readonly unknown[];
    const adminControllers = Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, AdminOperationsModule) as readonly unknown[];

    expect(authImports).not.toContain(AiModule);
    expect(authControllers).not.toContain(AdminOperationsController);
    expect(adminImports).toEqual(expect.arrayContaining([AuthModule, AiModule]));
    expect(adminControllers).toContain(AdminOperationsController);
  });
});
