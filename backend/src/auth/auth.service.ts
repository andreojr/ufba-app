import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { GoogleTokenService, GoogleUserInfo } from './google-token.service';

export interface GradlineLoginResult {
  accessToken: string;
  user: GoogleUserInfo;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly googleTokenService: GoogleTokenService,
    private readonly jwtService: JwtService,
  ) {}

  async loginWithGoogle(idToken: string): Promise<GradlineLoginResult> {
    const user = await this.googleTokenService.verify(idToken);

    const accessToken = this.jwtService.sign({
      sub: user.googleId,
      email: user.email,
      name: user.name,
    });

    return { accessToken, user };
  }
}
