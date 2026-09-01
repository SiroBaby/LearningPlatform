import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Patch, Post, UnauthorizedException, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { InternalAuthGuard } from '../../common/internal-mtls.guard';
import { AuthService } from './auth.service';
import { UpdateProfileDto } from './dto/update-profile.dto';

function bearerToken(value: string | undefined): string {
  const match = /^Bearer\s+(\S+)$/u.exec(value ?? '');
  if (!match) throw new UnauthorizedException('Invalid session');
  return match[1];
}

@Controller('internal/v1/auth')
@UseGuards(InternalAuthGuard)
@ApiBearerAuth()
@ApiTags('Authentication')
export class AuthSessionController {
  constructor(private readonly authService: AuthService) {}

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(@Headers('authorization') authorization?: string) {
    return this.authService.refresh(bearerToken(authorization));
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@Headers('authorization') authorization?: string): Promise<void> {
    await this.authService.logout(bearerToken(authorization));
  }

  @Get('me')
  me(@Headers('authorization') authorization?: string) {
    return this.authService.me(bearerToken(authorization));
  }
}

@Controller('auth')
@UseGuards(InternalAuthGuard)
@ApiBearerAuth()
@ApiTags('Authentication')
export class AuthProfileController {
  constructor(private readonly authService: AuthService) {}

  @Patch('profile')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update the authenticated user profile and onboarding state.' })
  @ApiOkResponse({ description: 'Updated profile and account summary.' })
  updateProfile(
    @Headers('authorization') authorization: string | undefined,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.authService.updateProfile(bearerToken(authorization), {
      displayName: dto.displayName,
      learningGoal: dto.learningGoal,
      onboardingAction: dto.onboardingAction,
      preferredLanguage: dto.preferredLanguage,
      proficiencyLevel: dto.proficiencyLevel,
    });
  }
}
