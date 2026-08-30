import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Patch, Post, UnauthorizedException } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';

import { AuthService } from './auth.service';
import { UpdateProfileDto } from './dto/update-profile.dto';

function bearerToken(value: string | undefined): string {
  const match = /^Bearer\s+(\S+)$/u.exec(value ?? '');
  if (!match) throw new UnauthorizedException('Invalid session');
  return match[1];
}

@Controller('auth')
@ApiTags('Authentication')
@ApiSecurity('bearer')
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

  @Patch('profile')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update the authenticated user profile and onboarding state.' })
  @ApiOkResponse({ description: 'Updated profile and account summary.' })
  updateProfile(@Headers('authorization') authorization: string | undefined, @Body() dto: UpdateProfileDto) {
    return this.authService.updateProfile(bearerToken(authorization), {
      displayName: dto.displayName,
      learningGoal: dto.learningGoal,
      onboardingAction: dto.onboardingAction,
      preferredLanguage: dto.preferredLanguage,
      proficiencyLevel: dto.proficiencyLevel,
    });
  }
}
