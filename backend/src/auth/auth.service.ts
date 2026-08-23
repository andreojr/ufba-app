import { ForbiddenException, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { GoogleTokenService } from './google-token.service';
import type { UserRecord, UserRepository } from '../users/user.repository';

const ALLOWED_EMAIL_DOMAIN = '@ufba.br';

export interface UfbaLoginResult {
  accessToken: string;
  user: UserRecord;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly googleTokenService: GoogleTokenService,
    private readonly jwtService: JwtService,
    private readonly userRepository: UserRepository,
  ) {}

  async loginWithGoogle(idToken: string): Promise<UfbaLoginResult> {
    const googleUser = await this.googleTokenService.verify(idToken);

    if (!googleUser.email.toLowerCase().endsWith(ALLOWED_EMAIL_DOMAIN)) {
      throw new ForbiddenException(
        'Apenas contas @ufba.br podem entrar no UFBA',
      );
    }

    const user = await this.userRepository.upsertGoogleUser(googleUser);

    const accessToken = this.jwtService.sign({
      sub: user.id,
      email: user.email,
      name: user.name,
    });

    return { accessToken, user };
  }
}
