import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { OAuthTransaction } from './entities/oauth-transaction.entity';
import { Session } from './entities/session.entity';
import { UserProfile } from './entities/user-profile.entity';
import { User } from './entities/user.entity';
import { AuthController } from './auth.controller';
import { AuthSessionController } from './auth-session.controller';
import { AuthService } from './auth.service';
import { AuthRepository } from './repositories/auth.repository';
import { GOOGLE_OAUTH_PROVIDER, GoogleOAuthClientProvider } from './google-oauth.provider';

@Module({
  imports: [TypeOrmModule.forFeature([OAuthTransaction, Session, UserProfile, User])],
  controllers: [AuthController, AuthSessionController],
  providers: [AuthRepository, AuthService, GoogleOAuthClientProvider, { provide: GOOGLE_OAUTH_PROVIDER, useExisting: GoogleOAuthClientProvider }],
  exports: [AuthService],
})
export class AuthModule {}
