import { Body, Controller, Post } from '@nestjs/common';
import { AuthService, GradlineLoginResult } from './auth.service';
import { GoogleLoginDto } from './google-login.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('google')
  async google(@Body() dto: GoogleLoginDto): Promise<GradlineLoginResult> {
    return this.authService.loginWithGoogle(dto.idToken);
  }
}
