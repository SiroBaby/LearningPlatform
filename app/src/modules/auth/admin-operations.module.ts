import { Module } from '@nestjs/common';

import { InternalAuthGuard } from '../../common/internal-mtls.guard';
import { AiModule } from '../ai/ai.module';
import { AuthModule } from './auth.module';
import { AdminOperationsController } from './admin-operations.controller';
import { AdminOperationsService } from './admin-operations.service';
import { AdminOperationsMappingProfile } from './mappings/admin-operations-mapping.profile';
import { RolesGuard } from './roles.guard';

@Module({
  imports: [AuthModule, AiModule],
  controllers: [AdminOperationsController],
  providers: [AdminOperationsService, AdminOperationsMappingProfile, InternalAuthGuard, RolesGuard],
})
export class AdminOperationsModule {}
