import { Injectable } from '@nestjs/common';
import { OAuth2Client, TokenPayload } from 'google-auth-library';

export class GoogleTokenInvalidError extends Error {
  constructor() {
    super('Google ID token is invalid or expired');
    this.name = 'GoogleTokenInvalidError';
  }
}

export interface GoogleUserInfo {
  googleId: string;
  email: string;
  name: string;
}

export interface GoogleIdTokenVerifier {
  verifyIdToken(options: {
    idToken: string;
    audience: string;
  }): Promise<{ getPayload(): TokenPayload | undefined }>;
}

@Injectable()
export class GoogleTokenService {
  constructor(
    private readonly googleClientId: string,
    private readonly verifier: GoogleIdTokenVerifier = new OAuth2Client(),
  ) {}

  async verify(idToken: string): Promise<GoogleUserInfo> {
    let payload: TokenPayload | undefined;

    try {
      const ticket = await this.verifier.verifyIdToken({
        idToken,
        audience: this.googleClientId,
      });
      payload = ticket.getPayload();
    } catch {
      throw new GoogleTokenInvalidError();
    }

    if (!payload?.sub || !payload.email) {
      throw new GoogleTokenInvalidError();
    }

    return {
      googleId: payload.sub,
      email: payload.email,
      name: payload.name ?? payload.email,
    };
  }
}
