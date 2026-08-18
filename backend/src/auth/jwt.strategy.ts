import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

export interface GradlineJwtPayload {
  sub: string;
  email: string;
  name: string;
}

export interface RequestUser {
  userId: string;
  email: string;
  name: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(secretOrConfig: string | ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey:
        typeof secretOrConfig === 'string'
          ? secretOrConfig
          : secretOrConfig.getOrThrow<string>('JWT_SECRET'),
    });
  }

  validate(payload: GradlineJwtPayload): Promise<RequestUser> {
    return Promise.resolve({
      userId: payload.sub,
      email: payload.email,
      name: payload.name,
    });
  }
}
