import {
  SigaaProfileUpdate,
  UserRecord,
  UserRepository,
} from '../users/user.repository';
import { PrismaService } from './prisma.service';

export class PrismaUserRepository implements UserRepository {
  constructor(private readonly prisma: PrismaService) {}

  async upsertGoogleUser(input: {
    googleId: string;
    email: string;
    name: string;
  }): Promise<UserRecord> {
    return this.prisma.user.upsert({
      where: { googleId: input.googleId },
      create: {
        googleId: input.googleId,
        email: input.email,
        name: input.name,
      },
      update: {
        email: input.email,
        name: input.name,
      },
    });
  }

  async findById(userId: string): Promise<UserRecord | null> {
    return this.prisma.user.findUnique({ where: { id: userId } });
  }

  async updateAvatarUrl(userId: string, avatarUrl: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { avatarUrl },
    });
  }

  async updateSigaaProfile(
    userId: string,
    profile: SigaaProfileUpdate,
  ): Promise<void> {
    // Null fields mean "the page didn't yield this" — leave the stored value
    // alone instead of erasing it.
    const data = Object.fromEntries(
      Object.entries(profile).filter(([, value]) => value !== null),
    );
    if (Object.keys(data).length === 0) {
      return;
    }
    await this.prisma.user.update({ where: { id: userId }, data });
  }
}
