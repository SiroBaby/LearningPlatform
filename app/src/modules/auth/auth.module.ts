import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { OAuthTransaction } from './entities/oauth-transaction.entity';
import { AuthOutboxEvent } from './entities/auth-outbox-event.entity';
import { Session } from './entities/session.entity';
import { UserProfile } from './entities/user-profile.entity';
import { User } from './entities/user.entity';
import { AuthController } from './auth.controller';
import { AuthProfileController, AuthSessionController } from './auth-session.controller';
import { AuthService } from './auth.service';
import { AuthRepository } from './repositories/auth.repository';
import { AuthOutboxRepository } from './repositories/auth-outbox.repository';
import { GOOGLE_OAUTH_PROVIDER, GoogleOAuthClientProvider } from './google-oauth.provider';
import { SessionAuthGuard } from './session-auth.guard';
import { InternalAuthGuard } from '../../common/internal-mtls.guard';

@Module({
  imports: [TypeOrmModule.forFeature([AuthOutboxEvent, OAuthTransaction, Session, UserProfile, User])],
  controllers: [AuthController, AuthProfileController, AuthSessionController],
  providers: [AuthOutboxRepository, AuthRepository, AuthService, GoogleOAuthClientProvider, InternalAuthGuard, SessionAuthGuard, { provide: GOOGLE_OAUTH_PROVIDER, useExisting: GoogleOAuthClientProvider }],
  exports: [AuthOutboxRepository, AuthRepository, AuthService, SessionAuthGuard],
})
export class AuthModule {}
