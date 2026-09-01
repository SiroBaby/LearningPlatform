import { Body, Controller, Post, UseGuards } from '@nestjs/common';

import { InternalAuthGuard } from '../../common/internal-mtls.guard';
import { AuthService } from './auth.service';
import { GoogleExchangeRequest, GoogleStartRequest } from './dto/google-auth.dto';

@Controller('internal/v1/auth/google')
@UseGuards(InternalAuthGuard)
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('start')
  start(@Body() request: GoogleStartRequest): Promise<{ readonly authorizationUrl: string }> {
    return this.authService.start(request.login_hint);
  }

  @Post('exchange')
  exchange(@Body() request: GoogleExchangeRequest) {
    return this.authService.exchange(request.code, request.state);
  }
}
