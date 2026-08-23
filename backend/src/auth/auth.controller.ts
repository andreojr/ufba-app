import { Body, Controller, Post } from '@nestjs/common';
import { AuthService, UfbaLoginResult } from './auth.service';
import { GoogleLoginDto } from './google-login.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('google')
  async google(@Body() dto: GoogleLoginDto): Promise<UfbaLoginResult> {
    return this.authService.loginWithGoogle(dto.idToken);
  }
}
