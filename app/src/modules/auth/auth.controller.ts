import { Body, Controller, Get, Post, Query } from '@nestjs/common';

import { AuthService } from './auth.service';
import { GoogleExchangeRequest, GoogleStartQuery } from './dto/google-auth.dto';

@Controller('auth/google')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Get('start')
  start(@Query() query: GoogleStartQuery): Promise<{ readonly authorizationUrl: string }> {
    return this.authService.start(query.login_hint);
  }

  @Post('exchange')
  exchange(@Body() request: GoogleExchangeRequest) {
    return this.authService.exchange(request.code, request.state);
  }
}
