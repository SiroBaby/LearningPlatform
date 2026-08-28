import { Controller, Get, Headers, HttpCode, HttpStatus, Post, UnauthorizedException } from '@nestjs/common';

import { AuthService } from './auth.service';

function bearerToken(value: string | undefined): string {
  const match = /^Bearer\s+(\S+)$/u.exec(value ?? '');
  if (!match) throw new UnauthorizedException('Invalid session');
  return match[1];
}

@Controller('auth')
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
